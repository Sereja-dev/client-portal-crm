/**
 * Benchmark definition v1.5.0 — historical diagnostic replay.
 *
 * DIAGNOSTIC ONLY — NOT AN OFFICIAL RESULT. Replays the preserved,
 * immutable 1.1.0 live-run artifact (`results/forensic-trace.json`)
 * through the CURRENT (v1.5.0) scorer, entirely offline and read-only.
 * Never writes to `results/`, never mutates any preserved artifact, and
 * never produces a new official result — the real 1.1.0 archive
 * (`results/results.json`, `officialRun: true`) remains untouched and is
 * the only authoritative record of that run's own outcome under its own
 * (1.1.0) semantics.
 *
 * Only TWO cases changed in v1.5.0 (invoice-03, nonexistent-02) — see
 * benchmark-version.ts's own History and README.md's own "v1.5.0" entry.
 * Every other case's originally-recorded `scorerDecision.keyFactsMissing`
 * is reused directly — recomputing is unnecessary and impossible to
 * differ, since neither those case definitions nor the scoring engine
 * for them changed at all in this revision (case-local isolation,
 * verified structurally by test/case-semantics-migration-regression.test.ts's
 * own "29 unaffected cases" count).
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

const IN_SCOPE_CASE_IDS = new Set(["invoice-03", "nonexistent-02"]);

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

type ReplayRow = { caseId: string; provider: "anthropic" | "openai"; repetition: number; oldFail: boolean; newFail: boolean };

function replay(): ReplayRow[] {
  const raw = readFileSync(join(RESULTS_DIR, "forensic-trace.json"), "utf8");
  const trace = JSON.parse(raw) as ForensicTrace;
  assert.equal(trace.rowCount, 216, "sanity check: the preserved forensic trace must have exactly 216 rows");
  assert.equal(trace.complete, true, "sanity check: the preserved forensic trace must be marked complete");

  const caseById = new Map(BENCHMARK_CASES.map((c) => [c.id, c]));

  return trace.rows.map((row): ReplayRow => {
    const oldFail = row.scorerDecision.keyFactsMissing.length > 0;
    if (!IN_SCOPE_CASE_IDS.has(row.caseId)) {
      return { caseId: row.caseId, provider: row.provider, repetition: row.repetition, oldFail, newFail: oldFail };
    }
    const caseDef = caseById.get(row.caseId);
    if (!caseDef) throw new Error(`historical replay: no current case definition for "${row.caseId}"`);
    if (row.finalText === null) throw new Error(`historical replay: no real finalText available for in-scope row ${row.caseId}/${row.provider}/rep${row.repetition}`);
    const newScore = scoreRun(caseDef, baseRun(row.finalText));
    return { caseId: row.caseId, provider: row.provider, repetition: row.repetition, oldFail, newFail: newScore.keyFactsMissing.length > 0 };
  });
}

describe("v1.5.0 historical diagnostic replay — DIAGNOSTIC ONLY, NOT AN OFFICIAL RESULT", () => {
  const rows = replay();

  test("invoice-03: all 6 historical rows remain FAIL under v1.5.0 — the pre-1.3.0 empty-tool-result bug meant no historical row ever reported the required amount, so none flip", () => {
    const invoiceRows = rows.filter((r) => r.caseId === "invoice-03");
    assert.equal(invoiceRows.length, 6);
    for (const r of invoiceRows) {
      assert.equal(r.oldFail, true, `${r.provider}/rep${r.repetition}: expected the ORIGINAL 1.1.0 record to be FAIL (sanity)`);
      assert.equal(r.newFail, true, `${r.provider}/rep${r.repetition}: v1.5.0 must NOT retroactively pass this row — the new rule is justified by fresh v1.4.0-subset evidence, never by relaxing historical failures`);
    }
  });

  test("nonexistent-02: zero historical rows flip fail->pass from the two new phrases specifically (none of the 6 real 1.1.0 answers contain \"didn't/did not return any results\") — the pre-existing v1.4.0 phrase set already covers all 6", () => {
    const nonexistentRows = rows.filter((r) => r.caseId === "nonexistent-02");
    assert.equal(nonexistentRows.length, 6);
    for (const r of nonexistentRows) {
      // Every one of these 6 rows was already fixed by the v1.4.0
      // absence-phrase repair (see historical-1.4.0-replay.test.ts's own
      // exact row-level delta proof) — the v1.5.0 phrase addition is
      // purely additive and does not change any of their outcomes.
      assert.equal(r.newFail, false, `${r.provider}/rep${r.repetition}: expected already-passing (via the v1.4.0 repair) under v1.5.0 too`);
    }
  });

  test("no row outside the 2 in-scope cases ever changes status (34 cases' worth of rows are provably untouched by this revision)", () => {
    const outOfScopeChanged = rows.filter((r) => !IN_SCOPE_CASE_IDS.has(r.caseId) && r.oldFail !== r.newFail);
    assert.deepEqual(outOfScopeChanged, []);
  });

  test("zero rows anywhere flip pass->fail (both v1.5.0 changes are purely additive — new OR-alternatives never remove an existing acceptance path)", () => {
    const newlyFailed = rows.filter((r) => !r.oldFail && r.newFail);
    assert.deepEqual(newlyFailed, []);
  });
});
