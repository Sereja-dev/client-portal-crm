import { describe, expect, it } from "vitest";
import {
  parseClientContactForm,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  CONTACT_ROLE_MAX_LENGTH,
} from "@/lib/validation/client-contact";

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

describe("parseClientContactForm", () => {
  it("trims name and requires it", () => {
    const { values, fieldErrors } = parseClientContactForm(buildFormData({ name: "  Jane Smith  " }));
    expect(values.name).toBe("Jane Smith");
    expect(fieldErrors.name).toBeUndefined();
  });

  it("rejects a missing/blank name", () => {
    expect(parseClientContactForm(buildFormData({ name: "" })).fieldErrors.name).toBe("Name is required.");
    expect(parseClientContactForm(buildFormData({ name: "   " })).fieldErrors.name).toBe("Name is required.");
  });

  it("rejects a name over the max length", () => {
    const { fieldErrors } = parseClientContactForm(buildFormData({ name: "x".repeat(CONTACT_NAME_MAX_LENGTH + 1) }));
    expect(fieldErrors.name).toContain(String(CONTACT_NAME_MAX_LENGTH));
  });

  it("email/phone/role are all optional — empty submissions produce null, not errors", () => {
    const { values, fieldErrors } = parseClientContactForm(buildFormData({ name: "Jane" }));
    expect(values.email).toBeNull();
    expect(values.phone).toBeNull();
    expect(values.role).toBeNull();
    expect(fieldErrors).toEqual({});
  });

  it("validates email format only when a value is present", () => {
    expect(
      parseClientContactForm(buildFormData({ name: "Jane", email: "not-an-email" })).fieldErrors.email,
    ).toBe("Enter a valid email address.");
    expect(
      parseClientContactForm(buildFormData({ name: "Jane", email: "jane@example.com" })).fieldErrors.email,
    ).toBeUndefined();
  });

  it("rejects an email over the max length", () => {
    const longEmail = `${"x".repeat(CONTACT_EMAIL_MAX_LENGTH)}@example.com`;
    const { fieldErrors } = parseClientContactForm(buildFormData({ name: "Jane", email: longEmail }));
    expect(fieldErrors.email).toContain(String(CONTACT_EMAIL_MAX_LENGTH));
  });

  it("phone has no format validation, only a max length — matches Client.phone's own convention", () => {
    const { values, fieldErrors } = parseClientContactForm(
      buildFormData({ name: "Jane", phone: "not a real phone!!" }),
    );
    expect(values.phone).toBe("not a real phone!!");
    expect(fieldErrors.phone).toBeUndefined();
  });

  it("rejects a phone over the max length", () => {
    const { fieldErrors } = parseClientContactForm(
      buildFormData({ name: "Jane", phone: "1".repeat(CONTACT_PHONE_MAX_LENGTH + 1) }),
    );
    expect(fieldErrors.phone).toContain(String(CONTACT_PHONE_MAX_LENGTH));
  });

  it("trims role, and rejects one over the max length", () => {
    const { values } = parseClientContactForm(buildFormData({ name: "Jane", role: "  Owner  " }));
    expect(values.role).toBe("Owner");

    const { fieldErrors } = parseClientContactForm(
      buildFormData({ name: "Jane", role: "x".repeat(CONTACT_ROLE_MAX_LENGTH + 1) }),
    );
    expect(fieldErrors.role).toContain(String(CONTACT_ROLE_MAX_LENGTH));
  });

  it("isPrimary/isBilling parse from the checkbox 'on' convention, default false when absent", () => {
    const unchecked = parseClientContactForm(buildFormData({ name: "Jane" }));
    expect(unchecked.values.isPrimary).toBe(false);
    expect(unchecked.values.isBilling).toBe(false);

    const checked = parseClientContactForm(buildFormData({ name: "Jane", isPrimary: "on", isBilling: "on" }));
    expect(checked.values.isPrimary).toBe(true);
    expect(checked.values.isBilling).toBe(true);
  });
});
