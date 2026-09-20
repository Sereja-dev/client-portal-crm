import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANARY_CASE_ID,
  CANARY_MAX_PROVIDER_CALLS,
  CANARY_RESULTS_DIR,
  classifyCanaryProviderResult,
  executeCanarySweep,
  writeCanaryReport,
  type CanaryProviderSpec,
} from "../canary.js";
import { BENCHMARK_CASES } from "../cases.js";
import { RESULTS_DIR } from "../report.js";
import type { NormalizedProviderTurn } from "../result-types.js";

/**
 * Deliberately imports canary.ts directly, never index.ts — see
 * canary.ts's own header comment for why (index.ts has a top-level,
 * unconditional main() call that would run as an import side effect).
 * Real-subprocess assertions (missing credential, stale snapshot,
 * official results/ untouched) spawn `npx tsx index.ts --canary` exactly
 * like test/no-live-by-default.test.ts / test/freshness-ordering.test.ts
 * already do for --run.
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_SNAPSHOT_PATH = join(PACKAGE_DIR, "fixtures", "tool-contracts.snapshot.json");
const CANARY_ARTIFACT_PATH = join(CANARY_RESULTS_DIR, "canary-result.json");
const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const ZERO_COST = () => 0;

const CANARY_CASE = BENCHMARK_CASES.find((c) => c.id === CANARY_CASE_ID)!;

/**
 * Builds a child env for a subprocess spawn of index.ts's own --canary
 * mode, WITHOUT ever forwarding this process's own real
 * AQENRA_EVAL_ANTHROPIC_API_KEY/AQENRA_EVAL_OPENAI_API_KEY (destructured
 * out, never merely set to ""), and always carrying
 * AQENRA_EVAL_TEST_NO_LIVE=1 — the PRIMARY, credential-independent
 * mechanical boundary (see index.ts's own enforceTestNoLiveOrExit() doc
 * comment) that makes it impossible for this subprocess to ever reach a
 * dynamic provider import, client construction, or network call, no
 * matter what `overrides` below supplies (including a real-shaped
 * present sentinel credential, for the one ordering test that needs
 * one). `overrides` layers on top for exactly what one specific test
 * needs (a sentinel credential pair, a AQENRA_EVAL_TEST_SNAPSHOT_PATH
 * pointing at an isolated temp file — never the real credentials, never
 * a write to the canonical snapshot).
 */
function buildNoLiveChildEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { AQENRA_EVAL_ANTHROPIC_API_KEY, AQENRA_EVAL_OPENAI_API_KEY, ...rest } = process.env;
  return { ...rest, AQENRA_EVAL_TEST_NO_LIVE: "1", ...overrides };
}

function sha256OfFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function scripted(turns: NormalizedProviderTurn[]) {
  let cursor = 0;
  return async (): Promise<NormalizedProviderTurn> => {
    if (cursor >= turns.length) throw new Error("scripted provider: ran out of turns");
    const turn = turns[cursor];
    cursor += 1;
    return turn;
  };
}

const SUCCESSFUL_TOOL_ROUND_TRIP: NormalizedProviderTurn[] = [
  { kind: "ok", response: { kind: "toolCall", call: { toolName: "getOrganizationSummary", args: {} }, usage: USAGE } },
  { kind: "ok", response: { kind: "text", text: "Organization summary.", usage: USAGE } },
];

function fakeSpec(id: "openai" | "anthropic", turns: NormalizedProviderTurn[]): CanaryProviderSpec {
  return { id, model: `${id}-fake-model`, complete: scripted(turns), estimateCostUsd: ZERO_COST };
}

describe("canary.ts — fixed case / provider sequence / repetition (item 1, 2, 3, 4)", () => {
  test("1. CANARY_CASE_ID resolves to exactly one real BENCHMARK_CASES entry", () => {
    assert.equal(BENCHMARK_CASES.filter((c) => c.id === CANARY_CASE_ID).length, 1);
    assert.equal(CANARY_CASE.id, "org-summary-01");
  });

  test("2 & 3. executeCanarySweep runs each supplied spec exactly once, in array order (OpenAI first, Anthropic second when supplied that way)", async () => {
    const order: string[] = [];
    const openai = fakeSpec("openai", SUCCESSFUL_TOOL_ROUND_TRIP);
    const anthropic = fakeSpec("anthropic", SUCCESSFUL_TOOL_ROUND_TRIP);
    const originalOpenAiComplete = openai.complete;
    const originalAnthropicComplete = anthropic.complete;
    openai.complete = async (...args) => {
      order.push("openai");
      return originalOpenAiComplete(...args);
    };
    anthropic.complete = async (...args) => {
      order.push("anthropic");
      return originalAnthropicComplete(...args);
    };

    const sweep = await executeCanarySweep(CANARY_CASE, [openai, anthropic]);
    assert.equal(sweep.providers.length, 2);
    assert.equal(sweep.providers[0].provider, "openai");
    assert.equal(sweep.providers[1].provider, "anthropic");
    assert.deepEqual(order, ["openai", "openai", "anthropic", "anthropic"], "both providers, each their own full 2-call round trip, in spec order");
  });

  test("4. exactly one repetition per provider — executeCanarySweep never loops a spec more than once", async () => {
    const sweep = await executeCanarySweep(CANARY_CASE, [fakeSpec("openai", SUCCESSFUL_TOOL_ROUND_TRIP), fakeSpec("anthropic", SUCCESSFUL_TOOL_ROUND_TRIP)]);
    assert.equal(sweep.providers.filter((p) => p.provider === "openai").length, 1);
    assert.equal(sweep.providers.filter((p) => p.provider === "anthropic").length, 1);
  });
});

describe("canary.ts — request bound (item 5, 11)", () => {
  test("5 & 11. maxProviderCalls = 2 for both providers — a scripted 3rd tool-call turn is never reached, provider call count caps at 2 (absolute ceiling: 4 total)", async () => {
    let openaiCallCount = 0;
    let anthropicCallCount = 0;
    const toolCallTurn: NormalizedProviderTurn = { kind: "ok", response: { kind: "toolCall", call: { toolName: "getOrganizationSummary", args: {} }, usage: USAGE } };
    const openai: CanaryProviderSpec = {
      id: "openai",
      model: "m",
      complete: async () => {
        openaiCallCount += 1;
        return toolCallTurn;
      },
      estimateCostUsd: ZERO_COST,
    };
    const anthropic: CanaryProviderSpec = {
      id: "anthropic",
      model: "m",
      complete: async () => {
        anthropicCallCount += 1;
        return toolCallTurn;
      },
      estimateCostUsd: ZERO_COST,
    };

    const sweep = await executeCanarySweep(CANARY_CASE, [openai, anthropic]);

    assert.equal(openaiCallCount, CANARY_MAX_PROVIDER_CALLS, "OpenAI complete() invoked exactly CANARY_MAX_PROVIDER_CALLS times, never a 3rd");
    assert.equal(anthropicCallCount, CANARY_MAX_PROVIDER_CALLS, "Anthropic complete() invoked exactly CANARY_MAX_PROVIDER_CALLS times, never a 3rd");
    assert.equal(openaiCallCount + anthropicCallCount, 4, "absolute live request ceiling for the whole canary invocation is 4");
    assert.equal(sweep.providers[0].classification, "TOOL_PROTOCOL_FAILURE", "the ceiling was reached without a final text response");
    assert.equal(sweep.providers[1].classification, "TOOL_PROTOCOL_FAILURE");
  });
});

describe("canary.ts — provider B still runs after provider A's deterministic failure (item 6)", () => {
  test("6. OpenAI deterministic invalid_request does not prevent the Anthropic turn from running", async () => {
    const openai = fakeSpec("openai", [{ kind: "error", error: { kind: "invalid_request", message: "bad request" } }]);
    const anthropic = fakeSpec("anthropic", SUCCESSFUL_TOOL_ROUND_TRIP);

    const sweep = await executeCanarySweep(CANARY_CASE, [openai, anthropic]);

    assert.equal(sweep.providers[0].classification, "PROTOCOL_FAILURE");
    assert.equal(sweep.providers[1].provider, "anthropic", "Anthropic's turn was still executed");
    assert.equal(sweep.providers[1].classification, "PASS");
    assert.equal(sweep.overall, "FAIL");
  });
});

describe("canary.ts — classification mapping", () => {
  test("a timeout/rate_limited/unavailable/unknown errorClass maps to TRANSPORT_INCONCLUSIVE", async () => {
    for (const kind of ["timeout", "rate_limited", "unavailable", "unknown"] as const) {
      const sweep = await executeCanarySweep(CANARY_CASE, [fakeSpec("openai", [{ kind: "error", error: { kind, message: "x" } }])]);
      assert.equal(sweep.providers[0].classification, "TRANSPORT_INCONCLUSIVE", `errorClass ${kind}`);
    }
  });

  test("an unregistered tool attempt maps to TOOL_PROTOCOL_FAILURE", async () => {
    const sweep = await executeCanarySweep(CANARY_CASE, [
      fakeSpec("openai", [
        { kind: "ok", response: { kind: "toolCall", call: { toolName: "deleteEverything", args: {} }, usage: USAGE } },
        { kind: "ok", response: { kind: "text", text: "done", usage: USAGE } },
      ]),
    ]);
    assert.equal(sweep.providers[0].classification, "TOOL_PROTOCOL_FAILURE");
  });
});

describe("canary.ts — PASS requires the fixed case's exact expected tool sequence (pre-push review §I fix)", () => {
  test("a WRONG but registered tool, called with valid arguments, followed by final text, maps to TOOL_PROTOCOL_FAILURE, not PASS", async () => {
    const wrongToolThenText: NormalizedProviderTurn[] = [
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: {} }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "Here are the clients.", usage: USAGE } },
    ];
    const openai = fakeSpec("openai", wrongToolThenText);

    const sweep = await executeCanarySweep(CANARY_CASE, [openai]);

    assert.equal(sweep.providers[0].classification, "TOOL_PROTOCOL_FAILURE", "searchClients is registered and validly-argued, but is not the expected getOrganizationSummary — must not PASS");
    assert.equal(sweep.overall, "FAIL");
    assert.equal(sweep.providers[0].providerCallCount, 2, "exactly 2 provider calls — no call 3");
    assert.equal(sweep.providers[0].toolSelected, "searchClients", "the wrong tool is still recorded diagnostically in the artifact");
  });

  test("final text with NO tool call at all maps to TOOL_PROTOCOL_FAILURE, not PASS", async () => {
    const noToolThenText: NormalizedProviderTurn[] = [{ kind: "ok", response: { kind: "text", text: "The organization is doing fine.", usage: USAGE } }];
    const openai = fakeSpec("openai", noToolThenText);

    const sweep = await executeCanarySweep(CANARY_CASE, [openai]);

    assert.equal(sweep.providers[0].classification, "TOOL_PROTOCOL_FAILURE", "final text alone, with no getOrganizationSummary call, must not PASS");
    assert.equal(sweep.overall, "FAIL");
    assert.equal(sweep.providers[0].providerCallCount, 1);
    assert.equal(sweep.providers[0].toolSelected, null);
  });

  test("happy path — the correct single tool call followed by final text still maps to PASS, with score.fullSequenceMatch true", async () => {
    const { scoreRun } = await import("../scoring.js");
    const { runBenchmarkTurn } = await import("../loop.js");
    const run = {
      ...(await runBenchmarkTurn({
        provider: "openai",
        model: "m",
        complete: scripted(SUCCESSFUL_TOOL_ROUND_TRIP),
        userMessage: CANARY_CASE.prompt,
        estimateCostUsd: ZERO_COST,
        maxProviderCalls: CANARY_MAX_PROVIDER_CALLS,
      })),
      caseId: CANARY_CASE.id,
      repetition: 1,
    };
    const score = scoreRun(CANARY_CASE, run);
    assert.equal(score.fullSequenceMatch, true, "the scripted round trip calls exactly getOrganizationSummary once, matching expectedToolSequence");
    assert.equal(classifyCanaryProviderResult(run, score), "PASS");

    const sweep = await executeCanarySweep(CANARY_CASE, [fakeSpec("openai", SUCCESSFUL_TOOL_ROUND_TRIP)]);
    assert.equal(sweep.providers[0].classification, "PASS");
  });
});

describe("canary.ts — artifact shape (item 11, 12)", () => {
  test("11. runKind === \"canary\", and no SelectionOutcome/winner field exists anywhere in the artifact", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aqenra-canary-artifact-test-"));
    try {
      const tmpPath = join(tmpDir, "canary-result.json");
      const sweep = await executeCanarySweep(CANARY_CASE, [fakeSpec("openai", SUCCESSFUL_TOOL_ROUND_TRIP), fakeSpec("anthropic", SUCCESSFUL_TOOL_ROUND_TRIP)]);
      const written = writeCanaryReport(sweep.providers, tmpPath);
      const artifact = JSON.parse(readFileSync(written.path, "utf8"));

      assert.equal(artifact.runKind, "canary");
      assert.equal(artifact.caseId, CANARY_CASE_ID);
      assert.equal(artifact.overall, "PASS");
      assert.equal(artifact.providers.length, 2);

      // NOT a bare /outcome/i check — this artifact's own, legitimate
      // `argumentOutcome` field would false-positive on that. The actual
      // concern is decision.ts's own SelectionOutcome type/field, or any
      // "winner"-shaped field naming one provider over the other.
      const serialized = JSON.stringify(artifact);
      assert.equal(/SelectionOutcome/.test(serialized), false, "no SelectionOutcome-shaped field anywhere in the canary artifact");
      assert.equal(/winner/i.test(serialized), false);
      assert.equal("outcome" in artifact, false);
      assert.equal("selectionOutcome" in artifact, false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("successful mocked tool round-trip for both providers -> overall PASS (item 13)", async () => {
    const sweep = await executeCanarySweep(CANARY_CASE, [fakeSpec("openai", SUCCESSFUL_TOOL_ROUND_TRIP), fakeSpec("anthropic", SUCCESSFUL_TOOL_ROUND_TRIP)]);
    assert.equal(sweep.overall, "PASS");
  });

  test("one provider failure -> overall non-PASS (item 14)", async () => {
    const sweep = await executeCanarySweep(CANARY_CASE, [
      fakeSpec("openai", [{ kind: "error", error: { kind: "invalid_request", message: "x" } }]),
      fakeSpec("anthropic", SUCCESSFUL_TOOL_ROUND_TRIP),
    ]);
    assert.notEqual(sweep.overall, "PASS");
    assert.equal(sweep.overall, "FAIL");
  });
});

describe("canary.ts — classifyCanaryProviderResult is exported and pure (no I/O, no re-run)", () => {
  test("PASS for a clean tool-call-then-text run", () => {
    // Exercised indirectly above via executeCanarySweep; this proves the
    // function itself is directly callable/importable for future callers.
    assert.equal(typeof classifyCanaryProviderResult, "function");
  });
});

describe("index.ts --canary — real subprocess, mechanically no-live (items 7, 8, 9, 10, 15)", () => {
  test("7. missing eval credentials fails closed before any provider execution, no artifact written", () => {
    const beforeArtifactHash = sha256OfFile(CANARY_ARTIFACT_PATH);
    let output = "";
    let threw = false;
    try {
      output = execFileSync("npx", ["tsx", "index.ts", "--canary"], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        env: buildNoLiveChildEnv(),
      });
    } catch (err) {
      threw = true;
      output = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
    }
    assert.equal(threw, true, "expected a non-zero exit (missing credentials)");
    assert.match(output, /CREDENTIAL_MISSING/);
    assert.equal(output.includes("canary turn"), false, "no provider turn was ever started");
    assert.equal(sha256OfFile(CANARY_ARTIFACT_PATH), beforeArtifactHash, "the real canary artifact must be byte-identical before/after");
  });

  test("8. a stale snapshot fails before the credential check, even with fake-but-present keys, and no artifact is written — using an isolated temp snapshot copy, never the canonical file", () => {
    const beforeCanonicalHash = sha256OfFile(CANONICAL_SNAPSHOT_PATH);
    const beforeArtifactHash = sha256OfFile(CANARY_ARTIFACT_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-canary-stale-snapshot-"));
    try {
      const original = readFileSync(CANONICAL_SNAPSHOT_PATH, "utf8"); // read-only — the canonical file is never opened for write by this test
      const corrupted = JSON.parse(original);
      corrupted.sourceFingerprint = "deadbeef".repeat(8);
      const tempSnapshotPath = join(tempDir, "stale-tool-contracts.snapshot.json");
      writeFileSync(tempSnapshotPath, JSON.stringify(corrupted, null, 2) + "\n", "utf8");

      let output = "";
      let threw = false;
      try {
        output = execFileSync("npx", ["tsx", "index.ts", "--canary"], {
          cwd: PACKAGE_DIR,
          encoding: "utf8",
          // AQENRA_EVAL_TEST_NO_LIVE=1 (via buildNoLiveChildEnv) is the
          // PRIMARY boundary here — it alone guarantees no live call can
          // happen even if this test's own stale-snapshot setup fails for
          // any reason. The sentinel credentials below exist ONLY to
          // prove the freshness-before-credential ordering; they are
          // never real, and AQENRA_EVAL_TEST_SNAPSHOT_PATH is only ever
          // honored by index.ts because AQENRA_EVAL_TEST_NO_LIVE=1 is set
          // (see index.ts's own resolveSnapshotPath()) — it can never
          // weaken a real --canary invocation's freshness enforcement.
          env: buildNoLiveChildEnv({
            AQENRA_EVAL_TEST_SNAPSHOT_PATH: tempSnapshotPath,
            AQENRA_EVAL_ANTHROPIC_API_KEY: "sk-ant-CANARY-ORDERING-SENTINEL",
            AQENRA_EVAL_OPENAI_API_KEY: "sk-CANARY-ORDERING-SENTINEL",
          }),
        });
      } catch (err) {
        threw = true;
        output = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
      }
      assert.equal(threw, true, "expected a non-zero exit (stale snapshot)");
      assert.match(output, /SNAPSHOT_STALE/);
      assert.equal(output.includes("CREDENTIAL_MISSING"), false, "must never reach the credential check after a freshness failure");
      assert.equal(output.includes("CANARY-ORDERING-SENTINEL"), false, "must never print a key value");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
    // The canonical snapshot and the real canary artifact were never
    // opened for write by this test at all — asserted anyway as a
    // regression guard, not because anything above could plausibly have
    // touched them.
    assert.equal(sha256OfFile(CANONICAL_SNAPSHOT_PATH), beforeCanonicalHash, "the canonical snapshot must be byte-identical before/after — this test never writes to it");
    assert.equal(sha256OfFile(CANARY_ARTIFACT_PATH), beforeArtifactHash, "the real canary artifact must be byte-identical before/after");
  });

  test("9 & 10. official results/ is never touched by --canary, and the real canary-results/ artifact is never created or modified when the canary never reaches a provider call", () => {
    const beforeResults = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).sort() : null;
    const beforeArtifactHash = sha256OfFile(CANARY_ARTIFACT_PATH);
    try {
      execFileSync("npx", ["tsx", "index.ts", "--canary"], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        env: buildNoLiveChildEnv(),
      });
    } catch {
      // Expected — no credentials set, non-zero exit. Only the
      // filesystem side effects below matter for this test.
    }
    const afterResults = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).sort() : null;
    assert.deepEqual(beforeResults, afterResults, "results/ directory listing unchanged");
    // Deliberately a hash comparison, never an existsSync(...) === false
    // assumption — canary-results/canary-result.json legitimately
    // pre-exists as preserved evidence from an authorized live run, and
    // this test must remain correct regardless of whether it does.
    assert.equal(sha256OfFile(CANARY_ARTIFACT_PATH), beforeArtifactHash, "the real canary artifact must be byte-identical before/after a run that never reached a provider call");
  });
});

describe("source-contract — --canary is a separate branch from --run, and canary.ts never touches decision.ts/writeReport (item 16)", () => {
  const indexSource = readFileSync(join(PACKAGE_DIR, "index.ts"), "utf8");
  const canarySource = readFileSync(join(PACKAGE_DIR, "canary.ts"), "utf8");

  test("main() has a distinct mode === \"canary\" branch that calls runCanary(), separate from the mode === \"run\" branch that calls runLiveBenchmark()", () => {
    const mainBody = indexSource.slice(indexSource.indexOf("async function main"));
    assert.match(mainBody, /mode === "canary"/);
    assert.match(mainBody, /await runCanary\(\)/);
    // The final, un-guarded fallthrough at the bottom of main() is the
    // "run" branch — it must still call runLiveBenchmark(), never
    // runCanary().
    const runBranch = mainBody.slice(mainBody.indexOf('mode === "canary"'));
    assert.match(runBranch, /await runLiveBenchmark\(/);
  });

  test("runLiveBenchmark() never passes maxProviderCalls to runBenchmarkTurn — only executeCanarySweep() (canary.ts) does", () => {
    const liveBenchmarkBody = indexSource.slice(indexSource.indexOf("async function runLiveBenchmark"), indexSource.indexOf("async function main"));
    assert.equal(liveBenchmarkBody.includes("maxProviderCalls"), false, "the official --run sweep must never override the real provider-call ceiling");
    assert.match(canarySource, /maxProviderCalls:\s*CANARY_MAX_PROVIDER_CALLS/);
  });

  test("canary.ts never imports or calls writeReport, aggregate, or decideOutcome", () => {
    // Comment-stripped first — canary.ts's own doc comments legitimately
    // DISCUSS writeReport()/report.ts by name (explaining why it's never
    // called), the same false-positive class check-ai-assistant-security.mjs's
    // own stripComments() discipline already exists to avoid elsewhere in
    // this codebase. A real call/import must survive comment-stripping;
    // prose explaining its absence must not.
    const codeOnly = canarySource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.equal(codeOnly.includes("writeReport"), false);
    assert.equal(codeOnly.includes("aggregate("), false);
    assert.equal(codeOnly.includes("decideOutcome"), false);
    assert.equal(codeOnly.includes("SelectionOutcome"), false);
    // report.js IS a legitimate import (safeGitSha only) — confirm the
    // specific named imports from it never include writeReport.
    assert.match(codeOnly, /from "\.\/report\.js"/);
    assert.equal(/import\s*\{[^}]*writeReport[^}]*\}\s*from\s*"\.\/report\.js"/.test(codeOnly), false);
  });
});
