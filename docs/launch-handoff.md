# Aqenra Launch Handoff

## 1. Current Status

**Overall status: Core SaaS ready. Marketing live. Paid billing and AI intentionally not enabled.**

- App baseline SHA: `c7c2b0bc13e03659d8c881157ae789cb29871811` (`main`, clean, matches `origin/main`)
- Marketing baseline SHA: `b635a6f6a8c188b23936d6907c7f55ff54ccda7f` (`main`, clean, matches `origin/main`)
- Production domains: `https://aqenra.com`, `https://www.aqenra.com`, `https://app.aqenra.com` — all live, verified responding as of this handoff (see §2, §4).
- Already live: the SaaS app (Staff + Client Portal + Platform Admin), the marketing site, transactional email, Supabase Storage.
- Intentionally disabled/deferred:
  - **Paddle billing** — not configured in Production, fails closed (see §11)
  - **AI Assistant** — not configured in Production, fails closed (see §12)
  - **Public dollar pricing** — not finalized; marketing states "Launch pricing will be announced before public release"

This is **not** a "full public launch complete" state — it is a ready core product with two deliberately gated features (billing, AI) and one open business decision (pricing) remaining.

---

## 2. Production Architecture

**Marketing**
- `https://aqenra.com` — live
- `https://www.aqenra.com` → `308` redirect to the apex — live, verified
- Separate Vercel project from the SaaS app
- Separate GitHub repository (`aqenra-marketing`)

**App**
- `https://app.aqenra.com` — live
- Existing SaaS Vercel project (unchanged, pre-dates the marketing site)

**Isolation notes**
- Marketing and the SaaS app are **intentionally isolated**: separate repos, separate Vercel projects, no shared code or runtime dependency. This is deliberate, in part to keep the SaaS product cleanly separable for a future transfer/sale.
- `app.aqenra.com` (auth, API, Portal, billing webhook, Platform Admin) must **never** be moved into the marketing project or repo.
- Cloudflare DNS for the apex, `www`, and `app` records is intentionally **DNS-only** (grey-clouded) for Vercel's own domain verification and TLS to work correctly. Do not enable the Cloudflare orange-cloud proxy on these records without deliberate review — it can break Vercel's certificate issuance and routing.

---

## 3. Git / Repositories

**client-portal-crm**
- Path: `~/Projects/freelance/client-portal-crm`
- Remote: `git@github.com:Sereja-dev/client-portal-crm.git`
- Current `main` SHA: `c7c2b0bc13e03659d8c881157ae789cb29871811`

**aqenra-marketing**
- Path: `~/Projects/freelance/aqenra-marketing`
- Remote: `https://github.com/Sereja-dev/aqenra-marketing.git`
- Current `main` SHA: `b635a6f6a8c188b23936d6907c7f55ff54ccda7f`

Both repos deploy from `main` via each project's own Vercel GitHub integration — a push to `main` triggers a Production deploy in that project. The marketing repo is kept separate by design, in part for future transfer/sale isolation of the SaaS product from the marketing asset.

---

## 4. Completed Production Verification

| Area | Status | Evidence / Notes |
|---|---|---|
| Staff invited signup | **DONE (manual, Production)** | Real invited signup completed against Production with a real test identity; verified via a direct, read-only DB check afterward, then cleaned up. |
| Staff confirmation | **DONE (manual, Production)** | Same test — confirmed via a real Resend-delivered confirmation email link. |
| Staff invitation acceptance | **DONE (manual, Production)** | Same test — Membership row confirmed created correctly, then removed. |
| standalone Staff signup | Not independently re-verified in Production | Code-verified (automated tests + build); the completed manual test above was invitation-based, not standalone. |
| standalone Staff login after logout | Not independently re-verified in Production | Code-verified only. |
| Portal invitation flow | Test fixtures prepared, not executed | A real test Client/Project/Invoice was created in Production for this purpose; the full manual click-through was not completed. |
| Portal signup | Not independently re-verified in Production | Code-verified only. |
| Portal confirmation | Not independently re-verified in Production | Code-verified only. |
| Portal explicit acceptance | Not independently re-verified in Production | Code-verified only. |
| Portal client/project isolation | Not independently re-verified in Production | Code- and test-suite-verified (tenant scoping, dedicated security checks); no live manual click-through performed. |
| Portal invoice isolation | Not independently re-verified in Production | Same as above. |
| Portal denial from Staff dashboard | Code-verified (structural) | Enforced by separate identity resolvers; not a manual click-through test. |
| Platform Admin access | Config verified only | `PLATFORM_ADMIN_EMAILS` confirmed present in Vercel Production (value not inspected); no live login-as-admin functional test performed. |
| transactional email delivery | **DONE (manual, Production)** | A real Resend email was sent and successfully used during the Staff invited-signup test above. |
| Resend sender/domain | Functional (inferred from successful send) | No direct Resend-dashboard domain-verification check was performed; the successful real delivery above is the evidence. |
| Storage attachments upload | Not independently re-verified in Production | Config/metadata-verified only (see §7); no manual UI upload test performed. |
| Storage signed download | Not independently re-verified in Production | Same as above. |
| Storage deletion cleanup | Automated test coverage: PASS | Verified via integration tests (Attachment DB row + Storage object removal on delete); not a manual Production test. |
| attachments bucket hardening | **DONE (verified against real Production metadata)** | Direct, read-only query against Production confirmed `file_size_limit`/`allowed_mime_types` are set to match the app's own limits. |
| marketing desktop | Automated verification only | Screenshot pass (4 breakpoints) against the built artifact pre-deploy; live content confirmed matches via HTTP fetch. Not manually reviewed in a live browser. |
| marketing mobile | Automated verification only | Same as above. |
| marketing CTAs | **DONE (verified live)** | Live `href` targets on `aqenra.com` confirmed pointing at `app.aqenra.com/login` and `/signup`. |
| privacy/terms links | **DONE (verified live)** | Confirmed pointing at `app.aqenra.com/privacy` and `/terms`. |
| robots.txt | **DONE (verified live)** | Fetched live, correct content, scoped only to `aqenra.com`. |
| sitemap.xml | **DONE (verified live)** | Fetched live, correct single-URL content. |
| aqenra.com | **DONE (verified live)** | `200`, confirmed responding as of this handoff. |
| www redirect | **DONE (verified live)** | `308` to the apex, confirmed as of this handoff. |
| app.aqenra.com | **DONE (verified live)** | `200`, confirmed responding as of this handoff. |
| new Aqenra favicon/brand mark on marketing | **DONE (verified live)** | `favicon.ico`, `icon.svg`, `apple-touch-icon` all confirmed serving the new mark on `aqenra.com`. |
| new Aqenra favicon/brand mark on app | **DONE (verified live)** | Same three assets confirmed serving the new mark on `app.aqenra.com` (favicon size matches the new asset, not the old generic one). |

---

## 5. Auth Architecture

**Staff**
- Standalone signup and invited signup both go through a controlled, Resend-delivered confirmation link handled at `/auth/confirm` — never Supabase's own native confirmation email/implicit flow.
- Invited signup never accidentally provisions a new Organization — the invitation path skips organization creation entirely.
- A Membership row is created only via the correct, server-validated path (never as a side effect of an unrelated action).

**Client Portal**
- Portal signup uses the same controlled Resend-confirmation architecture, with its own distinct `type=portal_signup` branch — structurally unable to reach Staff provisioning logic.
- Explicit invitation acceptance is required — confirming an email link alone never creates a `PortalUser` row.
- `PortalUser` is created only at the moment of explicit acceptance.
- The invited email must match the authenticated session's verified email — this remains the real security boundary regardless of anything the signup form does or doesn't lock.
- Staff and Portal identity resolution are structurally separate — each surface resolves its own identity from its own table, independently.

**Dual identity**
- Explicitly allowed: one person can legitimately hold both a Staff identity (their own workspace) and a Portal identity (as someone else's client).
- A server-side notice is now shown when an already-authenticated Staff session accepts a Portal invitation at the same email — informational only, never blocking.
- Password-reset now respects the requested surface (`audienceHint`) when both a Staff and a Portal identity exist for the same email, falling back to the documented default (Staff) only when no valid hint is present.
- No schema unification between `User` and `PortalUser` is planned before launch.

---

## 6. Security / Hardening Status

**Completed**
- Tenant isolation (organization-scoped queries throughout)
- Portal project/invoice isolation (client-scoped, verified via dedicated tests)
- Platform Admin authorization via an env-var allowlist, never tied to workspace ownership
- Supabase Storage: deny-by-default RLS posture
- Storage: bucket-level size/MIME limits set on both buckets
- Storage: signed-URL-based download authorization, app-side scoping enforced before every signed URL is issued
- Invitation replay/concurrency protections (conditional update-then-check pattern, real DB unique constraints)
- Billing webhook idempotency: code-ready (real DB unique-constraint dedup), not yet exercised against a real provider delivery
- AI Assistant: read-only by mechanical construction, not merely by prompt wording
- Logging discipline: metadata-only logging, no PII/secrets in any log line anywhere audited
- `TEST_MODE` confirmed absent from Vercel Production
- Dev/mock surfaces (`/billing/mock/*`, `/test-only/theme`, `/api/e2e-test-storage/*`, mock AI/billing providers) all fail closed outside `TEST_MODE`
- Task creation: rate-limited
- Invoice creation: rate-limited
- `CRON_SECRET` comparison: timing-safe
- Client/Project delete blocked by existing invoices: now returns a clear, controlled message instead of a generic failure
- Regression test coverage added for the destructive delete actions above
- Brand/favicon cleanup: generic stock icon replaced in both repos

**Accepted / deferred**
- Rate limiting is in-memory and per-instance (resets on a cold start) — an accepted, app-wide tradeoff, not unique to any one feature.
- The 5 known `npm audit` HIGH findings in the app repo remain confined to the `prisma` CLI's own build-time tooling chain — the runtime `@prisma/client` graph is unaffected.
- Staff↔Portal dual identity remains an intentionally supported product scenario, not a defect.
- No external observability service is required for launch — existing logging discipline plus Vercel's own log capture is judged sufficient.

---

## 7. Storage

**`attachments` bucket**
- Private
- 10 MB file size limit (bucket-level, matches app-level limit)
- MIME allowlist set (matches the app's own allowed attachment types)
- Accessed only via the service-role key, server-side — never a direct client/browser Storage call
- Downloads served exclusively via short-lived signed URLs

**`logos` bucket**
- Public by design (rendered directly in `<img>` tags)
- 2 MB file size limit
- MIME allowlist: `image/png`, `image/jpeg`, `image/webp`

**RLS**
- Enabled on `storage.objects`
- Zero policies defined
- This is deny-by-default for the `anon`/`authenticated` roles — correct, since the app never uses those roles for Storage access (service-role only)

A real Production upload/download UI smoke test has **not** been independently performed — see §4. Bucket configuration itself was verified directly against Production metadata.

---

## 8. Email / Resend

- `aqenra.com` sending domain: functional, inferred from a successful real send (see §4) — not independently checked against Resend's own domain-verification dashboard.
- Sender: `Aqenra <no-reply@aqenra.com>`
- Email flows in place: Staff invite, Portal invite, Staff signup confirmation, Portal signup confirmation, password reset, and a shared legal footer (Privacy/Terms links) on every transactional email.

**Required Production variables**

| Variable | Status |
|---|---|
| `RESEND_API_KEY` | Present in Vercel Production |
| `INVITATION_FROM_EMAIL` | Present in Vercel Production |

(Values not printed or inspected.)

---

## 9. Branding / Marketing

- Marketing site live at `aqenra.com`.
- Text wordmark ("Aqenra") remains unchanged in both the app and marketing headers.
- A custom Aqenra favicon/logomark has been implemented and is live in both repos.
- Concept: two overlapping rounded squares, using the app's own already-approved "Aqenra Indigo" accent colors — no letterform, no resemblance to the generic Next.js/Vercel triangle it replaced.
- The generic stock favicon has been removed from both repos (app and marketing).
- The marketing Open Graph image was left unchanged — it already contained no generic mark and was judged intentional as-is.
- Current pricing copy on the marketing site states "Launch pricing will be announced before public release" — accurate to the app's own current state (no dollar pricing exists anywhere in the product yet).

---

## 10. Dependency Status

**App (client-portal-crm)**
- `npm audit`: critical 0, high 5, moderate 0, low 0
- All HIGH findings confined to the `prisma` CLI's own build-time dependency chain (`@prisma/config`, `deepmerge-ts`, `fast-uri`, `mysql2`)
- The runtime `@prisma/client` dependency graph is unaffected
- No safe remediation currently exists without an undesirable version move (the only available fix path is a major-version change with no clear upstream resolution yet) — no action recommended at this time

**Marketing (aqenra-marketing)**
- `npm audit`: 0 vulnerabilities at every severity
- The `allow-scripts` install-script warning has been resolved
- The ESLint 9 deprecation warning is accepted as-is until the plugin ecosystem (specifically `eslint-plugin-react`, `eslint-plugin-jsx-a11y`, `eslint-plugin-import`) publishes ESLint 10 support — no fix currently exists

---

## 11. Paddle — Intentionally Deferred

**This is a launch gate if paid billing is required.**

**Current state**
- Code readiness: PASS
- 34 dedicated billing security checks pass
- No Paddle environment variables configured in Vercel Production
- No sandbox end-to-end test performed
- No live end-to-end test performed

**Required Production variables**
- `BILLING_PROVIDER`
- `BILLING_ENVIRONMENT`
- `BILLING_API_KEY`
- `BILLING_WEBHOOK_SECRET`
- `BILLING_STARTER_PRICE_ID`
- `BILLING_PRO_PRICE_ID`
- `NEXT_PUBLIC_BILLING_CLIENT_TOKEN`

**Expected webhook endpoint:** `https://app.aqenra.com/api/billing/webhook`

**Safe implementation order**
1. Create a Paddle account.
2. Use Sandbox mode first — never live credentials for initial testing.
3. Create the Starter and Pro products/prices in Paddle.
4. Create a server-side API key.
5. Create a client-side token.
6. Register the webhook endpoint above and capture its signing secret.
7. Verify Paddle's own website/domain approval requirements for the target domain.
8. Run a full sandbox end-to-end test (checkout → webhook → Subscription update).
9. Only after the sandbox test passes, configure live values.
10. Verify `BILLING_ENVIRONMENT=live` is set correctly wherever live credentials are used.
11. Run one live smoke test before enabling paid launch to the public.

**Important:** do not place sandbox Paddle credentials directly into Vercel Production as the normal test strategy. Prefer a Preview deployment, local environment, or another safe sandbox environment for steps 1–8 above.

---

## 12. OpenAI / AI — Intentionally Deferred

**This is a launch gate if the AI Assistant is required at launch.**

**Current state**
- AI code readiness: PASS
- Read-only by construction
- Tenant-scoped
- No Production OpenAI key configured
- `AI_PROVIDER` absent from Vercel Production
- `AQENRA_OPENAI_API_KEY` absent from Vercel Production
- Production AI Assistant therefore fails closed (503 to every user)
- Model is currently hardcoded (`gpt-5.6-luna`) — not configurable via environment variable

**Required before enabling**
1. Create a dedicated Aqenra Production OpenAI project.
2. Create a dedicated Production API key for that project.
3. Configure spend/usage controls on that project/key before it is ever used against real traffic.
4. Set in Vercel Production: `AI_PROVIDER=openai` and `AQENRA_OPENAI_API_KEY=<the new key>`.
5. Redeploy.
6. Run a Production AI smoke test (ordinary request, client/project/task/invoice lookup, cross-tenant isolation attempt, prohibited mutation request, malformed input).
7. Explicitly verify cross-tenant isolation and prohibited-mutation behavior hold in Production, not just in tests.
8. Rollback: remove or blank `AI_PROVIDER` (or the key) and redeploy — restores the fail-closed 503 state immediately, no other cleanup required.

(No real secret value is included anywhere in this document.)

---

## 13. Pricing — Business Decision Required

- No dollar prices are hardcoded anywhere in the app.
- Paddle price IDs are entirely environment-variable-driven (`BILLING_STARTER_PRICE_ID`, `BILLING_PRO_PRICE_ID`).
- The marketing site currently, intentionally, avoids stating any real price.
- Starter/Pro **product limits** (seats, clients, projects, storage) already exist in code independently of what the actual dollar price will be.
- Real dollar pricing must be decided before a paid public launch — this document does not recommend a specific price.

---

## 14. Legal

- Privacy: `https://app.aqenra.com/privacy`
- Terms: `https://app.aqenra.com/terms`
- The marketing site's links point to these same URLs.
- Every transactional email's legal footer points to these same URLs.
- Moving the legal pages to `aqenra.com` is optional, not required — the current location is fully functional.

**Manual operator check required:** verify the actual legal entity name, support contact, and address fields configured for the platform are appropriate before any public commercial launch. (This document does not provide legal advice or assess the current values.)

---

## 15. Production Environment Checklist

| Variable | Category | Production status | Notes |
|---|---|---|---|
| `DATABASE_URL` | Database | Present | — |
| `DIRECT_URL` | Database | Present | — |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Present | Public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Present | Public by design (Supabase's own model) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Present | Sensitive |
| `APP_BASE_URL` | App URL | Present | — |
| `RESEND_API_KEY` | Email | Present | Sensitive |
| `INVITATION_FROM_EMAIL` | Email | Present | Sensitive |
| `PLATFORM_ADMIN_EMAILS` | Platform Admin | Present | Sensitive |
| `CRON_SECRET` | Cron | Present | Sensitive |

**Deferred (missing intentionally)**

| Variable | Category | Status |
|---|---|---|
| `BILLING_PROVIDER` / `BILLING_ENVIRONMENT` / `BILLING_API_KEY` / `BILLING_WEBHOOK_SECRET` / `BILLING_STARTER_PRICE_ID` / `BILLING_PRO_PRICE_ID` / `NEXT_PUBLIC_BILLING_CLIENT_TOKEN` | Paddle | Missing intentionally |
| `AI_PROVIDER` | AI | Missing intentionally |
| `AQENRA_OPENAI_API_KEY` | AI | Missing intentionally |
| `TEST_MODE` | Test infra | Absent intentionally |

**`TEST_MODE` must remain absent in Production.** Its presence would enable mock providers and TEST_MODE-only surfaces in the live environment.

---

## 16. Final Launch Gates

### Core app launch
Already satisfied:
- Staff
- Portal
- Email
- Storage
- Platform Admin
- Marketing
- Domains
- Branding
- Security hardening

### Paid billing launch
Required:
- Pricing decision
- Paddle sandbox end-to-end test
- Paddle live configuration
- Paddle live smoke test

### AI launch
Required:
- OpenAI project/key
- Spend cap
- Environment configuration
- Production AI smoke test

---

## 17. Rollback Notes

**Marketing:** redeploy the previous known-good Vercel deployment, or revert `main` in `aqenra-marketing` and push.

**App:** redeploy the previous known-good Vercel deployment, or revert `main` in `client-portal-crm` and push.

**AI:** remove or blank `AI_PROVIDER` (or `AQENRA_OPENAI_API_KEY`) in Vercel Production and redeploy — restores the fail-closed state immediately.

**Paddle:** remove or blank the billing provider environment variables in Vercel Production and redeploy — restores the fail-closed "not configured" state immediately.

No destructive database rollback is documented here, as none is required for any of the above.

---

## 18. Known Good Baselines

**App:** `c7c2b0bc13e03659d8c881157ae789cb29871811`
**Marketing:** `b635a6f6a8c188b23936d6907c7f55ff54ccda7f`

Notable prior commits (app repo, most recent first): final P2 hardening cleanup, task/invoice creation rate limiting, dual-identity UX hardening, Aqenra brand mark, Portal signup-confirmation fix, invited-signup organization-creation fix.

---

## 19. Do Not Accidentally Change

- Do not move app auth/API/billing/portal routes to `aqenra.com`.
- Do not enable the Cloudflare proxy for the Vercel-facing DNS records without deliberate review.
- Do not set `TEST_MODE` in Production.
- Do not reuse dev/sandbox OpenAI or Paddle credentials for Production.
- Do not expose service-role or API secrets with a `NEXT_PUBLIC_` prefix.
- Do not bypass the invitation email-match check.
- Do not turn a Portal identity into a Staff identity (or vice versa) implicitly.
- Do not remove Storage app-side authorization just because Storage RLS currently has zero policies — the app-side scoping is the real, primary enforcement layer.
- Do not "fix" the Prisma `npm audit` findings by blindly downgrading Prisma.
- Do not force an ESLint 10 upgrade in the marketing repo until its plugin chain supports it safely.

---

## 20. Exact Next Steps

1. Decide whether launch is free/no-billing first, or paid immediately. — **business decision**
2. Decide Starter/Pro dollar pricing. — **business decision**
3. If paid: configure Paddle sandbox → run E2E → configure live. — **manual external setup**, then **Production mutation** (env vars)
4. Create the OpenAI Production project/key only when AI is ready to be enabled. — **manual external setup**, then **Production mutation** (env vars)
5. Run final post-configuration smoke tests for whichever of Paddle/AI was just enabled. — **manual verification** (Claude can assist with a structured smoke-test pass)
6. Declare the product ready for its next real launch milestone once the above are complete.
