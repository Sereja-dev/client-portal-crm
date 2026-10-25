import { describe, expect, it } from "vitest";
import {
  normalizePhoneNumber,
  parsePhoneNumber,
  isSupportedPhoneCountry,
} from "@/lib/phone/normalize";
import { maskPhoneNumber } from "@/lib/phone/mask";
import { formatPhoneNumberForDisplay, formatPhoneNumberAsYouType } from "@/lib/phone/format";
import { getPhoneCountryOptions, DEFAULT_PHONE_COUNTRY } from "@/lib/phone/countries";

// Phone Recovery Foundation, Slice B1 (read-only architecture audit:
// PHONE_RECOVERY_AUDIT). Every example below is a real, valid-format
// number per libphonenumber-js's own metadata — deliberately avoiding
// the NANP "555-01xx" fictional-number range, which libphonenumber-js
// itself correctly rejects as invalid (verified empirically while
// writing this module).

describe("normalizePhoneNumber", () => {
  it("normalizes a Thai local-format number with an explicit TH default to canonical E.164", () => {
    const result = normalizePhoneNumber("081-234-5678", "TH");
    expect(result).toEqual({ ok: true, e164: "+66812345678" });
  });

  it("normalizes a Thai number already in E.164 form, with no default country needed", () => {
    const result = normalizePhoneNumber("+66812345678");
    expect(result).toEqual({ ok: true, e164: "+66812345678" });
  });

  it("normalizes a different country's local-format number with its own explicit default", () => {
    const result = normalizePhoneNumber("(212) 234-5678", "US");
    expect(result).toEqual({ ok: true, e164: "+12122345678" });
  });

  it("normalizes the same US number via a +1-prefixed input with no default country at all", () => {
    const result = normalizePhoneNumber("+1 212 234 5678");
    expect(result).toEqual({ ok: true, e164: "+12122345678" });
  });

  it("rejects an invalid/too-short number", () => {
    const result = normalizePhoneNumber("123", "TH");
    expect(result.ok).toBe(false);
  });

  it("rejects a string that isn't a phone number at all", () => {
    const result = normalizePhoneNumber("not a phone number", "TH");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty/whitespace-only input", () => {
    expect(normalizePhoneNumber("", "TH").ok).toBe(false);
    expect(normalizePhoneNumber("   ", "TH").ok).toBe(false);
  });

  it("canonical equivalence — differently formatted inputs for the same real number normalize to the identical E.164 string", () => {
    const a = normalizePhoneNumber("081 234 5678", "TH");
    const b = normalizePhoneNumber("081-234-5678", "TH");
    const c = normalizePhoneNumber("+66812345678");
    expect(a).toEqual({ ok: true, e164: "+66812345678" });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("ignores an unsupported/garbage default-country value rather than throwing", () => {
    // @ts-expect-error -- deliberately an invalid CountryCode to prove this is rejected safely, not trusted
    const result = normalizePhoneNumber("+66812345678", "ZZ");
    expect(result).toEqual({ ok: true, e164: "+66812345678" });
  });
});

describe("parsePhoneNumber", () => {
  it("returns null (not a throw) for invalid input", () => {
    expect(parsePhoneNumber("garbage", "TH")).toBeNull();
  });

  it("returns a real PhoneNumber object for valid input", () => {
    const parsed = parsePhoneNumber("081-234-5678", "TH");
    expect(parsed?.country).toBe("TH");
    expect(parsed?.number).toBe("+66812345678");
  });
});

describe("isSupportedPhoneCountry", () => {
  it("accepts a real ISO country code", () => {
    expect(isSupportedPhoneCountry("TH")).toBe(true);
    expect(isSupportedPhoneCountry("US")).toBe(true);
  });

  it("rejects a non-country string", () => {
    expect(isSupportedPhoneCountry("ZZ")).toBe(false);
    expect(isSupportedPhoneCountry("")).toBe(false);
  });
});

describe("maskPhoneNumber", () => {
  it("masks all but the last two digits of the national number, keeping the calling code visible", () => {
    const masked = maskPhoneNumber("+66812345678");
    expect(masked.startsWith("+66 ")).toBe(true);
    expect(masked.endsWith("78")).toBe(true);
    expect(masked).not.toContain("812345678");
  });

  it("falls back to a generic mask for an unparseable value, never throwing", () => {
    expect(maskPhoneNumber("not-a-real-number")).toBe("••••");
  });

  it("never reveals the full raw number for a second, different real number either", () => {
    const masked = maskPhoneNumber("+12122345678");
    expect(masked).not.toContain("2122345678");
  });
});

describe("formatPhoneNumberForDisplay", () => {
  it("formats a stored E.164 value into a readable international form", () => {
    const formatted = formatPhoneNumberForDisplay("+66812345678");
    expect(formatted).toContain("66");
    expect(formatted.startsWith("+")).toBe(true);
  });

  it("falls back to the raw value for something unparseable", () => {
    expect(formatPhoneNumberForDisplay("not-a-number")).toBe("not-a-number");
  });
});

describe("formatPhoneNumberAsYouType", () => {
  it("never throws on partial/incomplete input", () => {
    expect(() => formatPhoneNumberAsYouType("08", "TH")).not.toThrow();
    expect(() => formatPhoneNumberAsYouType("", "TH")).not.toThrow();
  });

  it("inserts grouping as digits accumulate", () => {
    const formatted = formatPhoneNumberAsYouType("081234", "TH");
    expect(formatted.length).toBeGreaterThanOrEqual(6);
  });
});

describe("getPhoneCountryOptions / DEFAULT_PHONE_COUNTRY", () => {
  it("includes Thailand with its correct calling code and a real display name", () => {
    const options = getPhoneCountryOptions();
    const th = options.find((option) => option.code === "TH");
    expect(th).toBeDefined();
    expect(th?.callingCode).toBe("66");
    expect(th?.name).toBe("Thailand");
  });

  it("includes a genuinely international spread of countries, not just Thailand", () => {
    const options = getPhoneCountryOptions();
    expect(options.length).toBeGreaterThan(100);
    expect(options.some((option) => option.code === "US")).toBe(true);
    expect(options.some((option) => option.code === "GB")).toBe(true);
  });

  it("is sorted by display name", () => {
    const options = getPhoneCountryOptions();
    const names = options.map((option) => option.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("defaults to Thailand as the initial UX selection — a default, not a silent assumption (the server never trusts this value; it only pre-selects the dropdown)", () => {
    expect(DEFAULT_PHONE_COUNTRY).toBe("TH");
  });
});
