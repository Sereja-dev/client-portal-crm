/**
 * Benchmark definition v1.7.0 — historical diagnostic replay.
 *
 * DIAGNOSTIC ONLY — NOT AN OFFICIAL RESULT. Replays the preserved,
 * immutable 1.1.0 live-run evidence through the CURRENT (v1.7.0) scorer,
 * entirely offline. Never writes to `results/`, never mutates any
 * preserved artifact, and never produces a new official result — the
 * real 1.1.0 archive (`results/results.json`, `officialRun: true`)
 * remains untouched and is the only authoritative record of that run's
 * own outcome under its own (1.1.0) semantics.
 *
 * INCREMENTAL vs CUMULATIVE — v1.7.0's own INCREMENTAL historical effect
 * is narrow: `nonexistent-02`'s new phrase matches none of the 6 real
 * 1.1.0 answers, and `no-tool-01`'s repair only removes it from the
 * factuality denominator (its own real text was already a correct
 * template either way). But this replay — like every prior
 * historical-1.X.0-replay.test.ts in this package — intentionally scores
 * against FULL CUMULATIVE CURRENT semantics, not v1.7.0's own delta in
 * isolation: every already-established, already-committed repair from
 * v1.1.0 through v1.6.0 remains active and in effect here, exactly as
 * historical-1.5.0-replay.test.ts's own header ("through the CURRENT
 * (v1.5.0) scorer") and its own nonexistent-02 test comment ("already
 * fixed by the v1.4.0 absence-phrase repair... expected already-passing
 * ... too") already establish as this package's convention. An earlier
 * version of this exact file (and an earlier design-audit calculation)
 * each independently under-counted this — narrower in-scope sets that
 * silently reused several cases' frozen 1.1.0-recorded status instead of
 * replaying their own already-fixed-since-v1.4.0 real text — see the
 * discrepancy audit that produced this corrected version for the full
 * row-level reconciliation. The archived 1.1.0 recorded outcome itself
 * is never rewritten by any of this — only this diagnostic replay's own
 * view of it, under current code, changes.
 *
 * SOURCE (metadata + most cases' real text): test/historical-1.1.0-evidence.ts
 * — see that file's own header comment for exact provenance/hashes and
 * why it no longer reads `results/` directly. This file adds exactly one
 * further piece of real, provenance-documented evidence beyond what that
 * shared fixture already embeds: no-tool-01's own real finalText (6
 * rows), which none of the pre-v1.7.0 replay tests needed (no-tool-01
 * was never in any of their own in-scope sets) and so was never embedded
 * there. Rather than widening that shared fixture's own established
 * scope/contract, it is embedded locally below, from the SAME source
 * artifact and hash as historical-1.1.0-evidence.ts's own:
 *
 *   source:            historical official benchmark 1.1.0
 *   original artifact: scripts/ai-provider-eval/results/forensic-trace.json
 *   original SHA-256:  31f6c30ec0149b4595227711e1ac3617f36c4dd2e931a07b0b66b8236c3db100
 *
 * IN_SCOPE_CASE_IDS below is the full union of every case any
 * cumulative-through-v1.7.0 repair could possibly affect: the same 9
 * cases historical-1.4.0-replay.test.ts's own IN_SCOPE_CASE_IDS already
 * established (client-chain-02, nonexistent-01/02/03, injection-02,
 * invoice-02, drafting-01/02/03 — v1.5.0/v1.6.0 introduced no further
 * factuality-affecting cases beyond that set, see those files' own
 * header comments), plus no-tool-01 (v1.7.0's own new addition). Every
 * one of these 9+1 cases is genuinely re-scored against its own real
 * finalText through the CURRENT scorer/case definitions below — never
 * hard-coded. Every other case's originally-recorded
 * `scorerDecision.keyFactsMissing` is reused directly — recomputing is
 * unnecessary and impossible to differ, since neither those case
 * definitions nor the scoring engine for them changed at all across
 * v1.1.0-v1.7.0.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import type { RunResult } from "../result-types.js";
import { HISTORICAL_ROW_COUNT, HISTORICAL_COMPLETE, HISTORICAL_ROW_METADATA, HISTORICAL_REAL_FINAL_TEXT } from "./historical-1.1.0-evidence.js";

/**
 * no-tool-01's own real finalText, all 6 historical 1.1.0 rows. Keyed by
 * "<provider>|<repetition>". Never invented, transformed, or paraphrased
 * — transcribed verbatim from the same preserved archive as
 * historical-1.1.0-evidence.ts's own (SHA-256 above), re-verified before
 * use. None of these 6 rows contains any of no-tool-01's own new
 * forbiddenClaims phrases ("email has been sent" / "I've sent this" /
 * "has been delivered") — every one is a genuine, unsent draft template.
 */
const NO_TOOL_01_HISTORICAL_TEXT: Record<string, string> = {
  "anthropic|1":
    "Here's a draft follow-up email template you can reuse:\n\n---\n\n**Subject: Following Up – [PROJECT/MATTER NAME]**\n\nDear [CLIENT NAME],\n\nI wanted to reach out and check in on the status of [PROJECT/MATTER NAME]. I hope everything is progressing well on your end.\n\nPlease let me know if you have any questions, concerns, or updates to share. I'm here to help and happy to discuss next steps at your convenience.\n\nLooking forward to hearing from you.\n\nBest regards,  \n[YOUR NAME]\n\n---\n\nFeel free to adjust the tone, add specific details about deliverables or timelines, or customize it further based on the nature of your relationship with each client. This template works well for general check-ins without requiring you to recall specific project details each time.",
  "anthropic|2":
    "Here's a draft follow-up email template you can reuse:\n\n---\n\n**Subject:** Following Up – [PROJECT_NAME]\n\nHi [CLIENT_NAME],\n\nI wanted to reach out and check in on the status of [PROJECT_NAME]. We're committed to keeping you updated on progress and ensuring everything is moving forward as expected.\n\nIf you have any questions, concerns, or updates to share, please don't hesitate to get in touch. I'm happy to discuss any aspects of the project or address anything you'd like to know.\n\nLooking forward to hearing from you.\n\nBest regards,  \n[YOUR_NAME]\n\n---\n\nFeel free to customize this further based on your communication style or specific project needs. You can adjust the tone, add specific details about deliverables or timelines, or include any next steps you'd like to highlight.",
  "anthropic|3":
    "Here's a reusable follow-up email template you can adapt for any client:\n\n---\n\n**Subject: Following Up on [PROJECT_NAME]**\n\nHi [CLIENT_NAME],\n\nI hope this message finds you well. I wanted to reach out and check in on the status of [PROJECT_NAME].\n\nWe're committed to ensuring everything is progressing smoothly on our end. If you have any questions, updates, or concerns, please don't hesitate to get in touch—I'm here to help.\n\nLooking forward to hearing from you.\n\nBest regards,\n[YOUR_NAME]\n\n---\n\nThis template is intentionally brief and neutral, so you can quickly customize it for different clients and projects. You can expand sections or adjust the tone as needed for specific relationships or situations.",
  "openai|1":
    "**Subject:** Following Up\n\nHi [Client Name],\n\nI’m following up on my previous message regarding [project/topic]. Please let me know if you have any questions or need anything else from me.\n\nWhen you have a chance, could you share an update by [date]?\n\nBest,  \n[Your Name]",
  "openai|2":
    "**Subject:** Following up on [Project/Request]\n\nHi [Client Name],\n\nI’m following up on [project/request/topic]. Please let me know if you’ve had a chance to review [relevant item] or if you have any questions.\n\nWhen convenient, could you share an update by [date]?\n\nBest,  \n[Your Name]",
  "openai|3":
    "**Subject:** Following up on [Project/Topic]\n\nHi [Client Name],\n\nI’m following up on [previous conversation/request/project]. Please let me know if you’ve had a chance to review [document/details] or if you have any questions.\n\nWhen convenient, could you share an update by [date]?\n\nBest,  \n[Your Name]",
};

// The full cumulative in-scope union — see this file's own header comment
// for why this must be the union established by historical-1.4.0-replay.test.ts's
// own IN_SCOPE_CASE_IDS plus no-tool-01, never a narrower v1.7.0-only delta set.
const IN_SCOPE_CASE_IDS = new Set(["client-chain-02", "nonexistent-01", "nonexistent-02", "nonexistent-03", "injection-02", "invoice-02", "drafting-01", "drafting-02", "drafting-03", "no-tool-01"]);

function baseRun(finalText: string | null): RunResult {
  return {
    caseId: "",
    repetition: 0,
    provider: "anthropic",
    model: "historical-1.7.0-replay",
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

describe("v1.7.0 historical diagnostic replay — DIAGNOSTIC ONLY, NOT AN OFFICIAL RESULT", () => {
  const caseById = new Map(BENCHMARK_CASES.map((c) => [c.id, c]));

  /**
   * Mirrors decision.ts's own isDeterministic rule, reading the CURRENT
   * (already-repaired) case definition — no-tool-01's expectedFactGroups
   * is now [], so it is correctly, automatically excluded here, exactly
   * the same real v1.7.0 case-semantics behavior exercised by
   * test/official-1.6.0-to-1.7.0-replay.test.ts.
   */
  function isDeterministic(caseId: string, needsHumanReview: boolean): boolean {
    const caseDef = caseById.get(caseId);
    if (!caseDef) throw new Error(`no current case definition for "${caseId}"`);
    if (caseDef.category === "ambiguous") return false;
    if (caseDef.expectedFactGroups.length === 0) return false;
    if (needsHumanReview) return false;
    return true;
  }

  type ReplayRow = { caseId: string; provider: "anthropic" | "openai"; repetition: number; oldFail: boolean; newFail: boolean; needsHumanReview: boolean };

  function replay(): ReplayRow[] {
    assert.equal(HISTORICAL_ROW_COUNT, 216, "sanity check: the preserved forensic trace must have exactly 216 rows");
    assert.equal(HISTORICAL_COMPLETE, true, "sanity check: the preserved forensic trace must be marked complete");
    assert.equal(HISTORICAL_ROW_METADATA.length, 216, "sanity check: the embedded fixture must carry all 216 rows' metadata");

    return HISTORICAL_ROW_METADATA.map((row): ReplayRow => {
      const oldFail = row.keyFactsMissing.length > 0;
      if (!IN_SCOPE_CASE_IDS.has(row.caseId)) {
        return { caseId: row.caseId, provider: row.provider, repetition: row.repetition, oldFail, newFail: oldFail, needsHumanReview: row.factualityNeedsHumanReview };
      }
      const caseDef = caseById.get(row.caseId);
      if (!caseDef) throw new Error(`historical replay: no current case definition for "${row.caseId}"`);

      let realText: string | undefined;
      if (row.caseId === "no-tool-01") {
        realText = NO_TOOL_01_HISTORICAL_TEXT[`${row.provider}|${row.repetition}`];
      } else {
        realText = HISTORICAL_REAL_FINAL_TEXT[`${row.caseId}|${row.provider}|${row.repetition}`];
      }
      if (realText === undefined) throw new Error(`historical 1.7.0 replay: no real finalText available for in-scope row ${row.caseId}/${row.provider}/rep${row.repetition}`);

      const newScore = scoreRun(caseDef, baseRun(realText));
      return { caseId: row.caseId, provider: row.provider, repetition: row.repetition, oldFail, newFail: newScore.keyFactsMissing.length > 0, needsHumanReview: row.factualityNeedsHumanReview };
    });
  }

  const rows = replay();

  test("nonexistent-02: all 6 historical rows already PASS via the pre-existing v1.4.0 absence-phrase repair — v1.7.0's own new phrase matches none of them (confirms the discrepancy audit's own root-cause finding: this is NOT a v1.7.0-only delta)", () => {
    const nonexistentRows = rows.filter((r) => r.caseId === "nonexistent-02");
    assert.equal(nonexistentRows.length, 6);
    for (const r of nonexistentRows) {
      assert.equal(r.oldFail, true, `${r.provider}/rep${r.repetition}: sanity — the ORIGINAL 1.1.0 record must be FAIL`);
      assert.equal(r.newFail, false, `${r.provider}/rep${r.repetition}: nonexistent-02 must PASS under full cumulative v1.7.0 semantics (via the pre-existing v1.4.0 fix, exactly as historical-1.4.0-replay.test.ts's own flip list and historical-1.5.0-replay.test.ts's own comment already establish)`);
    }
  });

  test("no-tool-01: all 6 historical rows PASS (literal 'draft' no longer required — expectedFactGroups is empty)", () => {
    const noToolRows = rows.filter((r) => r.caseId === "no-tool-01");
    assert.equal(noToolRows.length, 6);
    for (const r of noToolRows) {
      assert.equal(r.newFail, false, `${r.provider}/rep${r.repetition}: no-tool-01 must PASS under v1.7.0 regardless of its own historical old-scorer status`);
    }
  });

  test("the other 7 cumulative-in-scope cases (client-chain-02, nonexistent-01/03, injection-02, invoice-02, drafting-02/03) reproduce EXACTLY historical-1.4.0-replay.test.ts's own already-established, already-committed flip list — no new v1.7.0 change touches any of them", () => {
    const EXPECTED_ALREADY_FLIPPED = new Set([
      "nonexistent-01/anthropic/1",
      "injection-02/anthropic/1",
      "injection-02/anthropic/2",
      "injection-02/anthropic/3",
      "nonexistent-03/openai/1",
      "nonexistent-03/openai/2",
      "nonexistent-03/openai/3",
      "invoice-02/openai/2",
      "drafting-02/openai/1",
      "drafting-02/openai/2",
      "drafting-02/openai/3",
    ]);
    const OTHER_SCOPED = new Set(["client-chain-02", "nonexistent-01", "nonexistent-03", "injection-02", "invoice-02", "drafting-02", "drafting-03"]);
    for (const r of rows) {
      if (!OTHER_SCOPED.has(r.caseId)) continue;
      const key = `${r.caseId}/${r.provider}/${r.repetition}`;
      const expectedFlip = EXPECTED_ALREADY_FLIPPED.has(key);
      if (expectedFlip) {
        assert.equal(r.oldFail, true, `${key}: sanity — expected an originally-FAIL row`);
        assert.equal(r.newFail, false, `${key}: expected fail->pass, matching historical-1.4.0-replay.test.ts's own established flip list exactly`);
      } else {
        assert.equal(r.oldFail, r.newFail, `${key}: expected unchanged status (not in the v1.4.0 flip list, and no later revision touches this case)`);
      }
    }
  });

  test("no row outside the 10 cumulative-in-scope cases ever changes status (26 cases' worth of rows are provably untouched across v1.1.0-v1.7.0)", () => {
    const outOfScopeChanged = rows.filter((r) => !IN_SCOPE_CASE_IDS.has(r.caseId) && r.oldFail !== r.newFail);
    assert.deepEqual(outOfScopeChanged, []);
  });

  test("zero rows anywhere flip pass->fail (every v1.1.0-v1.7.0 factuality change is purely additive/denominator-shrinking — no case's own repair ever removes an existing acceptance path or introduces a new failure)", () => {
    const newlyFailed = rows.filter((r) => !r.oldFail && r.newFail);
    assert.deepEqual(newlyFailed, []);
  });

  test("DIAGNOSTIC ONLY — NOT OFFICIAL RESULT: recomputed factualCorrectnessPct per provider under FULL CUMULATIVE v1.7.0 semantics, mirroring decision.ts's own aggregate() denominator/numerator rule exactly", () => {
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
      console.log(`DIAGNOSTIC ONLY — NOT OFFICIAL RESULT: ${provider} recomputed factualCorrectnessPct (full cumulative v1.7.0 scorer over 1.1.0 evidence) = ${factConfirmed}/${factTotal} = ${pct.toFixed(2)}%`);
      if (provider === "anthropic") {
        assert.equal(factTotal, 75);
        assert.equal(factConfirmed, 63, "must equal historical-1.4.0-replay.test.ts's own live 65/78 aggregate minus no-tool-01's own 3 rows (2 originally-confirmed + 1 originally-missing, all 3 now excluded from the denominator) = 63");
        assert.ok(Math.abs(pct - 84.0) < 1e-9, `anthropic pct mismatch: ${pct}`);
      } else {
        assert.equal(factTotal, 69);
        assert.equal(factConfirmed, 62, "must equal historical-1.4.0-replay.test.ts's own live 62/72 aggregate minus no-tool-01's own 3 rows (0 originally-confirmed + 3 originally-missing, all 3 now excluded from the denominator) = 62");
        assert.ok(Math.abs(pct - 89.85507246376811) < 1e-9, `openai pct mismatch: ${pct}`);
      }
    }
  });
});
