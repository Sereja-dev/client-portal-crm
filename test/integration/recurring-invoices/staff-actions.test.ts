import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createRecurringInvoiceAction,
  updateRecurringInvoiceAction,
  pauseRecurringInvoiceAction,
  resumeRecurringInvoiceAction,
  archiveRecurringInvoiceAction,
  generateDueInvoiceAction,
} from "@/app/(dashboard)/recurring-invoices/actions";
import { listRecurringInvoices, getRecurringInvoice } from "@/lib/recurring-invoices/recurring-invoices";
import { encodeInvoiceLineItemsFormValue, type InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";
import { getNavigationCalls, resetNavigationMock } from "../../support/navigation-mock";

/**
 * Recurring Invoices Phase 2A — Staff Server Action layer (test items
 * 1-21, 26-40). Mirrors test/integration/time-entries/staff-actions.test.ts's
 * own seedTestData/actAs/expectRedirect pattern exactly.
 */

async function expectRedirect(promise: Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

const DEFAULT_LINE_ITEMS: InvoiceLineItemFormValue[] = [{ description: "Retainer", quantity: "1", unitPrice: "100.00" }];

function formData(fields: Record<string, string | undefined>, lineItems: InvoiceLineItemFormValue[] = DEFAULT_LINE_ITEMS): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) fd.set(key, value);
  }
  fd.set("lineItems", encodeInvoiceLineItemsFormValue(lineItems));
  return fd;
}

function baseFields(fixtures: TestFixtures, overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    clientId: fixtures.clientA.id,
    frequency: "MONTHLY",
    firstIssueDate: "2027-01-31",
    invoiceNumberPrefix: "INV-",
    currency: "USD",
    ...overrides,
  };
}

function utcMidnight(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function cleanupAll(organizationIds: string[]) {
  await prisma.invoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.recurringInvoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

async function createViaAction(fixtures: TestFixtures, overrides: Record<string, string | undefined> = {}) {
  actAs(fixtures.owner, fixtures.orgA.id);
  const redirect = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures, overrides))));
  const id = redirect.url.split("/recurring-invoices/")[1].split("?")[0];
  resetAuthMock();
  resetNavigationMock();
  return id;
}

describe("Recurring Invoices — Staff Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupAll([fixtures.orgA.id, fixtures.orgB.id]);
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // --- Permissions -----------------------------------------------------

  it("1/2. OWNER and ADMIN can list/read", async () => {
    const id = await createViaAction(fixtures);
    for (const user of [fixtures.owner, fixtures.admin]) {
      actAs(user, fixtures.orgA.id);
      const listResult = await listRecurringInvoices(fixtures.orgA.id, { id: user.id, name: user.name, role: user === fixtures.owner ? "OWNER" : "ADMIN" });
      expect(listResult.ok).toBe(true);
      const getResult = await getRecurringInvoice(fixtures.orgA.id, id, { id: user.id, name: user.name, role: user === fixtures.owner ? "OWNER" : "ADMIN" });
      expect(getResult.ok).toBe(true);
      resetAuthMock();
    }
  });

  it("3. MEMBER cannot access recurrence data through the action layer", async () => {
    const id = await createViaAction(fixtures);
    actAs(fixtures.member, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("4/5. OWNER and ADMIN can create", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const ownerRedirect = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures))));
    expect(ownerRedirect.url).toContain("/recurring-invoices/");
    resetAuthMock();

    actAs(fixtures.admin, fixtures.orgA.id);
    const adminRedirect = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures))));
    expect(adminRedirect.url).toContain("/recurring-invoices/");
  });

  it("6. MEMBER create is rejected", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const result = await createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures)));
    expect(result.error).toBe("You don't have permission to do that.");
    expect(await prisma.recurringInvoice.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("7. a cross-org Client is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures, { clientId: fixtures.clientB.id })));
    expect(result).toEqual({ error: null, fieldErrors: { clientId: "Select a valid client and project." } });
  });

  it("8. an invalid/cross-client Project is rejected", async () => {
    const otherClient = await prisma.client.create({ data: { name: "Other Client", organizationId: fixtures.orgA.id, status: "ACTIVE", userId: fixtures.owner.id } });
    const otherProject = await prisma.project.create({ data: { name: "Other Project", clientId: otherClient.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" } });

    actAs(fixtures.owner, fixtures.orgA.id);
    // fixtures.project belongs to fixtures.clientA, not otherClient.
    const result = await createRecurringInvoiceAction(
      { error: null },
      formData(baseFields(fixtures, { clientId: otherClient.id, projectId: fixtures.project.id })),
    );
    expect(result).toEqual({ error: null, fieldErrors: { clientId: "Select a valid client and project." } });

    await prisma.project.deleteMany({ where: { id: otherProject.id } });
    await prisma.client.deleteMany({ where: { id: otherClient.id } });
  });

  // --- Form / create -----------------------------------------------------

  it("9. a submitted anchorDay is never accepted as authoritative (the action doesn't even read it)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const fd = formData(baseFields(fixtures, { firstIssueDate: "2027-01-31" }));
    fd.set("anchorDay", "1"); // never read by the action at all
    const redirect = await expectRedirect(createRecurringInvoiceAction({ error: null }, fd));
    const id = redirect.url.split("/recurring-invoices/")[1].split("?")[0];
    const created = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect(created.anchorDay).toBe(31); // derived from firstIssueDate, not the bogus "1"
  });

  it("10. the first issue date derives the correct anchorDay through the domain layer", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const redirect = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures, { firstIssueDate: "2027-03-15" }))));
    const id = redirect.url.split("/recurring-invoices/")[1].split("?")[0];
    const created = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect(created.anchorDay).toBe(15);
    expect(created.nextIssueDate.toISOString()).toBe("2027-03-15T00:00:00.000Z");
  });

  it("11. the prefix is submitted and persisted correctly", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const redirect = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures, { invoiceNumberPrefix: "ACME-" }))));
    const id = redirect.url.split("/recurring-invoices/")[1].split("?")[0];
    const created = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect(created.invoiceNumberPrefix).toBe("ACME-");
  });

  it("12. line items serialize correctly through the hidden JSON field", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const lineItems: InvoiceLineItemFormValue[] = [
      { description: "Design", quantity: "1", unitPrice: "500.00" },
      { description: "Hosting", quantity: "2", unitPrice: "25.00" },
    ];
    const redirect = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures), lineItems)));
    const id = redirect.url.split("/recurring-invoices/")[1].split("?")[0];
    const created = await prisma.recurringInvoiceLineItem.findMany({ where: { recurringInvoiceId: id }, orderBy: { position: "asc" } });
    expect(created).toHaveLength(2);
    expect(created[0].description).toBe("Design");
    expect(created[1].description).toBe("Hosting");
  });

  it("13. dueDateOffsetDays is nullable — omitted means null, provided means the value", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const withoutOffset = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures))));
    const idWithout = withoutOffset.url.split("/recurring-invoices/")[1].split("?")[0];
    expect((await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: idWithout } })).dueDateOffsetDays).toBeNull();

    const withOffset = await expectRedirect(createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures, { dueDateOffsetDays: "14" }))));
    const idWith = withOffset.url.split("/recurring-invoices/")[1].split("?")[0];
    expect((await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: idWith } })).dueDateOffsetDays).toBe(14);
  });

  it("14. invalid fields return safe field errors, not raw internals", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createRecurringInvoiceAction({ error: null }, formData(baseFields(fixtures, { currency: "XXX" })));
    expect(result).toEqual({ error: null, fieldErrors: expect.objectContaining({ currency: expect.any(String) }) });
    expect(await prisma.recurringInvoice.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  // --- Edit / lifecycle ----------------------------------------------------

  it("15. a valid template edit works", async () => {
    const id = await createViaAction(fixtures);
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(updateRecurringInvoiceAction(id, { error: null }, formData({ name: "Renamed", clientId: fixtures.clientA.id, invoiceNumberPrefix: "INV-", currency: "USD" })));
    const updated = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect(updated.name).toBe("Renamed");
  });

  it("16. an unsupported schedule-date/frequency mutation is never exposed — the action doesn't read those fields at all", async () => {
    const id = await createViaAction(fixtures, { frequency: "MONTHLY", firstIssueDate: "2027-01-31" });
    const before = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const fd = formData({ name: "Renamed again", clientId: fixtures.clientA.id, invoiceNumberPrefix: "INV-", currency: "USD" });
    fd.set("frequency", "WEEKLY");
    fd.set("firstIssueDate", "2027-06-01");
    fd.set("startingSequence", "999");
    await expectRedirect(updateRecurringInvoiceAction(id, { error: null }, fd));

    const after = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect(after.frequency).toBe(before.frequency);
    expect(after.anchorDay).toBe(before.anchorDay);
    expect(after.nextIssueDate.getTime()).toBe(before.nextIssueDate.getTime());
    expect(after.nextSequence).toBe(before.nextSequence);
  });

  it("17/18/19. pause, resume, and archive all work", async () => {
    const id = await createViaAction(fixtures);
    actAs(fixtures.owner, fixtures.orgA.id);

    expect(await pauseRecurringInvoiceAction(id)).toEqual({ ok: true });
    expect((await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("PAUSED");

    expect(await resumeRecurringInvoiceAction(id)).toEqual({ ok: true });
    expect((await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");

    expect(await archiveRecurringInvoiceAction(id)).toEqual({ ok: true });
    expect((await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("ARCHIVED");
  });

  it("20. an archived recurrence cannot resume", async () => {
    const id = await createViaAction(fixtures);
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveRecurringInvoiceAction(id);
    const result = await resumeRecurringInvoiceAction(id);
    expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
  });

  it("21. an archived recurrence cannot generate", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveRecurringInvoiceAction(id);
    const result = await generateDueInvoiceAction(id);
    expect(result).toEqual({ ok: false, reason: "NOT_ACTIVE" });
    expect(await prisma.invoice.count({ where: { recurringInvoiceId: id } })).toBe(0);
  });

  // --- Generated invoice history --------------------------------------

  it("26/27. only this schedule's own Invoices are returned, org-scoped", async () => {
    const idA = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    const idB = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1), invoiceNumberPrefix: "OTHER-" });
    actAs(fixtures.owner, fixtures.orgA.id);
    await generateDueInvoiceAction(idA);
    await generateDueInvoiceAction(idB);

    const historyForA = await prisma.invoice.findMany({ where: { recurringInvoiceId: idA, organizationId: fixtures.orgA.id } });
    expect(historyForA).toHaveLength(1);
    expect(historyForA[0].recurringInvoiceId).toBe(idA);
  });

  it("28. a generated Invoice's id resolves through the ordinary Invoice route target", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    if (result.ok !== true || result.outcome !== "generated") throw new Error("expected generated");
    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice).not.toBeNull(); // /invoices/[id]/edit resolves this exact id
  });

  // --- Manual generation -------------------------------------------------

  it("29. an ACTIVE + due schedule can generate", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    expect(result.ok).toBe(true);
    if (result.ok !== true) throw new Error("expected ok");
    expect(result.outcome).toBe("generated");
  });

  it("30. a future schedule cannot manually generate", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(5) });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    expect(result).toEqual({ ok: false, reason: "NOT_DUE" });
    expect(await prisma.invoice.count({ where: { recurringInvoiceId: id } })).toBe(0);
  });

  it("31. a PAUSED schedule cannot generate", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    await pauseRecurringInvoiceAction(id);
    const result = await generateDueInvoiceAction(id);
    expect(result).toEqual({ ok: false, reason: "NOT_ACTIVE" });
  });

  it("32. an ARCHIVED schedule cannot generate", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveRecurringInvoiceAction(id);
    const result = await generateDueInvoiceAction(id);
    expect(result).toEqual({ ok: false, reason: "NOT_ACTIVE" });
  });

  it("33/34. the generated Invoice is DRAFT and appears in this schedule's own history", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    if (result.ok !== true || result.outcome !== "generated") throw new Error("expected generated");
    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice?.status).toBe("DRAFT");
    expect(invoice?.recurringInvoiceId).toBe(id);
  });

  it("35. a successful generation advances the schedule's own displayed nextIssueDate", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    const before = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    actAs(fixtures.owner, fixtures.orgA.id);
    await generateDueInvoiceAction(id);
    const after = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect(after.nextIssueDate.getTime()).toBeGreaterThan(before.nextIssueDate.getTime());
  });

  it("36. a repeated manual call for the same already-COMPLETED occurrence creates no duplicate Invoice", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    const first = await generateDueInvoiceAction(id);
    if (first.ok !== true || first.outcome !== "generated") throw new Error("expected generated");

    // Simulate a stale second click for the exact same occurrence — reset
    // nextIssueDate back to the date that already completed.
    const schedule = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    const occurrence = await prisma.recurringInvoiceOccurrence.findFirstOrThrow({ where: { recurringInvoiceId: id, status: "COMPLETED" } });
    await prisma.recurringInvoice.update({ where: { id }, data: { nextIssueDate: occurrence.occurrenceDate } });
    void schedule;

    const second = await generateDueInvoiceAction(id);
    expect(second).toEqual({ ok: true, outcome: "skipped_completed" });
    expect(await prisma.invoice.count({ where: { recurringInvoiceId: id } })).toBe(1);
  });

  it("37. skipped_claimed is handled safely, no internals exposed", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    const schedule = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id } });
    // A fresh, still-owned PENDING claim for today's occurrence — simulates another worker already processing it.
    await prisma.recurringInvoiceOccurrence.create({
      data: { recurringInvoiceId: id, occurrenceDate: schedule.nextIssueDate, status: "PENDING", claimedAt: new Date(), claimToken: "other-worker", attemptCount: 1 },
    });

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    expect(result).toEqual({ ok: true, outcome: "skipped_claimed" });
    expect(await prisma.invoice.count({ where: { recurringInvoiceId: id } })).toBe(0);
  });

  it("38. a failed (numbering-exhausted) result is handled without exposing raw DB/internal details", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1), invoiceNumberPrefix: "EXH-" });
    for (let seq = 1; seq <= 5; seq++) {
      await prisma.invoice.create({
        data: {
          invoiceNumber: `EXH-${seq}`,
          status: "DRAFT",
          amount: "0",
          subtotal: "0",
          discountAmount: "0",
          taxAmount: "0",
          currency: "USD",
          issueDate: new Date(),
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
        },
      });
    }

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    expect(result).toEqual({ ok: true, outcome: "failed" });
    // The result shape itself structurally cannot carry a raw failureReason/DB
    // message — {ok:true, outcome:"failed"} has no further field at all.
    expect(Object.keys(result)).toEqual(["ok", "outcome"]);
  }, 15_000);

  it("39. a successful manual generation never Issues/PDFs/emails the Invoice", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await generateDueInvoiceAction(id);
    if (result.ok !== true || result.outcome !== "generated") throw new Error("expected generated");

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoiceId } });
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.pdfGeneratedAt).toBeNull();
    expect(invoice.pdfStoragePath).toBeNull();
    expect(invoice.finalizedAt).toBeNull();
    expect(await prisma.invoiceEmailAttempt.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("40. a successful generation revalidates /invoices and the recurrence pages", async () => {
    const id = await createViaAction(fixtures, { firstIssueDate: utcMidnight(-1) });
    resetNavigationMock();
    actAs(fixtures.owner, fixtures.orgA.id);
    await generateDueInvoiceAction(id);

    const calls = getNavigationCalls();
    expect(calls).toContainEqual({ type: "revalidatePath", path: "/recurring-invoices" });
    expect(calls).toContainEqual({ type: "revalidatePath", path: `/recurring-invoices/${id}` });
    expect(calls).toContainEqual({ type: "revalidatePath", path: "/invoices" });
  });
});
