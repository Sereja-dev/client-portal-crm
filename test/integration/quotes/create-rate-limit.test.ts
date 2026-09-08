import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { checkRateLimit, QUOTE_CREATE_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — createQuoteAction rate limiting. Same
 * file-local mocking convention as test/integration/leads/
 * create-rate-limit.test.ts's own header comment: only checkRateLimit()
 * itself is replaced (file-locally); every other export of
 * @/lib/rate-limit (QUOTE_CREATE_LIMIT, RATE_LIMIT_MESSAGE, the real
 * store) stays real.
 */
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const mockedCheckRateLimit = vi.mocked(checkRateLimit);

const NAME_PREFIX = "RL-Quote-Create";

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

describe("createQuoteAction — rate limiting", () => {
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

  it("12. a request below the limit succeeds", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(result.ok).toBe(true);
  });

  it("a request above the limit is rejected, and no Quote row is created", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const number = uniqueNumber();

    const result = await createQuoteAction(baseInput({ number, clientId: fixtures.clientA.id }));

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(await prisma.quote.findFirst({ where: { number } })).toBeNull();
  });

  it("the limiter key is the server-resolved authenticated user id, and uses QUOTE_CREATE_LIMIT specifically", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(mockedCheckRateLimit).toHaveBeenCalledWith(QUOTE_CREATE_LIMIT, fixtures.owner.id);
  });

  it("one user's rate limit does not block a different user in the same organization", async () => {
    mockedCheckRateLimit.mockImplementation((_config, identifier) =>
      identifier === fixtures.owner.id ? { limited: true, message: RATE_LIMIT_MESSAGE } : { limited: false },
    );

    actAs(fixtures.owner, fixtures.orgA.id);
    const blockedNumber = uniqueNumber();
    const blockedResult = await createQuoteAction(baseInput({ number: blockedNumber, clientId: fixtures.clientA.id }));
    expect(blockedResult).toEqual({ ok: false, reason: "rate_limited" });
    resetAuthMock();

    actAs(fixtures.admin, fixtures.orgA.id);
    const allowedNumber = uniqueNumber();
    const allowedResult = await createQuoteAction(baseInput({ number: allowedNumber, clientId: fixtures.clientA.id }));
    expect(allowedResult.ok).toBe(true);

    expect(await prisma.quote.findFirst({ where: { number: blockedNumber } })).toBeNull();
    expect(await prisma.quote.findFirst({ where: { number: allowedNumber } })).not.toBeNull();
  });
});
