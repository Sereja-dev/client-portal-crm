import { describe, expect, it } from "vitest";
import { isValidOtpCodeFormat } from "@/lib/phone/otp-format";

// Phone Recovery, Slice B2 — a pre-filter only (never the real security
// boundary; Twilio's own VerificationCheck is), but still worth testing
// directly since it's what lets the Settings UI show an inline error
// before a round-trip, and what the Server Action checks before ever
// spending a provider call.

describe("isValidOtpCodeFormat", () => {
  it("accepts Twilio's own 6-digit default", () => {
    expect(isValidOtpCodeFormat("123456")).toBe(true);
  });

  it("accepts the shorter and longer ends of Twilio's configurable range (4-10 digits)", () => {
    expect(isValidOtpCodeFormat("1234")).toBe(true);
    expect(isValidOtpCodeFormat("1234567890")).toBe(true);
  });

  it("rejects too short", () => {
    expect(isValidOtpCodeFormat("123")).toBe(false);
  });

  it("rejects too long", () => {
    expect(isValidOtpCodeFormat("12345678901")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidOtpCodeFormat("12a456")).toBe(false);
    expect(isValidOtpCodeFormat("123 456")).toBe(false);
    expect(isValidOtpCodeFormat("123-456")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isValidOtpCodeFormat("")).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(isValidOtpCodeFormat("   ")).toBe(false);
  });

  it("is not already-trimmed-safe — leading/trailing whitespace around otherwise-valid digits is rejected (callers must trim first)", () => {
    expect(isValidOtpCodeFormat(" 123456 ")).toBe(false);
  });
});
