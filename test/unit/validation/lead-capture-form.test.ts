import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseLeadCaptureFormMetadata, parsePublicLeadCaptureSubmission } from "@/lib/validation/lead-capture-form";
import { defaultLeadCaptureFormFieldsConfig, resolveLeadCaptureFormFieldsConfig } from "@/lib/lead-capture-forms/fields";

describe("parseLeadCaptureFormMetadata", () => {
  it("requires name and title", () => {
    const { fieldErrors } = parseLeadCaptureFormMetadata({ name: "", title: "" });
    expect(fieldErrors.name).toBeTruthy();
    expect(fieldErrors.title).toBeTruthy();
  });

  it("accepts a valid input, trims, and treats blank optional fields as null", () => {
    const { values, fieldErrors } = parseLeadCaptureFormMetadata({
      name: "  Website Form  ",
      title: "  Get in touch  ",
      description: "   ",
      successMessage: undefined,
    });
    expect(fieldErrors).toEqual({});
    expect(values).toEqual({ name: "Website Form", title: "Get in touch", description: null, successMessage: null });
  });

  it("rejects an over-length name/title/description/successMessage", () => {
    const { fieldErrors } = parseLeadCaptureFormMetadata({
      name: "a".repeat(201),
      title: "b".repeat(201),
      description: "c".repeat(2001),
      successMessage: "d".repeat(501),
    });
    expect(fieldErrors.name).toBeTruthy();
    expect(fieldErrors.title).toBeTruthy();
    expect(fieldErrors.description).toBeTruthy();
    expect(fieldErrors.successMessage).toBeTruthy();
  });
});

describe("parsePublicLeadCaptureSubmission", () => {
  const defaults = defaultLeadCaptureFormFieldsConfig();

  it("accepts a valid full submission", () => {
    const result = parsePublicLeadCaptureSubmission(
      { name: "Jane", company: "Acme", email: "jane@acme.test", phone: "555-0100", message: "Hi" },
      defaults,
    );
    expect(result).toEqual({
      ok: true,
      values: { name: "Jane", company: "Acme", email: "jane@acme.test", phone: "555-0100", message: "Hi" },
    });
  });

  it("requires name even with only the defaults applied", () => {
    const result = parsePublicLeadCaptureSubmission({ name: "" }, defaults);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.name).toBeTruthy();
  });

  it("enforces a required+visible field from the resolved config", () => {
    const withRequiredEmail = resolveLeadCaptureFormFieldsConfig({ email: { visible: true, required: true, order: 2, label: null } });
    const result = parsePublicLeadCaptureSubmission({ name: "Jane" }, withRequiredEmail);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.email).toBeTruthy();
  });

  it("never enforces a required field that is hidden", () => {
    const hiddenButRequired = resolveLeadCaptureFormFieldsConfig({ email: { visible: false, required: true, order: 2, label: null } });
    const result = parsePublicLeadCaptureSubmission({ name: "Jane" }, hiddenButRequired);
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed email when supplied", () => {
    const result = parsePublicLeadCaptureSubmission({ name: "Jane", email: "not-an-email" }, defaults);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.email).toBe("Enter a valid email address.");
  });

  it("does not require email/company/phone/message when the config leaves them optional", () => {
    const result = parsePublicLeadCaptureSubmission({ name: "Jane" }, defaults);
    expect(result.ok).toBe(true);
  });

  it("rejects an over-length field", () => {
    const result = parsePublicLeadCaptureSubmission({ name: "a".repeat(201) }, defaults);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.name).toBeTruthy();
  });
});
