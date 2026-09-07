import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createInvoiceAction } from "@/app/(dashboard)/invoices/new/actions";
import { checkRateLimit, INVOICE_CREATE_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Post-Hardening Residual Code Audit (P1) — createInvoiceAction previously
 * had no rate limit at all. Same mocking convention pdf-download.test.ts's
 * own header comment already establishes: only checkRateLimit() itself is
 * replaced (file-locally); every other export of @/lib/rate-limit
 * (INVOICE_CREATE_LIMIT, RATE_LIMIT_MESSAGE, the real store) stays real.
 * Kept as its own file rather than added to draft-create.test.ts, which
 * has no rate-limit mock of its own and should stay that way — every test
 * there keeps exercising the real, unmocked checkRateLimit() (always
 * "not limited" at real, low test volume).
 */
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const mockedCheckRateLimit = vi.mocked(checkRateLimit);

const INVOICE_NUMBER_PREFIX = "INV-RL";

function uniqueInvoiceNumber(runId: string): string {
  return `${INVOICE_NUMBER_PREFIX}-${runId}-${randomUUID().slice(0, 8)}`;
}

function buildFormData(invoiceNumber: string, projectId: string): FormData {
  const fd = new FormData();
  fd.set("invoiceNumber", invoiceNumber);
  fd.set("projectId", projectId);
  fd.set("mode", "flat");
  fd.set("amount", "100.00");
  fd.set("lineItems", "");
  fd.set("currency", "USD");
  fd.set("issueDate", "2026-08-16");
  fd.set("dueDate", "");
  fd.set("notes", "");
  fd.set("internalNotes", "");
  fd.set("discountType", "NONE");
  fd.set("discountValue", "");
  fd.set("taxRatePercent", "");
  fd.set("taxLabel", "TAX");
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

describe("createInvoiceAction — rate limiting (Post-Hardening Residual Code Audit P1)", () => {
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
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: `${INVOICE_NUMBER_PREFIX}-${fixtures.runId}` } } });
    await cleanupTestData(fixtures);
  });

  it("a request below the limit succeeds — the invoice is created normally", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);

    await expectRedirect(createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.project.id)));

    const created = await prisma.invoice.findFirst({ where: { invoiceNumber } });
    expect(created).not.toBeNull();
  });

  it("a request above the limit is rejected with the generic rate-limit message, and no Invoice row is created", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);

    const result = await createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.project.id));

    expect(result.error).toBe(RATE_LIMIT_MESSAGE);
    expect(result.fieldErrors).toBeUndefined();
    const created = await prisma.invoice.findFirst({ where: { invoiceNumber } });
    expect(created).toBeNull();
  });

  it("the limiter key is the server-resolved authenticated user id, never anything from the request body", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);

    await expectRedirect(createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.project.id)));

    expect(mockedCheckRateLimit).toHaveBeenCalledWith(INVOICE_CREATE_LIMIT, fixtures.owner.id);
  });

  it("one user's rate limit does not block a different user in the same organization", async () => {
    mockedCheckRateLimit.mockImplementation((_config, identifier) =>
      identifier === fixtures.owner.id ? { limited: true, message: RATE_LIMIT_MESSAGE } : { limited: false },
    );

    actAs(fixtures.owner, fixtures.orgA.id);
    const blockedInvoiceNumber = uniqueInvoiceNumber(fixtures.runId);
    const blockedResult = await createInvoiceAction({ error: null }, buildFormData(blockedInvoiceNumber, fixtures.project.id));
    expect(blockedResult.error).toBe(RATE_LIMIT_MESSAGE);
    resetAuthMock();

    actAs(fixtures.admin, fixtures.orgA.id);
    const allowedInvoiceNumber = uniqueInvoiceNumber(fixtures.runId);
    await expectRedirect(createInvoiceAction({ error: null }, buildFormData(allowedInvoiceNumber, fixtures.project.id)));

    expect(await prisma.invoice.findFirst({ where: { invoiceNumber: blockedInvoiceNumber } })).toBeNull();
    expect(await prisma.invoice.findFirst({ where: { invoiceNumber: allowedInvoiceNumber } })).not.toBeNull();
  });

  it("existing org/client/project validation is unchanged: an arbitrary/foreign projectId is still rejected, rate limit notwithstanding", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);

    const result = await createInvoiceAction({ error: null }, buildFormData(invoiceNumber, randomUUID()));

    expect(result.fieldErrors?.projectId).toBe("Select a valid project.");
    const created = await prisma.invoice.findFirst({ where: { invoiceNumber } });
    expect(created).toBeNull();
  });

  it("existing invoice-number idempotency (P2002 -> conflict) is unchanged: rate-limit check never masks a real duplicate", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);

    await expectRedirect(createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.project.id)));

    const result = await createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.project.id));
    expect(result.fieldErrors?.invoiceNumber).toBe("An invoice with this number already exists.");
  });
});
