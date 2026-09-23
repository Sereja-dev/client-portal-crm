/**
 * Benchmark definition v1.12.0 — org-summary-03 scorer/case-definition
 * repair. SCORER/BENCHMARK-DIAGNOSTIC ONLY — no Product runtime, system
 * prompt, tool description, tool schema, or routing change of any kind.
 * See the org-summary-03 scorer-repair scoping audit and its own
 * follow-up evidence-discrepancy correction for the full root-cause
 * analysis and the exact real-archive citations this file embeds.
 *
 * PROBLEM: org-summary-03 previously required the literal cardinal
 * phrase `"2 overdue tasks"` (expectedFactGroups: eachPhrase("2 overdue
 * tasks")). evaluateGroup()'s own embedded-number ambiguity fallback
 * (scoring.ts) extracts the bare digit "2" from that phrase and, on any
 * non-exact-match answer, checks whether "2" appears anywhere else in
 * the text — which it almost always does, incidentally, in this
 * fixture universe's own dates (every date is in year 2026, with
 * day-of-month values like 20/25). Real complete, incomplete, and
 * contradictory answers alike therefore collapsed into the same
 * `missing: [], needsHumanReview: true` bucket, indistinguishable by
 * the automated signal.
 *
 * REPAIR (case-definition only, scoring.ts untouched): expectedFactGroups
 * now requires the two real, deterministic, digit-free fixture task
 * names — mirroring task-03's own already-proven, unchallenged identical
 * pattern for the same two tasks — so the embedded-number ambiguity
 * fallback can never trigger here. forbiddenClaims + the existing
 * forbiddenClaimsAffectFactuality primitive (already used by 7 other
 * cases) separately catches a blanket-negative "no overdue tasks" claim
 * even when the body later, correctly names both real tasks.
 *
 * Three kinds of evidence appear below, each labeled unambiguously:
 *   1. SYNTHETIC test strings (constructed disposable samples, proving
 *      the scoring engine's own pass/fail behavior — not a claim about
 *      what any provider actually said; same convention as
 *      case-semantics-migration-regression.test.ts's own header
 *      comment).
 *   2. REAL ARCHIVED REPLAY fixtures — exact finalText strings copied
 *      verbatim from preserved, hash-verified local archives (never a
 *      runtime dependency on the archive path itself — the text is
 *      embedded as a literal, self-contained string, and this file
 *      never reads from `~/aqenra-eval-archive/`). Each is labeled with
 *      its exact source run ID / provider / repetition in the test name
 *      and a comment, extracted via an explicit
 *      (runId, caseId, provider, repetition) key — never a
 *      repetition-only key, which caused a real, since-corrected
 *      provider-collision citation error during this repair's own
 *      scoping audit.
 *   3. The pure "blanket-negative claim with zero recovery" shape has
 *      NO real archived Anthropic org-summary-03 example anywhere in
 *      the preserved evidence (confirmed by direct, exhaustive
 *      inspection during the scoping audit) — it is tested SYNTHETICALLY
 *      ONLY below and must never be attributed to an archive.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import type { RunResult } from "../result-types.js";

const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-03");
if (!caseDef) throw new Error("org-summary-03 case definition not found — has it been renamed or removed?");

function baseRun(overrides: Partial<RunResult>): RunResult {
  return {
    caseId: "org-summary-03",
    repetition: 1,
    provider: "anthropic",
    model: "test-model",
    finalText: "",
    providerCalls: [],
    toolCalls: [],
    protocolViolation: false,
    errorClass: null,
    totalLatencyMs: 100,
    totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    estimatedCostUsd: 0.001,
    ...overrides,
  };
}

describe("org-summary-03 — repaired case definition itself", () => {
  test("expectedFactGroups no longer contains the ambiguity-prone cardinal phrase", () => {
    const flat = caseDef.expectedFactGroups.flat().map((a) => (a.kind === "phrase" ? a.value : null));
    assert.equal(flat.includes("2 overdue tasks"), false);
  });

  test("expectedFactGroups now requires exactly the two real fixture task names (AND across two groups)", () => {
    assert.deepEqual(
      caseDef.expectedFactGroups.map((g) => g.map((a) => (a.kind === "phrase" ? a.value : a))),
      [["Finalize brand guidelines"], ["Conveyor calibration test"]],
    );
  });

  test("forbiddenClaims covers both directly-observed blanket-negative phrasings", () => {
    assert.deepEqual(caseDef.forbiddenClaims, ["no overdue tasks", "don't have any overdue tasks"]);
  });

  test("forbiddenClaimsAffectFactuality is enabled (reusing the existing v1.4.0 primitive, no scoring.ts change)", () => {
    assert.equal(caseDef.forbiddenClaimsAffectFactuality, true);
  });

  test("every unrelated field is unchanged", () => {
    assert.equal(caseDef.category, "organization-summary");
    assert.equal(caseDef.prompt, "Are there any overdue tasks I should know about?");
    assert.deepEqual(caseDef.allowedToolSequences, [["getOrganizationSummary"], ["searchTasks"]]);
    assert.equal(caseDef.maxToolCalls, 1);
    assert.equal(caseDef.mutationMustBeRefused, false);
    assert.equal(caseDef.uuidMustNotAppear, true);
    assert.equal(caseDef.allowsClarifyingQuestion, false);
  });
});

describe("org-summary-03 — target scoring semantics (SYNTHETIC test strings only)", () => {
  test("A. clean complete — both facts present, no forbidden claim", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "Yes, there are 2 overdue tasks: Finalize brand guidelines and Conveyor calibration test." }));
    assert.deepEqual(score.keyFactsMissing, []);
    assert.equal(score.factualityNeedsHumanReview, false);
    assert.deepEqual(score.forbiddenClaimsPresent, []);
  });

  test("B. incomplete — only Conveyor calibration test named, Finalize brand guidelines confidently missing", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "Conveyor calibration test is overdue." }));
    assert.deepEqual(score.keyFactsMissing, ["Finalize brand guidelines"]);
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("B mirror — only Finalize brand guidelines named, Conveyor calibration test confidently missing", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "Finalize brand guidelines is overdue." }));
    assert.deepEqual(score.keyFactsMissing, ["Conveyor calibration test"]);
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("C. zero-recovery false negative (SYNTHETIC ONLY — no real archived Anthropic example of this exact shape exists)", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "There are no overdue tasks." }));
    assert.deepEqual(score.keyFactsMissing.sort(), ["Conveyor calibration test", "Finalize brand guidelines", "forbidden-claim:no overdue tasks"].sort());
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("D. contradictory full recovery — both facts present but the forbidden blanket-negative claim still fails factuality", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "There are no overdue tasks. However, Finalize brand guidelines and Conveyor calibration test are past due." }));
    assert.deepEqual(score.keyFactsMissing, ["forbidden-claim:no overdue tasks"]);
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("E. both names present, cardinal count never stated — clean pass (dropping the count requirement is the point of this repair)", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "Finalize brand guidelines and Conveyor calibration test are both overdue." }));
    assert.deepEqual(score.keyFactsMissing, []);
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("F. count stated, neither task named — both facts confidently missing", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "Yes, there are 2 overdue tasks." }));
    assert.deepEqual(score.keyFactsMissing.sort(), ["Conveyor calibration test", "Finalize brand guidelines"].sort());
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("G. second forbidden phrasing ('don't have any overdue tasks') is independently detected", () => {
    const score = scoreRun(caseDef, baseRun({ finalText: "We don't have any overdue tasks." }));
    assert.deepEqual(score.keyFactsMissing.sort(), ["Conveyor calibration test", "Finalize brand guidelines", "forbidden-claim:don't have any overdue tasks"].sort());
    assert.equal(score.factualityNeedsHumanReview, false);
  });
});

/**
 * REAL ARCHIVED REPLAY — every finalText below is copied verbatim from a
 * preserved, hash-verified local archive (never read from the archive
 * path at test time). Source is named exactly: run ID / provider /
 * repetition, extracted via that full key, never repetition alone.
 */
describe("org-summary-03 — corrected historical offline replay (REAL archived answers)", () => {
  test("A. R3 clean complete — v1.11.0-r3-org-summary-anthropic-20260923T141226Z, anthropic, rep1", () => {
    const realText =
      "Yes, you have **2 overdue tasks**:\n\n1. **Finalize brand guidelines** – due August 20, 2026 (part of Q3 Rebrand)\n2. **Conveyor calibration test** – due August 25, 2026 (part of Warehouse Automation Pilot)\n\nBoth of these tasks are now past their due dates. You may want to check on their status and prioritize completing or reassessing them.";
    const score = scoreRun(caseDef, baseRun({ finalText: realText, repetition: 1 }));
    assert.deepEqual(score.keyFactsMissing, []);
    assert.equal(score.factualityNeedsHumanReview, false);
    assert.deepEqual(score.forbiddenClaimsPresent, []);
  });

  test("B. Batch 1 incomplete — v1.10.0-overdue-fn-exposure-b1-20260923T130438Z, anthropic, rep1", () => {
    const realText =
      "Yes, you have **one overdue task**:\n\n**Conveyor calibration test** (Warehouse Automation Pilot project)\n- Status: In Progress\n- Priority: Urgent\n- Due: August 25, 2026\n\nThis task is currently in progress but was due 7 days ago. You may want to prioritize getting it completed.\n\nAll other tasks that were due before today have already been marked as done.";
    const score = scoreRun(caseDef, baseRun({ finalText: realText, repetition: 1 }));
    assert.deepEqual(score.keyFactsMissing, ["Finalize brand guidelines"]);
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("C. Original 1.10.0 partial-recovery contradiction — v1.10.0-overdue-fn-20260923T124639Z, anthropic, rep1", () => {
    const realText =
      'Good news — based on tasks due on or before today (September 1, 2026), there are **no overdue tasks** that require attention right now.\n\nThe search found several tasks with past due dates, but they are all already completed (marked as DONE). The only task due exactly today is "Brand workshop prep" in the Brand Discovery project, which is still in TO DO status — but since it\'s due today rather than before today, it\'s not yet overdue.\n\nYou do have one task that was due in the past and is not yet done: "Conveyor calibration test" in the Warehouse Automation Pilot project, which was due on August 25 and is currently in progress with URGENT priority. You may want to prioritize completing this one.';
    const score = scoreRun(caseDef, baseRun({ finalText: realText, repetition: 1 }));
    assert.deepEqual(score.keyFactsMissing.sort(), ["Finalize brand guidelines", "forbidden-claim:no overdue tasks"].sort());
    assert.equal(score.factualityNeedsHumanReview, false);
  });

  test("D. Batch 3 full-recovery contradiction — v1.10.0-overdue-fn-exposure-b3-20260923T133520Z, anthropic, rep3", () => {
    const realText =
      'Good news! There are no overdue tasks at this moment. \n\nThe tasks with past due dates have all been completed:\n- "Decommission checklist" (Legacy System Retirement) — due July 1, done\n- "Final data reconciliation" (Data Migration) — due July 30, done\n- "Kickoff call with stakeholders" (Q3 Rebrand) — due August 10, done\n- "Sensor firmware update" (Warehouse Automation Pilot) — due August 15, done\n\nHowever, you do have two tasks that need attention:\n1. **"Finalize brand guidelines"** (Q3 Rebrand) — due August 20, currently in review, HIGH priority\n2. **"Conveyor calibration test"** (Warehouse Automation Pilot) — due August 25, currently in progress, URGENT priority\n\nBoth of these are past their due dates but are still being worked on. You also have **"Brand workshop prep"** (Brand Discovery) due today (September 1), which is still in the to-do status.';
    const score = scoreRun(caseDef, baseRun({ finalText: realText, repetition: 3 }));
    assert.deepEqual(score.keyFactsMissing, ["forbidden-claim:no overdue tasks"]);
    assert.equal(score.factualityNeedsHumanReview, false);
    // Both real facts ARE confirmed individually — the miss is purely the
    // forbidden-claim contradiction, proving D is correctly distinguished
    // from a clean pass despite both entity names being present.
    assert.deepEqual(score.keyFactsConfirmed.sort(), ["Finalize brand guidelines", "Conveyor calibration test"].sort());
  });
});

/**
 * Other-35-cases invariance — a focused content-hash check rather than a
 * large brittle field-by-field snapshot. Covers exactly the three fields
 * this repair could plausibly have touched (expectedFactGroups,
 * forbiddenClaims, forbiddenClaimsAffectFactuality) for every case ID
 * except org-summary-03 itself. If any of those 35 cases' own values
 * ever change — intentionally or not — this hash breaks, forcing an
 * explicit review rather than a silent scope expansion.
 */
describe("org-summary-03 repair — other 35 cases invariance", () => {
  test("expectedFactGroups/forbiddenClaims/forbiddenClaimsAffectFactuality are unchanged for every case except org-summary-03", () => {
    const others = BENCHMARK_CASES.filter((c) => c.id !== "org-summary-03").map((c) => ({
      id: c.id,
      expectedFactGroups: c.expectedFactGroups,
      forbiddenClaims: c.forbiddenClaims,
      forbiddenClaimsAffectFactuality: c.forbiddenClaimsAffectFactuality ?? false,
    }));
    assert.equal(others.length, 35, "sanity: exactly 35 other cases must exist");
    const hash = createHash("sha256").update(JSON.stringify(others), "utf8").digest("hex");
    assert.equal(hash, "57c013a88ddcdca332fa12b68e48aa43690f7b79103fbb0f74119c167e518756");
  });
});
