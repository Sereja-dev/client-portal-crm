import { describe, expect, it, vi } from "vitest";

// company-profile-form.tsx imports its own Server Action directly
// (./actions, "use server") rather than receiving it as a prop — a
// pre-existing architectural difference from Invoice/Recurring
// Invoice/Quote's own forms, unrelated to this slice. Outside the real
// Next.js build (which replaces a Server Action reference at the
// client/server boundary), that import chain reaches a `server-only`-
// guarded module and throws the instant this file is evaluated in
// Vitest. Mocking the action module here — never touched or modified
// in production — is the narrow, test-only accommodation that keeps
// this file importable without changing CompanyProfileForm's own
// existing module structure.
vi.mock("@/app/(dashboard)/settings/company/actions", () => ({
  updateCompanyProfileAction: vi.fn(),
}));

const { buildCompanyProfileDirtySnapshot } = await import("@/app/(dashboard)/settings/company/company-profile-form");

/**
 * Forms Improvement Slice C1b — focused coverage for
 * `buildCompanyProfileDirtySnapshot`, the one normalization function
 * CompanyProfileForm's own dirty-state comparison is built from. This
 * is deliberately NOT validation coverage (see the function's own doc
 * comment): an invalid-but-currently-typed value still normalizes to a
 * real string and still counts as current state.
 */

const BASE_RAW = {
  legalName: "Acme Legal Name LLC",
  displayName: "Acme",
  country: "United States",
  currency: "usd",
  timezone: "America/New_York",
  supportEmail: "support@acme.com",
  website: "https://acme.com",
  phone: "+1 555-0100",
  taxId: "EU123456789",
  brandColor: "#0F172A",
  streetAddress: "123 Main St",
  city: "Springfield",
  state: "IL",
  postalCode: "62704",
};

describe("buildCompanyProfileDirtySnapshot — required-field trimming", () => {
  it("trims leading/trailing whitespace on every required field", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({
      ...BASE_RAW,
      legalName: "  Acme Legal Name LLC  ",
      displayName: "  Acme  ",
      country: "  United States  ",
      timezone: "  America/New_York  ",
    });
    expect(snapshot.legalName).toBe("Acme Legal Name LLC");
    expect(snapshot.displayName).toBe("Acme");
    expect(snapshot.country).toBe("United States");
    expect(snapshot.timezone).toBe("America/New_York");
  });

  it("a missing/undefined required field normalizes to an empty string, never 'undefined'", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, legalName: undefined, displayName: null });
    expect(snapshot.legalName).toBe("");
    expect(snapshot.displayName).toBe("");
  });
});

describe("buildCompanyProfileDirtySnapshot — currency uppercasing", () => {
  it("trims and uppercases the currency code", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, currency: "  eur  " });
    expect(snapshot.currency).toBe("EUR");
  });

  it("an already-uppercase currency is unaffected", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, currency: "GBP" });
    expect(snapshot.currency).toBe("GBP");
  });
});

describe("buildCompanyProfileDirtySnapshot — optional-field empty/null normalization", () => {
  it("an empty string on an optional field normalizes to null, mirroring parseCompanyProfileForm's own trimmedOrNull", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, supportEmail: "", website: "" });
    expect(snapshot.supportEmail).toBeNull();
    expect(snapshot.website).toBeNull();
  });

  it("a whitespace-only optional field also normalizes to null, not a string of spaces", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, phone: "   ", taxId: "\t\n " });
    expect(snapshot.phone).toBeNull();
    expect(snapshot.taxId).toBeNull();
  });

  it("an undefined/missing optional field also normalizes to null", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, brandColor: undefined, streetAddress: null });
    expect(snapshot.brandColor).toBeNull();
    expect(snapshot.streetAddress).toBeNull();
  });

  it("a genuine optional value is trimmed but otherwise preserved", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, city: "  Springfield  " });
    expect(snapshot.city).toBe("Springfield");
  });

  it("an invalid-but-typed optional value (malformed brand color) still normalizes to a real string, never rejected — this helper performs no validation", () => {
    const snapshot = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, brandColor: "not-a-color" });
    expect(snapshot.brandColor).toBe("not-a-color");
  });
});

describe("buildCompanyProfileDirtySnapshot — deterministic exact field set", () => {
  it("produces exactly the 14 submitted Company Profile fields, no more, no fewer", () => {
    const snapshot = buildCompanyProfileDirtySnapshot(BASE_RAW);
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "brandColor",
        "city",
        "country",
        "currency",
        "displayName",
        "legalName",
        "phone",
        "postalCode",
        "state",
        "streetAddress",
        "supportEmail",
        "taxId",
        "timezone",
        "website",
      ].sort(),
    );
  });
});

describe("buildCompanyProfileDirtySnapshot — semantic equality for comparison purposes", () => {
  it("two FormData-shaped payloads that differ only in incidental whitespace/case normalize to the exact same snapshot", () => {
    const a = buildCompanyProfileDirtySnapshot(BASE_RAW);
    const b = buildCompanyProfileDirtySnapshot({
      ...BASE_RAW,
      legalName: " Acme Legal Name LLC ",
      currency: "USD",
      city: "  Springfield",
    });
    expect(a).toEqual(b);
  });

  it("a genuine semantic difference in a required field normalizes to a different snapshot", () => {
    const a = buildCompanyProfileDirtySnapshot(BASE_RAW);
    const b = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, legalName: "A Different Legal Name" });
    expect(a).not.toEqual(b);
  });

  it("a genuine semantic difference in an optional field (set vs. cleared) normalizes to a different snapshot", () => {
    const a = buildCompanyProfileDirtySnapshot(BASE_RAW);
    const b = buildCompanyProfileDirtySnapshot({ ...BASE_RAW, website: "" });
    expect(a).not.toEqual(b);
  });
});
