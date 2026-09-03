/**
 * Isolated Aqenra AI provider benchmark harness — snapshot freshness.
 *
 * RESOLVED CIRCULARITY: an earlier design compared the snapshot's own
 * recorded git commit SHA (`extractedFromGitSha`) against the CURRENT
 * `git rev-parse HEAD` as the hard official-run gate. That is
 * unsatisfiable by construction once the snapshot is committed —
 * committing it advances HEAD to a NEW SHA, which the file being
 * committed can never have recorded in advance (a commit cannot contain
 * its own future hash). Any commit-SHA-equality gate therefore fails
 * immediately after every legitimate refresh-and-commit cycle, not just
 * after a real drift.
 *
 * This module instead defines and computes a SOURCE CONTENT fingerprint
 * — a hash over the exact bytes of the small, fixed set of source files
 * that determine what extract-fixtures.ts extracts. This is
 * content-addressed, not commit-addressed: it is unaffected by which
 * commit HEAD happens to be on, so it stays valid across any number of
 * commits that don't touch these exact files (including the very commit
 * that checks the refreshed snapshot in), and changes the instant any of
 * them do — exactly the property a freshness gate needs, with no
 * circularity.
 *
 * Every file is read as raw BYTES only (fs.readFileSync) — never
 * imported or executed. This is why computing the fingerprint at
 * benchmark-run time does not pull Prisma or any other app runtime into
 * the isolated harness, even though several of these files (clients.ts,
 * invoices.ts, the *_STATUSES modules, etc.) are themselves NOT safe to
 * import (see tool-runtime.ts's own header comment on that distinction —
 * this module deliberately never imports any of them).
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const FINGERPRINT_ALGORITHM = "sha256-v1";

/**
 * The exact, minimal set of source files whose byte content can change
 * what extract-fixtures.ts serializes into the snapshot:
 *  - registry.ts: which tool names are registered at all (the closed
 *    six-tool list itself)
 *  - the five tool-implementation files: each one's own
 *    name/description/inputSchema constants
 *  - the four validation modules: their *_STATUSES/*_PRIORITIES enum
 *    arrays are embedded directly into the relevant
 *    inputSchema.properties.*.enum lists (e.g. SEARCH_CLIENTS_INPUT_SCHEMA's
 *    own `status.enum: CLIENT_STATUSES`)
 *
 * Deliberately EXCLUDED, and why:
 *  - tools/types.ts: defines a TypeScript type only, erased at compile
 *    time — never part of the serialized runtime data.
 *  - tools/limits.ts: SEARCH_*_LIMIT constants affect execute() result
 *    COUNTS, never the schema/description contract extract-fixtures.ts
 *    reads.
 *  - Every Prisma/query/app file: execute() function BODIES are never
 *    part of what gets extracted (extract-fixtures.ts's own doc comment:
 *    "Deliberately NOT included: tool.execute").
 */
export const FRESHNESS_SOURCE_FILES: readonly string[] = [
  "src/lib/ai/tools/registry.ts",
  "src/lib/ai/tools/organization-summary.ts",
  "src/lib/ai/tools/clients.ts",
  "src/lib/ai/tools/projects.ts",
  "src/lib/ai/tools/tasks.ts",
  "src/lib/ai/tools/invoices.ts",
  "src/lib/validation/client.ts",
  "src/lib/validation/project.ts",
  "src/lib/validation/task.ts",
  "src/lib/validation/invoice.ts",
];

export type SourceFingerprintResult =
  | { ok: true; fingerprint: string; algorithm: string }
  | { ok: false; reason: "missing_file"; missingPath: string };

/**
 * Sorted (deterministic path order), hashes `path + NUL + bytes + NUL`
 * per file, concatenated in that sorted order, then SHA-256 of the whole
 * concatenation — so both a content change AND the file SET itself
 * changing (a listed file disappearing) are detectable. Never imports or
 * evaluates any file — `readFileSync` only.
 *
 * `files`/`rootDir` default to the real, fixed values every production
 * call site relies on (extract-fixtures.ts, index.ts's freshness gate)
 * — the override parameters exist ONLY so
 * test/snapshot-freshness.test.ts can prove the hashing logic's exact
 * sensitivity (a one-byte content change, a missing file) against
 * throwaway fixtures in a scratch directory, WITHOUT ever reading or
 * mutating the real repository's own src/** files. No production code
 * anywhere passes these overrides.
 */
export function computeSourceFingerprint(files: readonly string[] = FRESHNESS_SOURCE_FILES, rootDir: string = REPO_ROOT): SourceFingerprintResult {
  const sortedPaths = [...files].sort((a, b) => a.localeCompare(b));
  const hash = createHash("sha256");
  for (const relativePath of sortedPaths) {
    const absolutePath = join(rootDir, relativePath);
    let bytes: Buffer;
    try {
      bytes = readFileSync(absolutePath);
    } catch {
      return { ok: false, reason: "missing_file", missingPath: relativePath };
    }
    hash.update(relativePath, "utf8");
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return { ok: true, fingerprint: hash.digest("hex"), algorithm: FINGERPRINT_ALGORITHM };
}

export type SnapshotFreshnessMetadata = {
  sourceFingerprint?: unknown;
  fingerprintAlgorithm?: unknown;
};

export type FreshnessCheckResult =
  | { fresh: true }
  | { fresh: false; reason: "missing_source_file"; missingPath: string }
  | { fresh: false; reason: "snapshot_missing_fingerprint" }
  | { fresh: false; reason: "algorithm_mismatch"; recordedAlgorithm: string; currentAlgorithm: string }
  | { fresh: false; reason: "fingerprint_mismatch"; recorded: string; current: string };

/** Normalizes/trims recorded values before comparing — a snapshot hand-edited with trailing whitespace or the wrong type must not silently pass. */
export function checkSnapshotFreshness(snapshot: SnapshotFreshnessMetadata): FreshnessCheckResult {
  const current = computeSourceFingerprint();
  if (!current.ok) {
    return { fresh: false, reason: "missing_source_file", missingPath: current.missingPath };
  }

  const recorded = typeof snapshot.sourceFingerprint === "string" ? snapshot.sourceFingerprint.trim() : "";
  if (!recorded) {
    return { fresh: false, reason: "snapshot_missing_fingerprint" };
  }

  const recordedAlgorithm = typeof snapshot.fingerprintAlgorithm === "string" ? snapshot.fingerprintAlgorithm.trim() : "";
  if (recordedAlgorithm !== current.algorithm) {
    return {
      fresh: false,
      reason: "algorithm_mismatch",
      recordedAlgorithm: recordedAlgorithm || "unrecorded",
      currentAlgorithm: current.algorithm,
    };
  }

  if (recorded !== current.fingerprint) {
    return { fresh: false, reason: "fingerprint_mismatch", recorded, current: current.fingerprint };
  }

  return { fresh: true };
}

/** A fixed, generic, never-secret-leaking message for the operator — see index.ts's own refusal path. */
export function describeFreshnessFailure(result: Extract<FreshnessCheckResult, { fresh: false }>): string {
  switch (result.reason) {
    case "missing_source_file":
      return `Snapshot freshness check could not read a required source file (${result.missingPath}). Refresh the snapshot from the repository root: npx tsx scripts/ai-provider-eval/extract-fixtures.ts`;
    case "snapshot_missing_fingerprint":
      return "The committed tool-contract snapshot has no recorded sourceFingerprint. Refresh it from the repository root: npx tsx scripts/ai-provider-eval/extract-fixtures.ts";
    case "algorithm_mismatch":
      return `The committed snapshot was fingerprinted with algorithm "${result.recordedAlgorithm}", but this codebase now uses "${result.currentAlgorithm}". Refresh the snapshot from the repository root: npx tsx scripts/ai-provider-eval/extract-fixtures.ts`;
    case "fingerprint_mismatch":
      return "The committed tool-contract snapshot no longer matches the current tool source files (registry.ts, the five tool-implementation files, or their enum sources have changed). Refresh the snapshot from the repository root: npx tsx scripts/ai-provider-eval/extract-fixtures.ts";
  }
}
