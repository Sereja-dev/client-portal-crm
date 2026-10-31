import type { Prisma, User } from "@/generated/prisma/client";
import type { ThemeMode } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { activateSignupAttemptInTransaction, recordSignupActivation } from "@/lib/signup-attempts/record";

/**
 * Platform Admin Growth V1, Slice A. The one place a brand-new Prisma User
 * is created for a Supabase identity (called only from getOrCreateUser, on
 * its "no User row yet" path).
 *
 * Healthy path: the User upsert and the matching SignupAttempt activation
 * run in ONE interactive transaction. They commit together or not at all,
 * so a process that dies at any point leaves either both or neither. That
 * is what lets retention's single guarded DELETE (activatedAt IS NULL)
 * guarantee it never removes the record of an account that already exists:
 * if the account's transaction committed first, the row is activated and
 * the delete skips it; if the delete committed first, the account did not
 * yet exist when the record expired.
 *
 * Degraded path: registration analytics must never block a login. If the
 * transaction fails for any reason (for example the SignupAttempt table is
 * not migrated yet), the User is created exactly as before and activation
 * is attempted best-effort (never throwing, time-bounded). Only in that
 * degraded path does the weaker, window-based protection described in
 * retention.ts apply. A genuine database outage fails both paths and
 * surfaces as the same error the plain upsert always produced.
 */

const TRANSACTION_TIMEOUT_MS = 2000;

export type UserProvisioningData = {
  id: string;
  email: string;
  name: string;
  themeMode: ThemeMode;
};

type Deps = {
  /** Test seam for the in-transaction activation; defaults to the real one. */
  activateInTransaction?: (
    tx: Prisma.TransactionClient,
    input: { authUserId: string; activatedAt: Date },
  ) => PromiseLike<unknown>;
  /** Test seam for the best-effort fallback activation; defaults to the real one. */
  recordActivation?: typeof recordSignupActivation;
};

/** Atomic create + activate. Throws (rolling everything back) if either step fails. */
export function createUserWithSignupActivation(data: UserProvisioningData, deps: Deps = {}): Promise<User> {
  const activate = deps.activateInTransaction ?? activateSignupAttemptInTransaction;
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.upsert({
        where: { id: data.id },
        update: {},
        create: { id: data.id, email: data.email, name: data.name, themeMode: data.themeMode },
      });
      await activate(tx, { authUserId: user.id, activatedAt: user.createdAt });
      return user;
    },
    { maxWait: TRANSACTION_TIMEOUT_MS, timeout: TRANSACTION_TIMEOUT_MS },
  );
}

export async function provisionUser(data: UserProvisioningData, deps: Deps = {}): Promise<User> {
  try {
    return await createUserWithSignupActivation(data, deps);
  } catch {
    // Fixed line, no error text or identifiers.
    console.warn("[signup-attempts] atomic activation unavailable, used the best-effort path.");
    const user = await prisma.user.upsert({
      where: { id: data.id },
      update: {},
      create: { id: data.id, email: data.email, name: data.name, themeMode: data.themeMode },
    });
    await (deps.recordActivation ?? recordSignupActivation)({ authUserId: user.id, activatedAt: user.createdAt });
    return user;
  }
}
