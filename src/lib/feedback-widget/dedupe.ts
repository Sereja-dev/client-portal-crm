import { createHash } from "node:crypto";

/**
 * Authenticated Staff Feedback Widget — duplicate-submission guard. A double
 * click, a slow network retry or a re-submit of the same form must not send the
 * same email twice. Two independent keys, both scoped to the signed-in user:
 *
 *   1. the form's own opaque submissionId (identical form instance), and
 *   2. a hash of the normalised content (the same text sent again shortly
 *      after, e.g. from a second tab).
 *
 * A key is released again if the send itself fails, so a genuine retry after a
 * failure always works. In-memory and per serverless instance — the identical
 * documented tradeoff as src/lib/rate-limit/store.ts: it removes the realistic
 * accidental double-send, it is not a global exactly-once guarantee.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

const seen = new Map<string, number>();

function prune(now: number): void {
  if (seen.size < MAX_ENTRIES) return;
  for (const [key, expiresAt] of seen) {
    if (expiresAt <= now) seen.delete(key);
  }
  // Still full of live entries: drop the oldest ones rather than grow without bound.
  while (seen.size >= MAX_ENTRIES) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

export function contentFingerprint(parts: readonly string[]): string {
  const normalised = parts.map((p) => p.replace(/\s+/g, " ").trim().toLowerCase()).join("\u0000");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

export type SubmissionClaim = { duplicate: true } | { duplicate: false; release: () => void };

export function claimSubmission(
  scope: { userId: string; kind: "support" | "bug" },
  keys: { submissionId: string | null; fingerprint: string },
  now: number = Date.now(),
): SubmissionClaim {
  prune(now);
  const candidates = [`${scope.userId}:${scope.kind}:content:${keys.fingerprint}`];
  if (keys.submissionId) candidates.push(`${scope.userId}:${scope.kind}:id:${keys.submissionId}`);

  for (const key of candidates) {
    const expiresAt = seen.get(key);
    if (expiresAt !== undefined && expiresAt > now) return { duplicate: true };
  }
  for (const key of candidates) seen.set(key, now + TTL_MS);

  return {
    duplicate: false,
    release: () => {
      for (const key of candidates) seen.delete(key);
    },
  };
}

/** Test-only reset. */
export function resetSubmissionDedupeForTests(): void {
  seen.clear();
}
