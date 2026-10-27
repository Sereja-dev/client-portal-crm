import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TEST_MODE is a module-level const computed once at first import (see
// test/unit/recovery-token.test.ts's own identical technique) — set/unset
// process.env.TEST_MODE and vi.resetModules() before each dynamic import
// below so this module's real TEST_MODE branch runs directly, never a
// mock of it.

const ORIGINAL_TEST_MODE = process.env.TEST_MODE;
const ORIGINAL_API_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM_EMAIL = process.env.INVITATION_FROM_EMAIL;
const ORIGINAL_PLATFORM_REPLY_TO = process.env.PLATFORM_REPLY_TO_EMAIL;

function restoreEnv() {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.TEST_MODE;
  else process.env.TEST_MODE = ORIGINAL_TEST_MODE;
  if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_FROM_EMAIL === undefined) delete process.env.INVITATION_FROM_EMAIL;
  else process.env.INVITATION_FROM_EMAIL = ORIGINAL_FROM_EMAIL;
  if (ORIGINAL_PLATFORM_REPLY_TO === undefined) delete process.env.PLATFORM_REPLY_TO_EMAIL;
  else process.env.PLATFORM_REPLY_TO_EMAIL = ORIGINAL_PLATFORM_REPLY_TO;
}

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const BASE_INPUT = {
  to: "client@example.com",
  from: "noreply@example.com",
  subject: "Invoice attached",
  html: "<p>hi</p>",
  text: "hi",
};

function mockResponse(status: number, jsonImpl?: () => Promise<unknown>) {
  const jsonMock = vi.fn(jsonImpl ?? (async () => ({})));
  return { ok: status >= 200 && status < 300, status, json: jsonMock } as unknown as Response;
}

describe("sendEmailViaResend / checkEmailProviderReadiness — TEST_MODE branch", () => {
  beforeEach(() => {
    process.env.TEST_MODE = "1";
    delete process.env.RESEND_API_KEY;
    delete process.env.INVITATION_FROM_EMAIL;
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("valid input returns ok:true before any fetch/secret requirement", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("valid optional foundation fields (attachments/idempotencyKey/timeoutMs) do not break TEST_MODE", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({
      ...BASE_INPUT,
      attachments: [{ filename: "invoice.pdf", content: "ZmFrZQ==", content_type: "application/pdf" }],
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      timeoutMs: 5000,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a malformed idempotencyKey (CR/LF) fails before the TEST_MODE short-circuit, with zero fetch calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: "bad\r\nkey" });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a malformed timeoutMs (negative) fails before the TEST_MODE short-circuit, with zero fetch calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, timeoutMs: -1 });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a valid explicit replyTo does not break TEST_MODE", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example.com" });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a malformed explicit replyTo (CRLF) fails before the TEST_MODE short-circuit, with zero fetch calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "evil\r\nX-Injected: x@example.com" });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("explicit replyTo combined with disablePlatformReplyTo:true fails before the TEST_MODE short-circuit (mutually exclusive contract)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({
      ...BASE_INPUT,
      replyTo: "visitor@example.com",
      disablePlatformReplyTo: true,
    });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("checkEmailProviderReadiness() returns 'ready' without RESEND_API_KEY/INVITATION_FROM_EMAIL configured", async () => {
    const { checkEmailProviderReadiness } = await import("@/lib/email/resend-client");
    expect(checkEmailProviderReadiness()).toBe("ready");
  });
});

describe("sendEmailViaResend — production adapter: existing (pre-Slice-4) behavior unchanged", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("serializes exactly the original four body fields when no new fields are supplied", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body as string)).toEqual({
      from: BASE_INPUT.from,
      to: BASE_INPUT.to,
      subject: BASE_INPUT.subject,
      html: BASE_INPUT.html,
      text: BASE_INPUT.text,
    });
    expect(init.headers).toEqual({ Authorization: "Bearer test-api-key", "Content-Type": "application/json" });
    expect(init.signal).toBeUndefined();
  });

  it("returns not_configured with zero fetch calls when RESEND_API_KEY is absent", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a non-2xx response to provider_error without ever parsing the body", async () => {
    const response = mockResponse(500);
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect((response as unknown as { json: ReturnType<typeof vi.fn> }).json).not.toHaveBeenCalled();
  });

  it("maps a thrown fetch failure to network_error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("simulated DNS failure"));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: false, reason: "network_error" });
  });
});

describe("sendEmailViaResend — production adapter: attachments (Requirement D)", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("serializes attachments exactly as REST JSON with filename/content/content_type", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend({
      ...BASE_INPUT,
      attachments: [{ filename: "Invoice-2026-001.pdf", content: "ZmFrZS1wZGYtYnl0ZXM=", content_type: "application/pdf" }],
    });

    const init = fetchSpy.mock.calls[0][1];
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.attachments).toEqual([{ filename: "Invoice-2026-001.pdf", content: "ZmFrZS1wZGYtYnl0ZXM=", content_type: "application/pdf" }]);
    expect(typeof parsedBody.attachments[0].content).toBe("string");
    expect(parsedBody.from).toBe(BASE_INPUT.from);
  });

  it("omits content_type on an attachment that doesn't supply it", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend({ ...BASE_INPUT, attachments: [{ filename: "file.pdf", content: "YQ==" }] });

    const init = fetchSpy.mock.calls[0][1];
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.attachments).toEqual([{ filename: "file.pdf", content: "YQ==" }]);
    expect("content_type" in parsedBody.attachments[0]).toBe(false);
  });

  it("omits the attachments key entirely when none are supplied", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend(BASE_INPUT);

    const init = fetchSpy.mock.calls[0][1];
    const parsedBody = JSON.parse(init.body as string);
    expect("attachments" in parsedBody).toBe(false);
  });
});

describe("sendEmailViaResend — production adapter: Idempotency-Key header (Requirement E)", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("sends exactly one Idempotency-Key header with the exact validated value", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const key = "11111111-1111-4111-8111-111111111111";
    await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: key });

    const init = fetchSpy.mock.calls[0][1];
    expect(init.headers["Idempotency-Key"]).toBe(key);
  });

  it("omits the header entirely when no idempotencyKey is supplied", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend(BASE_INPUT);

    const init = fetchSpy.mock.calls[0][1];
    expect("Idempotency-Key" in init.headers).toBe(false);
  });

  it("accepts a 1-character key", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: "a" });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy.mock.calls[0][1].headers["Idempotency-Key"]).toBe("a");
  });

  it("accepts an exactly-256-character key", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const key = "a".repeat(256);
    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: key });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy.mock.calls[0][1].headers["Idempotency-Key"]).toBe(key);
  });

  it("rejects a 257-character key before fetch, with zero fetch calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: "a".repeat(257) });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty-string key before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: "" });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a key containing CR before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: "key\rinjected" });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a key containing LF before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: "key\ninjected" });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a key containing a header-injection-style second header before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, idempotencyKey: "key\r\nX-Injected: evil" });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendEmailViaResend — production adapter: timeoutMs (Requirement F)", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("rejects timeoutMs of zero before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, timeoutMs: 0 });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-integer timeoutMs before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, timeoutMs: 100.5 });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a timeoutMs above the conservative bound before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, timeoutMs: 30_001 });
    expect(result).toEqual({ ok: false, reason: "provider_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a timeoutMs at exactly the conservative bound and passes an AbortSignal to fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, timeoutMs: 30_000 });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("an abort before any response is received maps to network_error", async () => {
    const fetchSpy = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend({ ...BASE_INPUT, timeoutMs: 5 });
    expect(result).toEqual({ ok: false, reason: "network_error" });
  });

  it("existing callers that omit timeoutMs never pass a signal to fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend(BASE_INPUT);
    expect(fetchSpy.mock.calls[0][1].signal).toBeUndefined();
  });
});

describe("sendEmailViaResend — production adapter: 2xx response body parsing (Requirement G)", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("a 2xx with a valid string id returns ok:true with messageId", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => ({ id: "msg_abc123" })));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true, messageId: "msg_abc123" });
  });

  it("a 2xx with no id in the body returns ok:true without messageId", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => ({})));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
    expect("messageId" in result).toBe(false);
  });

  it("a 2xx whose body cannot be parsed as JSON returns ok:true without messageId", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => { throw new Error("invalid json"); }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
  });

  it("a 2xx with an oversized id (>128 chars) ignores it", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => ({ id: "x".repeat(129) })));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
  });

  it("a 2xx with an id at exactly 128 chars is accepted", async () => {
    const id = "x".repeat(128);
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => ({ id })));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true, messageId: id });
  });

  it("a 2xx with a non-string id ignores it", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => ({ id: 12345 })));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
  });

  it("a 2xx whose parsed body is an array ignores it entirely", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => (["not", "an", "object"])));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
  });

  it("a 2xx with an empty-string id ignores it", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, async () => ({ id: "" })));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
  });
});

describe("checkEmailProviderReadiness — production adapter (Requirement C)", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("returns 'ready' when both RESEND_API_KEY and INVITATION_FROM_EMAIL are configured", async () => {
    process.env.RESEND_API_KEY = "real-key";
    process.env.INVITATION_FROM_EMAIL = "billing@example.com";
    const { checkEmailProviderReadiness } = await import("@/lib/email/resend-client");
    expect(checkEmailProviderReadiness()).toBe("ready");
  });

  it("returns 'not_configured' when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.INVITATION_FROM_EMAIL = "billing@example.com";
    const { checkEmailProviderReadiness } = await import("@/lib/email/resend-client");
    expect(checkEmailProviderReadiness()).toBe("not_configured");
  });

  it("returns 'not_configured' when RESEND_API_KEY is whitespace-only", async () => {
    process.env.RESEND_API_KEY = "   ";
    process.env.INVITATION_FROM_EMAIL = "billing@example.com";
    const { checkEmailProviderReadiness } = await import("@/lib/email/resend-client");
    expect(checkEmailProviderReadiness()).toBe("not_configured");
  });

  it("returns 'not_configured' when INVITATION_FROM_EMAIL is missing", async () => {
    process.env.RESEND_API_KEY = "real-key";
    delete process.env.INVITATION_FROM_EMAIL;
    const { checkEmailProviderReadiness } = await import("@/lib/email/resend-client");
    expect(checkEmailProviderReadiness()).toBe("not_configured");
  });

  it("returns 'not_configured' when INVITATION_FROM_EMAIL is whitespace-only", async () => {
    process.env.RESEND_API_KEY = "real-key";
    process.env.INVITATION_FROM_EMAIL = "   ";
    const { checkEmailProviderReadiness } = await import("@/lib/email/resend-client");
    expect(checkEmailProviderReadiness()).toBe("not_configured");
  });
});

/**
 * E2 (Reply-To wiring). getTransactionalReplyToEmail()'s own exhaustive
 * valid/unset/blank/malformed matrix already lives in
 * test/unit/platform-email-config.test.ts — this file's job is narrower:
 * prove sendEmailViaResend actually calls it and serializes its result as
 * the real Resend request body's own `reply_to` field, under exactly the
 * same real-fetch-interception technique already used above for
 * attachments/Idempotency-Key, never a real network call.
 */
describe("sendEmailViaResend — production adapter: platform Reply-To (E2)", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  it("includes reply_to with the exact configured address when PLATFORM_REPLY_TO_EMAIL is valid", async () => {
    process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend(BASE_INPUT);

    const init = fetchSpy.mock.calls[0][1];
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.reply_to).toBe("support@acme.example");
    // Every other field stays exactly what the "existing behavior
    // unchanged" describe block above already asserts — repeated here
    // only for the fields reply_to sits alongside, not duplicated per case.
    expect(parsedBody.from).toBe(BASE_INPUT.from);
    expect(parsedBody.to).toBe(BASE_INPUT.to);
  });

  it("omits reply_to entirely when PLATFORM_REPLY_TO_EMAIL is unset", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend(BASE_INPUT);

    const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect("reply_to" in parsedBody).toBe(false);
  });

  it("omits reply_to entirely when PLATFORM_REPLY_TO_EMAIL is blank/whitespace-only", async () => {
    process.env.PLATFORM_REPLY_TO_EMAIL = "   ";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend(BASE_INPUT);

    const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect("reply_to" in parsedBody).toBe(false);
  });

  it("omits reply_to entirely when PLATFORM_REPLY_TO_EMAIL is malformed, and the send still proceeds normally", async () => {
    process.env.PLATFORM_REPLY_TO_EMAIL = "not-an-email";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);

    expect(result).toEqual({ ok: true });
    const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect("reply_to" in parsedBody).toBe(false);
  });

  it("disablePlatformReplyTo: true omits reply_to even when a valid address is configured — the Invoice-email opt-out", async () => {
    process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend({ ...BASE_INPUT, disablePlatformReplyTo: true });

    const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect("reply_to" in parsedBody).toBe(false);
  });

  it("disablePlatformReplyTo: false behaves identically to omitting the field", async () => {
    process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend({ ...BASE_INPUT, disablePlatformReplyTo: false });

    const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(parsedBody.reply_to).toBe("support@acme.example");
  });

  it("attachments and Idempotency-Key continue to work exactly as before, alongside a configured Reply-To", async () => {
    process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    await sendEmailViaResend({
      ...BASE_INPUT,
      attachments: [{ filename: "Invoice-2026-001.pdf", content: "ZmFrZS1wZGYtYnl0ZXM=", content_type: "application/pdf" }],
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });

    const [, init] = fetchSpy.mock.calls[0];
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.reply_to).toBe("support@acme.example");
    expect(parsedBody.attachments).toEqual([{ filename: "Invoice-2026-001.pdf", content: "ZmFrZS1wZGYtYnl0ZXM=", content_type: "application/pdf" }]);
    expect(init.headers["Idempotency-Key"]).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("TEST_MODE never calls fetch at all, regardless of PLATFORM_REPLY_TO_EMAIL", async () => {
    process.env.TEST_MODE = "1";
    process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
    vi.resetModules();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailViaResend } = await import("@/lib/email/resend-client");

    const result = await sendEmailViaResend(BASE_INPUT);
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * Pre-Auth Support Widget V1, Slice A. Per-message `replyTo` — distinct
 * from, and always overriding, the platform-wide default the describe
 * block above already covers exhaustively. This block's own job is
 * narrower: prove the override precedence, the stricter validation
 * (Requirements C/D of this slice's own brief), and the "never silently
 * fall back" contract — all against the same real-fetch-interception
 * technique used throughout this file, never a real network call.
 */
describe("sendEmailViaResend — production adapter: per-message Reply-To (Slice A)", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.PLATFORM_REPLY_TO_EMAIL;
    vi.resetModules();
  });

  describe("A. existing default behavior preserved", () => {
    it("no replyTo, no platform default configured: omits reply_to exactly as before", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      await sendEmailViaResend(BASE_INPUT);

      const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect("reply_to" in parsedBody).toBe(false);
    });

    it("no replyTo, platform default configured: still uses the platform default exactly as before", async () => {
      process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      await sendEmailViaResend(BASE_INPUT);

      const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(parsedBody.reply_to).toBe("support@acme.example");
    });

    it("no replyTo, disablePlatformReplyTo:true, platform default configured: still suppresses reply_to exactly as before", async () => {
      process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      await sendEmailViaResend({ ...BASE_INPUT, disablePlatformReplyTo: true });

      const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect("reply_to" in parsedBody).toBe(false);
    });
  });

  describe("B. explicit override", () => {
    it("a valid visitor-style email becomes the exact reply_to value", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor+tag@example.com" });

      const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(parsedBody.reply_to).toBe("visitor+tag@example.com");
    });

    it("overrides the platform default only for this message — no other field is affected", async () => {
      process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example.com" });

      const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(parsedBody.reply_to).toBe("visitor@example.com");
      expect(parsedBody.from).toBe(BASE_INPUT.from);
      expect(parsedBody.to).toBe(BASE_INPUT.to);
      expect(parsedBody.subject).toBe(BASE_INPUT.subject);
      expect(parsedBody.html).toBe(BASE_INPUT.html);
      expect(parsedBody.text).toBe(BASE_INPUT.text);
      expect("attachments" in parsedBody).toBe(false);
    });

    it("coexists correctly with attachments and an Idempotency-Key", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      await sendEmailViaResend({
        ...BASE_INPUT,
        replyTo: "visitor@example.com",
        attachments: [{ filename: "file.pdf", content: "YQ==" }],
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      });

      const [, init] = fetchSpy.mock.calls[0];
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody.reply_to).toBe("visitor@example.com");
      expect(parsedBody.attachments).toEqual([{ filename: "file.pdf", content: "YQ==" }]);
      expect(init.headers["Idempotency-Key"]).toBe("11111111-1111-4111-8111-111111111111");
    });
  });

  describe("C/D. invalid input is rejected, never silently falls back, before any fetch", () => {
    it("rejects an empty-string replyTo", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "" });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only replyTo", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "   " });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a replyTo containing CR", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example.com\rinjected" });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a replyTo containing LF", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example.com\ninjected" });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a replyTo containing a full CRLF header-injection payload", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({
        ...BASE_INPUT,
        replyTo: "visitor@example.com\r\nBcc: attacker@evil.example",
      });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a comma-separated address list", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({
        ...BASE_INPUT,
        replyTo: "visitor@example.com,second@example.com",
      });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a 'Display Name <addr>' wrapper", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({
        ...BASE_INPUT,
        replyTo: "Visitor Name <visitor@example.com>",
      });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a structurally malformed address (no @)", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "not-an-email" });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a structurally malformed address (no domain dot)", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example" });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("accepts a replyTo at exactly the 254-character bound", async () => {
      const localPart = "a".repeat(254 - "@example.com".length);
      const address = `${localPart}@example.com`;
      expect(address.length).toBe(254);
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: address });
      expect(result).toEqual({ ok: true });
    });

    it("rejects a replyTo one character past the 254-character bound", async () => {
      const localPart = "a".repeat(255 - "@example.com".length);
      const address = `${localPart}@example.com`;
      expect(address.length).toBe(255);
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: address });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("an invalid explicit replyTo never silently falls back to a configured platform default", async () => {
      process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "not-an-email" });
      // The send is rejected outright — it never reaches fetch with the
      // platform default silently substituted in, and never reaches
      // fetch with reply_to simply omitted either.
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("explicit replyTo + disablePlatformReplyTo:true fails the whole send, even with a valid address and a configured platform default", async () => {
      process.env.PLATFORM_REPLY_TO_EMAIL = "support@acme.example";
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({
        ...BASE_INPUT,
        replyTo: "visitor@example.com",
        disablePlatformReplyTo: true,
      });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("E. unrelated existing behavior stays intact alongside this feature", () => {
    it("a provider error (5xx) is still mapped to provider_error when a valid replyTo is present", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(500));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example.com" });
      expect(result).toEqual({ ok: false, reason: "provider_error" });
    });

    it("a network failure is still mapped to network_error when a valid replyTo is present", async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new Error("simulated DNS failure"));
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example.com" });
      expect(result).toEqual({ ok: false, reason: "network_error" });
    });

    it("not_configured (missing RESEND_API_KEY) is still reported even with a valid replyTo present, before any fetch", async () => {
      delete process.env.RESEND_API_KEY;
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendEmailViaResend } = await import("@/lib/email/resend-client");

      const result = await sendEmailViaResend({ ...BASE_INPUT, replyTo: "visitor@example.com" });
      expect(result).toEqual({ ok: false, reason: "not_configured" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
