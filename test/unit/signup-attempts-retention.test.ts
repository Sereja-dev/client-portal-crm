import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SIGNUP_ATTEMPT_RETENTION_DAYS,
  SIGNUP_ATTEMPT_RETENTION_MS,
  isSignupAttemptExpired,
  signupAttemptRetentionCutoff,
} from "@/lib/signup-attempts/retention";

// Growth V1, Slice A — retention policy: the pure spec the cleanup query
// mirrors, plus the Privacy Policy source contract for the same promise.

const NOW = new Date("2027-03-01T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("signup attempt retention policy", () => {
  it("is 90 days of exact UTC time measured from now", () => {
    expect(SIGNUP_ATTEMPT_RETENTION_DAYS).toBe(90);
    expect(SIGNUP_ATTEMPT_RETENTION_MS).toBe(90 * DAY_MS);
    expect(signupAttemptRetentionCutoff(NOW).toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });

  it("does not drift across a daylight-saving boundary (pure UTC arithmetic)", () => {
    const across = new Date("2027-04-10T00:00:00.000Z");
    expect(across.getTime() - signupAttemptRetentionCutoff(across).getTime()).toBe(90 * DAY_MS);
  });

  it("keeps a row exactly at the cutoff, expires one millisecond older, keeps one millisecond newer", () => {
    const cutoff = signupAttemptRetentionCutoff(NOW).getTime();
    const at = (ms: number) => ({ lastAttemptedAt: new Date(ms), activatedAt: null });
    expect(isSignupAttemptExpired(at(cutoff), false, NOW)).toBe(false);
    expect(isSignupAttemptExpired(at(cutoff - 1), false, NOW)).toBe(true);
    expect(isSignupAttemptExpired(at(cutoff + 1), false, NOW)).toBe(false);
  });

  it("is based on the latest attempt, so a recent retry protects an old first attempt", () => {
    // Only lastAttemptedAt is an input; firstAttemptedAt cannot make a row expire.
    expect(isSignupAttemptExpired({ lastAttemptedAt: new Date(NOW.getTime() - DAY_MS), activatedAt: null }, false, NOW)).toBe(false);
  });

  it("never expires an activated row or a row whose User exists, however old", () => {
    const old = new Date(NOW.getTime() - 400 * DAY_MS);
    expect(isSignupAttemptExpired({ lastAttemptedAt: old, activatedAt: new Date(NOW.getTime() - 399 * DAY_MS) }, false, NOW)).toBe(false);
    expect(isSignupAttemptExpired({ lastAttemptedAt: old, activatedAt: null }, true, NOW)).toBe(false);
  });
});

describe("Privacy Policy sign-up record disclosure", () => {
  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8").replace(/\s+/g, " ");

  it("discloses staff sign-up records, including attempts never completed through email confirmation", () => {
    expect(privacy).toContain("Staff sign-up records.");
    expect(privacy).toContain("This includes attempts that are never completed through email confirmation.");
  });

  it("states the purpose and the data categories, and what the record does not contain", () => {
    expect(privacy).toContain("understand how many people start and finish sign-up");
    expect(privacy).toMatch(/email address entered, the time of the first and the most recent recorded attempt, how many attempts we recorded/);
    expect(privacy).toContain("does not contain your password, confirmation links, IP address, or browser details");
  });

  it("states the 90-day rule for incomplete sign-ups and that completed-account records follow the account", () => {
    expect(privacy).toContain("automatically deleted 90 days after the most recent recorded attempt");
    expect(privacy).toContain("kept for as long as the account remains active");
  });

  it("does not claim that authentication data is deleted with the record", () => {
    expect(privacy).toContain("does not by itself delete the authentication data held by our authentication provider");
    expect(privacy).not.toMatch(/all authentication data is (automatically )?deleted/i);
  });

  it("keeps the existing notification retention statement", () => {
    expect(privacy).toContain("Read in-app notifications are automatically deleted 90 days after they are marked read");
  });
});
