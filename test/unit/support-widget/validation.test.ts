import { describe, expect, it } from "vitest";
import {
  parseSupportMessageSubmission,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_MESSAGE_MIN_LENGTH,
} from "@/lib/support-widget/validation";

const VALID = {
  email: "visitor@example.com",
  issueType: "cant-sign-in",
  message: "I tried logging in three times and keep getting an error message.",
};

describe("parseSupportMessageSubmission", () => {
  it("accepts a fully valid submission", () => {
    const result = parseSupportMessageSubmission(VALID);
    expect(result).toEqual({
      ok: true,
      values: { email: VALID.email, issueType: "cant-sign-in", message: VALID.message },
    });
  });

  it("trims whitespace from every field", () => {
    const result = parseSupportMessageSubmission({
      email: "  visitor@example.com  ",
      issueType: "  cant-sign-in  ",
      message: `  ${VALID.message}  `,
    });
    expect(result).toEqual({ ok: true, values: { email: "visitor@example.com", issueType: "cant-sign-in", message: VALID.message } });
  });

  describe("missing fields", () => {
    it("rejects a missing email", () => {
      const result = parseSupportMessageSubmission({ ...VALID, email: undefined });
      expect(result.ok).toBe(false);
      expect((result as { fieldErrors: Record<string, string> }).fieldErrors.email).toBeDefined();
    });

    it("rejects a missing issueType", () => {
      const result = parseSupportMessageSubmission({ ...VALID, issueType: undefined });
      expect(result.ok).toBe(false);
      expect((result as { fieldErrors: Record<string, string> }).fieldErrors.issueType).toBeDefined();
    });

    it("rejects a missing message", () => {
      const result = parseSupportMessageSubmission({ ...VALID, message: undefined });
      expect(result.ok).toBe(false);
      expect((result as { fieldErrors: Record<string, string> }).fieldErrors.message).toBeDefined();
    });

    it("rejects an empty-string email (not merely absent)", () => {
      const result = parseSupportMessageSubmission({ ...VALID, email: "" });
      expect(result.ok).toBe(false);
    });

    it("rejects a whitespace-only message", () => {
      const result = parseSupportMessageSubmission({ ...VALID, message: "    " });
      expect(result.ok).toBe(false);
    });
  });

  describe("invalid email", () => {
    it("rejects a structurally malformed address", () => {
      const result = parseSupportMessageSubmission({ ...VALID, email: "not-an-email" });
      expect(result.ok).toBe(false);
      expect((result as { fieldErrors: Record<string, string> }).fieldErrors.email).toBeDefined();
    });

    it("rejects a comma-separated address list", () => {
      const result = parseSupportMessageSubmission({ ...VALID, email: "visitor@example.com,second@example.com" });
      expect(result.ok).toBe(false);
    });

    it("rejects a 'Display Name <addr>' wrapper", () => {
      const result = parseSupportMessageSubmission({ ...VALID, email: "Visitor <visitor@example.com>" });
      expect(result.ok).toBe(false);
    });

    it("rejects header injection (CRLF)", () => {
      const result = parseSupportMessageSubmission({ ...VALID, email: "visitor@example.com\r\nBcc: evil@example.com" });
      expect(result.ok).toBe(false);
    });

    it("rejects an overlong email", () => {
      const localPart = "a".repeat(260);
      const result = parseSupportMessageSubmission({ ...VALID, email: `${localPart}@example.com` });
      expect(result.ok).toBe(false);
    });
  });

  describe("issue type allowlist", () => {
    it("accepts all three allowed values", () => {
      for (const issueType of ["cant-sign-up", "cant-sign-in", "other"]) {
        const result = parseSupportMessageSubmission({ ...VALID, issueType });
        expect(result.ok).toBe(true);
      }
    });

    it("rejects an unknown category", () => {
      const result = parseSupportMessageSubmission({ ...VALID, issueType: "billing-question" });
      expect(result.ok).toBe(false);
      expect((result as { fieldErrors: Record<string, string> }).fieldErrors.issueType).toBeDefined();
    });

    it("rejects a category that merely looks close to a real one (case-sensitive, exact match only)", () => {
      const result = parseSupportMessageSubmission({ ...VALID, issueType: "Cant-Sign-In" });
      expect(result.ok).toBe(false);
    });
  });

  describe("message length bounds", () => {
    it(`rejects a message shorter than ${SUPPORT_MESSAGE_MIN_LENGTH} characters`, () => {
      const result = parseSupportMessageSubmission({ ...VALID, message: "too short" });
      expect(result.ok).toBe(false);
    });

    it(`accepts a message at exactly ${SUPPORT_MESSAGE_MIN_LENGTH} characters`, () => {
      const result = parseSupportMessageSubmission({ ...VALID, message: "a".repeat(SUPPORT_MESSAGE_MIN_LENGTH) });
      expect(result.ok).toBe(true);
    });

    it(`accepts a message at exactly ${SUPPORT_MESSAGE_MAX_LENGTH} characters`, () => {
      const result = parseSupportMessageSubmission({ ...VALID, message: "a".repeat(SUPPORT_MESSAGE_MAX_LENGTH) });
      expect(result.ok).toBe(true);
    });

    it(`rejects a message one character past ${SUPPORT_MESSAGE_MAX_LENGTH} characters`, () => {
      const result = parseSupportMessageSubmission({ ...VALID, message: "a".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 1) });
      expect(result.ok).toBe(false);
    });
  });

  describe("bounded against unexpected FormData shapes", () => {
    it("treats a non-string value (e.g. a File) as empty, never throws", () => {
      const fakeFile = { name: "x.txt" } as unknown;
      expect(() => parseSupportMessageSubmission({ ...VALID, email: fakeFile })).not.toThrow();
      const result = parseSupportMessageSubmission({ ...VALID, email: fakeFile });
      expect(result.ok).toBe(false);
    });

    it("treats a number value as empty, never throws", () => {
      expect(() => parseSupportMessageSubmission({ ...VALID, message: 12345 })).not.toThrow();
      expect(parseSupportMessageSubmission({ ...VALID, message: 12345 }).ok).toBe(false);
    });

    it("handles a very large individual value without throwing, and rejects it on length", () => {
      const huge = "a".repeat(100_000);
      expect(() => parseSupportMessageSubmission({ ...VALID, message: huge })).not.toThrow();
      expect(parseSupportMessageSubmission({ ...VALID, message: huge }).ok).toBe(false);
    });

    it("never throws on null/undefined input object fields", () => {
      expect(() => parseSupportMessageSubmission({ email: null, issueType: null, message: null })).not.toThrow();
    });
  });
});
