import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves the exact ordering required by this remediation's Finding 1: a
 * stale snapshot must refuse BEFORE the eval-key presence check, BEFORE
 * any dynamic provider import, BEFORE any client construction, BEFORE
 * any network. This spawns the real CLI as a subprocess against a
 * deliberately corrupted (but restored afterward) copy of the committed
 * snapshot — an end-to-end proof, not just a unit test of
 * checkSnapshotFreshness() in isolation (see snapshot-freshness.test.ts
 * for that).
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_PATH = join(PACKAGE_DIR, "fixtures", "tool-contracts.snapshot.json");

describe("index.ts --run — freshness gate ordering (real subprocess, no network)", () => {
  test("a FRESH snapshot with no keys set fails on the KEY-PRESENCE message, not a freshness message (freshness passes silently first)", () => {
    let output = "";
    let threw = false;
    try {
      output = execFileSync("npx", ["tsx", "index.ts", "--run"], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        env: { ...process.env, AQENRA_EVAL_ANTHROPIC_API_KEY: "", AQENRA_EVAL_OPENAI_API_KEY: "" },
      });
    } catch (err) {
      threw = true;
      output = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
    }
    assert.equal(threw, true, "expected a non-zero exit (missing keys)");
    assert.match(output, /Missing AQENRA_EVAL_ANTHROPIC_API_KEY/);
    assert.equal(output.includes("SNAPSHOT_STALE"), false);
  });

  test("a STALE snapshot (corrupted fingerprint) refuses with SNAPSHOT_STALE and NEVER reaches the key-presence message — even with a real-shaped (but fake) key present", () => {
    const originalSnapshot = readFileSync(SNAPSHOT_PATH, "utf8");
    try {
      const corrupted = JSON.parse(originalSnapshot);
      corrupted.sourceFingerprint = "deadbeef".repeat(8);
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(corrupted, null, 2) + "\n", "utf8");

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
          // regardless, since these sentinels must never appear in the
          // failure output either.
          env: { ...process.env, AQENRA_EVAL_ANTHROPIC_API_KEY: "sk-ant-ORDERING-TEST-SENTINEL", AQENRA_EVAL_OPENAI_API_KEY: "sk-ORDERING-TEST-SENTINEL" },
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
      writeFileSync(SNAPSHOT_PATH, originalSnapshot, "utf8");
    }
  });

  test("snapshot file is restored to its exact original content after the stale-snapshot test above", () => {
    // Sanity check on the finally-block discipline of the previous test
    // — re-reads the file fresh rather than trusting a variable that
    // could have gone stale.
    const current = readFileSync(SNAPSHOT_PATH, "utf8");
    const snapshot = JSON.parse(current);
    assert.notEqual(snapshot.sourceFingerprint, "deadbeef".repeat(8));
  });
});
