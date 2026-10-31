import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Platform Admin Growth V1, Slice A — retention for UNACTIVATED
 * SignupAttempt rows. Product Owner decision: an attempt that never became
 * an account is kept for at most 90 days.
 *
 * Exact semantics (also what the Privacy Policy promises):
 *   - The clock is the LATEST successfully recorded attempt
 *     (lastAttemptedAt), not the first, so a person who is still trying is
 *     never purged mid-signup.
 *   - A row is expired when lastAttemptedAt < now - 90 days, where a day is
 *     exactly 86,400,000 ms of UTC time. A row at EXACTLY the cutoff is kept;
 *     one millisecond older is eligible.
 *   - Only genuinely unactivated rows are ever eligible. Prisma User
 *     existence is authoritative, not the nullable activatedAt column: a
 *     row whose User exists is never deleted, and (see below) is repaired
 *     instead, so a missed activation write cannot cost anyone their record.
 *
 * What this never touches: Supabase Auth users, organizations,
 * memberships, Users, or any business data. It only reads User and only
 * writes SignupAttempt.
 *
 * Mechanism: a bounded, ordered (lastAttemptedAt, id) batch loop — never
 * an unbounded DELETE — run from the CRON_SECRET-protected cron route.
 * Idempotent: with nothing eligible it is a clean no-op, and any partial
 * run simply leaves the remainder for the next one.
 *
 * Concurrency: the delete itself is guarded (activatedAt IS NULL and the
 * row still older than the cutoff), so an activation or a fresh attempt
 * recorded before the delete statement protects the row. The one window
 * those guards cannot close is a User row committed between the existence
 * check and the delete; so after deleting, the same ids are checked
 * against User once more, and any row that turns out to belong to an
 * existing User is restored exactly as it was read, with activatedAt set
 * to that User's own createdAt. If the process dies between the delete and
 * that check, the loss is limited to a row whose owner activated within
 * the same few milliseconds and who also had no attempt for 90+ days.
 */

export const SIGNUP_ATTEMPT_RETENTION_DAYS = 90;
export const SIGNUP_ATTEMPT_RETENTION_MS = SIGNUP_ATTEMPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION_MAX_BATCHES = 5;

/** The UTC instant before which a last attempt is expired. */
export function signupAttemptRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - SIGNUP_ATTEMPT_RETENTION_MS);
}

/**
 * The policy as a pure function, mirroring the query below: expired only
 * when never activated, no User exists, and the latest attempt is strictly
 * older than the cutoff.
 */
export function isSignupAttemptExpired(
  attempt: { lastAttemptedAt: Date; activatedAt: Date | null },
  userExists: boolean,
  now: Date,
): boolean {
  if (attempt.activatedAt || userExists) return false;
  return attempt.lastAttemptedAt.getTime() < signupAttemptRetentionCutoff(now).getTime();
}

/** Aggregate counts only — nothing identifying. */
export type SignupAttemptRetentionSummary = {
  scanned: number;
  deleted: number;
  reconciled: number;
  restored: number;
  batches: number;
};

export async function cleanupSignupAttempts(params: {
  now: Date;
  batchSize: number;
  maxBatches?: number;
}): Promise<SignupAttemptRetentionSummary> {
  const { now, batchSize } = params;
  const maxBatches = params.maxBatches ?? DEFAULT_RETENTION_MAX_BATCHES;
  const cutoff = signupAttemptRetentionCutoff(now);
  const summary: SignupAttemptRetentionSummary = { scanned: 0, deleted: 0, reconciled: 0, restored: 0, batches: 0 };

  if (!Number.isInteger(batchSize) || batchSize < 1 || !Number.isInteger(maxBatches) || maxBatches < 1) {
    return summary;
  }

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const candidates = await prisma.signupAttempt.findMany({
      where: { activatedAt: null, lastAttemptedAt: { lt: cutoff } },
      orderBy: [{ lastAttemptedAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });
    if (candidates.length === 0) break;

    summary.batches += 1;
    summary.scanned += candidates.length;

    const users = await prisma.user.findMany({
      where: { id: { in: candidates.map((c) => c.authUserId) } },
      select: { id: true, createdAt: true },
    });
    const userCreatedAt = new Map(users.map((u) => [u.id, u.createdAt]));

    // A row with a User but a null activatedAt is a missed activation write.
    // Repair it (which also removes it from the candidate set, so such rows
    // can never starve the batch) instead of ever deleting it.
    for (const candidate of candidates) {
      const createdAt = userCreatedAt.get(candidate.authUserId);
      if (createdAt) {
        const repaired = await prisma.signupAttempt.updateMany({
          where: { authUserId: candidate.authUserId, activatedAt: null },
          data: { activatedAt: createdAt },
        });
        summary.reconciled += repaired.count;
      }
    }

    const deletable = candidates.filter((c) => !userCreatedAt.has(c.authUserId));
    if (deletable.length > 0) {
      const removed = await prisma.signupAttempt.deleteMany({
        where: {
          authUserId: { in: deletable.map((c) => c.authUserId) },
          activatedAt: null,
          lastAttemptedAt: { lt: cutoff },
        },
      });
      summary.deleted += removed.count;

      // Close the check-then-delete window: anything that gained a User in
      // the meantime is put back, unchanged, as an activated row.
      const lateUsers = await prisma.user.findMany({
        where: { id: { in: deletable.map((c) => c.authUserId) } },
        select: { id: true, createdAt: true },
      });
      for (const user of lateUsers) {
        const original = deletable.find((c) => c.authUserId === user.id);
        if (!original) continue;
        try {
          await prisma.signupAttempt.create({ data: { ...original, activatedAt: user.createdAt } });
          summary.restored += 1;
          summary.deleted -= 1;
        } catch (err) {
          // A concurrent writer already re-created it; nothing to restore.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
        }
      }
    }

    if (candidates.length < batchSize) break;
  }

  return summary;
}
