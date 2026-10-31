import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// src/lib/cron/auth.ts imports the real "server-only" marker package — see
// test/integration/cron/routes.test.ts's own header comment.
vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import { recordSignupActivation, recordSignupAttempt } from "@/lib/signup-attempts/record";
import {
  cleanupSignupAttempts,
  signupAttemptRetentionCutoff,
  SIGNUP_ATTEMPT_RETENTION_MS,
} from "@/lib/signup-attempts/retention";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";

const { GET: retentionGet } = await import("@/app/api/cron/signup-attempt-retention/route");

// Growth V1, Slice A — 90-day retention of UNACTIVATED SignupAttempt rows,
// against the real (PGlite-backed) database. `now` is always supplied, so
// no test depends on the wall clock.

const NOW = new Date("2027-03-01T12:00:00.000Z");
const CUTOFF = signupAttemptRetentionCutoff(NOW);
const TEST_CRON_SECRET = "retention-test-cron-secret";
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

const created: string[] = [];
const createdUsers: string[] = [];

async function seedAttempt(overrides: {
  lastAttemptedAt: Date;
  activatedAt?: Date | null;
  authUserId?: string;
  attemptCount?: number;
}) {
  const authUserId = overrides.authUserId ?? randomUUID();
  created.push(authUserId);
  return prisma.signupAttempt.create({
    data: {
      authUserId,
      email: testEmail(`retention-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN),
      origin: "STANDALONE",
      firstAttemptedAt: new Date(overrides.lastAttemptedAt.getTime() - 60_000),
      lastAttemptedAt: overrides.lastAttemptedAt,
      attemptCount: overrides.attemptCount ?? 2,
      activatedAt: overrides.activatedAt ?? null,
    },
  });
}

async function seedUser(id: string, createdAt: Date = new Date("2026-12-15T08:00:00.000Z")) {
  createdUsers.push(id);
  return prisma.user.create({
    data: { id, email: testEmail(`retention-user-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), name: "Retention User", createdAt },
  });
}

const exists = async (authUserId: string) => (await prisma.signupAttempt.count({ where: { authUserId } })) === 1;
const ago = (extraMs: number) => new Date(CUTOFF.getTime() - extraMs);

describe("signup attempt retention — cleanupSignupAttempts (Growth V1, Slice A)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.signupAttempt.deleteMany({ where: { authUserId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    created.length = 0;
    createdUsers.length = 0;
  });

  afterAll(() => {
    if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it("keeps a row at exactly the 90-day cutoff, deletes one millisecond older, keeps one millisecond newer", async () => {
    const atCutoff = await seedAttempt({ lastAttemptedAt: CUTOFF });
    const older = await seedAttempt({ lastAttemptedAt: ago(1) });
    const newer = await seedAttempt({ lastAttemptedAt: new Date(CUTOFF.getTime() + 1) });

    const summary = await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(summary).toEqual({ scanned: 1, deleted: 1, reconciled: 0, restored: 0, batches: 1 });
    expect(await exists(atCutoff.authUserId)).toBe(true);
    expect(await exists(older.authUserId)).toBe(false);
    expect(await exists(newer.authUserId)).toBe(true);
    expect(CUTOFF.getTime()).toBe(NOW.getTime() - SIGNUP_ATTEMPT_RETENTION_MS);
  });

  it("measures from the latest attempt: an old first attempt with a recent retry survives", async () => {
    const row = await seedAttempt({ lastAttemptedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) });
    await prisma.signupAttempt.update({ where: { id: row.id }, data: { firstAttemptedAt: ago(200 * 24 * 60 * 60 * 1000) } });

    await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(await exists(row.authUserId)).toBe(true);
  });

  it("never deletes an activated row, however old", async () => {
    const activated = await seedAttempt({ lastAttemptedAt: ago(400 * 24 * 60 * 60 * 1000), activatedAt: ago(399 * 24 * 60 * 60 * 1000) });
    const summary = await cleanupSignupAttempts({ now: NOW, batchSize: 50 });
    expect(summary.deleted).toBe(0);
    expect(await exists(activated.authUserId)).toBe(true);
  });

  it("a real activation (recordSignupActivation) protects the row from later cleanup", async () => {
    const row = await seedAttempt({ lastAttemptedAt: ago(5_000) });
    await recordSignupActivation({ authUserId: row.authUserId, activatedAt: new Date("2027-01-01T00:00:00.000Z") });
    await cleanupSignupAttempts({ now: NOW, batchSize: 50 });
    expect(await exists(row.authUserId)).toBe(true);
  });

  it("a User that exists with activatedAt still null is never deleted: the row is repaired to the User's own createdAt", async () => {
    const row = await seedAttempt({ lastAttemptedAt: ago(10 * 24 * 60 * 60 * 1000) });
    const user = await seedUser(row.authUserId);

    const summary = await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(summary).toMatchObject({ scanned: 1, deleted: 0, reconciled: 1, restored: 0 });
    const after = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: row.authUserId } });
    expect(after.activatedAt?.getTime()).toBe(user.createdAt.getTime());
    // Repair makes the row non-candidate, so a second run does nothing.
    expect(await cleanupSignupAttempts({ now: NOW, batchSize: 50 })).toMatchObject({ scanned: 0, reconciled: 0, deleted: 0 });
  });

  it("repaired rows cannot starve the batch: expired rows behind them are still deleted", async () => {
    const protectedRows = [];
    for (let i = 0; i < 3; i += 1) {
      const row = await seedAttempt({ lastAttemptedAt: ago(100_000 + i) });
      await seedUser(row.authUserId);
      protectedRows.push(row);
    }
    const expired = await seedAttempt({ lastAttemptedAt: ago(10) });

    await cleanupSignupAttempts({ now: NOW, batchSize: 3, maxBatches: 3 });

    expect(await exists(expired.authUserId)).toBe(false);
    for (const row of protectedRows) expect(await exists(row.authUserId)).toBe(true);
  });

  it("activation landing between the candidate read and the delete is respected (the delete is guarded)", async () => {
    const row = await seedAttempt({ lastAttemptedAt: ago(1_000) });
    const realDeleteMany = prisma.signupAttempt.deleteMany.bind(prisma.signupAttempt);
    vi.spyOn(prisma.signupAttempt, "deleteMany").mockImplementation(((args: Parameters<typeof realDeleteMany>[0]) =>
      recordSignupActivation({ authUserId: row.authUserId, activatedAt: new Date("2027-02-28T00:00:00.000Z") }).then(() =>
        realDeleteMany(args),
      )) as typeof prisma.signupAttempt.deleteMany);

    const summary = await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(summary.deleted).toBe(0);
    expect((await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: row.authUserId } })).activatedAt).not.toBeNull();
  });

  it("a fresh attempt landing between the read and the delete keeps the row", async () => {
    const row = await seedAttempt({ lastAttemptedAt: ago(1_000) });
    const realDeleteMany = prisma.signupAttempt.deleteMany.bind(prisma.signupAttempt);
    vi.spyOn(prisma.signupAttempt, "deleteMany").mockImplementation(((args: Parameters<typeof realDeleteMany>[0]) =>
      prisma.signupAttempt
        .update({ where: { authUserId: row.authUserId }, data: { lastAttemptedAt: NOW } })
        .then(() => realDeleteMany(args))) as typeof prisma.signupAttempt.deleteMany);

    const summary = await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(summary.deleted).toBe(0);
    expect(await exists(row.authUserId)).toBe(true);
  });

  it("a User created after the existence check but before the delete is detected and the row is restored unchanged, activated at the User's createdAt", async () => {
    const row = await seedAttempt({ lastAttemptedAt: ago(1_000), attemptCount: 4 });
    const userCreatedAt = new Date("2027-02-28T23:59:59.000Z");
    const realDeleteMany = prisma.signupAttempt.deleteMany.bind(prisma.signupAttempt);
    vi.spyOn(prisma.signupAttempt, "deleteMany").mockImplementation(((args: Parameters<typeof realDeleteMany>[0]) =>
      seedUser(row.authUserId, userCreatedAt).then(() => realDeleteMany(args))) as typeof prisma.signupAttempt.deleteMany);

    const summary = await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(summary).toMatchObject({ deleted: 0, restored: 1 });
    const after = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: row.authUserId } });
    expect(after.activatedAt?.getTime()).toBe(userCreatedAt.getTime());
    expect(after.email).toBe(row.email);
    expect(after.origin).toBe(row.origin);
    expect(after.attemptCount).toBe(4);
    expect(after.firstAttemptedAt.getTime()).toBe(row.firstAttemptedAt.getTime());
    expect(after.lastAttemptedAt.getTime()).toBe(row.lastAttemptedAt.getTime());
  });

  it("is bounded per run and idempotent across retries: oldest first, never more than batchSize x maxBatches", async () => {
    const rows = [];
    for (let i = 0; i < 7; i += 1) rows.push(await seedAttempt({ lastAttemptedAt: ago((7 - i) * 1_000) })); // rows[0] is the oldest

    const first = await cleanupSignupAttempts({ now: NOW, batchSize: 3, maxBatches: 1 });
    expect(first).toMatchObject({ scanned: 3, deleted: 3, batches: 1 });
    expect(await exists(rows[0].authUserId)).toBe(false);
    expect(await exists(rows[2].authUserId)).toBe(false);
    expect(await exists(rows[3].authUserId)).toBe(true);

    const second = await cleanupSignupAttempts({ now: NOW, batchSize: 3, maxBatches: 2 });
    expect(second).toMatchObject({ scanned: 4, deleted: 4, batches: 2 });

    const third = await cleanupSignupAttempts({ now: NOW, batchSize: 3, maxBatches: 2 });
    expect(third).toEqual({ scanned: 0, deleted: 0, reconciled: 0, restored: 0, batches: 0 });
    for (const row of rows) expect(await exists(row.authUserId)).toBe(false);
  });

  it("ignores invalid batch parameters instead of running unbounded", async () => {
    const row = await seedAttempt({ lastAttemptedAt: ago(1_000) });
    expect(await cleanupSignupAttempts({ now: NOW, batchSize: 0 })).toMatchObject({ scanned: 0, deleted: 0 });
    expect(await cleanupSignupAttempts({ now: NOW, batchSize: 5, maxBatches: 0 })).toMatchObject({ scanned: 0, deleted: 0 });
    expect(await exists(row.authUserId)).toBe(true);
  });

  it("a database failure before the delete rejects and deletes nothing; the retry then succeeds", async () => {
    const row = await seedAttempt({ lastAttemptedAt: ago(1_000) });
    const spy = vi.spyOn(prisma.user, "findMany").mockRejectedValueOnce(new Error("db down"));

    await expect(cleanupSignupAttempts({ now: NOW, batchSize: 50 })).rejects.toThrow("db down");
    expect(await exists(row.authUserId)).toBe(true);

    spy.mockRestore();
    expect(await cleanupSignupAttempts({ now: NOW, batchSize: 50 })).toMatchObject({ deleted: 1 });
    expect(await exists(row.authUserId)).toBe(false);
  });

  it("a failed delete statement leaves every row intact (single atomic statement)", async () => {
    const rows = [await seedAttempt({ lastAttemptedAt: ago(1_000) }), await seedAttempt({ lastAttemptedAt: ago(2_000) })];
    vi.spyOn(prisma.signupAttempt, "deleteMany").mockRejectedValueOnce(new Error("delete failed"));

    await expect(cleanupSignupAttempts({ now: NOW, batchSize: 50 })).rejects.toThrow("delete failed");
    for (const row of rows) expect(await exists(row.authUserId)).toBe(true);
  });

  it("isolates users: only expired unactivated rows go; recent, activated and other users' rows are byte-identical", async () => {
    const expired = await seedAttempt({ lastAttemptedAt: ago(1_000) });
    const recent = await seedAttempt({ lastAttemptedAt: new Date(NOW.getTime() - 1_000) });
    const activated = await seedAttempt({ lastAttemptedAt: ago(500_000), activatedAt: ago(400_000) });
    const beforeRecent = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: recent.authUserId } });
    const beforeActivated = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: activated.authUserId } });

    await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(await exists(expired.authUserId)).toBe(false);
    expect(await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: recent.authUserId } })).toEqual(beforeRecent);
    expect(await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: activated.authUserId } })).toEqual(beforeActivated);
  });

  it("touches no Users, organizations or memberships", async () => {
    await seedAttempt({ lastAttemptedAt: ago(1_000) });
    const counts = async () => [await prisma.user.count(), await prisma.organization.count(), await prisma.membership.count()];
    const before = await counts();
    await cleanupSignupAttempts({ now: NOW, batchSize: 50 });
    expect(await counts()).toEqual(before);
  });

  it("an expired attempt recorded through the real recorder is removed once old enough, and a newly recorded one is not", async () => {
    const oldId = randomUUID();
    const newId = randomUUID();
    created.push(oldId, newId);
    await recordSignupAttempt({ authUserId: oldId, email: testEmail("retention-real-old", TEST_EMAIL_DOMAIN), origin: "INVITED" }, { now: ago(1_000) });
    await recordSignupAttempt({ authUserId: newId, email: testEmail("retention-real-new", TEST_EMAIL_DOMAIN), origin: "STANDALONE" }, { now: NOW });

    await cleanupSignupAttempts({ now: NOW, batchSize: 50 });

    expect(await exists(oldId)).toBe(false);
    expect(await exists(newId)).toBe(true);
  });
});

describe("signup attempt retention — cron route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/cron/signup-attempt-retention", { headers: new Headers(headers) });

  it("rejects a missing or wrong bearer secret (401) and runs nothing", async () => {
    const spy = vi.spyOn(prisma.signupAttempt, "findMany");
    expect((await retentionGet(request())).status).toBe(401);
    expect((await retentionGet(request({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects even a plausible bearer value when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    expect((await retentionGet(request({ authorization: "Bearer anything" }))).status).toBe(401);
  });

  it("accepts the correct secret and returns only aggregate counts", async () => {
    const response = await retentionGet(request({ authorization: `Bearer ${TEST_CRON_SECRET}` }));
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual(["batches", "deleted", "reconciled", "restored", "scanned"]);
  });

  it("returns a generic 500 and logs one fixed line, with no error text, when the database fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(prisma.signupAttempt, "findMany").mockRejectedValueOnce(new Error("secret db detail alice@example.com"));

    const response = await retentionGet(request({ authorization: `Bearer ${TEST_CRON_SECRET}` }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Cleanup failed." });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toEqual(["[signup-attempts] retention cleanup failed."]);
  });
});
