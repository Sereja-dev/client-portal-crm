import { TEST_MODE } from "@/lib/test-mode";
import { getTransactionalReplyToEmail } from "@/lib/legal/platform-config";

// Reads process.env.RESEND_API_KEY (a server-only secret) and is only ever
// imported from "use server" action files, so this never reaches the
// client bundle — same trust boundary as src/lib/prisma.ts.
const RESEND_API_URL = "https://api.resend.com/emails";

// Invoice System Slice 4, PR 4a — a conservative, explicit ceiling on the
// caller-supplied timeoutMs, independent of any provider-side limit: this
// module has no retry logic of its own, so a send that hasn't gotten a
// response within 30s gains nothing from waiting longer.
const MAX_SEND_EMAIL_TIMEOUT_MS = 30_000;

// The Idempotency-Key header's value is opaque to this module — Slice 4's
// own future caller additionally enforces UUIDv4 — only structural
// header-safety is enforced here: a bounded length, and no character that
// could inject a second header or split/truncate the request.
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

export type SendEmailAttachment = {
  filename: string;
  content: string; // already Base64
  content_type?: string;
};

export type SendEmailInput = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  attachments?: SendEmailAttachment[];
  timeoutMs?: number;
  idempotencyKey?: string;
  /**
   * E2 (Reply-To wiring). The one narrow opt-out for the platform-wide
   * `PLATFORM_REPLY_TO_EMAIL` default this function applies to every send
   * below — never an opt-IN (the default already covers every platform-
   * originated flow with zero caller changes; see this function's own
   * doc comment). `true` only for a flow whose email copy presents itself
   * as originating from something other than the platform operator — at
   * launch, that's exactly Invoice email (src/lib/invoices/email/
   * send-invoice-email.ts), which reads as a message from the Aqenra
   * customer's own business, not from Aqenra itself; routing a client's
   * reply to Aqenra's own platform support would be misleading. Omit (or
   * `false`) for every other caller.
   *
   * Mutually exclusive with `replyTo` below — specifying both on the same
   * call is a caller contract violation, not a precedence question to
   * silently resolve one way, so it fails the send entirely (see that
   * field's own doc comment and the validation in `sendEmailViaResend`).
   */
  disablePlatformReplyTo?: boolean;
  /**
   * Pre-Auth Support Widget V1, Slice A. A per-message Reply-To,
   * explicitly supplied by the caller — distinct from, and always wins
   * over, the platform-wide `PLATFORM_REPLY_TO_EMAIL` default above. The
   * first caller is the future support-widget submission flow (Slice B),
   * which needs every send's Reply-To to be the actual visitor's own
   * address, not the platform operator's fixed default — but this field
   * is itself generic, not support-widget-specific.
   *
   * Validated the same hardened way every other address-shaped value in
   * this module already is (see `isValidReplyToAddress` below): a single
   * bare mailbox address only — no address list, no comma, no
   * "Display Name <addr>" wrapper, no header-injection character, bounded
   * length. An invalid value here is NEVER silently dropped in favor of
   * the platform default (unlike a malformed `PLATFORM_REPLY_TO_EMAIL`,
   * which — being an operator-configured value, not caller/request
   * input — degrades to "omit reply_to" so a typo in that one env var can
   * never fail every send in the app). An invalid explicit `replyTo`
   * instead rejects the whole send, `{ ok: false, reason: "provider_error" }`,
   * the same treatment a malformed `idempotencyKey`/`timeoutMs` already
   * gets, and for the same reason: this value traces back to request
   * input a future caller may not fully control, so a malformed value
   * must never silently become "no Reply-To" or "the platform's own
   * default" — either would be a wrong, surprising substitution for
   * whatever the caller actually intended.
   *
   * Also mutually exclusive with `disablePlatformReplyTo: true` — see
   * that field's own doc comment.
   */
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; messageId?: string }
  | { ok: false; reason: "not_configured" | "provider_error" | "network_error" };

export type SendEmailFn = (input: SendEmailInput) => Promise<SendEmailResult>;

export type EmailProviderReadiness = "ready" | "not_configured";

/**
 * Reports whether the email provider is ready to send, as a bounded
 * category only — never the configured API key or from-address
 * themselves. Always "ready" under TEST_MODE (this sandbox has no real
 * Resend to reach any more than it has a real Supabase; Slice 4's own E2E
 * suite would otherwise be structurally impossible to exercise). This
 * never weakens `sendEmailViaResend()`'s own independent RESEND_API_KEY
 * check below, which still runs on every real send regardless of what
 * this reports.
 */
export function checkEmailProviderReadiness(): EmailProviderReadiness {
  if (TEST_MODE) {
    return "ready";
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INVITATION_FROM_EMAIL;
  if (!apiKey?.trim() || !fromEmail?.trim()) {
    return "not_configured";
  }
  return "ready";
}

function hasHeaderInjectionCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Any C0 control character (includes CR 0x0D, LF 0x0A, NUL, tab) or DEL.
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 1 && key.length <= MAX_IDEMPOTENCY_KEY_LENGTH && !hasHeaderInjectionCharacter(key);
}

// RFC 5321 §4.5.3.1.3's own practical total-address-length ceiling — same
// "a conservative, explicit bound, independent of any provider-side
// limit" reasoning as MAX_IDEMPOTENCY_KEY_LENGTH above.
const MAX_REPLY_TO_LENGTH = 254;

// Deliberately its own copy, not an import from platform-config.ts's
// EMAIL_SHAPE_PATTERN — matches this codebase's established convention
// (see password-reset.ts's getAppBaseUrl comment) that each email module
// keeps its own narrow copy of logic this close to the wire, so one
// module's own validation rule can never silently drift because of an
// edit made for a completely different module's own reasons. Also
// deliberately stricter than that pattern: no comma (rules out an
// address list — this field is documented as exactly one address, never
// more) and no angle brackets (rules out a "Display Name <addr>"
// wrapper — a per-message Reply-To has no legitimate reason to carry a
// display name, and accepting one is unnecessary surface for injection
// that INVITATION_FROM_EMAIL's own, deliberately more permissive format
// elsewhere in this app doesn't need to worry about).
const REPLY_TO_SHAPE_PATTERN = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

function isValidReplyToAddress(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REPLY_TO_LENGTH) return false;
  if (hasHeaderInjectionCharacter(value)) return false;
  return REPLY_TO_SHAPE_PATTERN.test(value);
}

function isValidTimeoutMs(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_SEND_EMAIL_TIMEOUT_MS;
}

function extractMessageId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const id = (body as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return undefined;
  return id;
}

function acceptedResult(messageId: string | undefined): SendEmailResult {
  return messageId !== undefined ? { ok: true, messageId } : { ok: true };
}

/**
 * Thin fetch wrapper around Resend's HTTP API — chosen over the `resend`
 * SDK because it's a single JSON POST with a bearer token; a native fetch
 * call needs no extra dependency and is trivially swappable for a mock in
 * tests (see the `sendEmail` DI param on sendInvitationEmail).
 *
 * Never logs the request body (contains the recipient/invite link), the
 * response body (Resend may echo request fields back), any header, or the
 * idempotency key — only a coarse, non-identifying reason (and, on
 * success, an optional bounded provider message id) is ever returned to
 * the caller.
 *
 * Purely additive over the original four-field shape: `attachments`,
 * `timeoutMs`, `idempotencyKey`, and (Slice A) `replyTo` are all optional,
 * so every existing caller (invitations.ts, client-portal-invitations.ts,
 * password-reset.ts, deliver-notification-email.ts) compiles and behaves
 * identically without modification, and the request body it serializes
 * is byte-identical to before when none of the new fields are supplied.
 *
 * Pre-Auth Support Widget V1, Slice A — `replyTo`, when supplied, always
 * wins over the platform-wide default below and is validated far more
 * strictly (see `isValidReplyToAddress`'s own comment): unlike a
 * malformed `PLATFORM_REPLY_TO_EMAIL`, an invalid explicit `replyTo`
 * rejects the send entirely rather than silently omitting the field —
 * see `replyTo`'s own doc comment on `SendEmailInput` for the full
 * reasoning. No existing caller passes this field, so this is purely
 * additive for all of them too.
 *
 * E2 (Reply-To wiring) — centralizes the platform Reply-To default here,
 * not in any of this function's eight callers: `getTransactionalReplyToEmail()`
 * (src/lib/legal/platform-config.ts) is resolved once, below, and its
 * result — the operator-configured `PLATFORM_REPLY_TO_EMAIL`, already
 * validated as a real address, or `null` for unset/blank/malformed —
 * becomes the request's own `reply_to` field whenever both it is non-null
 * AND the caller hasn't passed `disablePlatformReplyTo: true`. A caller
 * never needs to read this env var itself, and a malformed value can
 * never fail a send: `getTransactionalReplyToEmail()` already treats an
 * invalid address as absent, so this function simply omits the field,
 * exactly as if nothing had been configured at all.
 */
export async function sendEmailViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  // Malformed optional foundation fields fail before the TEST_MODE
  // short-circuit below — otherwise this validation would be structurally
  // untestable, since Slice 4's own E2E suite runs exclusively under
  // TEST_MODE. This branch is unreachable for any existing caller (none
  // supplies these fields) and for any compliant Slice 4 input.
  if (input.idempotencyKey !== undefined && !isValidIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, reason: "provider_error" };
  }
  if (input.timeoutMs !== undefined && !isValidTimeoutMs(input.timeoutMs)) {
    return { ok: false, reason: "provider_error" };
  }
  // Pre-Auth Support Widget V1, Slice A. Mutually exclusive by contract —
  // see replyTo's own doc comment on SendEmailInput. Checked before the
  // validity check below so the contract violation itself is what's
  // reported, not a coincidentally-invalid address.
  if (input.replyTo !== undefined && input.disablePlatformReplyTo === true) {
    return { ok: false, reason: "provider_error" };
  }
  // Never silently falls back to the platform-wide default (or to no
  // Reply-To at all) when an explicit value was supplied but is
  // invalid — see replyTo's own doc comment for why this differs from
  // how a malformed PLATFORM_REPLY_TO_EMAIL is treated below.
  if (input.replyTo !== undefined && !isValidReplyToAddress(input.replyTo)) {
    return { ok: false, reason: "provider_error" };
  }

  // E2E-only fake, gated on the identical TEST_MODE flag src/lib/test-
  // mode.ts's identity bypass and src/lib/storage/test-storage.ts's fake
  // Storage both use — never a second independent check. This sandbox has
  // no real Resend to reach any more than it has real Supabase, so a real
  // send is equally unreachable in an E2E run; this reports the same
  // shape a real successful send would, without ever calling fetch() or
  // needing a real RESEND_API_KEY/INVITATION_FROM_EMAIL.
  if (TEST_MODE) {
    return { ok: true };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = input.idempotencyKey;
  }

  const body: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (input.replyTo !== undefined) {
    // Already validated above (shape, length, no header-injection
    // character) and already confirmed mutually exclusive with
    // disablePlatformReplyTo — always wins over the platform-wide
    // default when present, never merged/appended/second-guessed here.
    body.reply_to = input.replyTo;
  } else if (input.disablePlatformReplyTo !== true) {
    const platformReplyTo = getTransactionalReplyToEmail();
    if (platformReplyTo !== null) {
      body.reply_to = platformReplyTo;
    }
  }
  if (input.attachments !== undefined) {
    body.attachments = input.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      ...(attachment.content_type !== undefined ? { content_type: attachment.content_type } : {}),
    }));
  }

  const controller = input.timeoutMs !== undefined ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), input.timeoutMs) : undefined;

  try {
    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch {
      return { ok: false, reason: "network_error" };
    }

    if (!response.ok) {
      return { ok: false, reason: "provider_error" };
    }

    // Provider acceptance is already known at this point (2xx) — a failed
    // or aborted read of the response body must never downgrade this to a
    // failure; it only means messageId stays absent. The same
    // AbortController/timer that bounds the fetch above also bounds this
    // read, since the timer is only cleared in the `finally` below, after
    // this attempt has settled.
    try {
      const parsed: unknown = await response.json();
      return acceptedResult(extractMessageId(parsed));
    } catch {
      return { ok: true };
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
