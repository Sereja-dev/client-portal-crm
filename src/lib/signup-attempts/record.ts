import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Platform Admin Growth V1, Slice A. The only writer of SignupAttempt
 * (check-signup-attempts-security.mjs enforces that), called from exactly
 * two places: the Staff signup action (recordSignupAttempt) and the one
 * spot a User row is first provisioned (recordSignupActivation, in
 * current-user.ts). Portal signup never calls it.
 *
 * Failure contract: both functions NEVER throw and never block their
 * caller for longer than SIGNUP_ATTEMPT_WRITE_TIMEOUT_MS. Registration
 * analytics are best-effort; a failed or slow write must not fail, delay
 * beyond that bound, or change the outcome of a real signup. A failed
 * write is logged as one fixed-shape line containing only a fixed
 * operation name and a bounded error code — never an email, id, token,
 * message, stack or any request data.
 *
 * Timestamps are observation times (see SignupAttempt's schema comment).
 * Nothing here ever invents an event that was not observed: activation
 * never creates a row, it only completes one that a prior attempt wrote.
 */

export const SIGNUP_ATTEMPT_WRITE_TIMEOUT_MS = 2000;

const MAX_EMAIL_LENGTH = 320;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

/** UNKNOWN is reserved for a future explicit backfill; a live signup always knows its origin. */
export type RecordedSignupOrigin = "STANDALONE" | "INVITED";

export type RecordSignupAttemptInput = {
  authUserId: string;
  email: string;
  origin: RecordedSignupOrigin;
};

export type RecordResult =
  | { recorded: true }
  | { recorded: false; reason: "INVALID_INPUT" | "WRITE_FAILED" | "TIMEOUT" };

export type RecordSignupAttemptFn = (input: RecordSignupAttemptInput) => Promise<RecordResult>;

export type RecordActivationResult = RecordResult & { matched?: boolean };

type Options = {
  now?: Date;
  timeoutMs?: number;
};

export function normalizeSignupEmail(email: string): string {
  return email.trim().toLowerCase();
}

function errorCode(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(err.code)) {
    return err.code;
  }
  return "UNKNOWN";
}

function logFailure(operation: "record_attempt" | "record_activation", code: string): void {
  console.warn(`[signup-attempts] ${operation} failed (${code}).`);
}

class WriteTimeoutError extends Error {}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WriteTimeoutError()), timeoutMs);
  });
  // The abandoned write may still settle after the timeout; it is
  // idempotent, so letting it finish is safe — it just must not surface
  // as an unhandled rejection.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function upsertAttempt(input: RecordSignupAttemptInput, email: string, now: Date) {
  return prisma.signupAttempt.upsert({
    where: { authUserId: input.authUserId },
    // firstAttemptedAt/lastAttemptedAt/origin/email are set ONLY on creation.
    create: {
      authUserId: input.authUserId,
      email,
      origin: input.origin,
      firstAttemptedAt: now,
      lastAttemptedAt: now,
      attemptCount: 1,
      recordedVia: "LIVE",
    },
    // A retry only increments the count; the database applies the
    // increment atomically, so concurrent retries each count exactly once.
    update: { attemptCount: { increment: 1 } },
    select: { firstAttemptedAt: true, lastAttemptedAt: true },
  });
}

/**
 * Idempotent: one row per Auth user id, however many times and however
 * concurrently it is called.
 *
 * Under concurrency two requests can commit in the opposite order of
 * their own clocks, so the timestamps are made order-independent with
 * guarded updates: firstAttemptedAt can only move EARLIER and
 * lastAttemptedAt only LATER, each in a single conditional statement that
 * is a no-op once already satisfied. The earliest observed attempt is
 * therefore always the one kept.
 */
export async function recordSignupAttempt(
  input: RecordSignupAttemptInput,
  options: Options = {},
): Promise<RecordResult> {
  const email = normalizeSignupEmail(input.email);
  if (
    !UUID_PATTERN.test(input.authUserId) ||
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_SHAPE.test(email) ||
    (input.origin !== "STANDALONE" && input.origin !== "INVITED")
  ) {
    return { recorded: false, reason: "INVALID_INPUT" };
  }

  const now = options.now ?? new Date();

  try {
    await withTimeout(
      (async () => {
        let row;
        try {
          row = await upsertAttempt(input, email, now);
        } catch (err) {
          // A concurrent first insert can still win the unique index; the
          // row exists now, so the same upsert resolves to its update path.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            row = await upsertAttempt(input, email, now);
          } else {
            throw err;
          }
        }
        if (row.firstAttemptedAt.getTime() > now.getTime()) {
          await prisma.signupAttempt.updateMany({
            where: { authUserId: input.authUserId, firstAttemptedAt: { gt: now } },
            data: { firstAttemptedAt: now },
          });
        }
        if (row.lastAttemptedAt.getTime() < now.getTime()) {
          await prisma.signupAttempt.updateMany({
            where: { authUserId: input.authUserId, lastAttemptedAt: { lt: now } },
            data: { lastAttemptedAt: now },
          });
        }
      })(),
      options.timeoutMs ?? SIGNUP_ATTEMPT_WRITE_TIMEOUT_MS,
    );
    return { recorded: true };
  } catch (err) {
    const timedOut = err instanceof WriteTimeoutError;
    logFailure("record_attempt", timedOut ? "TIMEOUT" : errorCode(err));
    return { recorded: false, reason: timedOut ? "TIMEOUT" : "WRITE_FAILED" };
  }
}

/**
 * Marks the matching attempt activated at the exact time its User row was
 * created. Idempotent and monotonic: only a row whose activatedAt is still
 * null is touched, so a repeat call can never move or clear a recorded
 * activation. It matches by authUserId alone and never creates a row — an
 * identity with no recorded attempt (a historical account, a Portal
 * identity, or a signup whose attempt write failed) is left untouched
 * rather than given an unobserved signup time.
 */
export async function recordSignupActivation(
  input: { authUserId: string; activatedAt: Date },
  options: Pick<Options, "timeoutMs"> = {},
): Promise<RecordActivationResult> {
  if (!UUID_PATTERN.test(input.authUserId) || Number.isNaN(input.activatedAt.getTime())) {
    return { recorded: false, reason: "INVALID_INPUT" };
  }

  try {
    const result = await withTimeout(
      prisma.signupAttempt.updateMany({
        where: { authUserId: input.authUserId, activatedAt: null },
        data: { activatedAt: input.activatedAt },
      }),
      options.timeoutMs ?? SIGNUP_ATTEMPT_WRITE_TIMEOUT_MS,
    );
    return { recorded: true, matched: result.count > 0 };
  } catch (err) {
    const timedOut = err instanceof WriteTimeoutError;
    logFailure("record_activation", timedOut ? "TIMEOUT" : errorCode(err));
    return { recorded: false, reason: timedOut ? "TIMEOUT" : "WRITE_FAILED" };
  }
}

/**
 * Activation as part of the SAME database transaction that creates the User
 * row (see provision-user.ts). Because the User insert and this update
 * commit or roll back together, "a committed User exists" implies "its
 * attempt row (if one exists) is already activated", which is exactly what
 * the retention job's guarded delete (activatedAt IS NULL) relies on to
 * never remove an existing account's record. Same match-by-authUserId,
 * only-while-null, never-creates-a-row semantics as recordSignupActivation.
 * Unlike that function it deliberately throws on failure, so the caller's
 * transaction rolls back and the caller can fall back.
 */
export function activateSignupAttemptInTransaction(
  tx: Prisma.TransactionClient,
  input: { authUserId: string; activatedAt: Date },
) {
  return tx.signupAttempt.updateMany({
    where: { authUserId: input.authUserId, activatedAt: null },
    data: { activatedAt: input.activatedAt },
  });
}
