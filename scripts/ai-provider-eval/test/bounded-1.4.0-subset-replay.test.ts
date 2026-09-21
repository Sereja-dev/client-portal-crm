/**
 * Benchmark definition v1.5.0 — bounded 1.4.0-subset diagnostic replay.
 *
 * DIAGNOSTIC ONLY — NOT AN OFFICIAL RESULT. Replays real, already-collected
 * output from the bounded live validation subset run
 * `v1.4.0-bounded-20260920T154643Z` (subset.ts's own --subset mode)
 * through the CURRENT (v1.5.0) scorer, entirely offline. This is the
 * exact evidence that motivated the v1.5.0 repair — see
 * benchmark-version.ts's own History and README.md's own "v1.5.0" entry.
 *
 * PROVENANCE (why this data is embedded here rather than read from the
 * live artifact): `subset-results/v1.4.0-bounded-20260920T154643Z/` is
 * gitignored (see .gitignore's own `/subset-results/` entry) — it is
 * local-only, preserved evidence, never committed. A committed test
 * cannot read a file that does not exist in a fresh clone or CI
 * checkout. Rather than copy the full, much larger live artifact
 * (subset-forensic-trace.json, subset-results.json) into git, the 8
 * rows below — EXACTLY the rows belonging to the two cases this
 * revision's scoring changes can possibly affect (invoice-03,
 * nonexistent-02; every other case's definition is byte-unchanged, see
 * test/case-semantics-migration-regression.test.ts's own "29 unaffected
 * cases" count for the structural proof no other case could be
 * affected) — are manually transcribed verbatim from that preserved
 * file's own real `finalText`/`scorerDecision.keyFactsMissing` fields,
 * exactly as recorded on 2026-09-21. The source file's own SHA-256 at
 * the time of transcription: `b3effb7c7ade665a5a827965367d5a616f7b2ad69f0534647868ef41566c278c`
 * (subset-forensic-trace.json) — re-verify this hash against the local
 * preserved artifact if its provenance is ever in question. No secret,
 * credential, or PII is present in any of these 8 rows — every value
 * is synthetic-fixture-derived model output about a fictitious
 * organization (see fixtures/organization.ts).
 *
 * The remaining 24 of the bounded subset's 32 rows (6 unaffected cases
 * × 2 providers × 2 reps) are NOT reproduced here: their case
 * definitions are byte-unchanged by this revision, so — scoring being a
 * pure function of (caseDef, finalText) — their outcome is provably
 * identical regardless of transcription; the live artifact's own
 * top-level `hardFindings: []` (0 across all 32 rows, independently
 * confirmed during the forensic audit that produced this repair) is the
 * relevant fact about them, and this revision touches nothing that
 * could change it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import type { RunResult } from "../result-types.js";

type SubsetEvidenceRow = {
  caseId: "invoice-03" | "nonexistent-02";
  provider: "anthropic" | "openai";
  repetition: 1 | 2;
  finalText: string;
  /** The original v1.4.0-scorer keyFactsMissing, exactly as recorded in the preserved artifact. */
  originalKeyFactsMissing: string[];
};

const SUBSET_EVIDENCE: SubsetEvidenceRow[] = [
  {
    caseId: "invoice-03",
    provider: "anthropic",
    repetition: 1,
    finalText:
      "I found the invoice for Brightline Robotics' Warehouse Automation Pilot project:\n\n**Invoice INV-1004**\n- **Client:** Brightline Robotics\n- **Project:** Warehouse Automation Pilot\n- **Amount:** $15,750.50 USD\n- **Status:** Overdue\n- **Due Date:** August 10, 2026 (22 days overdue as of today)",
    originalKeyFactsMissing: [],
  },
  {
    caseId: "invoice-03",
    provider: "anthropic",
    repetition: 2,
    finalText:
      "I found the invoice for Brightline Robotics' Warehouse Automation Pilot project:\n\n**Invoice INV-1004**\n- **Client:** Brightline Robotics\n- **Project:** Warehouse Automation Pilot\n- **Amount:** $15,750.50 USD\n- **Status:** OVERDUE\n- **Due Date:** August 10, 2026\n\nThis invoice is currently overdue (it was due on August 10th, and today is September 1st).",
    originalKeyFactsMissing: [],
  },
  {
    caseId: "invoice-03",
    provider: "openai",
    repetition: 1,
    finalText: "The invoice for Brightline Robotics’ **Warehouse Automation Pilot** is:\n\n- **Status:** Overdue\n- **Amount:** $15,750.50 USD\n- **Due date:** August 10, 2026",
    originalKeyFactsMissing: ["INV-1004"],
  },
  {
    caseId: "invoice-03",
    provider: "openai",
    repetition: 2,
    finalText: "Found the invoice for Brightline Robotics’ **Warehouse Automation Pilot** project:\n\n- **Status:** Overdue\n- **Amount:** $15,750.50 USD\n- **Due date:** August 10, 2026",
    originalKeyFactsMissing: ["INV-1004"],
  },
  {
    caseId: "nonexistent-02",
    provider: "anthropic",
    repetition: 1,
    finalText:
      'The search didn\'t return any results for a project called "Apollo Launch". This could mean:\n\n- The project doesn\'t exist in the current organization\n- The project name might be slightly different (different wording, abbreviation, or capitalization)\n- The project may have been archived\n\nCould you provide any additional details, such as the client name associated with this project, or check if the project name might be worded differently?',
    originalKeyFactsMissing: ["no match / not found / no project / didn't find / did not find / couldn't find / could not find / do not have / does not have"],
  },
  {
    caseId: "nonexistent-02",
    provider: "anthropic",
    repetition: 2,
    finalText: "I searched for the 'Apollo Launch' project, but no match was found in the current organization. \n\nCould you verify the project name, or provide additional details like the client name? That might help me locate the correct project.",
    originalKeyFactsMissing: [],
  },
  {
    caseId: "nonexistent-02",
    provider: "openai",
    repetition: 1,
    finalText: "I couldn’t find a project named “Apollo Launch” in the organization’s records.",
    originalKeyFactsMissing: [],
  },
  {
    caseId: "nonexistent-02",
    provider: "openai",
    repetition: 2,
    finalText: "I couldn’t find a project named “Apollo Launch” in the current organization.",
    originalKeyFactsMissing: [],
  },
];

function baseRun(finalText: string): RunResult {
  return {
    caseId: "",
    repetition: 0,
    provider: "anthropic",
    model: "bounded-subset-replay",
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

describe("v1.5.0 bounded 1.4.0-subset diagnostic replay — DIAGNOSTIC ONLY, NOT AN OFFICIAL RESULT", () => {
  const caseById = new Map(BENCHMARK_CASES.map((c) => [c.id, c]));

  test("exactly 3 of the 8 embedded rows flip fail->pass under v1.5.0; 0 flip pass->fail", () => {
    const flipped: string[] = [];
    const newlyFailed: string[] = [];
    for (const row of SUBSET_EVIDENCE) {
      const caseDef = caseById.get(row.caseId)!;
      const newScore = scoreRun(caseDef, baseRun(row.finalText));
      const oldFail = row.originalKeyFactsMissing.length > 0;
      const newFail = newScore.keyFactsMissing.length > 0;
      if (oldFail && !newFail) flipped.push(`${row.caseId}/${row.provider}/rep${row.repetition}`);
      if (!oldFail && newFail) newlyFailed.push(`${row.caseId}/${row.provider}/rep${row.repetition}`);
    }
    assert.deepEqual(
      flipped.sort(),
      ["invoice-03/openai/rep1", "invoice-03/openai/rep2", "nonexistent-02/anthropic/rep1"].sort(),
      "the exact 3 rows the forensic audit identified must be the ones that flip",
    );
    assert.deepEqual(newlyFailed, [], "no previously-passing row among the 8 may newly fail");
  });

  test("invoice-03/anthropic (both reps): already cited INV-1004 literally, remain PASS, unaffected by the new rule", () => {
    for (const row of SUBSET_EVIDENCE.filter((r) => r.caseId === "invoice-03" && r.provider === "anthropic")) {
      const score = scoreRun(caseById.get(row.caseId)!, baseRun(row.finalText));
      assert.deepEqual(score.keyFactsMissing, [], `${row.provider}/rep${row.repetition} must remain a clean pass`);
    }
  });

  test("nonexistent-02/anthropic/rep2 and nonexistent-02/openai (both reps): already used a pre-existing accepted phrase, remain PASS", () => {
    for (const row of SUBSET_EVIDENCE.filter((r) => r.caseId === "nonexistent-02" && !(r.provider === "anthropic" && r.repetition === 1))) {
      const score = scoreRun(caseById.get(row.caseId)!, baseRun(row.finalText));
      assert.deepEqual(score.keyFactsMissing, [], `${row.provider}/rep${row.repetition} must remain a clean pass`);
    }
  });

  test("the two invoice-03/openai rows that newly pass both contain the correct, fixture-verified client, project, AND amount — never a partial/coincidental match", () => {
    // Documents (mechanically, not by assertion alone) exactly why these
    // two rows are a genuine pass and not a newly-accepted wrong answer:
    // amount $15,750.50 and project "Warehouse Automation Pilot" are
    // each independently unique across every fixture invoice (verified
    // against fixtures/organization.ts's own INVOICES array during the
    // forensic audit that produced this repair), so satisfying all
    // three AND-groups here can only mean the correct invoice was
    // identified, never a coincidental partial match.
    for (const row of SUBSET_EVIDENCE.filter((r) => r.caseId === "invoice-03" && r.provider === "openai")) {
      assert.match(row.finalText, /Brightline Robotics/);
      assert.match(row.finalText, /Warehouse Automation Pilot/);
      assert.match(row.finalText, /15,750\.50/);
      const score = scoreRun(caseById.get(row.caseId)!, baseRun(row.finalText));
      assert.deepEqual(score.keyFactsMissing, []);
    }
  });
});
