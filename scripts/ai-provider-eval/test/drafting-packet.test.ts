import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDraftingBlindArtifacts, writeDraftingBlindArtifacts, DRAFTING_BLIND_SEED } from "../drafting-packet.js";
import { BENCHMARK_CASES } from "../cases.js";
import type { RunResult } from "../result-types.js";

const DRAFTING_CASE_IDS = BENCHMARK_CASES.filter((c) => c.category === "drafting").map((c) => c.id).sort();

function run(overrides: Partial<RunResult> & Pick<RunResult, "caseId" | "repetition" | "provider" | "model" | "finalText">): RunResult {
  return {
    providerCalls: [],
    toolCalls: [],
    protocolViolation: false,
    errorClass: null,
    totalLatencyMs: 123.4,
    totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    estimatedCostUsd: 0.001,
    ...overrides,
  };
}

/** Realistic drafting-shaped text that never happens to contain a vendor/model name — see drafting-packet.ts's own "KNOWN, ACCEPTED LIMITATION" doc comment for why this matters for the leak-check tests below. */
function draftingRuns(): RunResult[] {
  return [
    run({ caseId: "drafting-01", repetition: 1, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: "Draft: Hi Cobalt & Finch team, a quick update on Brand Discovery." }),
    run({ caseId: "drafting-01", repetition: 1, provider: "openai", model: "gpt-5.6-luna", finalText: "Draft: Hello Cobalt & Finch, checking in on Brand Discovery status." }),
    run({ caseId: "drafting-01", repetition: 2, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: "Draft v2: following up once more on Brand Discovery." }),
    run({ caseId: "drafting-01", repetition: 2, provider: "openai", model: "gpt-5.6-luna", finalText: "Draft v2 (other vendor): another follow-up on Brand Discovery." }),
    run({ caseId: "drafting-01", repetition: 3, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: "Draft v3: third follow-up attempt on Brand Discovery." }),
    run({ caseId: "drafting-01", repetition: 3, provider: "openai", model: "gpt-5.6-luna", finalText: "Draft v3 (other vendor): third attempt on Brand Discovery." }),
    run({ caseId: "drafting-02", repetition: 1, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: "Draft: internal note summarizing overdue invoices for the team." }),
    run({ caseId: "drafting-02", repetition: 1, provider: "openai", model: "gpt-5.6-luna", finalText: "Draft: overdue invoice summary for internal review." }),
    run({ caseId: "drafting-03", repetition: 1, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: "Draft: a polite reminder regarding invoice INV-1002." }),
    run({ caseId: "drafting-03", repetition: 1, provider: "openai", model: "gpt-5.6-luna", finalText: "Draft: friendly reminder about invoice INV-1002." }),
    // A non-drafting run — must be excluded entirely.
    run({ caseId: "client-search-01", repetition: 1, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: "Alderbrook Studio is active." }),
    // A drafting run with no answer (errored) — must be excluded.
    run({ caseId: "drafting-01", repetition: 1, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: null, errorClass: "timeout" }),
  ];
}

describe("drafting-packet.ts — scope and identity safety", () => {
  test("includes only drafting-category cases, excludes non-drafting and null-answer runs", () => {
    const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
    for (const entry of artifacts.packet.entries) {
      assert.ok(DRAFTING_CASE_IDS.includes(entry.caseId));
      assert.equal(entry.category, "drafting");
    }
    assert.equal(artifacts.packet.entries.some((e) => e.caseId === "client-search-01"), false);
  });

  test("covers ALL repetitions (not one representative sample) — 3 drafting cases x up to 2 providers x up to 3 reps", () => {
    const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
    // drafting-01 has 3 reps x 2 providers = 6 (minus the one null-answer run counted separately below is a DIFFERENT entry with the same case/rep/provider as a valid one — see note); drafting-02/03 have 1 rep x 2 providers = 2 each.
    const byCaseId = new Map<string, number>();
    for (const entry of artifacts.packet.entries) byCaseId.set(entry.caseId, (byCaseId.get(entry.caseId) ?? 0) + 1);
    assert.equal(byCaseId.get("drafting-01"), 6);
    assert.equal(byCaseId.get("drafting-02"), 2);
    assert.equal(byCaseId.get("drafting-03"), 2);
  });

  test("scorer-visible packet contains ZERO vendor/model identity strings", () => {
    const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
    const packetStr = JSON.stringify(artifacts.packet);
    assert.equal(/anthropic|openai|claude|gpt-5|haiku-4|luna/i.test(packetStr), false);
  });

  test("scorer-visible packet contains NO token/cost/latency/errorClass/provider/model fields at all", () => {
    const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
    for (const entry of artifacts.packet.entries) {
      const keys = Object.keys(entry).sort();
      assert.deepEqual(keys, ["blindId", "caseId", "category", "finalText", "prompt", "repetition", "slot"].sort());
    }
  });

  test("the mapping file DOES contain the real provider/model, and correctly reverses every blindId", () => {
    const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
    const mappingById = new Map(artifacts.mapping.entries.map((e) => [e.blindId, e]));
    for (const entry of artifacts.packet.entries) {
      const mapped = mappingById.get(entry.blindId);
      assert.ok(mapped, `no mapping entry for ${entry.blindId}`);
      assert.ok(mapped!.provider === "anthropic" || mapped!.provider === "openai");
      assert.ok(mapped!.model.length > 0);
    }
    assert.equal(artifacts.mapping.entries.length, artifacts.packet.entries.length);
  });

  test("no secret-shaped content survives into either artifact even if finalText contained one", () => {
    process.env.AQENRA_EVAL_ANTHROPIC_API_KEY = "sk-ant-DRAFTING-TEST-SENTINEL";
    try {
      const runs = [run({ caseId: "drafting-01", repetition: 1, provider: "anthropic", model: "claude-haiku-4-5-20251001", finalText: "Draft mentioning sk-ant-DRAFTING-TEST-SENTINEL by mistake." })];
      const artifacts = buildDraftingBlindArtifacts(runs, BENCHMARK_CASES);
      assert.equal(JSON.stringify(artifacts.packet).includes("DRAFTING-TEST-SENTINEL"), false);
    } finally {
      delete process.env.AQENRA_EVAL_ANTHROPIC_API_KEY;
    }
  });
});

describe("drafting-packet.ts — deterministic randomization", () => {
  test("same run data + same seed -> byte-stable packet and mapping", () => {
    const runs = draftingRuns();
    const a = buildDraftingBlindArtifacts(runs, BENCHMARK_CASES, DRAFTING_BLIND_SEED);
    const b = buildDraftingBlindArtifacts(runs, BENCHMARK_CASES, DRAFTING_BLIND_SEED);
    assert.deepEqual(a.packet.entries, b.packet.entries);
    assert.deepEqual(a.mapping.entries, b.mapping.entries);
  });

  test("input ORDER does not affect output — a shuffled run array produces identical results", () => {
    const runs = draftingRuns();
    const shuffled = [...runs].reverse();
    const a = buildDraftingBlindArtifacts(runs, BENCHMARK_CASES, DRAFTING_BLIND_SEED);
    const b = buildDraftingBlindArtifacts(shuffled, BENCHMARK_CASES, DRAFTING_BLIND_SEED);
    assert.deepEqual(a.packet.entries, b.packet.entries);
  });

  test("a different seed can produce a different A/B assignment (proves randomization is seed-driven, not hardcoded)", () => {
    // blindId SETS are always the same regardless of seed (every pair
    // always yields exactly one "-A" and one "-B") — what must actually
    // differ across seeds is WHICH PROVIDER lands on which slot, i.e.
    // the mapping's own provider-per-blindId assignment.
    const runs = draftingRuns();
    const a = buildDraftingBlindArtifacts(runs, BENCHMARK_CASES, 1);
    const b = buildDraftingBlindArtifacts(runs, BENCHMARK_CASES, 2);
    const providerByBlindIdA = Object.fromEntries(a.mapping.entries.map((e) => [e.blindId, e.provider]));
    const providerByBlindIdB = Object.fromEntries(b.mapping.entries.map((e) => [e.blindId, e.provider]));
    assert.notDeepEqual(providerByBlindIdA, providerByBlindIdB, "expected at least one differing provider-to-slot assignment across different seeds");
  });

  test("within a single (caseId, repetition) pair, the two providers always land on OPPOSITE slots — never both A or both B", () => {
    const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
    const byPair = new Map<string, string[]>();
    for (const entry of artifacts.packet.entries) {
      const key = `${entry.caseId}|${entry.repetition}`;
      byPair.set(key, [...(byPair.get(key) ?? []), entry.slot]);
    }
    for (const [pairKey, slots] of byPair) {
      if (slots.length === 2) {
        assert.notEqual(slots[0], slots[1], `pair ${pairKey} has both entries on the same slot: ${slots}`);
      }
    }
  });

  test("blindIds are stable and derived only from caseId/repetition/slot — never from array position", () => {
    const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
    for (const entry of artifacts.packet.entries) {
      assert.equal(entry.blindId, `${entry.caseId}-rep${entry.repetition}-${entry.slot}`);
    }
  });
});

describe("drafting-packet.ts — file writing", () => {
  test("writeDraftingBlindArtifacts writes exactly two files with the expected names, and round-trips as valid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "aqenra-drafting-test-"));
    try {
      const artifacts = buildDraftingBlindArtifacts(draftingRuns(), BENCHMARK_CASES);
      const written = writeDraftingBlindArtifacts(dir, artifacts);
      const packet = JSON.parse(readFileSync(written.packetPath, "utf8"));
      const mapping = JSON.parse(readFileSync(written.mappingPath, "utf8"));
      assert.equal(Array.isArray(packet.entries), true);
      assert.equal(Array.isArray(mapping.entries), true);
      assert.equal(JSON.stringify(packet).match(/anthropic|openai/i), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
