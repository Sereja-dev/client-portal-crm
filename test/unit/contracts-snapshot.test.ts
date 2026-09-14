import { describe, expect, it, vi } from "vitest";

// src/lib/contracts/snapshot-types.ts imports the real "server-only"
// marker package, which throws outside Next's own build — see
// test/unit/invoice-pdf-snapshot.test.ts's own identical precedent.
vi.mock("server-only", () => ({}));

import {
  buildContractOrganizationSnapshotV1,
  buildContractClientSnapshotV1,
  buildContractSignatorySnapshotV1,
  parseContractOrganizationSnapshot,
  parseContractClientSnapshot,
  parseContractSignatorySnapshot,
} from "@/lib/contracts/snapshot-types";

/**
 * Contracts Phase 1 — round-trip + malformed/unknown-version rejection
 * tests for the versioned snapshot builders/parsers, mirroring
 * test/unit/invoice-pdf-snapshot.test.ts's own established style for
 * InvoiceIssuerSnapshotV1/InvoiceRecipientSnapshotV1.
 */

describe("buildContractOrganizationSnapshotV1 / parseContractOrganizationSnapshot", () => {
  it("round-trips a full profile", () => {
    const snapshot = buildContractOrganizationSnapshotV1({
      organizationName: "Acme Inc",
      profile: {
        legalName: "Acme Incorporated LLC",
        country: "US",
        taxId: "12-3456789",
        supportEmail: "support@acme.test",
        phone: "555-0100",
        website: "https://acme.test",
        streetAddress: "1 Main St",
        city: "Springfield",
        state: "IL",
        postalCode: "62701",
      },
    });
    expect(snapshot.legalName).toBe("Acme Incorporated LLC");
    const parsed = parseContractOrganizationSnapshot(snapshot);
    expect(parsed).toEqual({ ok: true, snapshot });
  });

  it("falls back to organizationName when no profile exists", () => {
    const snapshot = buildContractOrganizationSnapshotV1({ organizationName: "Acme Inc", profile: null });
    expect(snapshot.legalName).toBe("Acme Inc");
    expect(snapshot.address).toEqual({ streetAddress: null, city: null, state: null, postalCode: null });
    expect(parseContractOrganizationSnapshot(snapshot).ok).toBe(true);
  });

  it("rejects an unknown schemaVersion", () => {
    const snapshot = buildContractOrganizationSnapshotV1({ organizationName: "Acme Inc", profile: null });
    const tampered = { ...snapshot, schemaVersion: 2 };
    expect(parseContractOrganizationSnapshot(tampered)).toEqual({ ok: false, reason: "UNKNOWN_SCHEMA_VERSION" });
  });

  it("rejects malformed input: not an object, missing keys, extra keys, wrong types", () => {
    expect(parseContractOrganizationSnapshot(null)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractOrganizationSnapshot("not an object")).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractOrganizationSnapshot([])).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractOrganizationSnapshot({ schemaVersion: 1 })).toEqual({ ok: false, reason: "MALFORMED" });

    const snapshot = buildContractOrganizationSnapshotV1({ organizationName: "Acme Inc", profile: null });
    expect(parseContractOrganizationSnapshot({ ...snapshot, extraKey: "nope" })).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractOrganizationSnapshot({ ...snapshot, legalName: 123 })).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractOrganizationSnapshot({ ...snapshot, legalName: "" })).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractOrganizationSnapshot({ ...snapshot, address: null })).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractOrganizationSnapshot({ ...snapshot, address: { ...snapshot.address, extra: "x" } })).toEqual({
      ok: false,
      reason: "MALFORMED",
    });
  });

  it("never throws on hostile input", () => {
    expect(() => parseContractOrganizationSnapshot(undefined)).not.toThrow();
    expect(() => parseContractOrganizationSnapshot(42)).not.toThrow();
    expect(() => parseContractOrganizationSnapshot(() => {})).not.toThrow();
  });
});

describe("buildContractClientSnapshotV1 / parseContractClientSnapshot", () => {
  it("round-trips a full client", () => {
    const snapshot = buildContractClientSnapshotV1({
      billingLegalName: "Acme Client LLC",
      company: "Acme Client Co",
      name: "Acme Client",
      email: "billing@client.test",
      taxId: "98-7654321",
      streetAddress: "2 Oak Ave",
      city: "Metropolis",
      state: "NY",
      postalCode: "10001",
      country: "US",
    });
    expect(snapshot.billingName).toBe("Acme Client LLC");
    expect(parseContractClientSnapshot(snapshot)).toEqual({ ok: true, snapshot });
  });

  it("billingName fallback rule: billingLegalName ?? company ?? name", () => {
    const base = { email: null, taxId: null, streetAddress: null, city: null, state: null, postalCode: null, country: null };
    expect(buildContractClientSnapshotV1({ ...base, billingLegalName: null, company: null, name: "Fallback Name" }).billingName).toBe(
      "Fallback Name",
    );
    expect(buildContractClientSnapshotV1({ ...base, billingLegalName: null, company: "Fallback Co", name: "Ignored" }).billingName).toBe(
      "Fallback Co",
    );
    expect(buildContractClientSnapshotV1({ ...base, billingLegalName: "Fallback Legal", company: "Ignored Co", name: "Ignored" }).billingName).toBe(
      "Fallback Legal",
    );
  });

  it("rejects an unknown schemaVersion and malformed shapes", () => {
    const snapshot = buildContractClientSnapshotV1({
      billingLegalName: null,
      company: null,
      name: "Client",
      email: null,
      taxId: null,
      streetAddress: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
    });
    expect(parseContractClientSnapshot({ ...snapshot, schemaVersion: 99 })).toEqual({ ok: false, reason: "UNKNOWN_SCHEMA_VERSION" });
    expect(parseContractClientSnapshot({ ...snapshot, billingName: "" })).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractClientSnapshot({ ...snapshot, extra: 1 })).toEqual({ ok: false, reason: "MALFORMED" });
  });
});

describe("buildContractSignatorySnapshotV1 / parseContractSignatorySnapshot", () => {
  it("round-trips a full signatory", () => {
    const snapshot = buildContractSignatorySnapshotV1({ name: "Jane Doe", email: "jane@client.test", role: "CEO" });
    expect(parseContractSignatorySnapshot(snapshot)).toEqual({ ok: true, snapshot });
  });

  it("allows null email/role", () => {
    const snapshot = buildContractSignatorySnapshotV1({ name: "Jane Doe", email: null, role: null });
    expect(parseContractSignatorySnapshot(snapshot)).toEqual({ ok: true, snapshot });
  });

  it("rejects an unknown schemaVersion and malformed shapes", () => {
    const snapshot = buildContractSignatorySnapshotV1({ name: "Jane Doe", email: null, role: null });
    expect(parseContractSignatorySnapshot({ ...snapshot, schemaVersion: 0 })).toEqual({ ok: false, reason: "UNKNOWN_SCHEMA_VERSION" });
    expect(parseContractSignatorySnapshot({ ...snapshot, name: "" })).toEqual({ ok: false, reason: "MALFORMED" });
    expect(parseContractSignatorySnapshot({ ...snapshot, name: 5 })).toEqual({ ok: false, reason: "MALFORMED" });
  });
});
