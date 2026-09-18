/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §8). The one place a Slack webhook URL is ever
 * validated -- both the connect/replace action (before encryption) and
 * the delivery worker (immediately before sending, re-validating a
 * freshly-decrypted value) call this exact same function, never a second
 * copy of the rules.
 *
 * Commercial Slack only: hostname allowlist is exactly `hooks.slack.com`
 * (verified against current Slack Developer documentation per this
 * feature's implementation spec). GovSlack (slack-gov.com) is
 * deliberately out of scope for V1 and this validator rejects it like
 * any other non-allowlisted host -- no code here special-cases or even
 * mentions slack-gov.com, so there is nothing to accidentally broaden.
 *
 * Every rejection reason is a plain string discriminant (never a thrown
 * exception) -- callers decide what to do (return a validation error to
 * the OWNER, or fail a delivery attempt) without needing to catch/parse
 * an Error's message.
 */

const ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set(["hooks.slack.com"]);
const ALLOWED_PORTS: ReadonlySet<string> = new Set(["", "443"]);

export type SlackWebhookUrlValidation =
  | { valid: true; canonicalUrl: string }
  | {
      valid: false;
      reason:
        | "malformed_url"
        | "not_https"
        | "has_userinfo"
        | "has_fragment"
        | "disallowed_host"
        | "disallowed_port"
        | "invalid_path";
    };

/**
 * `pathname` must start with `/services/` -- the documented shape of a
 * real commercial Incoming Webhook URL
 * (https://hooks.slack.com/services/...). Deliberately not overfit to an
 * exact token-length/segment-count pattern beyond that prefix -- Slack
 * does not document those as a stable contract, and overfitting risks
 * rejecting a legitimate URL Slack is free to reshape later.
 */
function hasValidPathShape(pathname: string): boolean {
  return pathname.startsWith("/services/") && pathname.length > "/services/".length;
}

export function validateSlackWebhookUrl(input: string): SlackWebhookUrlValidation {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { valid: false, reason: "malformed_url" };
  }

  if (url.protocol !== "https:") {
    return { valid: false, reason: "not_https" };
  }
  if (url.username !== "" || url.password !== "") {
    return { valid: false, reason: "has_userinfo" };
  }
  if (url.hash !== "") {
    return { valid: false, reason: "has_fragment" };
  }

  // Exact-match, case-insensitive-normalized (URL's own `hostname` is
  // already lowercased per the WHATWG URL spec, but normalized again
  // here defensively rather than relying on that implicitly). This alone
  // rejects every SSRF-adjacent shape the architecture lock's own policy
  // called out: a literal IP address, "localhost", any subdomain
  // (including one merely *ending* in "slack.com", e.g.
  // "hooks.slack.com.evil.example" or "evil-hooks.slack.com"), and any
  // other host entirely -- none of those can ever string-equal
  // "hooks.slack.com".
  if (!ALLOWED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    return { valid: false, reason: "disallowed_host" };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { valid: false, reason: "disallowed_port" };
  }

  if (!hasValidPathShape(url.pathname)) {
    return { valid: false, reason: "invalid_path" };
  }

  // Canonicalize: URL's own serialization (toString()) is the value
  // stored/encrypted -- never the raw, unnormalized user input string.
  // Query string and search params are preserved as-is (a real Incoming
  // Webhook URL has none), but nothing here strips or rewrites the path.
  return { valid: true, canonicalUrl: url.toString() };
}

/** Safe, non-identifying copy for each rejection reason — never echoes the submitted URL back. */
export function describeSlackWebhookUrlRejection(reason: Exclude<SlackWebhookUrlValidation, { valid: true }>["reason"]): string {
  switch (reason) {
    case "malformed_url":
      return "Enter a valid URL.";
    case "not_https":
      return "The webhook URL must use https://.";
    case "has_userinfo":
      return "The webhook URL must not contain a username or password.";
    case "has_fragment":
      return "The webhook URL must not contain a # fragment.";
    case "disallowed_host":
      return "Only Slack Incoming Webhook URLs (hooks.slack.com) are supported.";
    case "disallowed_port":
      return "The webhook URL must not specify a non-standard port.";
    case "invalid_path":
      return "That doesn't look like a Slack Incoming Webhook URL.";
  }
}
