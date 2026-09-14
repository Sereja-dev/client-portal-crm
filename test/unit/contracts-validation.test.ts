import { describe, expect, it } from "vitest";
import {
  parseContractInput,
  hasContractFormErrors,
  parseContractInternalNotes,
  CONTRACT_NUMBER_MAX_LENGTH,
  CONTRACT_TITLE_MAX_LENGTH,
  CONTRACT_BODY_MAX_LENGTH,
  CONTRACT_INTERNAL_NOTES_MAX_LENGTH,
  type ContractWritableInput,
} from "@/lib/contracts/validation";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

function baseInput(overrides: Partial<ContractWritableInput> = {}): ContractWritableInput {
  return {
    contractNumber: "C-0001",
    title: "Master Services Agreement",
    body: "This agreement is entered into by and between the parties.",
    clientId: VALID_UUID,
    issueDate: "2026-06-01",
    ...overrides,
  };
}

describe("parseContractInput — required fields", () => {
  it("accepts a fully valid minimal input", () => {
    const { fieldErrors } = parseContractInput(baseInput());
    expect(hasContractFormErrors(fieldErrors)).toBe(false);
  });

  it("rejects a blank contractNumber", () => {
    const { fieldErrors } = parseContractInput(baseInput({ contractNumber: "   " }));
    expect(fieldErrors.contractNumber).toBeDefined();
  });

  it("rejects a contractNumber over the max length", () => {
    const { fieldErrors } = parseContractInput(baseInput({ contractNumber: "C".repeat(CONTRACT_NUMBER_MAX_LENGTH + 1) }));
    expect(fieldErrors.contractNumber).toBeDefined();
  });

  it("accepts a contractNumber at exactly the max length", () => {
    const { fieldErrors } = parseContractInput(baseInput({ contractNumber: "C".repeat(CONTRACT_NUMBER_MAX_LENGTH) }));
    expect(fieldErrors.contractNumber).toBeUndefined();
  });

  it("trims contractNumber", () => {
    const { values } = parseContractInput(baseInput({ contractNumber: "  C-0099  " }));
    expect(values.contractNumber).toBe("C-0099");
  });

  it("rejects a blank title", () => {
    const { fieldErrors } = parseContractInput(baseInput({ title: "" }));
    expect(fieldErrors.title).toBeDefined();
  });

  it("rejects a title over the max length", () => {
    const { fieldErrors } = parseContractInput(baseInput({ title: "T".repeat(CONTRACT_TITLE_MAX_LENGTH + 1) }));
    expect(fieldErrors.title).toBeDefined();
  });

  it("rejects a blank body (including whitespace-only)", () => {
    expect(parseContractInput(baseInput({ body: "" })).fieldErrors.body).toBeDefined();
    expect(parseContractInput(baseInput({ body: "   \n  " })).fieldErrors.body).toBeDefined();
  });

  it("rejects a body over the max length", () => {
    const { fieldErrors } = parseContractInput(baseInput({ body: "x".repeat(CONTRACT_BODY_MAX_LENGTH + 1) }));
    expect(fieldErrors.body).toBeDefined();
  });

  it("stores the body untrimmed (leading/trailing whitespace is the author's own content)", () => {
    const { values } = parseContractInput(baseInput({ body: "  Clause one.  " }));
    expect(values.body).toBe("  Clause one.  ");
  });

  it("rejects a missing/blank clientId", () => {
    expect(parseContractInput(baseInput({ clientId: "" })).fieldErrors.clientId).toBeDefined();
  });

  it("rejects a malformed clientId", () => {
    expect(parseContractInput(baseInput({ clientId: "not-a-uuid" })).fieldErrors.clientId).toBeDefined();
  });

  it("rejects a missing/invalid issueDate", () => {
    expect(parseContractInput(baseInput({ issueDate: "" })).fieldErrors.issueDate).toBeDefined();
    expect(parseContractInput(baseInput({ issueDate: "not-a-date" })).fieldErrors.issueDate).toBeDefined();
  });
});

describe("parseContractInput — optional fields", () => {
  it("projectId/signatoryContactId default to null when omitted", () => {
    const { values } = parseContractInput(baseInput());
    expect(values.projectId).toBeNull();
    expect(values.signatoryContactId).toBeNull();
  });

  it("rejects a malformed projectId", () => {
    expect(parseContractInput(baseInput({ projectId: "nope" })).fieldErrors.projectId).toBeDefined();
  });

  it("rejects a malformed signatoryContactId", () => {
    expect(parseContractInput(baseInput({ signatoryContactId: "nope" })).fieldErrors.signatoryContactId).toBeDefined();
  });

  it("accepts a well-formed projectId/signatoryContactId", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const { values, fieldErrors } = parseContractInput(baseInput({ projectId: other, signatoryContactId: other }));
    expect(hasContractFormErrors(fieldErrors)).toBe(false);
    expect(values.projectId).toBe(other);
    expect(values.signatoryContactId).toBe(other);
  });
});

describe("parseContractInput — chronology", () => {
  it("accepts effectiveDate strictly after issueDate", () => {
    const { fieldErrors } = parseContractInput(baseInput({ issueDate: "2026-06-01", effectiveDate: "2026-06-02" }));
    expect(fieldErrors.effectiveDate).toBeUndefined();
  });

  it("accepts effectiveDate equal to issueDate", () => {
    const { fieldErrors } = parseContractInput(baseInput({ issueDate: "2026-06-01", effectiveDate: "2026-06-01" }));
    expect(fieldErrors.effectiveDate).toBeUndefined();
  });

  it("rejects effectiveDate before issueDate", () => {
    const { fieldErrors } = parseContractInput(baseInput({ issueDate: "2026-06-01", effectiveDate: "2026-05-31" }));
    expect(fieldErrors.effectiveDate).toBeDefined();
  });

  it("rejects an invalid effectiveDate string", () => {
    expect(parseContractInput(baseInput({ effectiveDate: "garbage" })).fieldErrors.effectiveDate).toBeDefined();
  });

  it("rejects expiresAt equal to issueDate when no effectiveDate is set", () => {
    const { fieldErrors } = parseContractInput(baseInput({ issueDate: "2026-06-01", expiresAt: "2026-06-01" }));
    expect(fieldErrors.expiresAt).toBeDefined();
  });

  it("rejects expiresAt before issueDate when no effectiveDate is set", () => {
    const { fieldErrors } = parseContractInput(baseInput({ issueDate: "2026-06-01", expiresAt: "2026-05-01" }));
    expect(fieldErrors.expiresAt).toBeDefined();
  });

  it("accepts expiresAt strictly after issueDate when no effectiveDate is set", () => {
    const { fieldErrors } = parseContractInput(baseInput({ issueDate: "2026-06-01", expiresAt: "2026-06-02" }));
    expect(fieldErrors.expiresAt).toBeUndefined();
  });

  it("rejects expiresAt equal to or before effectiveDate when effectiveDate is set, even if after issueDate", () => {
    const { fieldErrors } = parseContractInput(
      baseInput({ issueDate: "2026-06-01", effectiveDate: "2026-06-10", expiresAt: "2026-06-05" }),
    );
    expect(fieldErrors.expiresAt).toBeDefined();
  });

  it("accepts expiresAt strictly after effectiveDate", () => {
    const { fieldErrors } = parseContractInput(
      baseInput({ issueDate: "2026-06-01", effectiveDate: "2026-06-10", expiresAt: "2026-06-11" }),
    );
    expect(fieldErrors.expiresAt).toBeUndefined();
  });

  it("rejects an invalid expiresAt string", () => {
    expect(parseContractInput(baseInput({ expiresAt: "garbage" })).fieldErrors.expiresAt).toBeDefined();
  });
});

describe("parseContractInternalNotes", () => {
  it("accepts a blank/omitted value as null", () => {
    expect(parseContractInternalNotes(undefined)).toEqual({ ok: true, value: null });
    expect(parseContractInternalNotes("")).toEqual({ ok: true, value: null });
    expect(parseContractInternalNotes("   ")).toEqual({ ok: true, value: null });
  });

  it("trims and accepts a normal value", () => {
    expect(parseContractInternalNotes("  Call the client before sending.  ")).toEqual({
      ok: true,
      value: "Call the client before sending.",
    });
  });

  it("rejects a value over the max length", () => {
    const result = parseContractInternalNotes("n".repeat(CONTRACT_INTERNAL_NOTES_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
  });

  it("accepts a value at exactly the max length", () => {
    const result = parseContractInternalNotes("n".repeat(CONTRACT_INTERNAL_NOTES_MAX_LENGTH));
    expect(result.ok).toBe(true);
  });
});
