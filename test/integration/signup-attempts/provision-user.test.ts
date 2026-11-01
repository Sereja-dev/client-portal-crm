import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordSignupAttempt } from "@/lib/signup-attempts/record";
import { createUserWithSignupActivation, provisionUser } from "@/lib/signup-attempts/provision-user";
import { cleanupSignupAttempts, signupAttemptRetentionCutoff } from "@/lib/signup-attempts/retention";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";

// Growth V1, Slice A — the atomic "create User + activate SignupAttempt"
// step, and its guarantee against the retention job, against the real
// (PGlite-backed) database.

const NOW = new Date("2027-03-01T12:00:00.000Z");
const CUTOFF = signupAttemptRetentionCutoff(NOW);
const ids: string[] = [];

function data(id: string = randomUUID()) {
  ids.push(id);
  return { id, email: testEmail(`provision-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), name: "Provision User", themeMode: "SYSTEM" as const };
}

async function attempt(authUserId: string, now: Date = new Date()) {
  await recordSignupAttempt({ authUserId, email: testEmail(`provision-attempt-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), origin: "STANDALONE" }, { now });
}

const row = (authUserId: string) => prisma.signupAttempt.findUnique({ where: { authUserId } });

describe("provisionUser — User creation and SignupAttempt activation (Growth V1, Slice A)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.signupAttempt.deleteMany({ where: { authUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    ids.length = 0;
  });

  it("creates the User and activates its attempt in one step, at the User's own createdAt", async () => {
    const d = data();
    await attempt(d.id);

    const user = await createUserWithSignupActivation(d);

    expect((await row(d.id))?.activatedAt?.getTime()).toBe(user.createdAt.getTime());
  });

  it("creates only the User when no attempt was ever recorded — it never invents a row", async () => {
    const d = data();
    const user = await createUserWithSignupActivation(d);
    expect(user.id).toBe(d.id);
    expect(await row(d.id)).toBeNull();
  });

  it("is atomic: if the activation step fails, the User insert is rolled back too", async () => {
    const d = data();
    await attempt(d.id);

    await expect(
      createUserWithSignupActivation(d, {
        activateInTransaction: async (tx) => {
          // The User is visible inside the transaction, then the step fails.
          expect(await tx.user.findUnique({ where: { id: d.id } })).not.toBeNull();
          throw new Error("activation failed");
        },
      }),
    ).rejects.toThrow("activation failed");

    expect(await prisma.user.findUnique({ where: { id: d.id } })).toBeNull();
    expect((await row(d.id))?.activatedAt).toBeNull();
  });

  it("degrades gracefully: a failing atomic step still creates the User exactly once and activates best-effort", async () => {
    const d = data();
    await attempt(d.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const user = await provisionUser(d, {
      activateInTransaction: async () => {
        throw new Error(`boom ${d.email}`);
      },
    });

    expect(user.id).toBe(d.id);
    expect(await prisma.user.count({ where: { id: d.id } })).toBe(1);
    expect((await row(d.id))?.activatedAt?.getTime()).toBe(user.createdAt.getTime());
    expect(warn.mock.calls).toEqual([["[signup-attempts] atomic activation unavailable, used the best-effort path."]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(d.email);
  });

  it("never blocks the login when the analytics side is down on both paths: the User is created, nothing throws", async () => {
    const d = data();
    await attempt(d.id);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recordActivation = vi.fn().mockResolvedValue({ recorded: false, reason: "WRITE_FAILED" });

    const user = await provisionUser(d, {
      activateInTransaction: async () => {
        throw new Error("analytics down");
      },
      recordActivation,
    });

    expect(recordActivation).toHaveBeenCalledTimes(1);
    expect(user.id).toBe(d.id);
    expect(await prisma.user.count({ where: { id: d.id } })).toBe(1);
    expect((await row(d.id))?.activatedAt).toBeNull();
  });

  it("a second call for the same identity is harmless and does not move the activation time", async () => {
    const d = data();
    await attempt(d.id);
    const first = await provisionUser(d);
    const activatedAt = (await row(d.id))!.activatedAt!.getTime();
    await new Promise((r) => setTimeout(r, 15));

    const second = await provisionUser(d);

    expect(second.id).toBe(first.id);
    expect(await prisma.user.count({ where: { id: d.id } })).toBe(1);
    expect((await row(d.id))!.activatedAt!.getTime()).toBe(activatedAt);
  });

  it("guarantee against retention: an account created between the candidate read and the delete keeps its record, with no restore needed", async () => {
    const d = data();
    await attempt(d.id, new Date(CUTOFF.getTime() - 1_000));
    const realDeleteMany = prisma.signupAttempt.deleteMany.bind(prisma.signupAttempt);
    vi.spyOn(prisma.signupAttempt, "deleteMany").mockImplementation(((args: Parameters<typeof realDeleteMany>[0]) =>
      createUserWithSignupActivation(d).then(() => realDeleteMany(args))) as typeof prisma.signupAttempt.deleteMany);

    const summary = await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(summary).toMatchObject({ deleted: 0, restored: 0 });
    const kept = await row(d.id);
    expect(kept).not.toBeNull();
    expect(kept!.activatedAt).not.toBeNull();
  });

  it("when the record expired first, the later account is created normally and no row is invented", async () => {
    const d = data();
    await attempt(d.id, new Date(CUTOFF.getTime() - 1_000));

    await cleanupSignupAttempts({ now: NOW, batchSize: 50 });
    expect(await row(d.id)).toBeNull();

    const user = await provisionUser(d);
    expect(user.id).toBe(d.id);
    expect(await row(d.id)).toBeNull();
  });
});
