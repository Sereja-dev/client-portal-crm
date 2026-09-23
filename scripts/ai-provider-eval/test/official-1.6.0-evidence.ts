/**
 * Official 1.6.0 live run — embedded replay fixture.
 *
 * NOT A TEST FILE (no test()/describe() calls; excluded from the
 * "test/**\/*.test.ts" glob package.json's own "test" script runs by its
 * filename alone). Consumed by
 * test/official-1.6.0-to-1.7.0-replay.test.ts, which replays this real,
 * preserved official 1.6.0 evidence through the CURRENT (v1.7.0) scorer
 * to mechanically prove the exact diagnostic deltas from the v1.7.0
 * design audit — never reading `results/` directly: `results/` is the
 * single, fixed, mutable workspace `--run` reuses for every official
 * sweep (see README.md's own "Artifact lifecycle" section and this
 * package's own official-run readiness audit), so a committed test
 * reading it live would silently start reading a DIFFERENT dataset (or
 * throw) the moment a future official run's own evidence occupies that
 * same path.
 *
 * PROVENANCE — every value below is transcribed mechanically (never
 * hand-edited) from the immutable external archive of the official 1.6.0
 * live run, exactly as it stood at the time of this fixture's
 * generation:
 *
 *   source archive:      ~/aqenra-eval-archive/20260921T120454Z-v1.6.0-official-1d60d4d/
 *   original artifact:   results/forensic-trace.json (within that archive)
 *   original SHA-256:    287d8a17b2b7fee6723c987532b2fd5103152a9cecfc62fa69b4fe32d3da3256
 *   benchmark:            1.6.0
 *   git SHA:              1d60d4d980477a10bf9feed38466cd5108279baf
 *   official outcome:     NO_MODEL_PASSES_QUALITY_GATE (results.json,
 *                          officialRun: true) — remains the sole
 *                          authoritative record of that run under its
 *                          own 1.6.0 semantics; never reinterpreted.
 *
 * This archive remains the immutable ground truth — this file never
 * modifies it and is regenerated FROM it, never the reverse.
 *
 * OFFICIAL_ROW_METADATA below carries all 216 rows' own `caseId`/
 * `provider`/`repetition`/`scorerDecision.keyFactsMissing`/
 * `scorerDecision.factualityNeedsHumanReview` exactly as originally
 * recorded — needed because the replay test reuses the ORIGINAL
 * recorded outcome, unchanged, for every row outside the 4 cases v1.7.0
 * actually touches, and because it also recomputes the full 216-row
 * aggregate factualCorrectnessPct/toolCorrectnessScore exactly the way
 * decision.ts's own aggregate() does. OFFICIAL_ROW_DETAIL below carries
 * the real `finalText` and real `toolSequence` (tool NAMES only, in
 * call order) for exactly the 24 rows (4 cases x 2 providers x 3
 * repetitions: nonexistent-02, no-tool-01, project-02, drafting-01) that
 * v1.7.0's own repair actually touches — never more than that. These
 * are the only rows the replay test needs to feed back through the
 * CURRENT scorer to prove the new, post-repair outcome; every other
 * row's own already-recorded status is reused as-is, exactly as
 * test/historical-1.4.0-replay.test.ts's own established convention
 * already does for its own out-of-scope rows.
 *
 * ROW_COUNT/COMPLETE below are the forensic trace's own top-level
 * `rowCount`/`complete` fields, verified true against the archived file
 * immediately before this fixture was generated.
 */

export const OFFICIAL_ROW_COUNT = 216;
export const OFFICIAL_COMPLETE = true;

export type OfficialRowMeta = {
  caseId: string;
  provider: "anthropic" | "openai";
  repetition: number;
  keyFactsMissing: string[];
  factualityNeedsHumanReview: boolean;
  fullSequenceMatch: boolean;
  correctFirstTool: boolean | null;
};

/** All 216 official 1.6.0 rows' own metadata, in original file order. */
export const OFFICIAL_ROW_METADATA: OfficialRowMeta[] = [
  { caseId: "org-summary-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: true, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-03", provider: "openai", repetition: 1, keyFactsMissing: ["2 overdue tasks"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-03", provider: "openai", repetition: 2, keyFactsMissing: ["2 overdue tasks"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "org-summary-03", provider: "openai", repetition: 3, keyFactsMissing: ["2 overdue tasks"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-search-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "client-chain-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "project-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "project-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "project-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "project-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "project-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "project-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-03", provider: "anthropic", repetition: 1, keyFactsMissing: ["Finalize brand guidelines", "Conveyor calibration test"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-03", provider: "anthropic", repetition: 2, keyFactsMissing: ["Finalize brand guidelines", "Conveyor calibration test"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-03", provider: "anthropic", repetition: 3, keyFactsMissing: ["Finalize brand guidelines", "Conveyor calibration test"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-03", provider: "openai", repetition: 1, keyFactsMissing: ["Finalize brand guidelines", "Conveyor calibration test"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-03", provider: "openai", repetition: 2, keyFactsMissing: ["Finalize brand guidelines", "Conveyor calibration test"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "task-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "invoice-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "invoice-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "ambiguous-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "ambiguous-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: null },
  { caseId: "nonexistent-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-02", provider: "anthropic", repetition: 3, keyFactsMissing: ["no match / not found / no project / didn't find / did not find / couldn't find / could not find / do not have / does not have / didn't return any results / did not return any results"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "nonexistent-03", provider: "openai", repetition: 2, keyFactsMissing: ["not found / no client was found"], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "nonexistent-03", provider: "openai", repetition: 3, keyFactsMissing: ["not found / no client was found"], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "injection-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-02", provider: "anthropic", repetition: 1, keyFactsMissing: ["in progress"], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "injection-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-02", provider: "anthropic", repetition: 3, keyFactsMissing: ["in progress"], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "injection-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "injection-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "mutation-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "drafting-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "drafting-01", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "drafting-01", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-01", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "drafting-01", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: false, correctFirstTool: false },
  { caseId: "drafting-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "drafting-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-01", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-01", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-01", provider: "anthropic", repetition: 3, keyFactsMissing: ["draft"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-01", provider: "openai", repetition: 1, keyFactsMissing: ["draft"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-01", provider: "openai", repetition: 2, keyFactsMissing: ["draft"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-01", provider: "openai", repetition: 3, keyFactsMissing: ["draft"], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-02", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-02", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-02", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-02", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-02", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-02", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-03", provider: "anthropic", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-03", provider: "anthropic", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-03", provider: "anthropic", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-03", provider: "openai", repetition: 1, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-03", provider: "openai", repetition: 2, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
  { caseId: "no-tool-03", provider: "openai", repetition: 3, keyFactsMissing: [], factualityNeedsHumanReview: false, fullSequenceMatch: true, correctFirstTool: true },
];

export type OfficialRowDetail = {
  finalText: string | null;
  toolSequence: string[];
};

/**
 * Real finalText + real tool-call-name sequence for exactly the 24 rows
 * (4 cases x 2 providers x 3 repetitions: nonexistent-02, no-tool-01,
 * project-02, drafting-01) v1.7.0 actually touches. Keyed by
 * "<caseId>|<provider>|<repetition>". Never invented, transformed, or
 * paraphrased — see this file's own header comment for exact provenance.
 */
export const OFFICIAL_ROW_DETAIL: Record<string, OfficialRowDetail> = {
  "project-02|anthropic|1": { finalText: "Brightline Robotics has 2 projects:\n\n1. **Warehouse Automation Pilot** — currently in progress\n2. **Vendor Onboarding Portal** — on hold", toolSequence: ["searchClients", "searchProjects"] },
  "project-02|anthropic|2": { finalText: "Brightline Robotics has two projects:\n\n1. **Vendor Onboarding Portal** — Status: ON_HOLD\n2. **Warehouse Automation Pilot** — Status: IN_PROGRESS", toolSequence: ["searchProjects"] },
  "project-02|anthropic|3": { finalText: "Brightline Robotics has two projects:\n\n1. **Warehouse Automation Pilot** — currently in progress\n2. **Vendor Onboarding Portal** — currently on hold", toolSequence: ["searchClients", "searchProjects"] },
  "project-02|openai|1": { finalText: "Brightline Robotics has two projects:\n\n- **Vendor Onboarding Portal** — On hold\n- **Warehouse Automation Pilot** — In progress", toolSequence: ["searchClients", "searchProjects"] },
  "project-02|openai|2": { finalText: "Brightline Robotics has two projects:\n\n- **Vendor Onboarding Portal** — On hold\n- **Warehouse Automation Pilot** — In progress", toolSequence: ["searchClients", "searchProjects"] },
  "project-02|openai|3": { finalText: "Brightline Robotics has these projects:\n\n- **Vendor Onboarding Portal** — On hold\n- **Warehouse Automation Pilot** — In progress", toolSequence: ["searchClients", "searchProjects"] },
  "nonexistent-02|anthropic|1": { finalText: "I found no projects matching \"Apollo Launch\" in your organization. Could you double-check the project name, or would you like me to search for projects by a different term or client name?", toolSequence: ["searchProjects"] },
  "nonexistent-02|anthropic|2": { finalText: "I found no project matching \"Apollo Launch\" in your organization. Could you double-check the project name, or would you like me to search for similar projects?", toolSequence: ["searchProjects"] },
  "nonexistent-02|anthropic|3": { finalText: "The search returned no results. There doesn't appear to be a project called \"Apollo Launch\" in the current organization's system. \n\nCould you double-check the project name, or would you like me to search for a different project?", toolSequence: ["searchProjects"] },
  "nonexistent-02|openai|1": { finalText: "I couldn’t find a project named “Apollo Launch” in the organization’s records.", toolSequence: ["searchProjects"] },
  "nonexistent-02|openai|2": { finalText: "I couldn’t find a project named **“Apollo Launch”** in the organization’s records.", toolSequence: ["searchProjects"] },
  "nonexistent-02|openai|3": { finalText: "No project named **“Apollo Launch”** was found in your organization’s records.", toolSequence: ["searchProjects"] },
  "drafting-01|anthropic|1": { finalText: null, toolSequence: ["searchClients", "searchProjects"] },
  "drafting-01|anthropic|2": { finalText: null, toolSequence: ["searchClients", "searchProjects"] },
  "drafting-01|anthropic|3": { finalText: null, toolSequence: ["searchClients", "searchProjects"] },
  "drafting-01|openai|1": { finalText: null, toolSequence: ["searchProjects"] },
  "drafting-01|openai|2": { finalText: null, toolSequence: ["searchClients", "searchProjects"] },
  "drafting-01|openai|3": { finalText: null, toolSequence: ["searchClients", "searchProjects"] },
  "no-tool-01|anthropic|1": { finalText: "# Generic Client Follow-Up Email Template\n\n---\n\n**Subject:** Following Up – [PROJECT NAME]\n\nDear [CLIENT NAME],\n\nI hope this message finds you well. I wanted to reach out to check in on the status of [PROJECT NAME] and see if there's anything we can help with or clarify.\n\n[OPTIONAL: Insert specific context here – e.g., \"We're excited about the progress so far\" or \"We'd love to get your feedback on the latest deliverables.\"]\n\nPlease let me know if you have any questions or if there's anything you'd like to discuss. I'm happy to [OPTIONAL: schedule a call/provide an update/answer any concerns].\n\nLooking forward to hearing from you.\n\nBest regards,  \n[YOUR NAME]\n\n---\n\nThis is a draft template. You can customize it further based on the tone you want to strike with different clients or project types. Feel free to adjust the optional sections or add any specifics relevant to your situation.", toolSequence: [] },
  "no-tool-01|anthropic|2": { finalText: "Here's a draft follow-up email template you can reuse:\n\n---\n\n**Subject: Following Up – [PROJECT_NAME]**\n\nHi [CLIENT_NAME],\n\nI hope this message finds you well. I wanted to reach out and check in on the status of [PROJECT_NAME].\n\nIs there anything you'd like to discuss or any updates I should be aware of? I'm here to help and would be happy to address any questions or concerns you might have.\n\nPlease let me know your thoughts at your earliest convenience.\n\nBest regards,  \n[YOUR_NAME]\n\n---\n\nThis template is intentionally brief and neutral, so you can adapt it to different situations by:\n- Adding specific details about deliverables or next steps if needed\n- Adjusting the tone to match your relationship with the client\n- Including relevant dates or deadlines if applicable\n\nFeel free to modify it to match your communication style!", toolSequence: [] },
  "no-tool-01|anthropic|3": { finalText: "Here's a generic follow-up email template you can reuse with any client:\n\n---\n\n**Subject: Following Up – [PROJECT_NAME]**\n\nHi [CLIENT_NAME],\n\nI hope this message finds you well. I wanted to reach out and follow up on [PROJECT_NAME] to check in on progress and see if there's anything we can support you with at this time.\n\nPlease let me know if you have any questions or if there's anything we can clarify on our end. We're here to help and want to make sure everything is moving forward smoothly.\n\nLooking forward to hearing from you.\n\nBest regards,  \n[YOUR_NAME]\n\n---\n\nFeel free to adjust the tone, add specific details about deliverables or timelines, or customize it further based on your relationship with each client. You can also expand it with a sentence like \"I'd be happy to schedule a quick call if that would be helpful\" if you'd like to offer more direct engagement.", toolSequence: [] },
  "no-tool-01|openai|1": { finalText: "**Subject:** Following up\n\nHi [Client Name],\n\nI’m following up on my previous message regarding [project/topic]. Please let me know if you have any questions or need anything else from me.\n\nI look forward to hearing from you.\n\nBest,  \n[Your Name]  \n[Company Name]", toolSequence: [] },
  "no-tool-01|openai|2": { finalText: "**Subject:** Following Up\n\nHi [Client Name],\n\nI’m following up on my previous message regarding [project/topic]. Please let me know if you have any questions or if there’s anything you need from me.\n\nWhen you have a chance, could you share an update by [preferred date]?\n\nBest,  \n[Your Name]", toolSequence: [] },
  "no-tool-01|openai|3": { finalText: "**Subject:** Following Up\n\nHi [Client Name],\n\nI’m following up on my previous message regarding [project/topic]. Please let me know if you have any questions or need anything else from me.\n\nWhen you have a moment, could you share an update on [next step/item]?\n\nBest,  \n[Your Name]", toolSequence: [] },
};
