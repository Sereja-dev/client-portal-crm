# Billing Provider Adapter — Handoff Guide

Written for whoever eventually connects a real payment provider (Paddle or
Stripe) to this app. It explains the adapter contract Stage 4 built, how
the TEST_MODE-only mock implements it, exactly what a real implementation
needs to do differently, and the checklist for going live. **No real API
keys, secrets, or price IDs are included anywhere in this document.**

See also: [`docs/billing-architecture.md`](billing-architecture.md) (the
overall design) and [`docs/operator-setup.md`](operator-setup.md) (the
practical "what's left" checklist).

## Why this exists

Stages 1–3 built a local, provider-neutral billing foundation
(`Subscription`/`WebhookEvent` schema, plan catalog, entitlements,
enforcement, and a Billing UI) with no payment provider connected at all.
Stage 4 built the *shape* every future provider integration plugs into —
a typed adapter interface, a registry that resolves to either a real
adapter or a safe stand-in, a deterministic mock that exercises the full
checkout → webhook → Subscription-update pipeline in tests, and a
provider-neutral webhook route. Connecting Paddle or Stripe for real is
now a matter of implementing one interface and wiring a few environment
variables — no changes to entitlements, the Billing UI, or the webhook
route's own trust/idempotency/ordering logic.

## Implementation status (Sale-Ready Phase E)

- **E2.2** — `src/lib/billing/provider/paddle-config.ts`: reads and
  validates the env vars below (fail-closed on any partial config).
- **E2.3 (this PR)** — `src/lib/billing/provider/paddle-provider.ts`: a
  real, server-only Paddle adapter. **`createCheckoutSession` and
  `createCustomerPortalSession` are implemented** against the actual
  Paddle Transactions API and Customer Portal Sessions API (via the
  official `@paddle/paddle-node-sdk`). **`verifyWebhook`/
  `parseWebhookEvent` are still safe, fail-closed placeholders** —
  `verifyWebhook` always returns `{ verified: false, reason:
  "not_implemented" }`, `parseWebhookEvent` always returns `null`. Real
  webhook signature verification and event parsing are a later PR
  (E2.4+).
- **The provider registry (`getBillingProviderAdapter()`,
  `./provider.ts`) is still unchanged** — it still only ever resolves to
  the mock (`TEST_MODE`) or the fail-closed unconfigured adapter. The
  real Paddle adapter exists and is fully unit-tested, but is not yet
  reachable from anywhere in the running application. Wiring it in as
  the real third branch is a later PR.
- **No Paddle account was created or required for this PR** — every
  test uses a fully mocked SDK client, no network call is ever made. Per
  the sale-ready framing established in E2.2: real credentials are still
  supplied later, by whoever actually connects a Paddle account —
  never by this repository.

## The adapter contract

`src/lib/billing/provider/types.ts` defines `BillingProviderAdapter`:

```ts
interface BillingProviderAdapter {
  readonly kind: "mock" | "unconfigured" | "paddle";
  readonly name: BillingProvider; // "PADDLE"

  createCheckoutSession(input: BillingCheckoutSessionInput): Promise<BillingCheckoutSession>;
  createCustomerPortalSession(input: BillingPortalSessionInput): Promise<BillingPortalSession>;
  verifyWebhook(input: WebhookVerificationInput): WebhookVerificationResult;
  parseWebhookEvent(rawBody: string): NormalizedBillingEvent | null;
}
```

Everything crossing this boundary is already normalized to this app's own
vocabulary — no Paddle- or Stripe-specific type, field name, or status
string is allowed to leak past `src/lib/billing/provider/*` (enforced by
`scripts/security-checks/check-billing-security.mjs`). A real
`Subscription.status` cancellation flow, a Paddle `subscription.canceled`
event, and a Stripe `customer.subscription.deleted` event all become the
exact same `NormalizedBillingEvent` shape by the time anything outside
this directory ever sees one.

There is deliberately no `cancelSubscription`/`resumeSubscription` method
on this interface — the current UI never calls a provider API directly to
cancel; "Manage subscription" redirects to the provider's own hosted
Customer Portal, and this app only ever learns the result via a webhook.
Add such a method later only if a genuine in-app "Cancel now" button ships
— it would be a compatible, additive interface change.

### `verifyWebhook` reads headers, not a single string

`WebhookVerificationInput` carries the full `Headers` object, not one
pre-extracted signature string — different providers sign with different
header names entirely (Paddle: `Paddle-Signature`, Stripe:
`Stripe-Signature`). Keeping header-name knowledge inside each adapter is
what keeps `src/app/api/billing/webhook/route.ts` itself genuinely
provider-neutral: it never needs to know which header any given provider
uses.

## The registry

`src/lib/billing/provider/provider.ts`:

```ts
export function getBillingProviderAdapter(): BillingProviderAdapter {
  if (TEST_MODE) return createMockBillingProvider();
  return createUnconfiguredBillingProvider();
}
```

Every checkout/portal Server Action and the webhook route call this —
never construct an adapter any other way. `getBillingProviderAvailability()`
(`src/lib/billing/provider-availability.ts`) derives the Billing UI's
`configured`/`checkoutAvailable`/`portalAvailable` flags from
`adapter.kind` — the UI never has its own opinion about whether a
provider is connected.

**Adding a real provider is a third branch here** — gated on a real
env var this stage deliberately does not read (see below), returning a
new `createPaddleBillingProvider()` (or `createStripeBillingProvider()`)
that implements `BillingProviderAdapter` against the provider's real SDK.
Nothing else in the registry, the actions, or the webhook route needs to
change. Importing this module must never throw or fail in a production
deployment with no billing env vars configured at all — the two-branch
behavior above already guarantees that; a third, real-provider branch
must preserve it (e.g. `if (isPaddleConfigured()) return
createPaddleBillingProvider(); return createUnconfiguredBillingProvider();`).

## The mock provider

`src/lib/billing/provider/mock-provider.ts` — a full, deterministic,
TEST_MODE-only stand-in. It:

- makes zero network calls;
- stores no card/payment data (there is none to store — it never collects
  a card number, email, or billing address at all);
- derives `providerCustomerId`/`providerSubscriptionId` deterministically
  from `organizationId` (`deriveMockCustomerId`/`deriveMockSubscriptionId`)
  rather than randomly, so tests can assert on them without capturing a
  generated value first;
- signs its own webhook payloads with a fixed, TEST_MODE-only HMAC secret
  (`signMockWebhookPayload`) — never a real secret, never read from an env
  var, and (via a second, independent `if (!TEST_MODE) throw` guard at
  construction) never reachable outside TEST_MODE even if the registry
  were ever miswired.

Two TEST_MODE-only pages simulate what a real provider's hosted checkout/
Customer Portal would do — `src/app/billing/mock/checkout/page.tsx` and
`src/app/billing/mock/portal/page.tsx`. Both 404 unconditionally outside
TEST_MODE (`if (!TEST_MODE) notFound()`, checked before anything else —
including before any dynamic API call, and both pages export `dynamic =
"force-dynamic"` specifically so this check re-runs on every request
instead of being baked into a static 404 at build time). Neither page —
nor any Server Action behind it — ever writes to `Subscription` directly;
every simulated outcome (checkout success, cancel, simulated payment
failure) builds and signs a real event, then POSTs it to the real
`/api/billing/webhook` route, the exact same path a genuine provider
delivery takes.

## The webhook route

`src/app/api/billing/webhook/route.ts` — provider-neutral, no user
session dependency. Sequence:

1. Read the raw body exactly once.
2. Resolve the adapter; an unconfigured provider fails closed (400, no
   DB write) before anything else.
3. `adapter.verifyWebhook(...)` — invalid signature → 400, no DB write.
4. `adapter.parseWebhookEvent(...)` — unparseable → 400, no DB write.
5. Resolve and trust-validate the event's claimed `organizationId`
   (must exist; its provider customer/subscription ids must not already
   belong to a *different* org's `Subscription` row).
6. Idempotency: `prisma.webhookEvent.create(...)` with a real unique
   constraint on `providerEventId` — a `P2002` here means "already
   received," a safe no-op, never reprocessed. This is a real
   insert-and-catch, not a check-then-insert race.
7. `applyBillingEventToSubscription(...)` (`src/lib/billing/event-mapper.ts`,
   a pure function) decides whether to apply, ignore, or reject — an
   event whose own `providerUpdatedAt` doesn't advance past the row's
   last-applied one is ignored, never regresses state.
8. On `APPLY`: one transaction updates `Subscription`, marks the
   `WebhookEvent` row `PROCESSED`, and creates any relevant
   `Notification` row(s) for the org's OWNER — all together, so one
   event's failure can never leave things half-updated.
9. Best-effort email delivery runs after the transaction commits (the
   same `deliverNotificationEmails()` every other notification-producing
   flow in this app already uses — no new email code path).

Never logs the raw payload, a signature, or any provider secret. Never
stores the raw payload on `WebhookEvent` (that table has no such column,
by design — see `docs/billing-architecture.md` §5).

## Local Subscription mapping

`src/lib/billing/event-mapper.ts`'s `applyBillingEventToSubscription` is
pure — no I/O, fully unit-tested (`test/unit/billing-event-mapper.test.ts`)
against every `SubscriptionStatus`, plan changes, `cancelAtPeriodEnd`,
grace-period computation (7 days, set once on first entry into
`PAST_DUE`, preserved on repeats, cleared on recovery), unknown plan keys
(stored verbatim — `entitlements.ts` already treats any unrecognized
value as LEGACY-safe), and the old-event ordering guard. It never touches
the entitlement engine directly — `getOrganizationEntitlements()`
continues to just read whatever `Subscription` row this mapper's output
was used to write.

## Required environment variables

Documented as empty placeholders in `.env.example` — see that file's own
comments. **Sale-Ready Phase E, E2.2** added
`src/lib/billing/provider/paddle-config.ts`, which reads and validates
all six variables below — but nothing calls that module yet, and
`getBillingProviderAdapter()` still only ever resolves to the mock
(`TEST_MODE`) or the fail-closed unconfigured adapter (E2.2's own PR
deliberately does not add the third branch). Setting these today still
has zero effect on runtime behavior:

| Variable | Purpose |
|---|---|
| `BILLING_PROVIDER` | Which real provider is configured. Must be exactly `PADDLE` (matching the `BillingProvider` Prisma enum's own casing) — anything else, `paddle-config.ts` treats Paddle as entirely unconfigured. |
| `BILLING_ENVIRONMENT` | Which Paddle mode these credentials are for — exactly `sandbox` or `live`, nothing else accepted (never guessed, never defaulted). The Paddle Node SDK requires this explicitly at client construction; it cannot be inferred from the API key alone. |
| `BILLING_API_KEY` | The provider's server-side API key. Server-only — never `NEXT_PUBLIC_`. |
| `BILLING_WEBHOOK_SECRET` | Used by the real adapter's `verifyWebhook` to compute/compare the provider's actual signature. Server-only. |
| `BILLING_STARTER_PRICE_ID` | The real provider price id for the `STARTER` plan (`src/lib/billing/plans.ts`'s `PLAN_CATALOG.STARTER`). |
| `BILLING_PRO_PRICE_ID` | Same, for `PRO`. |

`scripts/security-checks/check-billing-security.mjs` already fails the
build if any of these (or any future billing/provider variable) is ever
given a `NEXT_PUBLIC_` prefix — `paddle-config.ts` lives under
`src/lib/billing/provider/`, so it's automatically covered by that same
script's existing "every file here is server-only" and "no console
logging here" checks too, with no new assertions needed.

**All six values are supplied later, by whoever actually connects a real
Paddle account — never by this repository.** This project is designed to
be sold as a SaaS foundation: the current owner does not create a Paddle
account, does not go through KYC/KYB, and does not enter any real
credentials here. A future buyer creates their own Paddle account
(sandbox first, then live), fills in their own values for these six
variables in their own deployment's environment, and registers their own
webhook endpoint — with zero application code changes required. No real
key, secret, or price id belongs in this file, `.env.example`, or any
other committed file, ever.

`getPaddleProviderConfig()` (`paddle-config.ts`) treats any single
missing or invalid value — including an unrecognized `BILLING_ENVIRONMENT`
— as "Paddle is not configured" (returns `null`), never a partial or
best-effort configuration.

### Where plan → price id mapping belongs

`src/lib/billing/plans.ts`'s `PLAN_CATALOG` is the single source of truth
for plan *limits* and stays a code-defined, deploy-reviewed constant —
never a runtime database edit (see that file's own header comment). A
real adapter's `createCheckoutSession` is the one place that maps a
`planKey` to a real provider price id, reading
`BILLING_STARTER_PRICE_ID`/`BILLING_PRO_PRICE_ID` — this mapping should
live inside the adapter implementation itself (e.g.
`src/lib/billing/provider/paddle-provider.ts`'s own small
`PRICE_ID_BY_PLAN_KEY` lookup), not inside `plans.ts`, which must stay
provider-agnostic.

## Required provider metadata

When a real adapter creates a checkout session, it must embed the
organization id as trusted, provider-echoed metadata (Paddle's
`custom_data`, Stripe's `metadata`) so the webhook can recover which
`Organization` a delivered event is about. This is exactly what
`NormalizedBillingEvent.organizationId` is for — a real adapter's
`parseWebhookEvent` reads it out of the provider's own payload and
returns it as a claim; the webhook route (not the adapter) is what
validates that claim against the database before ever applying it (see
"The webhook route" above). Never accept an organization id from
anywhere else in a webhook payload.

## Test-mode → live checklist

1. Choose and confirm provider eligibility (Paddle vs. Stripe) — still an
   open, unverified item per `docs/billing-architecture.md` §2/§16. Get
   accountant/legal sign-off before proceeding.
2. Implement `createPaddleBillingProvider()` (or Stripe's equivalent)
   against `BillingProviderAdapter`, using the provider's real SDK/API —
   confined entirely to its own file(s) under
   `src/lib/billing/provider/`.
3. Add the real environment variables (above) to the deployment — never
   commit them.
4. Add the real provider as a third branch in `getBillingProviderAdapter()`,
   gated on the new env var(s) actually being present.
5. Point the provider's real webhook configuration at
   `/api/billing/webhook` (this app's route needs no change).
6. Test against the provider's own test/sandbox mode end to end — real
   checkout, real webhook delivery, confirm `Subscription` updates and
   `Notification`s fire exactly as the mock already proved they would.
7. Only after that: flip to live-mode credentials/price ids. Treat this
   as a deliberate, reviewed deploy step, never an automatic migration —
   see `docs/operator-setup.md`'s own "Live payments" section.

## Security checklist (already enforced today)

Everything below is verified by `scripts/security-checks/check-billing-security.mjs`
(run via `npm run security:check`) — a real provider implementation must
keep every one of these true:

- Every file under `src/lib/billing/provider/` is server-only.
- No `NEXT_PUBLIC_` billing/provider environment variable anywhere.
- No console logging of the webhook route or provider adapter directory
  (a raw payload/signature/secret must never reach a log line).
- The webhook route verifies the signature before ever parsing the
  payload, with no `TEST_MODE`-gated bypass of its own.
- Idempotency via a real database unique-constraint catch, not a
  check-then-insert race.
- The event mapper's `providerUpdatedAt` ordering guard.
- Checkout/portal actions are OWNER-only, and never accept
  `organizationId`/`userId`/`providerCustomerId`/`providerSubscriptionId`
  as a parameter from any caller.
- Return/cancel URLs are only ever built through `sanitizeRedirectPath`.
- The mock provider and both mock UI pages are unreachable outside
  TEST_MODE.
- No hardcoded provider price/product id literal anywhere in `src/`.
- The webhook route validates organization existence and rejects
  cross-org provider id reuse.
- The Client Portal never imports any part of the Billing UI or `src/lib/billing`.
