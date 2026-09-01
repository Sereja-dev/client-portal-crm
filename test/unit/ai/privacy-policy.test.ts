import { describe, expect, it } from "vitest";
import { AI_FORBIDDEN_FIELD_POLICY, isForbiddenFieldName, getForbiddenFieldCategories } from "@/lib/ai/privacy-policy";

const REQUIRED_CATEGORIES = [
  "banking-payment",
  "billing-provider-identifiers",
  "storage-paths",
  "raw-activity-internals",
  "auth-session-material",
  "platform-admin-data",
  "webhook-provider-payloads",
  "raw-internal-ids",
];

describe("AI_FORBIDDEN_FIELD_POLICY", () => {
  it("contains every approved high-risk category from the architecture plan", () => {
    const categories = getForbiddenFieldCategories();
    for (const required of REQUIRED_CATEGORIES) {
      expect(categories).toContain(required);
    }
  });

  it("every rule has a non-empty explanatory note", () => {
    for (const rule of AI_FORBIDDEN_FIELD_POLICY) {
      expect(rule.note.length).toBeGreaterThan(0);
    }
  });
});

describe("isForbiddenFieldName", () => {
  it("flags every OrganizationPaymentDetails banking field", () => {
    for (const field of ["bankName", "accountHolder", "accountNumber", "swiftBic", "paymentInstructions"]) {
      expect(isForbiddenFieldName(field)).toBe(true);
    }
  });

  it("flags billing-provider identifiers", () => {
    expect(isForbiddenFieldName("providerCustomerId")).toBe(true);
    expect(isForbiddenFieldName("providerSubscriptionId")).toBe(true);
  });

  it("flags storage paths", () => {
    expect(isForbiddenFieldName("pdfStoragePath")).toBe(true);
    expect(isForbiddenFieldName("storagePath")).toBe(true);
  });

  it("flags raw Activity internals", () => {
    expect(isForbiddenFieldName("metadata")).toBe(true);
    expect(isForbiddenFieldName("entityId")).toBe(true);
  });

  it("does not flag an ordinary safe field name", () => {
    expect(isForbiddenFieldName("name")).toBe(false);
    expect(isForbiddenFieldName("status")).toBe(false);
    expect(isForbiddenFieldName("createdAt")).toBe(false);
  });
});
