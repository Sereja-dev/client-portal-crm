import { describe, expect, it } from "vitest";
import { buildInvoiceDirtySnapshot } from "@/components/invoices/invoice-form";
import { buildRecurringInvoiceDirtySnapshot } from "@/components/recurring-invoices/recurring-invoice-form";
import { buildQuoteDirtySnapshot } from "@/components/quotes/quote-form";
import { deepEqual } from "@/lib/forms/deep-equal";

/**
 * Forms Improvement Slice C1a — proves the normalization rules each
 * form's own dirty snapshot applies, so a field that isn't currently
 * meaningful (hidden, inactive, or simply never rendered in the current
 * mode) never produces a false-positive "you have unsaved changes"
 * warning — the exact failure mode a naive field-by-field comparison
 * would have.
 */

describe("buildInvoiceDirtySnapshot — mode-conditional fields", () => {
  const base = {
    clientId: "c1",
    projectId: "",
    invoiceNumber: "INV-1",
    mode: "flat" as const,
    amount: "100.00",
    lineItems: [{ description: "", quantity: "", unitPrice: "" }],
    currency: "USD",
    issueDate: "2026-01-01",
    dueDate: "",
    discountType: "NONE" as const,
    discountValue: "",
    taxRatePercent: "",
    taxLabel: "TAX" as const,
    notes: "",
    internalNotes: "",
  };

  it("a stale lineItems array is ignored while mode is flat — only amount is meaningful", () => {
    const snapshot = buildInvoiceDirtySnapshot({
      ...base,
      mode: "flat",
      lineItems: [{ description: "leftover", quantity: "1", unitPrice: "1" }],
    });
    expect(snapshot.lineItems).toEqual([]);
  });

  it("a stale amount string is ignored while mode is itemized — only lineItems is meaningful", () => {
    const snapshot = buildInvoiceDirtySnapshot({ ...base, mode: "itemized", amount: "999.99" });
    expect(snapshot.amount).toBe("");
  });

  it("switching mode alone (with no amount/lineItems edit at all) still produces a different snapshot — mode itself is real, user-visible state", () => {
    const flat = buildInvoiceDirtySnapshot({ ...base, mode: "flat" });
    const itemized = buildInvoiceDirtySnapshot({ ...base, mode: "itemized" });
    expect(deepEqual(flat, itemized)).toBe(false);
  });
});

describe("buildInvoiceDirtySnapshot / buildRecurringInvoiceDirtySnapshot / buildQuoteDirtySnapshot — discountValue normalization", () => {
  it("Invoice: a stale discountValue is ignored while discountType is NONE — its own FormField isn't even rendered then", () => {
    const snapshot = buildInvoiceDirtySnapshot({
      clientId: "",
      projectId: "",
      invoiceNumber: "",
      mode: "flat",
      amount: "",
      lineItems: [],
      currency: "USD",
      issueDate: "",
      dueDate: "",
      discountType: "NONE",
      discountValue: "leftover-50.00",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
      internalNotes: "",
    });
    expect(snapshot.discountValue).toBe("");
  });

  it("Recurring Invoice: same normalization", () => {
    const snapshot = buildRecurringInvoiceDirtySnapshot({
      clientId: "",
      projectId: "",
      name: "",
      frequency: "MONTHLY",
      firstIssueDate: "",
      invoiceNumberPrefix: "",
      startingSequence: "1",
      dueDateOffsetDays: "",
      currency: "USD",
      lineItems: [],
      discountType: "NONE",
      discountValue: "leftover-50.00",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
      internalNotes: "",
    });
    expect(snapshot.discountValue).toBe("");
  });

  it("Quote: same normalization", () => {
    const snapshot = buildQuoteDirtySnapshot({
      targetType: null,
      leadId: "",
      clientId: "",
      number: "",
      title: "",
      issueDate: "",
      validUntil: "",
      currency: "USD",
      items: [],
      discountType: "NONE",
      discountValue: "leftover-50.00",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
    });
    expect(snapshot.discountValue).toBe("");
  });

  it("a real discountValue IS preserved once discountType is non-NONE", () => {
    const snapshot = buildInvoiceDirtySnapshot({
      clientId: "",
      projectId: "",
      invoiceNumber: "",
      mode: "flat",
      amount: "",
      lineItems: [],
      currency: "USD",
      issueDate: "",
      dueDate: "",
      discountType: "FIXED",
      discountValue: "50.00",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
      internalNotes: "",
    });
    expect(snapshot.discountValue).toBe("50.00");
  });
});

describe("buildQuoteDirtySnapshot — target normalization", () => {
  it("normalizes to { targetType, targetId } — the inactive side's own value is never compared", () => {
    const leadSnapshot = buildQuoteDirtySnapshot({
      targetType: "lead",
      leadId: "lead-1",
      clientId: "some-stale-client-id",
      number: "",
      title: "",
      issueDate: "",
      validUntil: "",
      currency: "USD",
      items: [],
      discountType: "NONE",
      discountValue: "",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
    });
    expect(leadSnapshot.targetType).toBe("lead");
    expect(leadSnapshot.targetId).toBe("lead-1");
  });

  it("a stale clientId left over from before switching to Lead never produces a dirty reading by itself — only targetId (the active side) is compared", () => {
    const a = buildQuoteDirtySnapshot({
      targetType: "lead",
      leadId: "lead-1",
      clientId: "client-A",
      number: "",
      title: "",
      issueDate: "",
      validUntil: "",
      currency: "USD",
      items: [],
      discountType: "NONE",
      discountValue: "",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
    });
    const b = buildQuoteDirtySnapshot({
      targetType: "lead",
      leadId: "lead-1",
      clientId: "client-B", // different stale clientId, but target is Lead either way
      number: "",
      title: "",
      issueDate: "",
      validUntil: "",
      currency: "USD",
      items: [],
      discountType: "NONE",
      discountValue: "",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
    });
    expect(deepEqual(a, b)).toBe(true);
  });

  it("switching target type (with the same resulting id shape) IS a real, detected change", () => {
    const leadTarget = buildQuoteDirtySnapshot({
      targetType: "lead",
      leadId: "x",
      clientId: "",
      number: "",
      title: "",
      issueDate: "",
      validUntil: "",
      currency: "USD",
      items: [],
      discountType: "NONE",
      discountValue: "",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
    });
    const clientTarget = buildQuoteDirtySnapshot({
      targetType: "client",
      leadId: "",
      clientId: "x",
      number: "",
      title: "",
      issueDate: "",
      validUntil: "",
      currency: "USD",
      items: [],
      discountType: "NONE",
      discountValue: "",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
    });
    expect(deepEqual(leadTarget, clientTarget)).toBe(false);
  });

  it("targetId is empty when no target type has been chosen yet", () => {
    const snapshot = buildQuoteDirtySnapshot({
      targetType: null,
      leadId: "",
      clientId: "",
      number: "",
      title: "",
      issueDate: "",
      validUntil: "",
      currency: "USD",
      items: [],
      discountType: "NONE",
      discountValue: "",
      taxRatePercent: "",
      taxLabel: "TAX",
      notes: "",
    });
    expect(snapshot.targetId).toBe("");
  });
});
