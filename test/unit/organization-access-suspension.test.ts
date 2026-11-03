import { describe, expect, it } from "vitest";
import { isOrganizationSuspended, ORGANIZATION_UNAVAILABLE_PATH } from "@/lib/organization-access";

describe("isOrganizationSuspended", () => {
  it("is false for suspendedAt: null (every existing organization before this PR)", () => {
    expect(isOrganizationSuspended({ suspendedAt: null })).toBe(false);
  });

  it("is true for any non-null suspendedAt", () => {
    expect(isOrganizationSuspended({ suspendedAt: new Date() })).toBe(true);
    expect(isOrganizationSuspended({ suspendedAt: new Date(0) })).toBe(true);
  });

  it("is true for a missing organization (null/undefined): unusable, never a TypeError", () => {
    expect(isOrganizationSuspended(null)).toBe(true);
    expect(isOrganizationSuspended(undefined)).toBe(true);
  });
});

describe("ORGANIZATION_UNAVAILABLE_PATH", () => {
  it("is the exact fixed route the design and the page itself agree on", () => {
    expect(ORGANIZATION_UNAVAILABLE_PATH).toBe("/organization-unavailable");
  });
});
