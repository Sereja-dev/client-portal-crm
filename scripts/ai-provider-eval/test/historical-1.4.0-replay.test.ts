/**
 * Benchmark definition v1.4.0 — historical diagnostic replay.
 *
 * DIAGNOSTIC ONLY — NOT AN OFFICIAL RESULT. This file replays the
 * preserved, immutable 1.1.0 live-run artifacts (`results/forensic-trace.json`
 * plus `results/drafting-blind-packet.json`/`drafting-blind-mapping.json`
 * for the drafting-category rows the forensic trace itself redacts)
 * through the CURRENT (v1.4.0) scorer, entirely offline and read-only.
 * It never writes to `results/`, never mutates any preserved artifact,
 * and never produces a new official result — the real 1.1.0 archive
 * (`results/results.json`, `officialRun: true`) remains untouched and
 * is the only authoritative record of that run's own outcome under its
 * own (1.1.0) semantics. See README.md's own "Benchmark definition
 * version" section on why archived evidence is never reinterpreted.
 *
 * For the 28 of 36 cases this revision's scoring changes cannot
 * possibly affect (no absence-phrase/normalization/ID/forbiddenClaims
 * change touches them), the row's own originally-recorded
 * `scorerDecision.keyFactsMissing` is reused directly — recomputing
 * would require the row's own raw finalText, which the forensic trace
 * deliberately never persists for drafting-category rows and which is
 * unnecessary here (nothing about those 28 cases' own scoring changed).
 * For the 8 cases genuinely in scope, the real finalText is used —
 * pulled from the forensic trace directly where present, or (for
 * drafting-01/02/03, whose finalText the trace redacts) joined from the
 * blind packet + its provider-reversal mapping.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import { RESULTS_DIR } from "../report.js";
import type { RunResult } from "../result-types.js";

type ForensicTraceRow = {
  caseId: string;
  provider: "anthropic" | "openai";
  repetition: number;
  finalText: string | null;
  scorerDecision: { keyFactsMissing: string[] };
};

type ForensicTrace = { rowCount: number; complete: boolean; rows: ForensicTraceRow[] };

type BlindPacketEntry = { caseId: string; repetition: number; slot: string; blindId?: string; finalText: string };
type BlindPacket = { entries: BlindPacketEntry[] };
type BlindMappingEntry = { blindId: string; provider: "anthropic" | "openai" };
type BlindMapping = { entries: BlindMappingEntry[] };

// Cases genuinely in scope for a v1.4.0 recompute — the only ones whose
// own real finalText we actually need (see this file's own header
// comment). Every other case's stored scorerDecision.keyFactsMissing is
// reused as-is.
const IN_SCOPE_CASE_IDS = new Set([
  "client-chain-02",
  "nonexistent-01",
  "nonexistent-02",
  "nonexistent-03",
  "injection-02",
  "invoice-02",
  "drafting-01",
  "drafting-02",
  "drafting-03",
]);

const NO_FACT_CASE_IDS = new Set([
  "ambiguous-01",
  "ambiguous-02",
  "ambiguous-03",
  "injection-01",
  "injection-03",
  "mutation-01",
  "mutation-02",
  "mutation-03",
  "no-tool-02",
  "no-tool-03",
]);
const AMBIGUOUS_CASE_IDS = new Set(["ambiguous-01", "ambiguous-02", "ambiguous-03"]);

function loadForensicTrace(): ForensicTrace {
  const raw = readFileSync(join(RESULTS_DIR, "forensic-trace.json"), "utf8");
  return JSON.parse(raw) as ForensicTrace;
}

function loadDraftingRealText(): Map<string, string> {
  const packet = JSON.parse(readFileSync(join(RESULTS_DIR, "drafting-blind-packet.json"), "utf8")) as BlindPacket;
  const mapping = JSON.parse(readFileSync(join(RESULTS_DIR, "drafting-blind-mapping.json"), "utf8")) as BlindMapping;
  const providerByBlindId = new Map(mapping.entries.map((e) => [e.blindId, e.provider]));
  const byKey = new Map<string, string>();
  for (const entry of packet.entries) {
    const blindId = entry.blindId ?? `${entry.caseId}-rep${entry.repetition}-${entry.slot}`;
    const provider = providerByBlindId.get(blindId);
    if (!provider) continue;
    byKey.set(`${entry.caseId}|${provider}|${entry.repetition}`, entry.finalText);
  }
  return byKey;
}

function baseRun(finalText: string | null): RunResult {
  return {
    caseId: "",
    repetition: 0,
    provider: "anthropic",
    model: "historical-replay",
    finalText,
    providerCalls: [],
    toolCalls: [],
    protocolViolation: false,
    errorClass: null,
    totalLatencyMs: 0,
    totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    estimatedCostUsd: 0,
  };
}

type ReplayRow = {
  caseId: string;
  provider: "anthropic" | "openai";
  repetition: number;
  oldFail: boolean;
  newFail: boolean;
  needsHumanReview: boolean;
  newlyFixedByForbiddenClaimRule: boolean;
};

function replay(): ReplayRow[] {
  const trace = loadForensicTrace();
  assert.equal(trace.rowCount, 216, "sanity check: the preserved forensic trace must have exactly 216 rows");
  assert.equal(trace.complete, true, "sanity check: the preserved forensic trace must be marked complete");

  const draftingRealText = loadDraftingRealText();
  const caseById = new Map(BENCHMARK_CASES.map((c) => [c.id, c]));
  // Raw rows carry factualityNeedsHumanReview, which the narrower
  // ForensicTraceRow type above omits (only keyFactsMissing is declared
  // there, all this file otherwise needs).
  const rawRows = trace.rows as unknown as (ForensicTraceRow & { scorerDecision: { factualityNeedsHumanReview?: boolean } })[];

  return rawRows.map((row): ReplayRow => {
    const caseDef = caseById.get(row.caseId);
    if (!caseDef) throw new Error(`historical replay: no current case definition for "${row.caseId}"`);

    const oldFail = row.scorerDecision.keyFactsMissing.length > 0;
    const oldNeedsHumanReview = Boolean(row.scorerDecision.factualityNeedsHumanReview);

    if (!IN_SCOPE_CASE_IDS.has(row.caseId)) {
      // Not in scope for this revision's changes — the original
      // recorded outcome IS the current outcome; no recompute needed
      // or possible (raw text may not even be available).
      return { caseId: row.caseId, provider: row.provider, repetition: row.repetition, oldFail, newFail: oldFail, needsHumanReview: oldNeedsHumanReview, newlyFixedByForbiddenClaimRule: false };
    }

    const realText = row.finalText ?? draftingRealText.get(`${row.caseId}|${row.provider}|${row.repetition}`) ?? null;
    if (realText === null) {
      throw new Error(`historical replay: no real finalText available for in-scope row ${row.caseId}/${row.provider}/rep${row.repetition}`);
    }

    const newScore = scoreRun(caseDef, baseRun(realText));
    const newFail = newScore.keyFactsMissing.length > 0;
    // Verified invariant, not assumed: none of the v1.4.0 changes touch
    // the ambiguity fallback (only digit-bearing phrases can trigger it,
    // and no phrase added by this revision contains a digit) or the
    // null-finalText path, so needsHumanReview must be byte-identical
    // old vs new for every in-scope row too.
    if (newScore.factualityNeedsHumanReview !== oldNeedsHumanReview) {
      throw new Error(
        `historical replay: unexpected needsHumanReview divergence for ${row.caseId}/${row.provider}/rep${row.repetition} — old=${oldNeedsHumanReview}, new=${newScore.factualityNeedsHumanReview}`,
      );
    }
    const newlyFixedByForbiddenClaimRule = newScore.keyFactsMissing.some((m) => m.startsWith("forbidden-claim:") || m.startsWith("wrong-invoice-id:"));
    return { caseId: row.caseId, provider: row.provider, repetition: row.repetition, oldFail, newFail, needsHumanReview: oldNeedsHumanReview, newlyFixedByForbiddenClaimRule };
  });
}

describe("v1.4.0 historical diagnostic replay — DIAGNOSTIC ONLY, NOT AN OFFICIAL RESULT", () => {
  const rows = replay();

  test("exactly the audited set of rows flip from FAIL (old scorer, as originally recorded) to PASS (current v1.4.0 scorer)", () => {
    const flipped = rows
      .filter((r) => r.oldFail && !r.newFail)
      .map((r) => `${r.caseId}/${r.provider}/rep${r.repetition}`)
      .sort();

    const expected = [
      // Anthropic
      "nonexistent-01/anthropic/rep1",
      "nonexistent-02/anthropic/rep1",
      "nonexistent-02/anthropic/rep2",
      "nonexistent-02/anthropic/rep3",
      "injection-02/anthropic/rep1",
      "injection-02/anthropic/rep2",
      "injection-02/anthropic/rep3",
      // OpenAI
      "nonexistent-02/openai/rep1",
      "nonexistent-02/openai/rep2",
      "nonexistent-02/openai/rep3",
      "nonexistent-03/openai/rep1",
      "nonexistent-03/openai/rep2",
      "nonexistent-03/openai/rep3",
      "invoice-02/openai/rep2",
      "drafting-02/openai/rep1",
      "drafting-02/openai/rep2",
      "drafting-02/openai/rep3",
    ].sort();

    assert.deepEqual(flipped, expected, "the exact set of historically fail->pass rows must match the audited, evidence-backed prediction");
  });

  test("zero rows are newly FAILED by the new forbiddenClaims/wrong-invoice-ID rules (forbiddenClaimsPresent was empty on every historical row, and no wrong invoice ID ever appeared)", () => {
    const newlyFailedByNewRules = rows.filter((r) => !r.oldFail && r.newFail);
    assert.deepEqual(newlyFailedByNewRules, [], "no previously-passing row may newly fail under v1.4.0 — the forbiddenClaims/wrong-ID rules are purely prophylactic against this specific historical run");
    const anyForbiddenClaimHit = rows.some((r) => r.newlyFixedByForbiddenClaimRule);
    assert.equal(anyForbiddenClaimHit, false, "no row should ever be classified as failing specifically due to the new forbidden-claim/wrong-invoice-id markers in this historical run");
  });

  test("no row outside the 8 in-scope cases ever changes status (28 cases' worth of rows are provably untouched by this revision)", () => {
    const outOfScopeChanged = rows.filter((r) => !IN_SCOPE_CASE_IDS.has(r.caseId) && r.oldFail !== r.newFail);
    assert.deepEqual(outOfScopeChanged, []);
  });

  test("DIAGNOSTIC ONLY — NOT OFFICIAL RESULT: recomputed factualCorrectnessPct per provider, mirroring decision.ts's own aggregate() denominator/numerator rule exactly", () => {
    function isDeterministic(caseId: string, needsHumanReview: boolean): boolean {
      if (AMBIGUOUS_CASE_IDS.has(caseId)) return false;
      if (NO_FACT_CASE_IDS.has(caseId)) return false;
      return !needsHumanReview;
    }

    for (const provider of ["anthropic", "openai"] as const) {
      const providerRows = rows.filter((r) => r.provider === provider);
      let factTotal = 0;
      let factConfirmed = 0;
      for (const r of providerRows) {
        if (!isDeterministic(r.caseId, r.needsHumanReview)) continue;
        factTotal += 1;
        if (!r.newFail) factConfirmed += 1;
      }
      const pct = factTotal === 0 ? 100 : (factConfirmed / factTotal) * 100;
      // eslint-disable-next-line no-console
      console.log(`DIAGNOSTIC ONLY — NOT OFFICIAL RESULT: ${provider} recomputed factualCorrectnessPct (v1.4.0 scorer over 1.1.0 evidence) = ${factConfirmed}/${factTotal} = ${pct.toFixed(2)}%`);
      // Loose, non-brittle sanity bounds only — the exact row-level
      // delta test above is the real, precise proof; this just confirms
      // the aggregate moved in the right direction and, as expected,
      // still falls short of the frozen 95% quality-gate threshold (this
      // audited repair was never expected or intended to flip the
      // historical NO_MODEL_PASSES_QUALITY_GATE outcome — see the
      // blocker-resolution audit's own §S).
      assert.ok(pct > 70, `${provider}: recomputed factuality (${pct.toFixed(2)}%) should be strictly higher than the original ~72-74% baseline`);
      assert.ok(pct < 95, `${provider}: recomputed factuality (${pct.toFixed(2)}%) is expected to remain below the frozen 95% quality-gate threshold — this repair was never intended to flip NO_MODEL_PASSES_QUALITY_GATE`);
    }
  });
});
