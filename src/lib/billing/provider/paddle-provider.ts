import "server-only";
import { ApiError } from "@paddle/paddle-node-sdk";
import type {
  BillingProviderAdapter,
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
 * Sale-Ready Phase E, E2.3 (Paddle Provider Core — checkout + customer
 * portal only). The real, server-only Paddle implementation of
 * `BillingProviderAdapter` (`./types.ts`). Deliberately NOT wired into
 * `getBillingProviderAdapter()` (`./provider.ts`) in this PR — see that
 * file's own doc comment, unchanged. Every method here is reachable only
 * by whatever test or future caller constructs this adapter directly;
 * production behavior is unaffected until a later PR adds the real third
 * resolver branch (`scripts/security-checks/check-billing-security.mjs`'s
 * own check 24 guards against that happening by accident).
 *
 * Webhook methods (`verifyWebhook`/`parseWebhookEvent`) exist only for
 * type compatibility with `BillingProviderAdapter` — both are safe,
 * fail-closed placeholders (see their own doc comments below). Real
 * webhook signature verification/event parsing is a later PR (E2.4+),
 * not this one.
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
     * Placeholder only — real Paddle-Signature HMAC verification is a
     * later PR (E2.4+, already designed in this PR's own report: manual
     * `node:crypto` verification against `ts:rawBody`, matching Paddle's
     * documented scheme, not the SDK's combined `webhooks.unmarshal`
     * helper — see docs/billing-provider-adapter.md). Always fails
     * closed here — `verified: false` unconditionally, a safe, generic
     * reason string, never a throw, never network/crypto work. Since
     * this adapter is never reached by the resolver in this PR (see this
     * file's own header comment), this method is unreachable in
     * production today regardless.
     */
    verifyWebhook(input: WebhookVerificationInput): WebhookVerificationResult {
      void input; // Interface conformance only — real verification is E2.4+ (see this method's own doc comment above).
      return { verified: false, reason: "not_implemented" };
    },

    /**
     * Placeholder only — real event parsing/normalization (the mapping
     * table this PR's own report already designed) is a later PR. Always
     * `null` — the same "malformed/unparseable" signal
     * `BillingProviderAdapter.parseWebhookEvent`'s own doc comment
     * already defines, never a fabricated `EVENT_IGNORED` result (that
     * would incorrectly imply this adapter successfully recognized and
     * deliberately ignored something, which isn't true yet).
     */
    parseWebhookEvent(rawBody: string): NormalizedBillingEvent | null {
      void rawBody; // Interface conformance only — real parsing is E2.4+ (see this method's own doc comment above).
      return null;
    },
  };
}
