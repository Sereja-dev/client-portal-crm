import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  defaultLeadCaptureFormFieldsConfig,
  resolveLeadCaptureFormFieldsConfig,
  buildPublicLeadCaptureFormFields,
  validateLeadCaptureFormFieldsConfigInput,
} from "@/lib/lead-capture-forms/fields";

describe("defaultLeadCaptureFormFieldsConfig", () => {
  it("returns every V1 field key, name visible+required, the rest visible+optional, in order", () => {
    const config = defaultLeadCaptureFormFieldsConfig();
    expect(config.name).toEqual({ visible: true, required: true, order: 0, label: null });
    expect(config.company).toEqual({ visible: true, required: false, order: 1, label: null });
    expect(config.email).toEqual({ visible: true, required: false, order: 2, label: null });
    expect(config.phone).toEqual({ visible: true, required: false, order: 3, label: null });
    expect(config.message).toEqual({ visible: true, required: false, order: 4, label: null });
  });

  it("returns a fresh object each call — never a shared mutable reference", () => {
    const first = defaultLeadCaptureFormFieldsConfig();
    first.name.required = false;
    const second = defaultLeadCaptureFormFieldsConfig();
    expect(second.name.required).toBe(true);
  });
});

describe("resolveLeadCaptureFormFieldsConfig", () => {
  it("fills in a missing key with its own default entry", () => {
    const resolved = resolveLeadCaptureFormFieldsConfig({ email: { visible: false, required: false, order: 2, label: "Work email" } });
    expect(resolved.email).toEqual({ visible: false, required: false, order: 2, label: "Work email" });
    expect(resolved.company).toEqual({ visible: true, required: false, order: 1, label: null });
  });

  it("forces name to visible+required true even if the stored config says otherwise", () => {
    const resolved = resolveLeadCaptureFormFieldsConfig({ name: { visible: false, required: false, order: 0, label: null } });
    expect(resolved.name.visible).toBe(true);
    expect(resolved.name.required).toBe(true);
  });
});

describe("buildPublicLeadCaptureFormFields", () => {
  it("includes only visible fields, sorted by order, with default labels", () => {
    const fields = buildPublicLeadCaptureFormFields({});
    expect(fields).toEqual([
      { key: "name", label: "Name", required: true },
      { key: "company", label: "Company", required: false },
      { key: "email", label: "Email", required: false },
      { key: "phone", label: "Phone", required: false },
      { key: "message", label: "Message", required: false },
    ]);
  });

  it("excludes a hidden field entirely", () => {
    const fields = buildPublicLeadCaptureFormFields({ phone: { visible: false, required: false, order: 3, label: null } });
    expect(fields.map((f) => f.key)).not.toContain("phone");
  });

  it("respects a custom order and a label override", () => {
    const fields = buildPublicLeadCaptureFormFields({
      email: { visible: true, required: true, order: 0, label: "Work email" },
      name: { visible: true, required: true, order: 1, label: null },
    });
    expect(fields[0]).toEqual({ key: "email", label: "Work email", required: true });
    expect(fields[1]).toEqual({ key: "name", label: "Name", required: true });
  });
});

describe("validateLeadCaptureFormFieldsConfigInput", () => {
  it("accepts undefined/null as an empty config", () => {
    expect(validateLeadCaptureFormFieldsConfigInput(undefined)).toEqual({ ok: true, config: {} });
    expect(validateLeadCaptureFormFieldsConfigInput(null)).toEqual({ ok: true, config: {} });
  });

  it("rejects a non-object input", () => {
    expect(validateLeadCaptureFormFieldsConfigInput("nope")).toEqual({ ok: false, error: expect.any(String) });
    expect(validateLeadCaptureFormFieldsConfigInput([1, 2, 3])).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects an unknown field key", () => {
    const result = validateLeadCaptureFormFieldsConfigInput({ budget: { visible: true } });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong-typed sub-fields", () => {
    expect(validateLeadCaptureFormFieldsConfigInput({ email: { visible: "yes" } }).ok).toBe(false);
    expect(validateLeadCaptureFormFieldsConfigInput({ email: { required: "yes" } }).ok).toBe(false);
    expect(validateLeadCaptureFormFieldsConfigInput({ email: { order: -1 } }).ok).toBe(false);
    expect(validateLeadCaptureFormFieldsConfigInput({ email: { order: 1.5 } }).ok).toBe(false);
    expect(validateLeadCaptureFormFieldsConfigInput({ email: { label: 42 } }).ok).toBe(false);
  });

  it("accepts a valid partial entry and fills its own omitted sub-fields from that key's default", () => {
    const result = validateLeadCaptureFormFieldsConfigInput({ email: { required: true } });
    expect(result).toEqual({ ok: true, config: { email: { visible: true, required: true, order: 2, label: null } } });
  });

  it("treats a blank label as null (use the default label)", () => {
    const result = validateLeadCaptureFormFieldsConfigInput({ phone: { label: "   " } });
    expect(result).toEqual({ ok: true, config: { phone: { visible: true, required: false, order: 3, label: null } } });
  });
});
