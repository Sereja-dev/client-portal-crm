import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS_DIR } from "../report.js";

/**
 * Proves the exact ordering required by this remediation's Finding 1: a
 * stale snapshot must refuse BEFORE the eval-key presence check, BEFORE
 * any dynamic provider import, BEFORE any client construction, BEFORE
 * any network. This spawns the real CLI as a subprocess.
 *
 * Eval-test isolation (2026-09-20 remediation): every subprocess spawn
 * below carries AQENRA_EVAL_TEST_NO_LIVE=1 — the PRIMARY, credential-
 * independent mechanical boundary (see index.ts's own
 * enforceTestNoLiveOrExit()) that makes it impossible for these
 * subprocesses to ever reach a dynamic provider import, client
 * construction, or network call, regardless of whatever credential
 * values are supplied. The stale-snapshot scenario below uses an
 * isolated mkdtempSync() temp-file copy via AQENRA_EVAL_TEST_SNAPSHOT_PATH
 * (only ever honored when AQENRA_EVAL_TEST_NO_LIVE=1 is also set — see
 * index.ts's own resolveSnapshotPath()) instead of mutating the real,
 * committed fixtures/tool-contracts.snapshot.json — this file no longer
 * opens that canonical path for write at all, closing the cross-test
 * race this package's own 2026-09-20 incident report identified (a
 * separate test file corrupting/restoring the same real, unlocked file
 * with no coordination).
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_SNAPSHOT_PATH = join(PACKAGE_DIR, "fixtures", "tool-contracts.snapshot.json");

/** See test/canary.test.ts's own identical helper doc comment. */
function buildNoLiveChildEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { AQENRA_EVAL_ANTHROPIC_API_KEY, AQENRA_EVAL_OPENAI_API_KEY, ...rest } = process.env;
  return { ...rest, AQENRA_EVAL_TEST_NO_LIVE: "1", ...overrides };
}

function sha256OfFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("index.ts --run — freshness gate ordering (real subprocess, mechanically no-live)", () => {
  const canonicalHashBefore = sha256OfFile(CANONICAL_SNAPSHOT_PATH);

  {
    // This test's own precondition — a genuinely FRESH snapshot reaching
    // the credential-presence check — requires RESULTS_DIR to hold none
    // of the four official artifact files, exactly like
    // results-dir-preflight.test.ts's own analogous precondition (see
    // that file's own identical comment). It genuinely cannot hold while
    // this repo's real results/ legitimately preserves official 1.1.0
    // evidence (README.md's own "Artifact lifecycle" section; that
    // evidence must never be deleted/moved to make a test pass).
    // Skipped, not weakened, when that precondition can't be met — a
    // real, foreseeable operator state, not a regression. When the
    // precondition DOES hold, this test must keep asserting the exact
    // credential-presence failure message, never a generic "some
    // non-zero exit happened" — a deleted/regressed credential check
    // must still fail this test.
    const staleFiles = ["results.json", "results.csv", "report.md", "forensic-trace.json"].filter((name) => existsSync(join(RESULTS_DIR, name)));
    test(
      "a FRESH snapshot with no keys set fails on the KEY-PRESENCE message, not a freshness message (freshness passes silently first)",
      { skip: staleFiles.length > 0 ? `RESULTS_DIR already holds preserved official evidence (${staleFiles.join(", ")}) — STALE_RESULTS_DIR would fire before the credential-presence check, which is not what this test verifies; see results-dir-preflight.test.ts for that ordering` : false },
      () => {
        for (const name of ["results.json", "results.csv", "report.md", "forensic-trace.json"]) {
          assert.equal(existsSync(join(RESULTS_DIR, name)), false, `precondition: ${name} must not exist for this test`);
        }

        let output = "";
        let threw = false;
        try {
          output = execFileSync("npx", ["tsx", "index.ts", "--run"], {
            cwd: PACKAGE_DIR,
            encoding: "utf8",
            env: buildNoLiveChildEnv(),
          });
        } catch (err) {
          threw = true;
          output = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
        }
        assert.equal(threw, true, "expected a non-zero exit (missing keys)");
        assert.match(output, /Missing AQENRA_EVAL_ANTHROPIC_API_KEY/);
        assert.equal(output.includes("SNAPSHOT_STALE"), false);
        assert.equal(output.includes("Running bounded live canary"), false);
      },
    );
  }

  test("a STALE snapshot (corrupted fingerprint) refuses with SNAPSHOT_STALE and NEVER reaches the key-presence message — even with a real-shaped (but fake) key present — using an isolated temp snapshot copy, never the canonical file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-freshness-stale-snapshot-"));
    try {
      const original = readFileSync(CANONICAL_SNAPSHOT_PATH, "utf8"); // read-only — never opened for write below
      const corrupted = JSON.parse(original);
      corrupted.sourceFingerprint = "deadbeef".repeat(8);
      const tempSnapshotPath = join(tempDir, "stale-tool-contracts.snapshot.json");
      writeFileSync(tempSnapshotPath, JSON.stringify(corrupted, null, 2) + "\n", "utf8");

      let output = "";
      let threw = false;
      try {
        output = execFileSync("npx", ["tsx", "index.ts", "--run"], {
          cwd: PACKAGE_DIR,
          encoding: "utf8",
          // Deliberately SET both eval keys to fake-but-present sentinel
          // values, to prove the ordering: if freshness ran AFTER the
          // key check, these present (if fake) keys would let execution
          // reach the freshness check having already passed the key
          // gate — this test instead proves freshness fires first
          // regardless. AQENRA_EVAL_TEST_NO_LIVE=1 (via
          // buildNoLiveChildEnv) remains the PRIMARY boundary
          // guaranteeing no live call regardless of this ordering.
          env: buildNoLiveChildEnv({
            AQENRA_EVAL_TEST_SNAPSHOT_PATH: tempSnapshotPath,
            AQENRA_EVAL_ANTHROPIC_API_KEY: "sk-ant-ORDERING-TEST-SENTINEL",
            AQENRA_EVAL_OPENAI_API_KEY: "sk-ORDERING-TEST-SENTINEL",
          }),
        });
      } catch (err) {
        threw = true;
        output = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
      }

      assert.equal(threw, true, "expected a non-zero exit (stale snapshot)");
      assert.match(output, /SNAPSHOT_STALE/);
      assert.equal(output.includes("Missing AQENRA_EVAL_ANTHROPIC_API_KEY"), false, "must never reach the key-presence check after a freshness failure");
      assert.equal(output.includes("ORDERING-TEST-SENTINEL"), false, "must never print a key value, present or not");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("the canonical snapshot was never opened for write by either test above — byte-identical before and after this whole suite", () => {
    assert.equal(sha256OfFile(CANONICAL_SNAPSHOT_PATH), canonicalHashBefore, "fixtures/tool-contracts.snapshot.json must be byte-identical — this file no longer mutates it at all");
  });
});
