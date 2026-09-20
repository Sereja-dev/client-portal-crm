import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS_DIR } from "../report.js";

/**
 * Proves index.ts's `enforceResultsDirEmptyOrExit()` pre-flight: a live
 * run must refuse — before any secret-presence check, before any
 * provider import, before any network — if the official RESULTS_DIR
 * already contains artifacts from a prior run. This is the fail-closed
 * guard against silently overwriting/mixing stale official results (see
 * README.md's own "Artifact lifecycle" section).
 *
 * Spawns the real CLI as a subprocess against a deliberately-placed
 * sentinel `results.json`, exactly as freshness-ordering.test.ts does
 * for the snapshot-freshness gate. No API keys are ever set in the
 * subprocess environment, so even if this guard did NOT fire, execution
 * would still stop at the key-presence check before any network call —
 * this test's assertions are about ORDERING and MESSAGE, not about
 * whether a network call could occur.
 *
 * Like freshness-ordering.test.ts, this file spawns a subprocess that
 * reads/writes shared external state (the real RESULTS_DIR). Both files
 * must run with other test files serialized, never interleaved — see
 * package.json's `test` script, which passes `--test-concurrency=1` to
 * the node test runner for exactly this reason. Running any subset of
 * these files concurrently with each other can produce a spurious
 * failure (one subprocess observes the other's in-flight sentinel), not
 * a real regression.
 */
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** See test/canary.test.ts's own identical helper doc comment. */
function buildNoLiveChildEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { AQENRA_EVAL_ANTHROPIC_API_KEY, AQENRA_EVAL_OPENAI_API_KEY, ...rest } = process.env;
  return { ...rest, AQENRA_EVAL_TEST_NO_LIVE: "1", ...overrides };
}

describe("index.ts --run — stale RESULTS_DIR pre-flight (real subprocess, mechanically no-live)", () => {
  test("refuses with STALE_RESULTS_DIR and never reaches the key-presence check, when results.json already exists", () => {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const sentinelResultsJsonPath = join(RESULTS_DIR, "results.json");
    const preexisting = existsSync(sentinelResultsJsonPath);
    const sentinelContent = preexisting ? null : '{"sentinel":"results-dir-preflight-test"}';
    if (!preexisting) {
      writeFileSync(sentinelResultsJsonPath, sentinelContent as string, "utf8");
    }

    try {
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

      assert.equal(threw, true, "expected a non-zero exit (stale results dir)");
      assert.match(output, /STALE_RESULTS_DIR/);
      assert.match(output, /results\.json/);
      assert.equal(output.includes("Missing AQENRA_EVAL_ANTHROPIC_API_KEY"), false, "must never reach the key-presence check after a stale-results refusal");

      // The guard is read-only: it must not have touched the sentinel.
      assert.equal(existsSync(sentinelResultsJsonPath), true);
    } finally {
      // Clean up ONLY the sentinel this test itself created — never
      // touch a results.json that already existed before this test ran.
      if (!preexisting) {
        rmSync(sentinelResultsJsonPath, { force: true });
      }
    }
  });

  test("refuses with STALE_RESULTS_DIR when only a stale forensic-trace.json exists (PR 2, task §34) — never auto-deletes it", () => {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const sentinelTracePath = join(RESULTS_DIR, "forensic-trace.json");
    const preexisting = existsSync(sentinelTracePath);
    const sentinelContent = preexisting ? null : '{"sentinel":"results-dir-preflight-trace-test"}';
    if (!preexisting) {
      writeFileSync(sentinelTracePath, sentinelContent as string, "utf8");
    }

    try {
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

      assert.equal(threw, true, "expected a non-zero exit (stale forensic-trace.json)");
      assert.match(output, /STALE_RESULTS_DIR/);
      assert.match(output, /forensic-trace\.json/);
      assert.equal(output.includes("Missing AQENRA_EVAL_ANTHROPIC_API_KEY"), false, "must never reach the key-presence check after a stale-results refusal");
      assert.equal(existsSync(sentinelTracePath), true, "the guard is read-only — it must not delete the stale trace file itself");
    } finally {
      if (!preexisting) {
        rmSync(sentinelTracePath, { force: true });
      }
    }
  });

  {
    // This test's own precondition — RESULTS_DIR holds none of the four
    // official artifact files — genuinely cannot hold while this repo's
    // real results/ legitimately preserves official 1.1.0 evidence (see
    // README.md's own "Artifact lifecycle" section; that evidence must
    // never be deleted/moved to make a test pass). Skipped, not failed,
    // when that precondition can't be met — a real, foreseeable operator
    // state, not a regression.
    const staleFiles = ["results.json", "results.csv", "report.md", "forensic-trace.json"].filter((name) => existsSync(join(RESULTS_DIR, name)));
    test(
      "proceeds past the stale-results guard (reaches the key-presence check) when RESULTS_DIR has no prior artifact files",
      { skip: staleFiles.length > 0 ? `RESULTS_DIR already holds preserved official evidence (${staleFiles.join(", ")}) — this precondition cannot be met without deleting it, which this suite must never do` : false },
      () => {
        // This test only asserts ordering/reachability, not a live run:
        // it still supplies no keys, so execution is guaranteed to stop
        // at the key-presence check before any provider import or
        // network call.
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
        assert.equal(output.includes("STALE_RESULTS_DIR"), false);
      },
    );
  }
});
