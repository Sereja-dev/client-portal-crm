import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUBSET_RESULTS_ROOT } from "../subset.js";
import { RESULTS_DIR } from "../report.js";
import { CANARY_RESULTS_DIR } from "../canary.js";

/**
 * Subprocess-level proofs for index.ts's own `--subset` / `--subset-preview`
 * CLI wiring — mirrors test/no-live-by-default.test.ts's / test/canary.test.ts's
 * own conventions exactly (real `npx tsx index.ts ...` spawns, never
 * importing index.ts directly — see subset.ts's own header comment for
 * why). The unit-level proofs (selection parsing, path safety, preview
 * internals, sweep execution with fake providers) live in
 * test/subset.test.ts instead.
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_CASES = "invoice-03,task-01,nonexistent-02,injection-02,invoice-02,drafting-02,client-search-01,mutation-01";

/**
 * See test/canary.test.ts's / test/no-live-by-default.test.ts's own
 * identical helper doc comment. AQENRA_EVAL_TEST_NO_LIVE=1 is the
 * PRIMARY, credential-independent mechanical boundary (index.ts's own
 * enforceTestNoLiveOrExit()) — carried by every subprocess spawn below,
 * regardless of what credential values that specific test also needs.
 */
function buildNoLiveChildEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { AQENRA_EVAL_ANTHROPIC_API_KEY, AQENRA_EVAL_OPENAI_API_KEY, ...rest } = process.env;
  return { ...rest, AQENRA_EVAL_TEST_NO_LIVE: "1", ...overrides };
}

function runSubprocess(args: string[], env: NodeJS.ProcessEnv): { output: string; threw: boolean } {
  try {
    const output = execFileSync("bash", ["-c", `npx tsx index.ts ${args.join(" ")} 2>&1`], { cwd: PACKAGE_DIR, encoding: "utf8", env });
    return { output, threw: false };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { output: String(e.stdout ?? "") + String(e.stderr ?? ""), threw: true };
  }
}

function cleanupRunDir(runId: string): void {
  const dir = join(SUBSET_RESULTS_ROOT, runId);
  rmSync(dir, { recursive: true, force: true });
}

describe("--subset — AQENRA_EVAL_TEST_NO_LIVE protection (§30)", () => {
  test("--subset with realistic-looking present credentials AND AQENRA_EVAL_TEST_NO_LIVE=1 is blocked before any provider import, and no artifact is written", () => {
    const runId = "test-no-live-subset-proof";
    cleanupRunDir(runId);
    const env = buildNoLiveChildEnv({
      AQENRA_EVAL_ANTHROPIC_API_KEY: "sk-ant-realistic-looking-sentinel-0123456789",
      AQENRA_EVAL_OPENAI_API_KEY: "sk-openai-realistic-looking-sentinel-0123456789",
    });
    const { output, threw } = runSubprocess(
      ["--subset", `--cases=${APPROVED_CASES}`, "--providers=anthropic,openai", "--repetitions=1", `--run-id=${runId}`],
      env,
    );
    assert.equal(threw, true, "expected a non-zero exit");
    assert.match(output, /TEST_NO_LIVE — refusing to proceed into provider code/);
    assert.equal(existsSync(join(SUBSET_RESULTS_ROOT, runId)), false, "no subset artifact directory should have been created");
    cleanupRunDir(runId);
  });

  test("--subset-preview never reaches (and is unaffected by) the TEST_NO_LIVE gate — it needs no credentials at all and writes nothing", () => {
    const runId = "test-no-live-preview-proof";
    cleanupRunDir(runId);
    const { output, threw } = runSubprocess(
      ["--subset-preview", `--cases=${APPROVED_CASES}`, "--providers=anthropic,openai", "--repetitions=2", `--run-id=${runId}`],
      buildNoLiveChildEnv(),
    );
    assert.equal(threw, false, `expected --subset-preview to succeed offline: ${output}`);
    assert.match(output, /"totalTurns": 32/);
    assert.match(output, /"absoluteProviderCallCeiling": 192/);
    assert.match(output, /Preview complete — no network call was made/);
    assert.equal(existsSync(join(SUBSET_RESULTS_ROOT, runId)), false);
  });
});

describe("--subset — selection safety at the CLI boundary", () => {
  test("--subset with no --cases at all fails closed and never silently runs all 36 cases", () => {
    const { output, threw } = runSubprocess(["--subset", "--providers=anthropic,openai", "--repetitions=1", "--run-id=no-cases-cli"], buildNoLiveChildEnv());
    assert.equal(threw, true);
    assert.match(output, /SUBSET_SELECTION_INVALID/);
    assert.match(output, /--cases is required/);
  });

  test("--subset with an unknown provider fails closed and never silently becomes \"both providers\"", () => {
    const { output, threw } = runSubprocess(["--subset", "--cases=invoice-03", "--providers=gemini", "--repetitions=1", "--run-id=bad-provider-cli"], buildNoLiveChildEnv());
    assert.equal(threw, true);
    assert.match(output, /SUBSET_SELECTION_INVALID/);
    assert.match(output, /unknown provider/);
  });

  test("--subset with a run-id attempting path traversal is rejected before any provider import", () => {
    const { output, threw } = runSubprocess(["--subset", "--cases=invoice-03", "--providers=anthropic", "--repetitions=1", "--run-id=../escape-attempt"], buildNoLiveChildEnv());
    assert.equal(threw, true);
    assert.match(output, /SUBSET_SELECTION_INVALID|not a safe run id/);
    assert.equal(existsSync(join(SUBSET_RESULTS_ROOT, "..", "escape-attempt")), false);
  });

  test("--subset selecting only openai never requires (or is blocked by) a missing anthropic credential", () => {
    const runId = "openai-only-credential-check";
    cleanupRunDir(runId);
    const env = buildNoLiveChildEnv({ AQENRA_EVAL_OPENAI_API_KEY: "sk-openai-realistic-looking-sentinel-0123456789" });
    const { output, threw } = runSubprocess(["--subset", "--cases=client-search-01", "--providers=openai", "--repetitions=1", `--run-id=${runId}`], env);
    // AQENRA_EVAL_ANTHROPIC_API_KEY is absent, but anthropic was never
    // selected, so credential validation must pass for openai alone —
    // the run should reach (and then be stopped by) the TEST_NO_LIVE
    // gate, never a "Missing AQENRA_EVAL_ANTHROPIC_API_KEY" message.
    assert.equal(threw, true);
    assert.equal(output.includes("Missing AQENRA_EVAL_ANTHROPIC_API_KEY"), false);
    assert.match(output, /TEST_NO_LIVE — refusing to proceed into provider code/);
    cleanupRunDir(runId);
  });

  test("--subset with both providers selected and only one credential present never reaches a provider, with or without TEST_NO_LIVE — no partial run", () => {
    const runId = "partial-credential-check";
    cleanupRunDir(runId);
    const { AQENRA_EVAL_ANTHROPIC_API_KEY, AQENRA_EVAL_OPENAI_API_KEY, ...rest } = process.env;
    const env = { ...rest, AQENRA_EVAL_OPENAI_API_KEY: "sk-openai-realistic-looking-sentinel-0123456789" };
    // Deliberately NOT setting AQENRA_EVAL_TEST_NO_LIVE here: this test
    // proves that missing AQENRA_EVAL_ANTHROPIC_API_KEY alone is enough
    // to guarantee no partial/live run happens, without relying on
    // TEST_NO_LIVE for safety. AQENRA_EVAL_ANTHROPIC_API_KEY is genuinely
    // absent (never forwarded), so this can only ever reach a clean local
    // refusal, never a real network call — but the EXACT refusal reached
    // first is legitimately either "SUBSET_DIRTY_WORKING_TREE" (this
    // repo's own working tree, e.g. mid-development) or
    // "Missing AQENRA_EVAL_ANTHROPIC_API_KEY" (a clean tree, e.g. CI
    // after a commit) — both are real, independent safety refusals ahead
    // of any provider touch, so either is an acceptable, sufficient
    // outcome for what this test actually needs to prove.
    const { output, threw } = runSubprocess(["--subset", "--cases=client-search-01", "--providers=anthropic,openai", "--repetitions=1", `--run-id=${runId}`], env);
    assert.equal(threw, true);
    assert.ok(
      output.includes("Missing AQENRA_EVAL_ANTHROPIC_API_KEY") || output.includes("SUBSET_DIRTY_WORKING_TREE"),
      `expected either the missing-credential or dirty-tree refusal, got: ${output}`,
    );
    assert.equal(existsSync(join(SUBSET_RESULTS_ROOT, runId)), false);
    cleanupRunDir(runId);
  });
});

describe("--subset — historical artifact isolation", () => {
  test("SUBSET_RESULTS_ROOT is distinct from and never overlaps official results/ or canary-results/", () => {
    assert.notEqual(SUBSET_RESULTS_ROOT, RESULTS_DIR);
    assert.notEqual(SUBSET_RESULTS_ROOT, CANARY_RESULTS_DIR);
  });
});
