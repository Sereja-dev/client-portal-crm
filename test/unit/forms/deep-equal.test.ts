import { describe, expect, it } from "vitest";
import { deepEqual } from "@/lib/forms/deep-equal";

/**
 * Forms Improvement Slice C1a — the one piece of shared logic every
 * guarded form's own dirty-state comparison (current normalized
 * snapshot vs its initial baseline) is built on. This is exactly why a
 * one-way touched latch (the existing, narrower `onDirtyChange` on
 * InvoiceForm) was insufficient for this slice: reverting a field back
 * to its original value must make the form read as clean again, which
 * requires a real structural comparison, not a boolean that only ever
 * flips one way.
 */
describe("deepEqual — primitives", () => {
  it("equal primitives of every kind", () => {
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
  });

  it("unequal primitives", () => {
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(true, false)).toBe(false);
  });

  it("different types are never equal, even with a loose == equivalent", () => {
    expect(deepEqual("1", 1)).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual("", null)).toBe(false);
  });

  it("null/undefined are never equal to each other or to a real value", () => {
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, "")).toBe(false);
  });
});

describe("deepEqual — plain objects", () => {
  it("equal flat objects regardless of key insertion order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("a nested difference on one key is detected", () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } })).toBe(false);
  });

  it("a missing key on either side is detected, not silently ignored", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("two structurally identical, deeply nested objects are equal", () => {
    const a = { target: { type: "client", id: "c1" }, items: [{ description: "x", quantity: "1", unitPrice: "2" }] };
    const b = { target: { type: "client", id: "c1" }, items: [{ description: "x", quantity: "1", unitPrice: "2" }] };
    expect(deepEqual(a, b)).toBe(true);
  });
});

describe("deepEqual — arrays (line-item order is Product-significant)", () => {
  it("equal arrays of primitives", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("same elements, different order — NOT equal (this is deliberate, not a bug)", () => {
    const a = [{ description: "Design" }, { description: "Hosting" }];
    const b = [{ description: "Hosting" }, { description: "Design" }];
    expect(deepEqual(a, b)).toBe(false);
  });

  it("different array lengths are never equal", () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("an array is never equal to a plain object, even with matching index-like keys", () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it("empty arrays are equal to each other", () => {
    expect(deepEqual([], [])).toBe(true);
  });
});

describe("deepEqual — realistic form-snapshot shapes", () => {
  it("two identical Invoice-style snapshots are equal", () => {
    const snapshot = {
      clientId: "c1",
      projectId: "",
      invoiceNumber: "INV-001",
      mode: "itemized" as const,
      amount: "",
      lineItems: [{ description: "Design", quantity: "2", unitPrice: "50.00" }],
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
    expect(deepEqual(snapshot, { ...snapshot })).toBe(true);
  });

  it("a single changed scalar field makes two otherwise-identical snapshots unequal", () => {
    const base = { name: "", notes: "Hello" };
    const changed = { name: "", notes: "Hello world" };
    expect(deepEqual(base, changed)).toBe(false);
  });

  it("restoring a changed field back to its original value makes the snapshots equal again", () => {
    const base = { name: "Original" };
    const edited = { name: "Edited" };
    const reverted = { name: "Original" };
    expect(deepEqual(base, edited)).toBe(false);
    expect(deepEqual(base, reverted)).toBe(true);
  });
});
