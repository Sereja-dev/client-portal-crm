import { describe, expect, it } from "vitest";
import { validateAiAssistantRequestBody } from "@/lib/ai/request-schema";
import { MAX_USER_MESSAGE_CHARS } from "@/lib/ai/orchestration-limits";

describe("validateAiAssistantRequestBody", () => {
  it("accepts a simple valid message", () => {
    expect(validateAiAssistantRequestBody({ message: "How many clients do we have?" })).toEqual({
      message: "How many clients do we have?",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validateAiAssistantRequestBody({ message: "  hello there  " })).toEqual({ message: "hello there" });
  });

  it("accepts a message at exactly MAX_USER_MESSAGE_CHARS", () => {
    const message = "a".repeat(MAX_USER_MESSAGE_CHARS);
    expect(validateAiAssistantRequestBody({ message })).toEqual({ message });
  });

  it("rejects a message one character over MAX_USER_MESSAGE_CHARS, measured BEFORE trim", () => {
    const message = "a".repeat(MAX_USER_MESSAGE_CHARS + 1);
    expect(validateAiAssistantRequestBody({ message })).toBeNull();
  });

  it("rejects padding-past-the-limit: a message under the limit only after trimming still fails on raw length", () => {
    const padded = " ".repeat(MAX_USER_MESSAGE_CHARS) + "real content" + " ".repeat(MAX_USER_MESSAGE_CHARS);
    expect(validateAiAssistantRequestBody({ message: padded })).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(validateAiAssistantRequestBody({ message: "" })).toBeNull();
  });

  it("rejects a whitespace-only message (empty after trim)", () => {
    expect(validateAiAssistantRequestBody({ message: "   \n\t  " })).toBeNull();
  });

  it("rejects a non-string message", () => {
    for (const bad of [123, true, null, undefined, {}, [], []]) {
      expect(validateAiAssistantRequestBody({ message: bad })).toBeNull();
    }
  });

  it("rejects a non-object body", () => {
    for (const bad of [null, undefined, "a string", 42, true, ["array"]]) {
      expect(validateAiAssistantRequestBody(bad)).toBeNull();
    }
  });

  it("rejects a missing message key entirely", () => {
    expect(validateAiAssistantRequestBody({})).toBeNull();
  });

  it("rejects an unknown extra key alongside a valid message", () => {
    expect(validateAiAssistantRequestBody({ message: "hi", extra: "x" })).toBeNull();
  });

  it("rejects organizationId", () => {
    expect(validateAiAssistantRequestBody({ message: "hi", organizationId: "11111111-1111-1111-1111-111111111111" })).toBeNull();
  });

  it("rejects userId", () => {
    expect(validateAiAssistantRequestBody({ message: "hi", userId: "x" })).toBeNull();
  });

  it("rejects history (no client-supplied conversation history in this batch)", () => {
    expect(validateAiAssistantRequestBody({ message: "hi", history: [] })).toBeNull();
  });

  it("rejects provider", () => {
    expect(validateAiAssistantRequestBody({ message: "hi", provider: "openai" })).toBeNull();
  });

  it("rejects mockScenario", () => {
    expect(validateAiAssistantRequestBody({ message: "hi", mockScenario: "tool-call" })).toBeNull();
  });

  it("rejects limit/tool-config-shaped keys", () => {
    expect(validateAiAssistantRequestBody({ message: "hi", limit: 100 })).toBeNull();
    expect(validateAiAssistantRequestBody({ message: "hi", maxToolCalls: 100 })).toBeNull();
    expect(validateAiAssistantRequestBody({ message: "hi", tools: [] })).toBeNull();
  });

  it("rejects a nested object masquerading as message", () => {
    expect(validateAiAssistantRequestBody({ message: { $ne: null } })).toBeNull();
  });

  it("never silently coerces or ignores — every rejection is a hard null, not a partial/best-effort object", () => {
    const result = validateAiAssistantRequestBody({ message: "hi", organizationId: "x" });
    expect(result).toBeNull();
    expect(result).not.toEqual({ message: "hi" });
  });
});
