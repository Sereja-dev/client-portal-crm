import { describe, expect, it } from "vitest";
import {
  BUG_ACTUAL_MAX_LENGTH,
  BUG_DESCRIPTION_MAX_LENGTH,
  BUG_EXPECTED_MAX_LENGTH,
  BUG_TITLE_MAX_LENGTH,
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_SUPPORT_MESSAGE_MAX_LENGTH,
  parseBugReport,
  parseStaffSupport,
  parseSubmissionId,
} from "@/lib/feedback-widget/validation";

const GOOD_SUPPORT = { subject: "Invoice question", message: "I cannot find where to change my invoice numbering." };
const GOOD_BUG = {
  title: "Save button does nothing",
  description: "Clicking Save on the client form does not save.",
  steps: "1. Open a client\n2. Edit the name\n3. Click Save",
};

describe("parseStaffSupport", () => {
  it("accepts a valid subject and message and trims them", () => {
    const result = parseStaffSupport({ subject: "  Invoice question  ", message: `  ${GOOD_SUPPORT.message}  `, submissionId: "abcdefgh-1234" });
    expect(result).toEqual({ ok: true, values: { subject: "Invoice question", message: GOOD_SUPPORT.message, submissionId: "abcdefgh-1234" } });
  });

  it("requires both fields", () => {
    const result = parseStaffSupport({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors).toEqual({ subject: "Subject is required.", message: "Message is required." });
  });

  it("bounds length on the server regardless of the form's maxLength attributes", () => {
    const result = parseStaffSupport({ subject: "x".repeat(FEEDBACK_SUBJECT_MAX_LENGTH + 1), message: "y".repeat(FEEDBACK_SUPPORT_MESSAGE_MAX_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.subject).toMatch(/120 characters or fewer/);
      expect(result.fieldErrors.message).toMatch(/4000 characters or fewer/);
    }
  });

  it("enforces minimum lengths (a one-word message is rejected)", () => {
    const result = parseStaffSupport({ subject: "ab", message: "too short" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.subject).toMatch(/at least 3/);
      expect(result.fieldErrors.message).toMatch(/at least 20/);
    }
  });

  it("rejects line breaks and control characters in the single-line subject (email header injection)", () => {
    for (const subject of ["Hello\r\nBcc: attacker@example.com", "Hello\nWorld", "Hello\u0000World", "tab\there"]) {
      const result = parseStaffSupport({ subject, message: GOOD_SUPPORT.message });
      expect(result.ok, JSON.stringify(subject)).toBe(false);
      if (!result.ok) expect(result.fieldErrors.subject).toMatch(/line breaks/);
    }
  });

  it("ignores non-string input instead of coercing it", () => {
    const result = parseStaffSupport({ subject: { toString: () => "Evil subject" }, message: ["a long enough message for sure, yes"] });
    expect(result.ok).toBe(false);
  });

  it("keeps newlines in the message, normalises CRLF and drops other control characters", () => {
    const result = parseStaffSupport({ subject: GOOD_SUPPORT.subject, message: "line one is here\r\nline two is here\u0007\u0000 done" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values.message).toBe("line one is here\nline two is here done");
  });

  it("only accepts a well-formed submission id, otherwise treats it as absent", () => {
    expect(parseSubmissionId("abcdefgh")).toBe("abcdefgh");
    expect(parseSubmissionId("short")).toBeNull();
    expect(parseSubmissionId("has spaces in it 123")).toBeNull();
    expect(parseSubmissionId("x".repeat(65))).toBeNull();
    expect(parseSubmissionId(undefined)).toBeNull();
    expect(parseStaffSupport({ ...GOOD_SUPPORT, submissionId: "bad id!" })).toMatchObject({ ok: true, values: { submissionId: null } });
  });
});

describe("parseBugReport", () => {
  it("accepts the required fields; expected/actual are optional and default to empty", () => {
    const result = parseBugReport(GOOD_BUG);
    expect(result).toEqual({
      ok: true,
      values: { title: GOOD_BUG.title, description: GOOD_BUG.description, steps: GOOD_BUG.steps, expected: "", actual: "", submissionId: null },
    });
  });

  it("requires title, description and steps", () => {
    const result = parseBugReport({ expected: "x", actual: "y" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.title).toBe("Title is required.");
      expect(result.fieldErrors.description).toBe("Description is required.");
      expect(result.fieldErrors.steps).toBe("Steps to reproduce is required.");
    }
  });

  it("bounds every field, including the optional ones", () => {
    const result = parseBugReport({
      title: "t".repeat(BUG_TITLE_MAX_LENGTH + 1),
      description: "d".repeat(BUG_DESCRIPTION_MAX_LENGTH + 1),
      steps: "s".repeat(BUG_DESCRIPTION_MAX_LENGTH + 1),
      expected: "e".repeat(BUG_EXPECTED_MAX_LENGTH + 1),
      actual: "a".repeat(BUG_ACTUAL_MAX_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors).sort()).toEqual(["actual", "description", "expected", "steps", "title"]);
  });

  it("rejects header-injection characters in the title", () => {
    const result = parseBugReport({ ...GOOD_BUG, title: "Broken\r\nSubject: spoofed" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.title).toMatch(/line breaks/);
  });

  it("does not require expected/actual but still accepts them when valid", () => {
    const result = parseBugReport({ ...GOOD_BUG, expected: "It saves.", actual: "Nothing happens." });
    expect(result).toMatchObject({ ok: true, values: { expected: "It saves.", actual: "Nothing happens." } });
  });
});
