import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTaskAction } from "@/app/(dashboard)/tasks/new/actions";
import { checkRateLimit, TASK_CREATE_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Post-Hardening Residual Code Audit (P1) — createTaskAction previously had
 * no rate limit at all. Same mocking convention
 * test/integration/invoices/pdf-download.test.ts's own header comment
 * already establishes: only checkRateLimit() itself is replaced
 * (file-locally, taking precedence over setup-mocks.ts's own registration
 * for this file only); every other export of @/lib/rate-limit
 * (TASK_CREATE_LIMIT, RATE_LIMIT_MESSAGE, the real store) stays real. This
 * proves the actual wiring (the real config object + the real
 * authenticated user id reach checkRateLimit) without needing to actually
 * exhaust the real in-memory bucket 100 times per test.
 */
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const mockedCheckRateLimit = vi.mocked(checkRateLimit);

const TITLE_PREFIX = "RL-Task";

function uniqueTitle(): string {
  return `${TITLE_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function buildFormData(title: string, projectId: string): FormData {
  const fd = new FormData();
  fd.set("title", title);
  fd.set("projectId", projectId);
  return fd;
}

async function expectRedirect(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
}

describe("createTaskAction — rate limiting (Post-Hardening Residual Code Audit P1)", () => {
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
    await prisma.task.deleteMany({ where: { title: { startsWith: TITLE_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("a request below the limit succeeds — the task is created normally", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const title = uniqueTitle();

    await expectRedirect(createTaskAction({ error: null }, buildFormData(title, fixtures.project.id)));

    const created = await prisma.task.findFirst({ where: { title } });
    expect(created).not.toBeNull();
  });

  it("a request above the limit is rejected with the generic rate-limit message, and no Task row is created", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const title = uniqueTitle();

    const result = await createTaskAction({ error: null }, buildFormData(title, fixtures.project.id));

    // The generic message only — never a distinct shape, count, or reset
    // time that would let a caller distinguish this from any other
    // rate-limited route in the app.
    expect(result.error).toBe(RATE_LIMIT_MESSAGE);
    expect(result.fieldErrors).toBeUndefined();
    const created = await prisma.task.findFirst({ where: { title } });
    expect(created).toBeNull();
  });

  it("the limiter key is the server-resolved authenticated user id, never anything from the request body", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const title = uniqueTitle();

    await expectRedirect(createTaskAction({ error: null }, buildFormData(title, fixtures.project.id)));

    expect(mockedCheckRateLimit).toHaveBeenCalledWith(TASK_CREATE_LIMIT, fixtures.owner.id);
  });

  it("one user's rate limit does not block a different user in the same organization", async () => {
    mockedCheckRateLimit.mockImplementation((_config, identifier) =>
      identifier === fixtures.owner.id ? { limited: true, message: RATE_LIMIT_MESSAGE } : { limited: false },
    );

    actAs(fixtures.owner, fixtures.orgA.id);
    const blockedTitle = uniqueTitle();
    const blockedResult = await createTaskAction({ error: null }, buildFormData(blockedTitle, fixtures.project.id));
    expect(blockedResult.error).toBe(RATE_LIMIT_MESSAGE);
    resetAuthMock();

    actAs(fixtures.admin, fixtures.orgA.id);
    const allowedTitle = uniqueTitle();
    await expectRedirect(createTaskAction({ error: null }, buildFormData(allowedTitle, fixtures.project.id)));

    expect(await prisma.task.findFirst({ where: { title: blockedTitle } })).toBeNull();
    expect(await prisma.task.findFirst({ where: { title: allowedTitle } })).not.toBeNull();
  });

  it("existing tenant scoping is unchanged: an arbitrary/foreign projectId is still rejected, rate limit notwithstanding", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const title = uniqueTitle();

    const result = await createTaskAction({ error: null }, buildFormData(title, randomUUID()));

    expect(result.fieldErrors?.projectId).toBe("Select a valid project.");
    const created = await prisma.task.findFirst({ where: { title } });
    expect(created).toBeNull();
  });
});
