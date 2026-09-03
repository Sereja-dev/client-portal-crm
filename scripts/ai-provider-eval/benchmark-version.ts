/**
 * Isolated Aqenra AI provider benchmark harness — explicit benchmark
 * DEFINITION version.
 *
 * This is NOT a package/SDK version and NEVER derived from the current
 * git SHA — the git SHA changes on every commit, including ones that
 * touch nothing about what the benchmark measures (docs, artifact-safety
 * fixes, harness operational fixes), so it cannot by itself signal
 * whether two runs are semantically comparable. This constant is
 * manually maintained and bumped ONLY when the actual challenge changes:
 *
 * BUMP when:
 *   - case scoring semantics change (e.g. how expectedFactGroups are
 *     evaluated, a new assertion kind, a new pass/fail rule)
 *   - a case's expected facts/forbidden claims materially change
 *   - a fixture change alters the evaluated challenge (a record name a
 *     case depends on, a synthetic data value a case's expectation is
 *     keyed to)
 *   - the scorer's interpretation of an existing rule changes
 *
 * Do NOT bump for:
 *   - comments/docs-only changes
 *   - unrelated harness operational fixes (e.g. the artifact-safety /
 *     test-cleanup remediation, README wording)
 *   - SDK/dependency version bumps that don't alter benchmark semantics
 *
 * History:
 *   - 1.0.0 (implicit/pre-versioning): the original 36-case benchmark
 *     introduced by PR #180, with PR #181's OpenAI reasoning_effort
 *     compatibility fix layered on top (a provider-adapter fix, not a
 *     semantics bump — see "Do NOT bump" above). Used for the official
 *     2026-09-03 live run — results.json SHA-256
 *     450349e960c551f64c993fb104a4347eab459c027984da75107bf3ecf3aced0e,
 *     machine outcome NO_MODEL_PASSES_QUALITY_GATE. That run is
 *     immutable and remains valid UNDER 1.0.0's own semantics — it must
 *     never be reinterpreted, rescored, or compared as if it used
 *     1.1.0's grouped/numeric scoring. See README.md's own "Benchmark
 *     definition version" section.
 *   - 1.1.0: expectedFactGroups (OR-within-group / AND-across-groups)
 *     replacing expectedKeyFacts' pure-AND semantics; a first-class
 *     numeric assertion kind; nonexistent-01/nonexistent-02 migrated to
 *     one OR-group each for their absence-phrasing synonyms;
 *     org-summary-02 migrated to numeric assertions sourced from
 *     fixtures/organization.ts's OUTSTANDING_AMOUNT/PAID_REVENUE; the
 *     injection-02 fixture project renamed to remove a forbidden-claim/
 *     record-name self-collision, plus a permanent collision-invariant
 *     test. No threshold, tie-rule, repetition-count, provider-call
 *     ceiling, output-token ceiling, model ID, reasoning_effort, system
 *     prompt, tool description, or provider-adapter change.
 */
export const BENCHMARK_DEFINITION_VERSION = "1.1.0";
