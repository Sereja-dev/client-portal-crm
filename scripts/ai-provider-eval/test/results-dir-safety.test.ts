/**
 * CRITICAL regression: no test in this package may delete, wipe, or
 * mutate the official `scripts/ai-provider-eval/results/` directory.
 *
 * Root cause this guards against: `test/report.test.ts` and
 * `test/csv-sanitization.test.ts` used to call `writeReport({...})` with
 * no explicit output directory (so it wrote to the real, official
 * RESULTS_DIR) and then unconditionally ran
 * `rmSync(join(RESULTS_DIR), { recursive: true, force: true })` in a
 * `finally` block. That meant a routine `npm test` destroyed whatever an
 * operator had placed in results/ — which is exactly what happened to
 * the retained 2026-09-03 failed-run artifacts. Those raw artifacts were
 * gitignored and are not recoverable; see README.md's own "Known data
 * loss" section. This file exists so that specific class of bug can
 * never silently return.
 *
 * Two independent regressions, on purpose:
 *
 *  1. A dynamic/behavioral proof: writeReport(), given an explicit
 *     outputDir, provably does not touch a sentinel file placed inside
 *     the real RESULTS_DIR — even though RESULTS_DIR is never passed in.
 *  2. A static/source proof: no test file in this package's `test/`
 *     directory contains source text that combines a destructive
 *     filesystem call with a reference to RESULTS_DIR. This is the
 *     stronger of the two — it fails immediately against the OLD,
 *     hazardous versions of report.test.ts / csv-sanitization.test.ts
 *     (each of which literally contained
 *     `rmSync(join(RESULTS_DIR), { recursive: true, force: true })`),
 *     and passes now that every test call site uses an isolated
 *     mkdtempSync() directory instead. It also prevents the hazard from
 *     being reintroduced in any *future* test file, not just these two.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { writeReport, RESULTS_DIR, buildReproducibilityMetadata } from "../report.js";
import type { ProviderAggregate } from "../decision.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function perfectAgg(provider: "anthropic" | "openai"): ProviderAggregate {
  return {
    provider, totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100,
    uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0,
    medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100,
  };
}

describe("results-dir-safety — writeReport() never touches official RESULTS_DIR when given an explicit outputDir", () => {
  test("a sentinel placed inside the real RESULTS_DIR survives byte-identical across a writeReport() call scoped to a temp dir", () => {
    // Never delete or overwrite anything already in RESULTS_DIR: only
    // create it if absent, and only ever remove the one sentinel file
    // this test itself creates, in a tightly scoped finally block.
    mkdirSync(RESULTS_DIR, { recursive: true });
    const beforeListing = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).sort() : [];

    const sentinelName = `.results-dir-safety-sentinel-${randomUUID()}`;
    const sentinelPath = join(RESULTS_DIR, sentinelName);
    const sentinelContent = `sentinel-${randomUUID()}`;
    writeFileSync(sentinelPath, sentinelContent, "utf8");

    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-results-dir-safety-test-"));
    try {
      const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
      const written = writeReport({
        rows: [], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir);

      // The artifacts landed in the temp dir, never in RESULTS_DIR.
      assert.ok(written.jsonPath.startsWith(tempDir), "results.json must be written under the explicit outputDir, not RESULTS_DIR");
      assert.ok(written.csvPath.startsWith(tempDir));
      assert.ok(written.markdownPath.startsWith(tempDir));

      // The sentinel — proxy for any real official artifact already
      // sitting in RESULTS_DIR — is byte-identical: writeReport() with
      // an explicit outputDir did not write into, truncate, or delete
      // anything in the official directory.
      assert.equal(readFileSync(sentinelPath, "utf8"), sentinelContent, "sentinel in official RESULTS_DIR must remain byte-identical");
    } finally {
      // Cleanup is scoped to exactly two paths this test itself created:
      // the sentinel file, and the mkdtempSync-returned temp directory.
      // Never a recursive delete of RESULTS_DIR itself.
      rmSync(sentinelPath, { force: true });
      rmSync(tempDir, { recursive: true, force: true });
    }

    // Directory listing (minus our own sentinel, now removed) is
    // unchanged — nothing else was added or removed as a side effect.
    const afterListing = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).sort() : [];
    assert.deepEqual(afterListing, beforeListing, "RESULTS_DIR directory listing must be unchanged after this test");
  });
});

describe("results-dir-safety — no test file in this package may combine a destructive fs call with RESULTS_DIR (static source scan)", () => {
  test("no test/*.ts file references RESULTS_DIR as the target of rmSync/rm/unlinkSync/unlink", () => {
    // This is a deliberately narrow, high-signal pattern match: a
    // destructive removal call whose argument chain mentions
    // RESULTS_DIR. It is not a general lint rule — it exists purely to
    // catch a reintroduction of this exact historical bug, in this file
    // or any new test file added later.
    const destructiveCallNames = ["rmSync", "rm(", "unlinkSync", "unlink("];
    const offenders: string[] = [];

    for (const entry of readdirSync(TEST_DIR)) {
      if (!entry.endsWith(".test.ts")) continue;
      // This file itself is exempt: its own test titles and comments
      // necessarily discuss "RESULTS_DIR" and "rmSync" together in
      // prose (describing the exact historical bug), which would
      // otherwise false-positive against this line-level scan. Its own
      // safety is instead proven directly, by the dynamic sentinel test
      // immediately above in this same file.
      if (entry === "results-dir-safety.test.ts") continue;
      const filePath = join(TEST_DIR, entry);
      const src = readFileSync(filePath, "utf8");
      for (const rawLine of src.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("//") || line.startsWith("*")) continue; // ignore comments/prose describing the hazard
        const mentionsDestructiveCall = destructiveCallNames.some((name) => line.includes(name));
        const mentionsResultsDir = line.includes("RESULTS_DIR");
        if (mentionsDestructiveCall && mentionsResultsDir) {
          offenders.push(`${entry}: ${line}`);
        }
      }
    }

    assert.deepEqual(offenders, [], `found a destructive filesystem call referencing RESULTS_DIR:\n${offenders.join("\n")}`);
  });
});
