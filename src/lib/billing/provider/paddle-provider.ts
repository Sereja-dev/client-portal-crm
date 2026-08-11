import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@paddle/paddle-node-sdk";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import type {
  BillingProviderAdapter,
  BillingProviderEventType,
  BillingCheckoutSessionInput,
  BillingCheckoutSession,
  BillingPortalSessionInput,
  BillingPortalSession,
  WebhookVerificationInput,
  WebhookVerificationResult,
  NormalizedBillingEvent,
} from "./types";
import type { PaddleProviderConfig, PaddlePriceIdByPlanKey } from "./paddle-config";
import { createPaddleSdkClient, type PaddleSdkClient } from "./paddle-client";

/**
 * Sale-Ready Phase E. E2.3 (Paddle Provider Core) added
 * `createCheckoutSession`/`createCustomerPortalSession`. E2.4 (Paddle
 * Webhook Verification + Event Normalization) adds the real
 * `verifyWebhook`/`parseWebhookEvent` implementations. The real,
 * server-only Paddle implementation of `BillingProviderAdapter`
 * (`./types.ts`). Still deliberately NOT wired into
 * `getBillingProviderAdapter()` (`./provider.ts`) — see that file's own
 * doc comment, unchanged by E2.4. Every method here is reachable only by
 * whatever test or future caller constructs this adapter directly;
 * production behavior is unaffected until a later PR adds the real third
 * resolver branch (`scripts/security-checks/check-billing-security.mjs`'s
 * own check 24 guards against that happening by accident).
 *
 * `verifyWebhook` and `parseWebhookEvent` are now real, but this adapter
 * is still never reached by the webhook route in production (the
 * resolver doesn't return it) — see this PR's own report for what
 * remains sandbox-unverified even though the logic itself is complete
 * and unit-tested against real, documented Paddle payload shapes.
 */

/** Thrown for any failure this adapter's own two real methods can produce — never carries the raw Paddle SDK error object, a secret, or a raw provider payload; `code` (if known) is Paddle's own short, non-sensitive error code (e.g. `"not_found"`), safe to surface to logs or a caller. */
export class PaddleAdapterError extends Error {
  readonly code: string;

  constructor(message: string, code = "unknown_error") {
    super(message);
    this.name = "PaddleAdapterError";
    this.code = code;
  }
}

/** Paddle's own `ApiError` (a real `Error` subclass, not just a TS-only type) carries a short `code` string (e.g. `"not_found"`, `"conflict"`) that's safe to surface — never the request/response body, headers, or the API key used to make the call. Any other thrown value (a network error, a bug) is reported as `"unknown_error"` rather than risking an accidental secret leak from an unrecognized shape. */
function toSafeErrorCode(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  return "unknown_error";
}

function hasConfiguredPriceId(planKey: string): planKey is keyof PaddlePriceIdByPlanKey {
  return planKey === "STARTER" || planKey === "PRO";
}

function planKeyForPriceId(config: PaddleProviderConfig, priceId: string): keyof PaddlePriceIdByPlanKey | null {
  if (config.priceIdByPlanKey.STARTER === priceId) return "STARTER";
  if (config.priceIdByPlanKey.PRO === priceId) return "PRO";
  return null;
}

// ---------------------------------------------------------------------------
// verifyWebhook — confirmed against Paddle's own current documentation
// (developer.paddle.com/webhooks/about/signature-verification), not
// assumed, before writing any of this.

/**
 * Deliberately WIDER than Paddle's own literal SDK default (5 seconds —
 * "reject events where the ts timestamp in the Paddle-Signature header
 * is more than 5 seconds old"), found during E2.4 PR review to have a
 * real, documented false-rejection history: PaddleHQ/paddle-node-sdk
 * issue #30 ("Webhook time validation error") reports the 5-second
 * default rejecting genuinely valid deliveries, resolved for that
 * integrator by widening to 10 seconds. This app's own deployment target
 * (a Vercel serverless Next.js route) is exactly the kind of environment
 * where a cold start plus normal network latency can plausibly eat a
 * multi-second chunk of a 5-second budget on its own, before Paddle's
 * own delivery latency is even considered — a false rejection here would
 * silently drop a legitimate event (Paddle does retry failed
 * deliveries, but that's an operational band-aid, not something to
 * design around). 30 seconds keeps meaningful margin while staying
 * inside the "5-30 seconds is a typical, reasonable range" guidance
 * commonly given for this kind of check, and is a small concession
 * given this route's own independent, unconditional idempotency
 * guard — every event is deduped on `WebhookEvent.providerEventId` via a
 * real unique-constraint (`P2002`) catch regardless of how fresh its
 * timestamp was judged to be, so a replayed-but-still-within-tolerance
 * event can never be reapplied even once accepted here; this constant's
 * real job is rejecting a *stale* signed payload, not being the sole
 * anti-replay control.
 *
 * Exported so tests reference this exact value rather than a hardcoded
 * magic number, and so it's trivially auditable if this reasoning ever
 * needs revisiting. Still NOT yet exercised against a real Paddle
 * sandbox delivery — see this PR's own report for why that's flagged as
 * an open question rather than assumed safe under real network
 * conditions.
 */
export const PADDLE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 30;

type ParsedPaddleSignatureHeader = { timestamp: string; signatures: string[] };

/**
 * `Paddle-Signature: ts=<unix>;h1=<hex>` — confirmed format. Paddle's own
 * docs state the header "contains at least one h1" and that "during
 * secret rotation, more than one h1 is returned while secrets are
 * rotated out" — this parser collects every h1 value present (the header
 * repeats the `h1=` key-value pair rather than comma-joining multiple
 * hashes under one key), so `verifySignature` below can accept a match
 * against ANY of them, not just the first. This app's own config only
 * ever holds one webhook secret at a time (`PaddleProviderConfig
 * .webhookSecret`) — multiple `h1` values are Paddle's own rotation of
 * its *signing* side, not something this app's config needs to model as
 * multiple secrets.
 */
function parsePaddleSignatureHeader(value: string): ParsedPaddleSignatureHeader | null {
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const rawPart of value.split(";")) {
    const part = rawPart.trim();
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!val) continue;
    if (key === "ts") timestamp = val;
    else if (key === "h1") signatures.push(val);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Different lengths must never reach timingSafeEqual (it throws on a
  // length mismatch) — but returning false immediately here is safe
  // regardless: an attacker who already knows the correct length has
  // gained nothing a generic 400 response wouldn't already tell them.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Pure, synchronous, no network — matches `BillingProviderAdapter
 * .verifyWebhook`'s own contract exactly. Deliberately does NOT use the
 * SDK's own `paddle.webhooks.unmarshal()` helper: that method verifies
 * the signature AND parses the event in one combined call, which doesn't
 * fit this app's own two-step contract (verify, then separately parse) —
 * see docs/billing-provider-adapter.md for the full reasoning. This is a
 * plain `node:crypto` implementation of the exact same algorithm Paddle's
 * own docs describe, not a reimplementation invented independently of
 * them.
 */
function verifyPaddleWebhookSignature(rawBody: string, headers: Headers, webhookSecret: string): WebhookVerificationResult {
  // Headers.get() is case-insensitive per the Fetch API spec — no manual
  // case-folding needed to read "Paddle-Signature" vs "paddle-signature".
  const header = headers.get("paddle-signature");
  if (!header) {
    return { verified: false, reason: "missing_signature_header" };
  }

  const parsed = parsePaddleSignatureHeader(header);
  if (!parsed) {
    return { verified: false, reason: "malformed_signature_header" };
  }

  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { verified: false, reason: "malformed_timestamp" };
  }

  const nowSeconds = Date.now() / 1000;
  if (nowSeconds - timestampSeconds > PADDLE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return { verified: false, reason: "timestamp_too_old" };
  }

  // rawBody used exactly as received — never re-serialized/pretty-printed
  // (Paddle's own docs call this out explicitly: any transformation
  // breaks the signature).
  const expectedSignature = createHmac("sha256", webhookSecret).update(`${parsed.timestamp}:${rawBody}`).digest("hex");

  const matchesAnySignature = parsed.signatures.some((signature) => timingSafeEqualStrings(signature, expectedSignature));
  if (!matchesAnySignature) {
    return { verified: false, reason: "signature_mismatch" };
  }

  return { verified: true };
}

// ---------------------------------------------------------------------------
// parseWebhookEvent — every field name below (event_id, event_type,
// occurred_at, data.id, data.customer_id, data.status, data
// .current_billing_period.{starts_at,ends_at}, data.scheduled_change
// .action, data.custom_data, data.items[].price.id,
// data.items[].trial_dates.ends_at, data.updated_at) is confirmed against
// Paddle's own real, current webhook payload documentation
// (developer.paddle.com/webhooks/subscriptions/*) — quoted example
// payloads, not guessed. custom_data set on a recurring-item transaction
// at checkout time (this adapter's own createCheckoutSession) is
// confirmed by Paddle's own docs to be copied onto the resulting
// Subscription entity and to persist across every subsequent transaction
// for that subscription (renewals, plan changes) — this is *why*
// data.custom_data.organizationId is a reliable claim on every
// subscription.* event for a subscription this app itself created, not
// just the first one.

/** Paddle's real event_type string -> this app's own normalized vocabulary. Deliberately excludes "subscription.paused" (this app's own SubscriptionStatus enum has no PAUSED value — docs/billing-architecture.md's own schema comment: "provider-conditional, not needed for v1") and "subscription.imported" (this app never imports a pre-existing Paddle subscription) — both fall through to EVENT_IGNORED in parseWebhookEvent, not represented here. "subscription.resumed"/"subscription.trialing" deliberately map to the same SUBSCRIPTION_UPDATED value types.ts's own doc comment already established as the "no dedicated event type, the mapper is driven by event.status instead" precedent for a plan change — event-mapper.ts never actually branches on which specific type value it receives (only on whether it's exactly "EVENT_IGNORED"), so this is a display/audit-trail label, not behavior-affecting. */
const PADDLE_SUBSCRIPTION_EVENT_TYPES: Readonly<Record<string, BillingProviderEventType>> = {
  "subscription.created": "SUBSCRIPTION_CREATED",
  "subscription.activated": "SUBSCRIPTION_ACTIVATED",
  "subscription.updated": "SUBSCRIPTION_UPDATED",
  "subscription.resumed": "SUBSCRIPTION_UPDATED",
  "subscription.trialing": "SUBSCRIPTION_UPDATED",
  "subscription.canceled": "SUBSCRIPTION_CANCELED",
  "subscription.past_due": "SUBSCRIPTION_PAST_DUE",
};

/** Confirmed exhaustive: Paddle's own subscription.status field has exactly 5 real values (trialing/active/past_due/paused/canceled) — no "unpaid" and no "incomplete". This app's own SubscriptionStatus.UNPAID/INCOMPLETE are therefore never reachable via a real Paddle event, by design — INCOMPLETE already carries this exact "kept only for exhaustiveness, currently unreachable" status per access-mode.ts's own doc comment; UNPAID now joins it for the same reason, confirmed here rather than left as an open question. "paused" is deliberately absent from this map — status "paused" makes the whole event EVENT_IGNORED before this map is ever consulted (see parseWebhookEvent). */
const PADDLE_SUBSCRIPTION_STATUS: Readonly<Record<string, SubscriptionStatus>> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
};

type PaddleWebhookEnvelope = {
  event_id?: unknown;
  event_type?: unknown;
  occurred_at?: unknown;
  data?: unknown;
};

type PaddleSubscriptionEventData = {
  id?: unknown;
  customer_id?: unknown;
  status?: unknown;
  updated_at?: unknown;
  current_billing_period?: { starts_at?: unknown; ends_at?: unknown } | null;
  scheduled_change?: { action?: unknown } | null;
  custom_data?: { organizationId?: unknown } | null;
  items?: Array<{ price?: { id?: unknown } | null; trial_dates?: { ends_at?: unknown } | null } | null> | null;
};

function parsePaddleDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The shared "recognized but this app deliberately never acts on it" result — a normal, successfully-parsed EVENT_IGNORED, never a `null` parse failure (see BillingProviderAdapter.parseWebhookEvent's own doc comment on that distinction). Every field beyond the three the webhook route's own idempotency insert actually needs (providerEventId/providerCreatedAt, plus type) is left at its own honest empty value — never fabricated. */
function ignoredPaddleEvent(eventId: string, occurredAt: Date): NormalizedBillingEvent {
  return {
    type: "EVENT_IGNORED",
    providerEventId: eventId,
    providerCreatedAt: occurredAt,
    providerCustomerId: null,
    providerSubscriptionId: null,
    organizationId: null,
    planKey: null,
    status: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    trialEnd: null,
    providerUpdatedAt: occurredAt,
  };
}

/**
 * Pure — no I/O, no trust decisions (see this function's own inline
 * notes and this file's own header comment on the trust boundary).
 * Returns `null` only when the payload can't even be parsed as JSON, or
 * is missing the minimal envelope fields (`event_id`/`event_type`
 * /`occurred_at`) every real Paddle event always has — a genuinely
 * malformed payload, never a merely-unrecognized one (which is
 * EVENT_IGNORED, a successful parse, per the interface's own contract).
 */
function parsePaddleWebhookEvent(rawBody: string, config: PaddleProviderConfig): NormalizedBillingEvent | null {
  let envelope: PaddleWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!envelope || typeof envelope !== "object") return null;

  const eventId = envelope.event_id;
  const eventType = envelope.event_type;
  const occurredAt = parsePaddleDate(envelope.occurred_at);

  if (typeof eventId !== "string" || typeof eventType !== "string" || !occurredAt) {
    return null;
  }

  // Non-subscription categories (transaction.*, customer.*, and anything
  // else this Paddle account can send) — recognized as well-formed
  // envelopes, deliberately never acted on. Payment failure is already
  // covered end to end via subscription.past_due (the webhook route's own
  // PAYMENT_FAILED notification fires off that exact status transition,
  // confirmed by reading route.ts before writing this, not assumed) — see
  // this PR's own report for the full reasoning on why
  // transaction.payment_failed/transaction.completed are deliberately not
  // separately mapped.
  if (!eventType.startsWith("subscription.")) {
    return ignoredPaddleEvent(eventId, occurredAt);
  }

  if (eventType === "subscription.paused" || eventType === "subscription.imported") {
    return ignoredPaddleEvent(eventId, occurredAt);
  }

  const mappedType = PADDLE_SUBSCRIPTION_EVENT_TYPES[eventType];
  if (!mappedType) {
    // A subscription.* event this Paddle account can send that this app
    // doesn't yet recognize (e.g. a future new event type) — ignored, not
    // a hard failure; recognizing new event types later is additive.
    return ignoredPaddleEvent(eventId, occurredAt);
  }

  const data = envelope.data as PaddleSubscriptionEventData | undefined;
  if (!data || typeof data !== "object") {
    // A subscription.* event with no data object at all is genuinely
    // malformed — every real Paddle subscription event has one.
    return null;
  }

  const rawStatus = typeof data.status === "string" ? data.status : null;
  if (rawStatus === "paused") {
    // A subscription can also transition INTO paused via a
    // subscription.updated event, not only a dedicated
    // subscription.paused one — same "this app's schema has no PAUSED
    // value" rule applies regardless of which event_type carried it.
    return ignoredPaddleEvent(eventId, occurredAt);
  }
  const status = rawStatus ? (PADDLE_SUBSCRIPTION_STATUS[rawStatus] ?? null) : null;

  const providerCustomerId = typeof data.customer_id === "string" ? data.customer_id : null;
  const providerSubscriptionId = typeof data.id === "string" ? data.id : null;

  const organizationId =
    data.custom_data && typeof data.custom_data === "object" && typeof data.custom_data.organizationId === "string"
      ? data.custom_data.organizationId
      : null;

  const firstItem = Array.isArray(data.items) ? data.items[0] : null;
  const priceId = firstItem?.price && typeof firstItem.price === "object" && typeof firstItem.price.id === "string" ? firstItem.price.id : null;
  // Unknown/unconfigured price id -> planKey stays null, never thrown —
  // event-mapper.ts's own fallback chain (event.planKey ?? existing
  // Subscription's planKey ?? "LEGACY") already handles a null planKey
  // safely; this function's job is only to report what it honestly knows.
  const planKey = priceId ? planKeyForPriceId(config, priceId) : null;

  const period = data.current_billing_period;
  const currentPeriodStart = period && typeof period === "object" ? parsePaddleDate(period.starts_at) : null;
  const currentPeriodEnd = period && typeof period === "object" ? parsePaddleDate(period.ends_at) : null;

  // A scheduled cancellation arrives as a subscription.updated event
  // whose own scheduled_change.action is "cancel" — Paddle only fires
  // subscription.canceled once the cancellation actually takes effect
  // (confirmed against Paddle's own docs), so this is genuinely the only
  // way to learn "the customer scheduled a cancellation but it hasn't
  // happened yet."
  const scheduledChange = data.scheduled_change;
  const cancelAtPeriodEnd =
    !!scheduledChange && typeof scheduledChange === "object" && scheduledChange.action === "cancel";

  // Present on this app's own NormalizedBillingEvent type but not
  // currently read by event-mapper.ts's own SubscriptionUpsertData (that
  // module's own doc comment: trial timing is resolved/preserved by the
  // webhook route itself, not written from an event) — populated here
  // anyway, honestly, whenever Paddle's payload actually carries it,
  // rather than silently left null just because nothing consumes it yet.
  const trialDates = firstItem?.trial_dates;
  const trialEnd = trialDates && typeof trialDates === "object" ? parsePaddleDate(trialDates.ends_at) : null;

  const providerUpdatedAt = parsePaddleDate(data.updated_at) ?? occurredAt;

  return {
    type: mappedType,
    providerEventId: eventId,
    providerCreatedAt: occurredAt,
    providerCustomerId,
    providerSubscriptionId,
    organizationId,
    planKey,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    trialEnd,
    providerUpdatedAt,
  };
}

export function createPaddleBillingProvider(
  config: PaddleProviderConfig,
  sdkClient: PaddleSdkClient = createPaddleSdkClient(config),
): BillingProviderAdapter {
  return {
    kind: "paddle",
    name: "PADDLE",

    /**
     * Server-side only — creates a Paddle Transaction and returns its
     * hosted `checkout.url` for the caller to redirect the browser to
     * (`requestPlanChangeAction` already does exactly this for every
     * adapter, unchanged). Confirmed against Paddle's actual current
     * Transactions API/Node SDK (`CreateTransactionRequestBody`) before
     * writing this — see this function's own inline notes for what is
     * and isn't actually supported, rather than guessed.
     */
    async createCheckoutSession(input: BillingCheckoutSessionInput): Promise<BillingCheckoutSession> {
      if (!hasConfiguredPriceId(input.planKey)) {
        throw new PaddleAdapterError(`No Paddle price id is configured for plan "${input.planKey}".`, "plan_not_configured");
      }
      const priceId = config.priceIdByPlanKey[input.planKey];

      // input.returnUrl/input.cancelUrl are deliberately NOT sent anywhere
      // below — CreateTransactionRequestBody has no field for either.
      // Confirmed against the SDK's own type: the only checkout-adjacent
      // input field is `checkout?: { url?: string }`, which controls
      // *which page renders the checkout widget* (must be a domain
      // approved in the Paddle dashboard, and that page must itself embed
      // Paddle.js — this app has no such page yet, out of this PR's
      // scope), not a post-payment return/cancel redirect. For a
      // subscription specifically, Paddle's own documented way to set a
      // post-checkout redirect is Paddle.js's client-side
      // `Checkout.open({ settings: { successUrl } })` call, or a
      // per-Product default configured once in the Paddle dashboard —
      // neither is a server-side Transactions API parameter. Omitting
      // `checkout` here lets Paddle fall back to the account's own
      // configured default payment link, which is the correct behavior
      // until a later PR adds this app's own Paddle.js-enabled checkout
      // page. See this PR's own report for the same finding in full.
      let transaction: Awaited<ReturnType<PaddleSdkClient["transactions"]["create"]>>;
      try {
        transaction = await sdkClient.transactions.create({
          items: [{ priceId, quantity: 1 }],
          // Reused when present — never a second provider customer for
          // the same org (matches this input field's own doc comment in
          // types.ts). When absent, omitted entirely rather than sent as
          // null/undefined: Paddle's own Transactions API creates (or
          // resolves) a customer automatically from the payment details
          // the buyer enters during checkout when no customerId is given
          // — this app never needs to create a Customer object itself
          // ahead of time. The real provider customer id first becomes
          // known to this app when the resulting webhook event arrives
          // (a later PR), the same "we learn it from the webhook, never
          // create it ourselves speculatively" discipline this whole
          // adapter boundary already follows for Subscription state.
          ...(input.existingProviderCustomerId ? { customerId: input.existingProviderCustomerId } : {}),
          // The organization id, embedded as trusted, provider-echoed
          // metadata — exactly what docs/billing-provider-adapter.md's
          // "Required provider metadata" section already specifies. A
          // future real parseWebhookEvent (E2.4+) reads this back out of
          // the webhook payload as an unverified claim; the webhook route
          // (never the adapter) is what validates it against the
          // database before ever applying it.
          customData: { organizationId: input.organizationId },
        });
      } catch (err) {
        throw new PaddleAdapterError("Paddle checkout session creation failed.", toSafeErrorCode(err));
      }

      const url = transaction.checkout?.url;
      if (!url) {
        // Genuinely possible per Paddle's own API: checkout details are
        // only populated for automatically-collected transactions (or
        // manually-collected ones with checkout explicitly enabled) —
        // never assume it's always present.
        throw new PaddleAdapterError("Paddle did not return a checkout URL for this transaction.", "checkout_url_missing");
      }

      return { url };
    },

    /**
     * Server-side only — creates a Paddle Customer Portal session and
     * returns its general (account-overview) hosted URL. Confirmed
     * against the real API/SDK: `customerPortalSessions.create` takes a
     * `customerId` and an array of `subscriptionIds` for deep-linking to
     * specific subscription management actions — `BillingPortalSessionInput`
     * (this app's own contract) carries no `providerSubscriptionId`
     * field, so an empty array is passed deliberately (never fabricated),
     * and only the general overview URL (`urls.general.overview`) is
     * used, matching this adapter's own single-`{url}`-field return
     * shape. `input.returnUrl` is likewise not sent anywhere — the
     * Customer Portal Sessions API has no such request field; the
     * customer navigates to/from the hosted portal directly.
     */
    async createCustomerPortalSession(input: BillingPortalSessionInput): Promise<BillingPortalSession> {
      let session: Awaited<ReturnType<PaddleSdkClient["customerPortalSessions"]["create"]>>;
      try {
        session = await sdkClient.customerPortalSessions.create(input.providerCustomerId, []);
      } catch (err) {
        throw new PaddleAdapterError("Paddle customer portal session creation failed.", toSafeErrorCode(err));
      }

      const url = session.urls?.general?.overview;
      if (!url) {
        throw new PaddleAdapterError("Paddle did not return a customer portal URL.", "portal_url_missing");
      }

      return { url };
    },

    /**
     * Real Paddle-Signature HMAC-SHA256 verification (E2.4) — see
     * `verifyPaddleWebhookSignature`'s own doc comment for the full
     * algorithm and why it's a plain `node:crypto` implementation rather
     * than the SDK's combined `webhooks.unmarshal` helper. Pure,
     * synchronous, no network — never logs the raw body, signature
     * header, or webhook secret (matches this method's own interface
     * contract). This adapter is still never reached by the resolver in
     * production (see this file's own header comment), so this method is
     * unreachable in production today regardless of being real now.
     */
    verifyWebhook(input: WebhookVerificationInput): WebhookVerificationResult {
      return verifyPaddleWebhookSignature(input.rawBody, input.headers, config.webhookSecret);
    },

    /**
     * Real event parsing/normalization (E2.4) — see
     * `parsePaddleWebhookEvent`'s own doc comment for the full field
     * mapping and trust-boundary notes. Must only ever be called after
     * `verifyWebhook` has already returned `verified: true` (this
     * method's own interface contract) — it performs no verification of
     * its own.
     */
    parseWebhookEvent(rawBody: string): NormalizedBillingEvent | null {
      return parsePaddleWebhookEvent(rawBody, config);
    },
  };
}
