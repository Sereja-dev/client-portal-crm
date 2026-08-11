# Operator Setup

Notes for whoever eventually operates a real deployment of this project —
what's already built, what still needs connecting, and what's deliberately
left undone. Currently covers **Billing only**; other sections will be
added here as they become relevant.

No real credentials, keys, or account-specific values are included
anywhere in this document. Every value below is a placeholder to fill in
from your own provider account.

## Billing

See [`docs/billing-architecture.md`](billing-architecture.md) for the full
design and [`docs/billing-provider-adapter.md`](billing-provider-adapter.md)
for the adapter contract, mock behavior, and the exact test-mode → live
checklist. This section is the practical "what do I still need to do"
summary for an operator, not a repeat of either document.

### What's already implemented

- A local, provider-neutral `Subscription`/`WebhookEvent` schema, a typed
  plan catalog (`src/lib/billing/plans.ts`), organization entitlements
  (`src/lib/billing/entitlements.ts`), and server-side limit enforcement on
  staff invites, Client/Project creation, and Attachment uploads.
- A staff-only Billing page (`/settings/billing`) showing current plan,
  status, usage, and Starter/Pro plan cards — all sourced from the local
  database.
- A **provider-neutral adapter contract** (`src/lib/billing/provider/*`)
  that a real Paddle/Stripe integration implements against, plus a
  registry (`getBillingProviderAdapter()`) that resolves to it — see
  `docs/billing-provider-adapter.md`.
- A **real checkout flow** (`requestPlanChangeAction`) and **real
  Customer Portal flow** (`manageSubscriptionAction`) — owner-only,
  server-resolved organization, allowlisted plan keys, safe return URLs,
  reused provider customer ids. Both redirect to whatever the resolved
  adapter's session URL is; neither ever writes to `Subscription` itself.
- A **real, provider-neutral webhook route**
  (`POST /api/billing/webhook`) — signature verification, idempotency,
  event-ordering guard, cross-org id-conflict protection, and atomic
  `Subscription`/`Notification` updates. Fully built and tested, but
  currently only ever reachable by the TEST_MODE-only mock provider —
  there is no real provider webhook configuration to point at yet.
- A **full, deterministic mock provider**, active only when
  `TEST_MODE=1` (a flag this app already only ever sets for its own E2E
  test runs — never in a real deployment). Makes zero network calls,
  collects zero payment data, and exercises the entire checkout →
  webhook → Subscription-update → Notification pipeline for real. Two
  TEST_MODE-only pages (`/billing/mock/checkout`, `/billing/mock/portal`)
  simulate what a provider's hosted pages would do; both 404
  unconditionally in any real deployment.
- Billing events (subscription activated, payment failed, subscription
  canceled, plan changed) notify the organization's OWNER through the
  existing in-app Notification Center and email, with the same
  graceful-degradation behavior every other notification type already
  has (see "Notifications" below).
- Every organization created so far — including ones created before
  billing existed — resolves to a safe access mode (`FULL_ACCESS` for a
  pre-billing/legacy org, a real trial/paid state for a new one). Nothing
  in the current code degrades an existing organization's access.

### What's still pending — connecting a real payment provider

The *shell* is built; the *provider* is not. None of the following
exists yet:

1. **Provider account and mode selection.** The architecture doc
   recommends Paddle (Merchant of Record) over Stripe, but this is flagged
   there as an *unverified, pre-implementation* recommendation — confirm
   product/country eligibility and review with an accountant before
   committing (see `docs/billing-architecture.md` §2/§16).
2. **A real adapter implementation.** No Paddle/Stripe SDK is installed.
   `docs/billing-provider-adapter.md` has the exact interface
   (`BillingProviderAdapter`) and a step-by-step checklist for
   implementing and wiring one in as a third branch in
   `getBillingProviderAdapter()` — no changes needed to entitlements, the
   Billing UI, or the webhook route's own logic.
3. **Real price IDs.** No price/product IDs are hardcoded anywhere in this
   codebase. They must come from environment variables added at the time a
   provider is actually connected — never committed to source (see the
   `BILLING_*_PRICE_ID` placeholders in `.env.example`).
4. **New environment variables — placeholders only today.**
   `BILLING_PROVIDER`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET`,
   `BILLING_STARTER_PRICE_ID`, `BILLING_PRO_PRICE_ID` are listed, empty,
   in `.env.example`. As of Sale-Ready Phase E, E2.6, the code *does*
   read and act on them (`getBillingProviderAdapter()` activates the
   real Paddle adapter once every one of them is set to a valid,
   complete value) — but none has ever been set to a real value in this
   repository, so this still has zero effect until a real Paddle account
   supplies them. When they're set for real, they must stay server-only;
   never give any of them a `NEXT_PUBLIC_` prefix
   (`scripts/security-checks/check-billing-security.mjs` already guards
   against that mistake).
5. **The provider's own webhook configuration.** Once a real adapter and
   `BILLING_WEBHOOK_SECRET` exist, point the provider's webhook settings
   at `POST /api/billing/webhook` — the route itself needs no change.
6. **Trial-ending reminders (`TRIAL_ENDING`).** Deferred — needs a daily
   cron job (see `docs/billing-architecture.md` §17/§18) this stage
   doesn't build. The other four billing notification types
   (activated/payment-failed/canceled/plan-changed) are already live,
   webhook-triggered.
7. **Reconciliation cron.** `docs/billing-architecture.md` §18 designs a
   daily "re-fetch from the provider and correct drift" job as a
   webhook-delivery backstop — not built yet. Not required for webhooks
   to work correctly; only for the (rare) case one is missed entirely.

### Notifications

Billing events already flow through the existing Notification Center —
no separate email pipeline. In production with no email provider
configured (`RESEND_API_KEY`/`INVITATION_FROM_EMAIL` unset), the
in-app `Notification` row is still created; email delivery is recorded as
`SKIPPED`/`not_configured` rather than failing, and webhook processing
itself always succeeds regardless of email configuration — the same
graceful-degradation behavior every other notification type in this app
already has.

### Migration and backfill

- Two billing-related migrations exist —
  `prisma/migrations/20260830090000_add_billing_foundation/` (Stage 2:
  the `Subscription`/`WebhookEvent` schema) and
  `prisma/migrations/20260907100000_add_billing_notification_types/`
  (Stage 4: four additive `NotificationType` enum values). **Both have
  been applied to production** (Sale-Ready Phase E, E1) — verified
  directly against the production database via `prisma migrate status`:
  all 22 migrations report applied, schema up to date, the billing
  foundation migration present, no migrations pending.
- `prisma/backfill-subscriptions.ts` (idempotent, dry-run by default) gives
  every pre-existing organization an explicit `LEGACY` Subscription row
  instead of relying indefinitely on the "no row = legacy access" fallback.
  **Verified against production** (Sale-Ready Phase E, E1): a dry run
  reported `Organizations without a Subscription row: 0` — every
  organization already has one, so `--apply` was not needed and no write
  was performed.
- Production runtime was confirmed healthy after this verification —
  including after an unrelated Supabase database password rotation (see
  the security note below) — with a real staff session reaching
  `/dashboard` and `/clients` with no Prisma connection errors.

### Security note — handling production database credentials

Operating against the production database (checking migration status,
running the backfill script) requires `DATABASE_URL`/`DIRECT_URL`
locally, per the [README's own Environment variables table](../README.md#environment-variables)
(Supabase → Project Settings → Database → Connection string). A few
rules, reinforced by an actual incident during Sale-Ready Phase E, E1:

- Production secrets must never be printed to a shell, logged, or pasted
  into a chat/AI session — not even partially. If one is exposed this
  way regardless, treat it as compromised and rotate it immediately, the
  same as if it had been committed to git.
- A local file holding real production credentials (e.g.
  `.env.production.local`) stays gitignored (`.env*` is ignored except
  `.env.example`/`.env.test.example`) and should be deleted once the
  task that needed it is done.
- After rotating the database password in Supabase, **both** Vercel's
  stored `DATABASE_URL`/`DIRECT_URL` (Project Settings → Environment
  Variables) **and** any local `.env*` file must be updated to match —
  and production must be redeployed afterward, since a running
  deployment does not pick up an env var change without a new build.
  Until both are done, production will fail every database query with
  Prisma error `P1000` ("Authentication failed against the database
  server").

### Live payments

Live billing is disabled by construction — there is no code path in this
repository that can currently charge a real customer or reach a real
payment provider. It stays that way until a real adapter is implemented
and connected per `docs/billing-provider-adapter.md`'s own checklist, and
is deliberately turned on.
