import "server-only";
import { TEST_MODE } from "@/lib/test-mode";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §26/§37). The one place `fetch()` is ever
 * called to reach Slack — no SDK, native fetch only, mirroring
 * src/lib/invoices/pdf/logo.ts's own proven outbound-fetch-safety
 * precedent (bounded timeout, `redirect: "manual"`, no redirect ever
 * followed).
 *
 * Every consumer (the post-commit best-effort attempt, the retry worker,
 * "Send test") calls this exact function — never a second copy of the
 * request-building/response-classification logic.
 */

const FETCH_TIMEOUT_MS = 5000; // Same bound as logo.ts's own FETCH_TIMEOUT_MS — no Slack-specific precedent exists in this repo, so this proven value is reused rather than inventing a new one.
const MAX_RESPONSE_BYTES = 1024; // Slack's own response body is a short plain-text token ("ok" or a short error string) — bounded defensively regardless.

export type SlackSendOutcome =
  | { outcome: "success" }
  | { outcome: "retryable"; code: SlackErrorCode; retryAfterMs?: number }
  | { outcome: "permanent"; code: SlackErrorCode };

export type SlackErrorCode =
  | "SLACK_TIMEOUT"
  | "SLACK_RATE_LIMITED"
  | "SLACK_CLIENT_ERROR"
  | "SLACK_SERVER_ERROR"
  | "SLACK_REDIRECT_REJECTED"
  | "SLACK_INVALID_RESPONSE"
  | "SLACK_NETWORK_ERROR";

export type SendSlackMessageFn = (url: string, text: string) => Promise<SlackSendOutcome>;

/**
 * Bounded `Retry-After` parsing — Slack's own header, if present, is
 * always a plain integer number of seconds for a 429 (never an HTTP-date
 * in this context) — a value outside a sane bound (0..3600s) is treated
 * as absent rather than trusted verbatim, so a misbehaving/hostile
 * response can never schedule a retry arbitrarily far in the future or
 * cause a negative delay.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return undefined;
  return Math.round(seconds * 1000);
}

/**
 * TEST_MODE-only transport redirect, applied at the lowest possible
 * layer — AFTER validation (src/lib/integrations/slack-url.ts, unchanged,
 * still requires hooks.slack.com in every environment) and AFTER storage
 * (the encrypted, stored URL is always the real hooks.slack.com value).
 * Only the literal fetch() destination is swapped, and only when both
 * TEST_MODE=1 AND TEST_SLACK_FIXTURE_BASE_URL are set — neither is ever
 * true in a real deployment (same "never set in committed config"
 * guarantee TEST_MODE itself already documents). Mirrors
 * resolveInvoiceLogo()'s own TEST_MODE branch in src/lib/invoices/pdf/
 * logo.ts: swap the actual network call for a deterministic local
 * substitute, while every upstream safety check stays production-real.
 */
function resolveSendTarget(url: string): string {
  if (!TEST_MODE) return url;
  const fixtureBaseUrl = process.env.TEST_SLACK_FIXTURE_BASE_URL;
  if (!fixtureBaseUrl) return url;
  // Path/query preserved, origin swapped — the fixture server can still
  // see which "webhook path" a message was sent to if a test cares.
  const original = new URL(url);
  const fixture = new URL(fixtureBaseUrl);
  fixture.pathname = original.pathname;
  fixture.search = original.search;
  return fixture.toString();
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
  } catch {
    return "";
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Sends one Slack Incoming Webhook message. Never throws — every failure
 * mode (timeout, network error, redirect, non-2xx, malformed response)
 * resolves to a typed outcome instead. Never includes the webhook URL in
 * any returned value, and never logs it, the response body, or any
 * header.
 */
export async function sendSlackMessage(url: string, text: string): Promise<SlackSendOutcome> {
  const target = resolveSendTarget(url);

  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { outcome: "retryable", code: "SLACK_TIMEOUT" };
    }
    return { outcome: "retryable", code: "SLACK_NETWORK_ERROR" };
  }

  // "manual" makes a redirect resolve to an opaqueredirect response
  // (status 0, no readable headers) rather than being followed — treated
  // as a permanent, safe failure. Never followed, in any environment.
  if (response.type === "opaqueredirect") {
    return { outcome: "permanent", code: "SLACK_REDIRECT_REJECTED" };
  }

  if (response.status >= 200 && response.status < 300) {
    // HTTP success semantics alone — deliberately not coupled to Slack's
    // own plain-text "ok" response body (locked spec §26: "prefer HTTP
    // success semantics to avoid fragile provider-text coupling").
    await readBoundedText(response); // Drain, bounded — never inspected further.
    return { outcome: "success" };
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    await readBoundedText(response);
    return { outcome: "retryable", code: "SLACK_RATE_LIMITED", retryAfterMs };
  }

  if (response.status >= 500) {
    await readBoundedText(response);
    return { outcome: "retryable", code: "SLACK_SERVER_ERROR" };
  }

  if (response.status >= 400) {
    await readBoundedText(response);
    return { outcome: "permanent", code: "SLACK_CLIENT_ERROR" };
  }

  // Any other, unexpected status class (e.g. a bare 1xx) — treated as a
  // safe, non-retryable failure rather than guessed at.
  await readBoundedText(response);
  return { outcome: "permanent", code: "SLACK_INVALID_RESPONSE" };
}
