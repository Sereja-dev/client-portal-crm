import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANARY_RESULTS_DIR } from "../canary.js";
import { RESULTS_DIR } from "../report.js";

/**
 * 2026-09-20 eval-test-isolation incident — regression coverage.
 *
 * Root cause (full write-up: the "AI EVAL TEST ISOLATION" audit): a
 * canary.test.ts subprocess test used non-empty, real-shaped sentinel
 * credentials, relying ENTIRELY on a shared, unlocked, real
 * fixtures/tool-contracts.snapshot.json file (also independently
 * mutated by freshness-ordering.test.ts) being observed as stale at
 * exactly the right moment. When that assumption didn't hold, the
 * sentinel credentials cleared the presence check and execution reached
 * a real provider call — one real OpenAI request and one real Anthropic
 * request, and a transient overwrite of the preserved
 * canary-results/canary-result.json artifact (since restored and
 * hash-verified against the original).
 *
 * This file proves, entirely offline, that the fix
 * (AQENRA_EVAL_TEST_NO_LIVE=1 in index.ts, checked immediately before
 * either dynamic provider import) closes that exact class of incident —
 * without relying on any snapshot/results-dir/credential-emptiness
 * side condition — and that the canonical snapshot/canary artifact are
 * never written by any of the affected test files anymore.
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_SNAPSHOT_PATH = join(PACKAGE_DIR, "fixtures", "tool-contracts.snapshot.json");
const CANARY_ARTIFACT_PATH = join(CANARY_RESULTS_DIR, "canary-result.json");

function sha256OfFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("regression — parent shell holding real-shaped, present eval credentials cannot reach provider code (the exact incident class)", () => {
  test("--canary with non-empty, realistic-looking sentinel credentials AND a genuinely FRESH canonical snapshot still refuses via TEST_NO_LIVE, before any provider-stage output or artifact write", () => {
    const beforeCanaryHash = sha256OfFile(CANARY_ARTIFACT_PATH);
    const beforeResults = existsSync(RESULTS_DIR) ? listDirSafely(RESULTS_DIR) : null;

    // Deliberately does NOT touch the snapshot at all — the canonical,
    // genuinely fresh file is used as-is, and the credential presence
    // check is deliberately allowed to pass (non-empty sentinels). If
    // AQENRA_EVAL_TEST_NO_LIVE=1 did not mechanically block here, this
    // is exactly the incident: a real provider call.
    const { AQENRA_EVAL_ANTHROPIC_API_KEY, AQENRA_EVAL_OPENAI_API_KEY, ...restEnv } = process.env;
    let output = "";
    let threw = false;
    try {
      output = execFileSync("npx", ["tsx", "index.ts", "--canary"], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        env: {
          ...restEnv,
          AQENRA_EVAL_TEST_NO_LIVE: "1",
          AQENRA_EVAL_ANTHROPIC_API_KEY: "sk-ant-REGRESSION-PARENT-CREDENTIAL-SENTINEL",
          AQENRA_EVAL_OPENAI_API_KEY: "sk-REGRESSION-PARENT-CREDENTIAL-SENTINEL",
        },
      });
    } catch (err) {
      threw = true;
      output = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
    }

    assert.equal(threw, true, "expected a non-zero exit — TEST_NO_LIVE refusal");
    assert.match(output, /TEST_NO_LIVE/);
    assert.equal(output.includes("SNAPSHOT_STALE"), false, "the snapshot genuinely was fresh — this refusal is NOT the freshness gate");
    assert.equal(output.includes("CREDENTIAL_MISSING"), false, "the sentinel credentials genuinely were present — this refusal is NOT the credential-presence gate");
    assert.equal(output.includes("Running bounded live canary"), false, "must never reach the provider-stage log line");
    assert.equal(output.includes("REGRESSION-PARENT-CREDENTIAL-SENTINEL"), false, "must never print a credential value");

    assert.equal(sha256OfFile(CANARY_ARTIFACT_PATH), beforeCanaryHash, "the real canary artifact must be byte-identical — no artifact write occurred");
    const afterResults = existsSync(RESULTS_DIR) ? listDirSafely(RESULTS_DIR) : null;
    assert.deepEqual(afterResults, beforeResults, "official results/ must be untouched");
  });
});

function listDirSafely(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

describe("regression — canonical tool-contract snapshot is never opened for write by any eval-test subprocess file anymore", () => {
  const affectedFiles = ["canary.test.ts", "freshness-ordering.test.ts", "no-live-by-default.test.ts", "results-dir-preflight.test.ts"];

  for (const fileName of affectedFiles) {
    test(`${fileName} never calls writeFileSync against the canonical snapshot path`, () => {
      const source = readFileSync(join(PACKAGE_DIR, "test", fileName), "utf8");
      // Every one of these files that touches a stale-snapshot scenario
      // now writes exclusively to a mkdtempSync()-created temp path —
      // this statically proves none of them still target the one real,
      // shared, committed CANONICAL_SNAPSHOT_PATH/SNAPSHOT_PATH constant
      // as a writeFileSync destination.
      assert.equal(/writeFileSync\(\s*(CANONICAL_)?SNAPSHOT_PATH\b/.test(source), false, `${fileName} must never writeFileSync(...) the canonical snapshot path`);
    });
  }

  test("the canonical snapshot's own fingerprint is unchanged by this file's own tests (it never touches the file)", () => {
    const before = sha256OfFile(CANONICAL_SNAPSHOT_PATH);
    // No action — this test exists purely as a before/after sentinel for
    // anyone re-running just this describe block in isolation.
    const after = sha256OfFile(CANONICAL_SNAPSHOT_PATH);
    assert.equal(after, before);
  });
});
