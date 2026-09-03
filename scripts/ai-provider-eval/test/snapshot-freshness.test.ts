import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  computeSourceFingerprint,
  checkSnapshotFreshness,
  describeFreshnessFailure,
  FRESHNESS_SOURCE_FILES,
  FINGERPRINT_ALGORITHM,
} from "../snapshot-freshness.js";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_PATH = join(PACKAGE_DIR, "fixtures", "tool-contracts.snapshot.json");

/**
 * Every adversarial test below that needs to prove sensitivity to a
 * byte-level source change does so against a throwaway scratch
 * directory created under the OS temp dir — NEVER against this
 * repository's own real src/** files (see computeSourceFingerprint()'s
 * own doc comment for why the override parameters exist). This keeps
 * the test suite 100% safe to run repeatedly with zero risk of ever
 * leaving a real app source file mutated, even if a test crashed
 * mid-run.
 */
function makeScratchRepo(files: Record<string, string>): { rootDir: string; cleanup: () => void } {
  const rootDir = mkdtempSync(join(tmpdir(), "aqenra-freshness-test-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(rootDir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  return { rootDir, cleanup: () => rmSync(rootDir, { recursive: true, force: true }) };
}

describe("snapshot-freshness.ts — source fingerprint over the REAL current source tree", () => {
  test("computes successfully", () => {
    const result = computeSourceFingerprint();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(result.algorithm, FINGERPRINT_ALGORITHM);
    }
  });

  test("is deterministic across repeated calls", () => {
    assert.deepEqual(computeSourceFingerprint(), computeSourceFingerprint());
  });

  test("FRESHNESS_SOURCE_FILES names exactly the registry, the five tool files, and the four enum-source validation files — nothing else", () => {
    assert.deepEqual(
      [...FRESHNESS_SOURCE_FILES].sort(),
      [
        "src/lib/ai/tools/clients.ts",
        "src/lib/ai/tools/invoices.ts",
        "src/lib/ai/tools/organization-summary.ts",
        "src/lib/ai/tools/projects.ts",
        "src/lib/ai/tools/registry.ts",
        "src/lib/ai/tools/tasks.ts",
        "src/lib/validation/client.ts",
        "src/lib/validation/invoice.ts",
        "src/lib/validation/project.ts",
        "src/lib/validation/task.ts",
      ].sort(),
    );
  });

  test("A. the actual committed snapshot's own recorded fingerprint matches the current real source tree", () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    assert.deepEqual(checkSnapshotFreshness(snapshot), { fresh: true });
  });
});

describe("snapshot-freshness.ts — adversarial fingerprint sensitivity (scratch fixtures only, never real src/**)", () => {
  test("B. a one-byte content change in a listed file changes the fingerprint", () => {
    const files = ["a/one.ts", "b/two.ts"];
    const before = makeScratchRepo({ "a/one.ts": "export const X = 1;\n", "b/two.ts": "export const Y = 2;\n" });
    const after = makeScratchRepo({ "a/one.ts": "export const X = 1;\n", "b/two.ts": "export const Y = 3;\n" }); // one byte different
    try {
      const beforeResult = computeSourceFingerprint(files, before.rootDir);
      const afterResult = computeSourceFingerprint(files, after.rootDir);
      assert.equal(beforeResult.ok, true);
      assert.equal(afterResult.ok, true);
      if (beforeResult.ok && afterResult.ok) {
        assert.notEqual(beforeResult.fingerprint, afterResult.fingerprint);
      }
    } finally {
      before.cleanup();
      after.cleanup();
    }
  });

  test("C. a description-string-shaped change (mirrors a real tool description edit) also changes the fingerprint", () => {
    const files = ["src/lib/ai/tools/clients.ts"];
    const original = 'export const SEARCH_CLIENTS_DESCRIPTION = "Searches the current organization\'s clients by name/company.";\n';
    const mutated = 'export const SEARCH_CLIENTS_DESCRIPTION = "Searches the current organization\'s clients by name/company (mutated).";\n';
    const before = makeScratchRepo({ "src/lib/ai/tools/clients.ts": original });
    const after = makeScratchRepo({ "src/lib/ai/tools/clients.ts": mutated });
    try {
      const beforeResult = computeSourceFingerprint(files, before.rootDir);
      const afterResult = computeSourceFingerprint(files, after.rootDir);
      assert.equal(beforeResult.ok, true);
      assert.equal(afterResult.ok, true);
      if (beforeResult.ok && afterResult.ok) {
        assert.notEqual(beforeResult.fingerprint, afterResult.fingerprint);
      }
    } finally {
      before.cleanup();
      after.cleanup();
    }
  });

  test("D. a file OUTSIDE the tracked list does not affect the fingerprint, even if present in the same directory tree", () => {
    const trackedOnly = ["a/one.ts"];
    const scratch1 = makeScratchRepo({ "a/one.ts": "export const X = 1;\n" });
    const scratch2 = makeScratchRepo({ "a/one.ts": "export const X = 1;\n", "a/unrelated-readme.md": "# completely different content, not in the tracked list\n" });
    try {
      const result1 = computeSourceFingerprint(trackedOnly, scratch1.rootDir);
      const result2 = computeSourceFingerprint(trackedOnly, scratch2.rootDir);
      assert.equal(result1.ok, true);
      assert.equal(result2.ok, true);
      if (result1.ok && result2.ok) {
        assert.equal(result1.fingerprint, result2.fingerprint, "a file not in the tracked list must never affect the fingerprint");
      }
    } finally {
      scratch1.cleanup();
      scratch2.cleanup();
    }
  });

  test("D2. mutating a real file OUTSIDE the freshness set (this package's own README.md) does not affect the REAL fingerprint", () => {
    const readmePath = join(PACKAGE_DIR, "README.md");
    const original = readFileSync(readmePath, "utf8");
    const before = computeSourceFingerprint();
    try {
      writeFileSync(readmePath, original + "\n<!-- audit-mutation-test -->\n", "utf8");
      const after = computeSourceFingerprint();
      assert.deepEqual(before, after);
    } finally {
      writeFileSync(readmePath, original, "utf8");
    }
  });

  test("E. a missing tracked file fails safely (ok:false, reason:missing_file) — never throws", () => {
    const scratch = makeScratchRepo({ "a/one.ts": "export const X = 1;\n" }); // "a/two.ts" deliberately not written
    try {
      const result = computeSourceFingerprint(["a/one.ts", "a/two.ts"], scratch.rootDir);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "missing_file");
        assert.equal(result.missingPath, "a/two.ts");
      }
    } finally {
      scratch.cleanup();
    }
  });
});

describe("snapshot-freshness.ts — checkSnapshotFreshness metadata handling", () => {
  test("fails on a fabricated fingerprint that doesn't match current real source", () => {
    const result = checkSnapshotFreshness({ sourceFingerprint: "0".repeat(64), fingerprintAlgorithm: FINGERPRINT_ALGORITHM });
    assert.equal(result.fresh, false);
    if (!result.fresh) assert.equal(result.reason, "fingerprint_mismatch");
  });

  test("F. stale snapshot metadata (mismatched fingerprint) fails — see index.ts's own ordering proof for WHEN this is checked relative to provider import/client construction", () => {
    const result = checkSnapshotFreshness({ sourceFingerprint: "f".repeat(64), fingerprintAlgorithm: FINGERPRINT_ALGORITHM });
    assert.deepEqual(result, { fresh: false, reason: "fingerprint_mismatch", recorded: "f".repeat(64), current: (computeSourceFingerprint() as { fingerprint: string }).fingerprint });
  });

  test("fails when the snapshot has no recorded fingerprint at all", () => {
    const result = checkSnapshotFreshness({});
    assert.equal(result.fresh, false);
    if (!result.fresh) assert.equal(result.reason, "snapshot_missing_fingerprint");
  });

  test("fails when the recorded fingerprint is whitespace-only (normalized/trimmed before comparison)", () => {
    const result = checkSnapshotFreshness({ sourceFingerprint: "   ", fingerprintAlgorithm: FINGERPRINT_ALGORITHM });
    assert.equal(result.fresh, false);
    if (!result.fresh) assert.equal(result.reason, "snapshot_missing_fingerprint");
  });

  test("fails on an algorithm mismatch even if the fingerprint string happens to match", () => {
    const current = computeSourceFingerprint();
    assert.equal(current.ok, true);
    if (!current.ok) return;
    const result = checkSnapshotFreshness({ sourceFingerprint: current.fingerprint, fingerprintAlgorithm: "md5-v0" });
    assert.equal(result.fresh, false);
    if (!result.fresh) assert.equal(result.reason, "algorithm_mismatch");
  });

  test("rejects a non-string sourceFingerprint (e.g. a number) rather than coercing it", () => {
    const result = checkSnapshotFreshness({ sourceFingerprint: 12345 as unknown as string, fingerprintAlgorithm: FINGERPRINT_ALGORITHM });
    assert.equal(result.fresh, false);
    if (!result.fresh) assert.equal(result.reason, "snapshot_missing_fingerprint");
  });

  test("describeFreshnessFailure never includes a secret and always names the exact refresh command", () => {
    for (const result of [
      { fresh: false as const, reason: "missing_source_file" as const, missingPath: "src/lib/ai/tools/tasks.ts" },
      { fresh: false as const, reason: "snapshot_missing_fingerprint" as const },
      { fresh: false as const, reason: "algorithm_mismatch" as const, recordedAlgorithm: "md5-v0", currentAlgorithm: FINGERPRINT_ALGORITHM },
      { fresh: false as const, reason: "fingerprint_mismatch" as const, recorded: "a".repeat(64), current: "b".repeat(64) },
    ]) {
      const message = describeFreshnessFailure(result);
      assert.match(message, /npx tsx scripts\/ai-provider-eval\/extract-fixtures\.ts/);
      assert.equal(/sk-|api[_-]?key/i.test(message), false);
    }
  });
});
