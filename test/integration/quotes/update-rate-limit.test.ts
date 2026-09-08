import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createQuoteAction,
  updateQuoteAction,
  sendQuoteAction,
  reopenQuoteAction,
  archiveQuoteAction,
  unarchiveQuoteAction,
  convertQuoteToInvoiceAction,
} from "@/app/(dashboard)/quotes/actions";
import { checkRateLimit, QUOTE_UPDATE_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — the shared QUOTE_UPDATE_LIMIT bucket.
 * Same file-local mocking convention as create-rate-limit.test.ts.
 * Proves every lifecycle mutation (edit/send/reopen/archive/unarchive)
 * shares the one bucket, matching QUOTE_UPDATE_LIMIT's own doc comment.
 */
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const mockedCheckRateLimit = vi.mocked(checkRateLimit);

const NAME_PREFIX = "RL-Quote-Update";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "1", unitPrice: "50.00" }],
    ...overrides,
  };
}

describe("Quote lifecycle actions — rate limiting", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  beforeEach(() => {
    mockedCheckRateLimit.mockReset().mockReturnValue({ limited: false });
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  it("23. updateQuoteAction is blocked above the limit, and uses QUOTE_UPDATE_LIMIT keyed by the authenticated user id", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const result = await updateQuoteAction(created.quoteId, baseInput({ clientId: fixtures.clientA.id }));
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(mockedCheckRateLimit).toHaveBeenCalledWith(QUOTE_UPDATE_LIMIT, fixtures.owner.id);
  });

  it("sendQuoteAction shares the same QUOTE_UPDATE_LIMIT bucket", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const result = await sendQuoteAction(created.quoteId);
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(mockedCheckRateLimit).toHaveBeenCalledWith(QUOTE_UPDATE_LIMIT, fixtures.owner.id);
  });

  it("reopenQuoteAction shares the same QUOTE_UPDATE_LIMIT bucket", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const result = await reopenQuoteAction(created.quoteId);
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(mockedCheckRateLimit).toHaveBeenCalledWith(QUOTE_UPDATE_LIMIT, fixtures.owner.id);
  });

  it("archiveQuoteAction and unarchiveQuoteAction share the same QUOTE_UPDATE_LIMIT bucket", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const archiveResult = await archiveQuoteAction(created.quoteId);
    expect(archiveResult).toEqual({ ok: false, reason: "rate_limited" });
    const unarchiveResult = await unarchiveQuoteAction(created.quoteId);
    expect(unarchiveResult).toEqual({ ok: false, reason: "rate_limited" });
    expect(mockedCheckRateLimit).toHaveBeenCalledWith(QUOTE_UPDATE_LIMIT, fixtures.owner.id);
  });

  it("Quotes / Estimates Phase 2.3 — convertQuoteToInvoiceAction shares the same QUOTE_UPDATE_LIMIT bucket", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const result = await convertQuoteToInvoiceAction(created.quoteId, "RL-CONVERT-1");
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(mockedCheckRateLimit).toHaveBeenCalledWith(QUOTE_UPDATE_LIMIT, fixtures.owner.id);
  });
});
