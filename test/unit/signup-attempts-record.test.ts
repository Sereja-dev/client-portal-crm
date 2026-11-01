import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const upsertMock = vi.fn();
const updateManyMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { signupAttempt: { upsert: upsertMock, updateMany: updateManyMock } },
}));

const { recordSignupAttempt, recordSignupActivation, normalizeSignupEmail } = await import(
  "@/lib/signup-attempts/record"
);

// Platform Admin Growth V1, Slice A. Unit-level proof of the recorder's
// contract: strict input validation, create-only identity fields, an
// increment-only update, order-independent guarded timestamp fixes, one
// bounded retry on a unique-index race, and — above all — that a failed
// or slow write never throws and never logs anything identifying.

const AUTH_USER_ID = "2f1c9a7e-6f4d-4f7b-8f3a-0b6f4a9d1c11";
const NOW = new Date("2026-11-01T10:00:00.000Z");

function row(first: Date, last: Date) {
  return { firstAttemptedAt: first, lastAttemptedAt: last };
}

describe("recordSignupAttempt", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    upsertMock.mockReset();
    updateManyMock.mockReset();
    updateManyMock.mockResolvedValue({ count: 1 });
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("normalizes email by trimming and lower-casing", () => {
    expect(normalizeSignupEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it.each([
    ["a non-UUID id", { authUserId: "not-a-uuid", email: "a@example.com", origin: "STANDALONE" as const }],
    ["an empty email", { authUserId: AUTH_USER_ID, email: "   ", origin: "STANDALONE" as const }],
    ["an email without @", { authUserId: AUTH_USER_ID, email: "nope", origin: "STANDALONE" as const }],
    ["an oversized email", { authUserId: AUTH_USER_ID, email: `${"a".repeat(330)}@example.com`, origin: "STANDALONE" as const }],
    ["an origin outside STANDALONE/INVITED", { authUserId: AUTH_USER_ID, email: "a@example.com", origin: "UNKNOWN" as never }],
  ])("rejects %s without touching the database", async (_label, input) => {
    const result = await recordSignupAttempt(input, { now: NOW });
    expect(result).toEqual({ recorded: false, reason: "INVALID_INPUT" });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("creates with identity fields and a LIVE source; an update only increments the count", async () => {
    upsertMock.mockResolvedValueOnce(row(NOW, NOW));

    const result = await recordSignupAttempt(
      { authUserId: AUTH_USER_ID, email: "  Alice@Example.COM ", origin: "INVITED" },
      { now: NOW },
    );

    expect(result).toEqual({ recorded: true });
    const call = upsertMock.mock.calls[0][0];
    expect(call.where).toEqual({ authUserId: AUTH_USER_ID });
    expect(call.create).toEqual({
      authUserId: AUTH_USER_ID,
      email: "alice@example.com",
      origin: "INVITED",
      firstAttemptedAt: NOW,
      lastAttemptedAt: NOW,
      attemptCount: 1,
      recordedVia: "LIVE",
    });
    // The retry path may change nothing but the count.
    expect(call.update).toEqual({ attemptCount: { increment: 1 } });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("lowers firstAttemptedAt and raises lastAttemptedAt only through guarded conditional updates", async () => {
    const earlier = new Date(NOW.getTime() - 5_000);
    const later = new Date(NOW.getTime() + 5_000);
    // The stored row is newer-first and older-last than this request's own clock.
    upsertMock.mockResolvedValueOnce(row(later, earlier));

    await recordSignupAttempt({ authUserId: AUTH_USER_ID, email: "a@example.com", origin: "STANDALONE" }, { now: NOW });

    expect(updateManyMock).toHaveBeenCalledTimes(2);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { authUserId: AUTH_USER_ID, firstAttemptedAt: { gt: NOW } },
      data: { firstAttemptedAt: NOW },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { authUserId: AUTH_USER_ID, lastAttemptedAt: { lt: NOW } },
      data: { lastAttemptedAt: NOW },
    });
  });

  it("makes no timestamp update when the stored row already brackets this request", async () => {
    upsertMock.mockResolvedValueOnce(row(new Date(NOW.getTime() - 9_000), new Date(NOW.getTime() + 9_000)));
    await recordSignupAttempt({ authUserId: AUTH_USER_ID, email: "a@example.com", origin: "STANDALONE" }, { now: NOW });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("retries the upsert exactly once after a unique-index race (P2002) and then succeeds", async () => {
    upsertMock
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }))
      .mockResolvedValueOnce(row(NOW, NOW));

    const result = await recordSignupAttempt({ authUserId: AUTH_USER_ID, email: "a@example.com", origin: "STANDALONE" }, { now: NOW });

    expect(result).toEqual({ recorded: true });
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never throws on a write failure and logs one fixed line with no identifying data", async () => {
    upsertMock.mockRejectedValueOnce(
      new Error("insert failed for alice@example.com password=hunter2 token_hash=abc123 2f1c9a7e-6f4d-4f7b-8f3a-0b6f4a9d1c11"),
    );

    const result = await recordSignupAttempt(
      { authUserId: AUTH_USER_ID, email: "alice@example.com", origin: "STANDALONE" },
      { now: NOW },
    );

    expect(result).toEqual({ recorded: false, reason: "WRITE_FAILED" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe("[signup-attempts] record_attempt failed (UNKNOWN).");
    for (const secret of ["alice", "example.com", "hunter2", "abc123", AUTH_USER_ID]) {
      expect(line).not.toContain(secret);
    }
  });

  it("logs only a bounded Prisma code for a known database error", async () => {
    upsertMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed on alice@example.com", { code: "P2024", clientVersion: "test" }),
    );
    await recordSignupAttempt({ authUserId: AUTH_USER_ID, email: "alice@example.com", origin: "STANDALONE" }, { now: NOW });
    expect(String(warn.mock.calls[0][0])).toBe("[signup-attempts] record_attempt failed (P2024).");
  });

  it("gives up after the bounded timeout instead of blocking signup", async () => {
    upsertMock.mockReturnValueOnce(new Promise(() => undefined));
    const started = Date.now();

    const result = await recordSignupAttempt(
      { authUserId: AUTH_USER_ID, email: "a@example.com", origin: "STANDALONE" },
      { now: NOW, timeoutMs: 25 },
    );

    expect(result).toEqual({ recorded: false, reason: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(String(warn.mock.calls[0][0])).toBe("[signup-attempts] record_attempt failed (TIMEOUT).");
  });
});

describe("recordSignupActivation", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    updateManyMock.mockReset();
    upsertMock.mockReset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("touches only the matching row and only while activatedAt is still null; it never upserts", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    const result = await recordSignupActivation({ authUserId: AUTH_USER_ID, activatedAt: NOW });

    expect(result).toEqual({ recorded: true, matched: true });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { authUserId: AUTH_USER_ID, activatedAt: null },
      data: { activatedAt: NOW },
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("reports matched: false (and writes nothing new) when there is no row to complete", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    expect(await recordSignupActivation({ authUserId: AUTH_USER_ID, activatedAt: NOW })).toEqual({ recorded: true, matched: false });
  });

  it("rejects an invalid id or date without touching the database", async () => {
    expect(await recordSignupActivation({ authUserId: "x", activatedAt: NOW })).toEqual({ recorded: false, reason: "INVALID_INPUT" });
    expect(await recordSignupActivation({ authUserId: AUTH_USER_ID, activatedAt: new Date("nope") })).toEqual({
      recorded: false,
      reason: "INVALID_INPUT",
    });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("never throws on failure and logs no identifying data", async () => {
    updateManyMock.mockRejectedValueOnce(new Error(`db down for alice@example.com ${AUTH_USER_ID}`));
    const result = await recordSignupActivation({ authUserId: AUTH_USER_ID, activatedAt: NOW });
    expect(result).toEqual({ recorded: false, reason: "WRITE_FAILED" });
    expect(String(warn.mock.calls[0][0])).toBe("[signup-attempts] record_activation failed (UNKNOWN).");
  });
});
