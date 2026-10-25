import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" neutralization as test/unit/recovery-token.test.ts —
// twilio-verify.ts imports it (it's a server-only module, same as
// recovery-token.ts), and outside Next.js's own "react-server" resolve
// condition that package's default export throws on import; vitest runs
// in plain Node, so this mock is required, not optional.
vi.mock("server-only", () => ({}));

// Phone Recovery, Slice B2. Same dynamic-import + vi.resetModules()
// technique as test/unit/resend-client.test.ts — TEST_MODE is a
// module-level const computed once at first import, so each test that
// needs a different TEST_MODE/env combination must reset the module
// registry and re-import fresh.

const ORIGINAL_TEST_MODE = process.env.TEST_MODE;
const ORIGINAL_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const ORIGINAL_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ORIGINAL_VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

function restoreEnv() {
  for (const [key, value] of [
    ["TEST_MODE", ORIGINAL_TEST_MODE],
    ["TWILIO_ACCOUNT_SID", ORIGINAL_ACCOUNT_SID],
    ["TWILIO_AUTH_TOKEN", ORIGINAL_AUTH_TOKEN],
    ["TWILIO_VERIFY_SERVICE_SID", ORIGINAL_VERIFY_SID],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function mockResponse(status: number, jsonImpl?: () => Promise<unknown>) {
  const jsonMock = vi.fn(jsonImpl ?? (async () => ({})));
  return { ok: status >= 200 && status < 300, status, json: jsonMock } as unknown as Response;
}

describe("twilio-verify.ts — TEST_MODE branch (sendCode/verifyCode)", () => {
  beforeEach(() => {
    process.env.TEST_MODE = "1";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    vi.resetModules();
  });

  it("sendCode succeeds with zero fetch calls and no real credentials needed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.sendCode("+66812345678");
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verifyCode approves the deterministic test code for the exact phone a code was sent to", async () => {
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");
    await twilioVerifyProvider.sendCode("+66812345678");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "000000");
    expect(result).toEqual({ ok: true, outcome: "approved" });
  });

  it("verifyCode denies a wrong code without consuming the still-pending correct one", async () => {
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");
    await twilioVerifyProvider.sendCode("+66899998888");

    const wrong = await twilioVerifyProvider.verifyCode("+66899998888", "111111");
    expect(wrong).toEqual({ ok: true, outcome: "denied" });

    const right = await twilioVerifyProvider.verifyCode("+66899998888", "000000");
    expect(right).toEqual({ ok: true, outcome: "approved" });
  });

  it("a code is single-use: verifying the same correct code twice denies the second attempt", async () => {
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");
    await twilioVerifyProvider.sendCode("+66811112222");

    const first = await twilioVerifyProvider.verifyCode("+66811112222", "000000");
    expect(first).toEqual({ ok: true, outcome: "approved" });

    const second = await twilioVerifyProvider.verifyCode("+66811112222", "000000");
    expect(second).toEqual({ ok: true, outcome: "denied" });
  });

  it("the critical invariant: a code sent to Phone A never verifies Phone B, even with the correct digits", async () => {
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");
    await twilioVerifyProvider.sendCode("+66811110000");

    const result = await twilioVerifyProvider.verifyCode("+66822220000", "000000");
    expect(result).toEqual({ ok: true, outcome: "denied" });
  });

  it("verifyCode denies when no code was ever sent for that phone", async () => {
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");
    const result = await twilioVerifyProvider.verifyCode("+66855556666", "000000");
    expect(result).toEqual({ ok: true, outcome: "denied" });
  });

  it("verifyCode denies an expired challenge", async () => {
    vi.useFakeTimers();
    try {
      const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");
      await twilioVerifyProvider.sendCode("+66866667777");

      vi.advanceTimersByTime(11 * 60 * 1000); // past the 10-minute TTL

      const result = await twilioVerifyProvider.verifyCode("+66866667777", "000000");
      expect(result).toEqual({ ok: true, outcome: "denied" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("twilio-verify.ts — production adapter: sendCode", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    vi.resetModules();
  });

  it("returns not_configured with zero fetch calls when credentials are entirely absent", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.sendCode("+66812345678");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns not_configured when only some credentials are present", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.sendCode("+66812345678");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps HTTP 429 to rate_limited", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(429)));
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.sendCode("+66812345678");
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("maps a non-2xx, non-429 response to provider_error", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(500)));
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.sendCode("+66812345678");
    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });

  it("maps a thrown fetch failure to network_error", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.sendCode("+66812345678");
    expect(result).toEqual({ ok: false, reason: "network_error" });
  });

  it("a successful send sends Basic Auth + form-encoded To/Channel, never JSON or a bearer token", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "secret-token";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    const fetchSpy = vi.fn(async () => mockResponse(201));
    vi.stubGlobal("fetch", fetchSpy);
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.sendCode("+66812345678");
    expect(result).toEqual({ ok: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://verify.twilio.com/v2/Services/VAxxxx/Verifications");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toBe("To=%2B66812345678&Channel=sms");
  });
});

describe("twilio-verify.ts — production adapter: verifyCode", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    vi.resetModules();
  });

  it("maps status: approved to outcome: approved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200, async () => ({ status: "approved" }))));
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "123456");
    expect(result).toEqual({ ok: true, outcome: "approved" });
  });

  it("maps status: pending (wrong code) to outcome: denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200, async () => ({ status: "pending" }))));
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "999999");
    expect(result).toEqual({ ok: true, outcome: "denied" });
  });

  it("maps HTTP 404 (no pending verification for this To — e.g. a stale phone) to outcome: denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(404)));
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "123456");
    expect(result).toEqual({ ok: true, outcome: "denied" });
  });

  it("maps a non-2xx, non-404 response to provider_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(500)));
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "123456");
    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });

  it("maps a malformed (non-JSON) 2xx response body to provider_error, never a false approval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse(200, async () => {
          throw new SyntaxError("Unexpected token");
        }),
      ),
    );
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "123456");
    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });

  it("maps a well-formed 2xx body with a missing/non-string status to outcome: denied, never approved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200, async () => ({ sid: "VExxxx" }))));
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "123456");
    expect(result).toEqual({ ok: true, outcome: "denied" });
  });

  it("returns not_configured with zero fetch calls when credentials are absent", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { twilioVerifyProvider } = await import("@/lib/phone/twilio-verify");

    const result = await twilioVerifyProvider.verifyCode("+66812345678", "123456");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("checkPhoneVerificationProviderReadiness", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("is always 'ready' under TEST_MODE, regardless of credentials", async () => {
    process.env.TEST_MODE = "1";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    vi.resetModules();
    const { checkPhoneVerificationProviderReadiness } = await import("@/lib/phone/twilio-verify");
    expect(checkPhoneVerificationProviderReadiness()).toBe("ready");
  });

  it("is 'not_configured' outside TEST_MODE with no credentials set", async () => {
    delete process.env.TEST_MODE;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    vi.resetModules();
    const { checkPhoneVerificationProviderReadiness } = await import("@/lib/phone/twilio-verify");
    expect(checkPhoneVerificationProviderReadiness()).toBe("not_configured");
  });

  it("is 'not_configured' when a credential is whitespace-only", async () => {
    delete process.env.TEST_MODE;
    process.env.TWILIO_ACCOUNT_SID = "   ";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    vi.resetModules();
    const { checkPhoneVerificationProviderReadiness } = await import("@/lib/phone/twilio-verify");
    expect(checkPhoneVerificationProviderReadiness()).toBe("not_configured");
  });

  it("is 'ready' outside TEST_MODE when all three credentials are set", async () => {
    delete process.env.TEST_MODE;
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAxxxx";
    vi.resetModules();
    const { checkPhoneVerificationProviderReadiness } = await import("@/lib/phone/twilio-verify");
    expect(checkPhoneVerificationProviderReadiness()).toBe("ready");
  });
});
