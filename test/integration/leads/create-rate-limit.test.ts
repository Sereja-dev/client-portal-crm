import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLeadAction } from "@/app/(dashboard)/leads/actions";
import { checkRateLimit, LEAD_CREATE_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Same file-local mocking convention as test/integration/tasks/
 * create-rate-limit.test.ts's own header comment: only checkRateLimit()
 * itself is replaced (file-locally); every other export of
 * @/lib/rate-limit (LEAD_CREATE_LIMIT, RATE_LIMIT_MESSAGE, the real
 * store) stays real. Proves the actual wiring without exhausting the real
 * in-memory bucket 100 times per test.
 */
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const mockedCheckRateLimit = vi.mocked(checkRateLimit);

const NAME_PREFIX = "RL-Lead-Create";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("createLeadAction — rate limiting", () => {
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
    await cleanupTestData(fixtures);
  });

  it("4. a request below the limit succeeds — the lead is created normally", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({ name });

    expect(result.ok).toBe(true);
    expect(await prisma.lead.findFirst({ where: { name } })).not.toBeNull();
  });

  it("a request above the limit is rejected, and no Lead row is created", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const name = uniqueName();

    const result = await createLeadAction({ name });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(await prisma.lead.findFirst({ where: { name } })).toBeNull();
  });

  it("38. the limiter key is the server-resolved authenticated user id, and uses LEAD_CREATE_LIMIT specifically", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    await createLeadAction({ name });

    expect(mockedCheckRateLimit).toHaveBeenCalledWith(LEAD_CREATE_LIMIT, fixtures.owner.id);
  });

  it("one user's rate limit does not block a different user in the same organization", async () => {
    mockedCheckRateLimit.mockImplementation((_config, identifier) =>
      identifier === fixtures.owner.id ? { limited: true, message: RATE_LIMIT_MESSAGE } : { limited: false },
    );

    actAs(fixtures.owner, fixtures.orgA.id);
    const blockedName = uniqueName();
    const blockedResult = await createLeadAction({ name: blockedName });
    expect(blockedResult).toEqual({ ok: false, reason: "rate_limited" });
    resetAuthMock();

    actAs(fixtures.admin, fixtures.orgA.id);
    const allowedName = uniqueName();
    const allowedResult = await createLeadAction({ name: allowedName });
    expect(allowedResult.ok).toBe(true);

    expect(await prisma.lead.findFirst({ where: { name: blockedName } })).toBeNull();
    expect(await prisma.lead.findFirst({ where: { name: allowedName } })).not.toBeNull();
  });
});
