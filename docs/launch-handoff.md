# Aqenra Launch Handoff

> **Refreshed October 31, 2026 for the Free Public Beta launch (baseline `fc72e83`).** §1–§20 describe the current Production state. §21 is the preserved September 2026 Quotes/Invoice smoke record (historical). §22–§27 are the Public Beta additions: Free Beta posture, Feedback Widget, verification record, accepted limitations, post-launch list, and the launch checklist.
>
> Evidence labels used throughout: **Verified** = checked with read-only CLI/HTTP/CI evidence on the date given; **Product Owner confirmed** = verified manually by the Product Owner; **Not performed** = no verification is claimed.

## 1. Current Status

**Overall status: Public Beta launch-ready. Launch decision: GO — no Product blockers identified (Product Owner decision, October 31, 2026).**

Aqenra runs as a **Free Public Beta**: no paid checkout, **5 members** and **3 GB of storage** per organization, and trial/subscription enforcement suspended by `FREE_BETA_MODE` (see §22). Online payments (Paddle) and the AI Assistant remain intentionally not enabled.

- App baseline SHA: `fc72e83b3e76ea6a11438683099900357f1b75f1` (`main`, merge of PR #195). Production deployment `dpl_CfrhiHtA2Xq3nxBdHf26s1cZ1HpG`, READY, `app.aqenra.com` attached (see §24).
- Marketing baseline SHA: `e9517cf463e48d8ee2934f0a3b979f8de3130ec2` (`main`, merge of Marketing PR #1). Production deployment `dpl_67uAHSe3BfMYZMVryXvv4dDhy4S6`, READY, `aqenra.com` attached.
- Production domains: `https://aqenra.com`, `https://www.aqenra.com` (308 to the apex), `https://app.aqenra.com` — all responding (Verified 2026-10-31, see §24).
- Already live: the SaaS app (Staff + Client Portal + Platform Admin), Quotes (§21), the redesigned onboarding (Product Owner confirmed), the Staff Feedback Widget V1 (§23), the marketing site, transactional email, Supabase Storage, and the Privacy Policy, Terms of Service and Cookie Policy (§14).
- Intentionally disabled/deferred:
  - **Paddle billing** — not configured in Production, fails closed; paid checkout is additionally blocked server-side during the beta (see §11, §22)
  - **AI Assistant** — not configured in Production, fails closed (see §12)
  - **Public dollar pricing** — not finalized (see §13)

**Launch decision record.** The decision is **GO** for Public Beta. A read-only launch review on 2026-10-31 found no launch blockers and no required code change. The limitations the Product Owner accepted for launch are in §25; the post-launch improvement list is §26; the short launch checklist is §27.

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
- Current `main` SHA: `fc72e83b3e76ea6a11438683099900357f1b75f1` (Verified 2026-10-31: equals `origin/main`; no open pull requests)

**aqenra-marketing**
- Path: `~/Projects/freelance/aqenra-marketing`
- Remote: `https://github.com/Sereja-dev/aqenra-marketing.git`
- Current `main` SHA: `e9517cf463e48d8ee2934f0a3b979f8de3130ec2` (Verified 2026-10-31: no open pull requests)

Both repos deploy from `main` via each project's own Vercel GitHub integration — a push to `main` triggers a Production deploy in that project. Changes land through pull requests with CI (§24). The marketing repo is kept separate by design, in part for future transfer/sale isolation of the SaaS product from the marketing asset.

---

## 4. Completed Production Verification

| Area | Status | Evidence / Notes |
|---|---|---|
| Staff invited signup | **DONE (manual, Production)** | Real invited signup completed against Production with a real test identity; verified via a direct, read-only DB check afterward, then cleaned up. |
| Staff confirmation | **DONE (manual, Production)** | Same test — confirmed via a real Resend-delivered confirmation email link. |
| Staff invitation acceptance | **DONE (manual, Production)** | Same test — Membership row confirmed created correctly, then removed. |
| standalone Staff signup | **DONE (Product Owner confirmed, Production)** | Verified manually by the Product Owner before the Public Beta decision (signup, Resend-delivered confirmation, login). The September 2026 Production test was invitation-based only. |
| standalone Staff login after logout | **DONE (Product Owner confirmed, Production)** | Logout/login verified manually by the Product Owner. |
| Portal invitation flow | **DONE (manual, Production)** | A full real invite → sign up → confirm → accept flow was completed for the Quotes Phase 4 smoke (`umerenko.s.v+portal3@gmail.com` → Portal Isolation Test Client) — see §21.5. |
| Portal signup | **DONE (manual, Production)** | Same test — a real Portal account was created via the signup form. |
| Portal confirmation | **DONE (manual, Production)** | Same test — confirmed via a real Resend-delivered confirmation email link. |
| Portal explicit acceptance | **DONE (manual, Production)** | Same test — invitation explicitly accepted; Staff Client page confirmed the Portal user afterward. |
| Portal client/project isolation | Not independently re-verified in Production | Code- and test-suite-verified (tenant scoping, dedicated security checks); no live cross-tenant manual click-through performed. |
| Portal invoice isolation | Not independently re-verified in Production | Same as above. |
| Portal denial from Staff dashboard | Code-verified (structural) | Enforced by separate identity resolvers; not a manual click-through test. |
| Project-less Invoice (Staff) | **DONE (manual, Production)** | Full smoke `SMOKE-NOPROJ-001` — create, edit, Dashboard/Activity/list read paths, issue, PDF download/content, mobile, dark theme. Retained as a Production smoke artifact — see §21.1. |
| Invoice → Project FK `SET NULL` migration | **DONE (Production migration + automated tests)** | `20260923090000_set_invoice_project_fk_set_null` applied and verified directly against Production; the delete-then-nullify behavior itself is covered by DB-backed integration tests, not a live destructive test — see §21.2. |
| Invoice Client/Project link UX (Staff) | **DONE (manual, Production)** | List and issued/read-only pages, canonical destinations, back navigation, Portal non-exposure — see §21.3. |
| Quotes — Staff UI (create/send/edit/archive lifecycle) | **DONE (manual, Production)** | `Q-0001` full lifecycle smoke — see §21.4. |
| Quotes — Portal approval | **DONE (manual, Production)** | Full invite → signup → confirm → accept → approve E2E — see §21.5. |
| Quote → Invoice conversion | **DONE (manual, Production)** | `Q-0001` → `QUOTE-SMOKE-001`, then cleaned up — see §21.6. |
| Portal invite existing-user conflict UX | **DONE (manual + automated, Production)** | Honest, non-leaking denial message for the one-Client-per-Portal-login conflict; no schema change — see §21.8. |
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
| Onboarding redesign | **DONE (Product Owner confirmed, Production)** | Verified manually by the Product Owner. |
| Free Beta model and limits | **DONE (Product Owner confirmed; code-verified)** | See §22. The `FREE_BETA_MODE` value itself is sensitive and was not read. |
| Privacy / Terms / Cookie Policy (live) | **DONE (Verified 2026-10-31 + Product Owner confirmed)** | HTTP 200; "Effective October 31, 2026" on all three; operator and contact present; feedback disclosures present. Product Owner also checked all three manually. See §14. |
| `support@aqenra.com` and `feedback@aqenra.com` routing | **DONE (Product Owner confirmed)** | Cloudflare Email Routing active; real forwarding to the operator's inbox verified; `support@` routing preserved when `feedback@` was added. See §8. |
| Feedback Widget V1 | **DONE (Product Owner confirmed, Production)** | A real bug report was submitted and its delivery verified in the mailbox; the draggable position and its persistence across reload were verified. See §23. |
| Staff password reset (Production) | **Not performed** | Automated coverage exists (§25); no manual Production smoke is recorded. |
| Cross-tenant live click-through (Production) | **Not performed** | Tenant isolation is evidenced by automated tests only (§25). |

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
- Separate from the above: a single Portal login can currently belong to only one *Client* (not the Staff/Portal dual-identity concept) — see §21.8 for that invariant and its conflict-denial UX.

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
- Client delete blocked by existing invoices: returns a clear, controlled message instead of a generic failure (`Invoice.clientId` FK remains `ON DELETE RESTRICT`)
- Project delete is **no longer** blocked by existing invoices, as of the Phase 2.4 migration (see §21.2): `Invoice.projectId` FK is now `ON DELETE SET NULL` — deleting a Project nullifies `projectId` on its Invoices instead of being blocked
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

- `aqenra.com` sending domain: functional — real emails have been delivered from Production (signup confirmation, invitations, and the Feedback Widget's bug report). Not independently checked against Resend's own domain-verification dashboard.
- Sender: `Aqenra <no-reply@aqenra.com>` (the previously documented `INVITATION_FROM_EMAIL`; its value is sensitive and was not re-read).
- Email flows in place: Staff invite, Portal invite, Staff signup confirmation, Portal signup confirmation, password reset, Staff Feedback Widget messages (§23), and a shared legal footer (Privacy/Terms links) on every transactional email.

**Operational mailboxes (Cloudflare Email Routing, forwarding to the operator's inbox)**

| Address | Used for | Status |
|---|---|---|
| `support@aqenra.com` | Support contact on the legal pages; pre-auth support widget and the Staff "Support" tab recipient | Routing and delivery **Product Owner confirmed** |
| `feedback@aqenra.com` | Recipient of the Staff "Report a bug" tab (own destination, no fallback to support) | Routing and real delivery **Product Owner confirmed** |

**Production variables (names checked 2026-10-31; values never printed or read)**

| Variable | Role | Status |
|---|---|---|
| `RESEND_API_KEY` | Email provider credential (sensitive) | Present |
| `INVITATION_FROM_EMAIL` | Sender address for platform email | Present |
| `PLATFORM_SUPPORT_EMAIL` | Support recipient and public support contact | Present (the live legal pages show `support@aqenra.com`) |
| `PLATFORM_FEEDBACK_EMAIL` | Report-a-bug recipient; no fallback — if unset or malformed the tab says it is unavailable and nothing is sent | Present |
| `PLATFORM_REPLY_TO_EMAIL` | Reply-To header on Aqenra's own transactional email (customer invoice emails deliberately do not use it) | Present |

---

## 9. Branding / Marketing

- Marketing site live at `aqenra.com`.
- Text wordmark ("Aqenra") remains unchanged in both the app and marketing headers.
- A custom Aqenra favicon/logomark has been implemented and is live in both repos.
- Concept: two overlapping rounded squares, using the app's own already-approved "Aqenra Indigo" accent colors — no letterform, no resemblance to the generic Next.js/Vercel triangle it replaced.
- The generic stock favicon has been removed from both repos (app and marketing).
- The marketing Open Graph image was left unchanged — it already contained no generic mark and was judged intentional as-is.
- Marketing CTAs (Verified 2026-10-31): "Open preview" / "Open product preview" / "Open current preview" go to `https://app.aqenra.com/signup`; "Sign in" goes to `https://app.aqenra.com/login`; Privacy and Terms link to the app's legal pages.
- **Wording limitation (accepted for launch, §25):** the marketing site still describes the product as "Working product · advanced pre-launch · pre-revenue" with "Open preview" buttons, and says pricing and wider validation "remain before full commercial release". It does not mention the Free Public Beta. It understates rather than overclaims; align it when separately approved.
- The marketing footer states "Operated by Umerenko Sergei, an individual", and the marketing Cookie page names the same operator (§14).
- No dollar pricing exists anywhere in the product or on the marketing site.

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

**This is a launch gate if paid billing is required. It is not a gate for the Free Public Beta (see §22).** During the beta, paid checkout and manage-subscription are rejected server-side regardless of provider configuration.

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

The "free or paid first" question is decided: Aqenra launches as a **Free Public Beta** (§22). The dollar-pricing decision below is deferred until after launch.

- No dollar prices are hardcoded anywhere in the app.
- Paddle price IDs are entirely environment-variable-driven (`BILLING_STARTER_PRICE_ID`, `BILLING_PRO_PRICE_ID`).
- The marketing site currently, intentionally, avoids stating any real price.
- Starter/Pro **product limits** (seats, clients, projects, storage) already exist in code independently of what the actual dollar price will be.
- Real dollar pricing must be decided before a paid public launch — this document does not recommend a specific price.

---

## 14. Legal

**Live documents (Verified 2026-10-31: HTTP 200 on each; Product Owner also verified all three manually)**

| Document | URL | Effective |
|---|---|---|
| Privacy Policy | `https://app.aqenra.com/privacy` | **October 31, 2026** |
| Terms of Service | `https://app.aqenra.com/terms` | **October 31, 2026** |
| Cookie Policy | `https://app.aqenra.com/cookies` | **October 31, 2026** (first published October 27, 2026; re-dated when the "Feedback button position" storage disclosure was added, PR #195) |

**Operator identity.** Aqenra is operated by **Umerenko Sergei, an individual, under the Aqenra brand**; "Aqenra is a product name, not a registered company". Contact: `support@aqenra.com`. These come from the shared legal configuration (`src/lib/legal/platform-config.ts`); Production sets no legal-name, address, jurisdiction or effective-date overrides (names checked 2026-10-31), so the code defaults apply.

**Where it appears.** The three legal pages; the Staff, public and auth footers ("© 2026 Aqenra · Operated by Umerenko Sergei"); the Platform Admin configuration labels; every transactional email's legal footer; the marketing footer and the marketing Cookie page. The marketing site's Privacy/Terms links point to the app's pages above. The marketing Cookie page carries no date of its own and links to the app's dated Cookie Policy.

**Disclosures added with the Feedback Widget.** Privacy: "Feedback from inside the app" (what a message or bug report includes). Cookie Policy: "Feedback button position" (browser-local storage of the button's coordinates only).

**Date rule.** A revised policy is never backdated; a revision gets its own new date in the same reviewed change that ships its wording (see the history comment in `platform-config.ts`).

**Not claimed.** No legal counsel review or approval is claimed for any of this text. Open for operator/legal review (accepted for launch, §25): the governing-law/jurisdiction clause uses generic placeholder wording ("the jurisdiction in which the Service operator is located"); no postal address is published; the liability clause has not been reviewed.

Moving the legal pages to `aqenra.com` is optional, not required — the current location is fully functional.

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
| `FREE_BETA_MODE` | Free Public Beta | Present | Sensitive; value not read. Strict: only the literal `true` enables it (§22) |
| `PLATFORM_SUPPORT_EMAIL` | Email / legal contact | Present | §8 |
| `PLATFORM_FEEDBACK_EMAIL` | Feedback Widget | Present | §8, §23 |
| `PLATFORM_REPLY_TO_EMAIL` | Email | Present | §8 |
| `INTEGRATIONS_ENCRYPTION_KEY_V1` | Integrations | Present | Sensitive; master key for encrypting stored Integrations credentials (AES-256-GCM) |

Names checked 2026-10-31 with `vercel env ls production`; no value was read or printed.

**Deferred (missing intentionally)**

| Variable | Category | Status |
|---|---|---|
| `BILLING_PROVIDER` / `BILLING_ENVIRONMENT` / `BILLING_API_KEY` / `BILLING_WEBHOOK_SECRET` / `BILLING_STARTER_PRICE_ID` / `BILLING_PRO_PRICE_ID` / `NEXT_PUBLIC_BILLING_CLIENT_TOKEN` | Paddle | Missing intentionally |
| `AI_PROVIDER` | AI | Missing intentionally |
| `AQENRA_OPENAI_API_KEY` | AI | Missing intentionally |
| `TEST_MODE` | Test infra | Absent intentionally |
| `PLATFORM_LEGAL_NAME` / `PLATFORM_LEGAL_ADDRESS` / `PLATFORM_JURISDICTION` / `PRIVACY_POLICY_EFFECTIVE_DATE` / `TOS_EFFECTIVE_DATE` / `COOKIE_POLICY_EFFECTIVE_DATE` | Legal overrides | Absent intentionally — code defaults apply (§14) |

**`TEST_MODE` must remain absent in Production.** Its presence would enable mock providers and TEST_MODE-only surfaces in the live environment.

---

## 16. Final Launch Gates

### Free Public Beta launch
**Decision: GO (October 31, 2026). No blockers identified.** Satisfied: public entry points, authentication, Free Beta availability, essential transactional email, legal pages, and Marketing-to-app navigation (evidence in §4 and §24). Accepted limitations: §25. Checklist: §27.

### Core app launch
Already satisfied:
- Staff
- Portal
- Quotes (Staff create/send/archive lifecycle + Portal approval/decline + Quote → Invoice conversion — see §21; known gaps are listed in §21.9)
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

**Feedback Widget:** unset or blank `PLATFORM_FEEDBACK_EMAIL` and redeploy — the "Report a bug" tab then says it is unavailable and sends nothing (the Support tab is unaffected); or revert the widget's merge commit.

**Free Beta mode:** do **not** disable `FREE_BETA_MODE` as a rollback. See the exit invariant in §22 — turning it off without an approved transition plan can put existing organizations into read-only access immediately.

**AI:** remove or blank `AI_PROVIDER` (or `AQENRA_OPENAI_API_KEY`) in Vercel Production and redeploy — restores the fail-closed state immediately.

**Paddle:** remove or blank the billing provider environment variables in Vercel Production and redeploy — restores the fail-closed "not configured" state immediately.

No destructive database rollback is documented here, as none is required for any of the above.

---

## 18. Known Good Baselines

**App:** `fc72e83b3e76ea6a11438683099900357f1b75f1` (Public Beta launch baseline, 2026-10-31)
**Marketing:** `e9517cf463e48d8ee2934f0a3b979f8de3130ec2` (2026-10-31)

Earlier baselines (historical): app `e2fe12b3e6ba7027e997edbe9570cf5134fb5818` and marketing `b635a6f6a8c188b23936d6907c7f55ff54ccda7f` (2026-09-08, see §21). The October 2026 release history is in §24.

Notable prior commits (app repo, most recent first) — see §21 for full detail on the first five: Portal invite existing-user conflict UX fix, Quotes Portal approval (Phase 4), Quotes Staff UI (Phase 3), Invoice Client/Project link UX, Invoice → Project FK `SET NULL` migration (Phase 2.4), final P2 hardening cleanup, task/invoice creation rate limiting, dual-identity UX hardening, Aqenra brand mark, Portal signup-confirmation fix, invited-signup organization-creation fix.

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
- Do not turn `FREE_BETA_MODE` off without a separately approved transition plan (§22).
- Do not add a fallback for `PLATFORM_FEEDBACK_EMAIL` (not to support, not to the sender address) — bug reports must never be routed to an unrelated mailbox.
- Do not backdate a legal document; a revision gets a new effective date (§14).
- Do not publish claims of legal counsel approval, a registered company, or live online payments — none exist.

---

## 20. Exact Next Steps

1. Decide whether launch is free/no-billing first, or paid immediately. — **DECIDED: Free Public Beta** (§22).
2. Decide Starter/Pro dollar pricing. — **Deferred** to after launch (business decision, §13).
3. Configure `support@aqenra.com` and update the contact locations. — **DONE** (§8, §14). `feedback@aqenra.com` is also configured (§23).
4. If/when paid: configure Paddle sandbox, run E2E, then live (§11). — **Deferred.**
5. Create the OpenAI Production project/key only when AI is ready to be enabled (§12). — **Deferred.**
6. Post-configuration smoke tests for whichever of Paddle/AI is enabled later. — **Not applicable until enabled.**
7. Public Beta launch. — **Decision recorded: GO.** Remaining steps are the checklist in §27.

---

## 21. Quotes & Invoice Production Smoke (2026-09-08)

Manual Production verification completed 2026-09-08, closing out the gaps §4 previously left open for the Quotes feature, project-less Invoices, and the Invoice→Project FK. All test data below was created against Production directly by the operator and is either retained as a documented reusable smoke artifact or was cleaned up — see §21.7 for the exact final state.

Latest Production HEAD as of this update (historical — the September 2026 baseline; the current baseline is in §1 and §18): `e2fe12b3e6ba7027e997edbe9570cf5134fb5818`. Relevant deployed commits covered below: `01046ef` (Project FK `SetNull`, §21.2), `1847ce5` (Invoice Client/Project links, §21.3), `134bf2d` (Staff Quotes UI, §21.4), `0d18fc5` (Portal Quote approval, §21.5), `e2fe12b` (Portal invite conflict UX fix, §21.8).

### 21.1 Project-less Invoice (Phase 2.3)

Manual Production smoke: **PASS**. Manual Production artifact `SMOKE-NOPROJ-001` (Client: `Portal Isolation Test Client`, Project: `No project`) remains an issued Production smoke artifact and was **not** deleted.

Checks completed:
- Add Invoice form supports required Client + optional Project
- Project can remain "No project"
- Invoice created successfully
- Invoice appeared in the Staff list
- Draft edit page reopened correctly
- Amount updated successfully, $10 → $12
- Dashboard included the project-less Invoice in KPI/read paths
- Recent Activity included it
- Recent Invoices included it
- Issue Invoice succeeded
- Issued read-only page rendered correctly
- Download PDF succeeded
- PDF rendered correctly: correct Invoice number, correct Client, correct line/amount, no broken/null Project output
- Mobile Invoice form checked manually
- Dark theme checked manually
- Client/Project link UI checked separately (see §21.3)

### 21.2 Invoice → Project FK `SET NULL` (Phase 2.4)

Commit: `01046ef48874ba58c0744e599f8c78c166847be1`
Migration: `20260923090000_set_invoice_project_fk_set_null`

Production migration applied successfully. Verified directly against Production:

| | Before | After |
|---|---|---|
| `Invoice_projectId_fkey` | `ON DELETE RESTRICT` | `ON DELETE SET NULL` |
| `Invoice.projectId` | nullable | nullable (unchanged) |
| `Invoice.clientId` | `NOT NULL` | `NOT NULL` (unchanged) |
| `Invoice_clientId_fkey` | `ON DELETE RESTRICT` | `ON DELETE RESTRICT` (unchanged) |
| `Invoice_projectId_idx` | present | present (unchanged) |

No unrelated schema changes and no row-count changes attributable to the migration.

No real Production Project was deleted to test this — the delete-then-nullify behavior itself was covered with DB-backed integration tests instead, not a live destructive Production test.

Post-migration Vercel/runtime sanity: no relevant Prisma errors, no FK/nullability errors, no 5xx in the available log samples. Vercel log retention/window was limited, so this is not exhaustive historical coverage.

This directly supersedes the previous "Client/Project delete blocked by existing invoices" statement in §6 — see that section's corrected wording: Client delete is still blocked (FK unchanged); Project delete is no longer blocked (FK now `SET NULL`).

### 21.3 Invoice Client/Project link UX

Commit: `1847ce59cc1067e8bab8598d93294a3cab55cd82`

Production browser checks completed:
- Invoice list Client link works
- Invoice list Project link works
- Issued/read-only Invoice Client link works
- Issued/read-only Invoice Project link works
- Canonical destinations: `/clients/{id}/edit`, `/projects/{id}/edit`
- Back navigation works
- Portal does not expose Staff Client/Project links
- No console/runtime errors observed

"No project" non-link behavior was covered by automated tests; the separate demo browser workspace used for this browser verification did not contain a project-less Invoice, so that specific combination was not separately checked live in that session (the project-less Invoice itself has its own dedicated Production smoke — see §21.1).

### 21.4 Quotes — Staff UI (Phase 3)

Commit: `134bf2d49285d65726d79192ff8053a1429bbc22`

Production manual smoke: Quote `Q-0001`, title "Production Quote Smoke", target `Portal Isolation Test Client`, initial total $25.00 → updated total $30.00.

Checks completed:
- `/quotes` empty state
- Quotes navigation
- `/quotes/new`
- Lead target selector
- Client target selector
- Switching target replaces the inactive selector correctly
- Create Draft Quote
- Quote appears in list
- Draft edit reloads saved data
- Live totals preview works
- Draft update $25 → $30, saved total is $30
- Mark as sent
- SENT read-only display, recipient snapshot shown
- Edit-sent-quote warning correctly explains the Draft reset
- Cancel preserves SENT state
- Archive; Active list hides the archived Quote; Archived filter shows it; Unarchive; Active list shows it again

"Mark as sent" does **not** send an email — this is correctly communicated in the UI (no Quote email-delivery feature exists yet; see §21.9).

### 21.5 Quotes — Portal approval (Phase 4)

Commit: `0d18fc5a2e08874f463e314e96f0681719004512`

Manual Production E2E completed. Portal test account ultimately used: `umerenko.s.v+portal3@gmail.com`, Client: `Portal Isolation Test Client`.

Chronology:
1. An existing Portal account, `umerenko.s.v+portal2@gmail.com`, was already linked to a different Client.
2. Attempting to accept a new Client invitation with that account exposed the existing one-Portal-login → one-Client architecture (see §5, §21.8).
3. This was **not** a transaction-corruption bug — the invitation stayed correctly `PENDING` throughout.
4. A separate documentation/UI bugfix (§21.8) was implemented so this conflict is explained honestly instead of a generic error.
5. A fresh Portal account, `umerenko.s.v+portal3@gmail.com`, was then created through the full real flow: invite → sign up → email confirmation → accept invitation.

Checks completed:
- Portal account created, invitation accepted
- Staff Client page shows `+portal3` under Portal users
- Portal context correctly shows `Portal Isolation Test Client`
- `/portal/quotes` visible in Portal nav
- `Q-0001` visible in Portal, showing Sent / "Production Quote Smoke" / $30.00
- Quote detail opens, line items/totals correct
- Approve and Decline both available
- Approval confirmation correctly states the Quote number, $30.00, no Invoice auto-created, no payment processed
- Approve succeeds; Portal state becomes Approved; decision buttons disappear
- Staff page reflects Approved and shows "Convert to invoice"

This directly supersedes the previous "Portal invitation flow / Portal signup / Portal confirmation / Portal explicit acceptance" rows in §4 — updated there to DONE.

### 21.6 Quote → Invoice conversion

Manual Production conversion: Quote `Q-0001` → Invoice number `QUOTE-SMOKE-001`, Project: No project.

Checks completed:
- Convert dialog opened; Invoice number required; Project optional, "No project" available/default
- Client was not caller-selected; totals/items were not caller-entered
- Conversion succeeded, creating a Draft Invoice: `QUOTE-SMOKE-001`, Client = Portal Isolation Test Client, Project = No project, itemized "Consulting" line, Qty 1, Unit price $30, Total $30, USD
- Quote became derived Converted, showing the linked Invoice
- The second conversion action disappeared

### 21.7 Cleanup state (final, as of 2026-09-08)

- `Q-0001`: archived; lifecycle status remains **Approved**; preserved intentionally as a historical smoke artifact — **not deleted**.
- `QUOTE-SMOKE-001` (the converted Draft Invoice): deleted successfully; `Q-0001.convertedInvoiceId` cleared via the existing `SetNull` relation behavior; `Q-0001` correctly returned to Approved; "Convert to invoice" became available again.
- `SMOKE-NOPROJ-001` (§21.1): remains an issued Production smoke artifact — **not deleted**.
- Pending Portal invitation for `umerenko.s.v+portal2@gmail.com`: cancelled/removed.
- Portal user `umerenko.s.v+portal3@gmail.com`: remains linked to `Portal Isolation Test Client`; intentionally retained as a reusable Portal regression/smoke account — **not deleted**.

### 21.8 Portal invite architecture / conflict bugfix

Commit: `e2fe12b3e6ba7027e997edbe9570cf5134fb5818`

Current MVP invariant, unchanged by this fix: one Portal auth identity → one `PortalUser` row → one required `clientId`. One Portal login can currently belong to only one Client.

An existing Portal account invited to a different Client is intentionally denied: old Client access is preserved, the invitation remains pending until Staff cancels/reassigns it, and the app must never silently reassign `PortalUser.clientId`.

Bugfix behavior:
- The conflict now gets a distinct, honest error instead of the generic "This invitation is no longer available."
- No other Client name/id is leaked.
- New-user flow unchanged; same-Client idempotent acceptance unchanged.
- No schema change, no migration.

Real multi-Client-per-login support would require a future architectural change: a join/membership model, Portal context selection/switching, and a broader auth/query migration. This is **not** a planned launch gate — it is a known future architecture item only (see §21.9).

### 21.9 Known gaps — Quotes (not yet implemented)

- Quote email delivery
- Quote PDF
- Public/anonymous approval links
- E-signature
- Revision/version history
- Automatic Invoice creation on approval (conversion remains a manual Staff action)
- Automatic Lead → Client conversion on Quote approval
- Multi-Client-per-Portal-login architecture (see §21.8)
- Custom Quote workflows/statuses

---

## 22. Free Public Beta Posture

Aqenra launches as a **Free Public Beta**. No paid plan is offered, no checkout can be started, and no organization is charged.

**Switch.** `FREE_BETA_MODE` is set in Vercel Production (sensitive; the value was not read; the beta model was confirmed by the Product Owner). `isFreeBetaModeEnabled()` (`src/lib/billing/free-beta-mode.ts`) is the single predicate; it is **strict** — only the literal string `true` enables it, so `1`, `TRUE`, `yes` or a typo means disabled.

**What it does (code-verified at the baseline)**
- **Access.** It forces full access for every organization regardless of subscription status or whether a billing provider is configured. This is a *computed* access mode only — no Subscription row is written (`src/lib/billing/entitlements.ts`).
- **Limits.** Effective ceiling of **5 members per organization** (members plus pending invitations count toward it) and **3 GB of storage per organization**, applied at one central entitlement point (`FREE_BETA_MAX_MEMBERS`, `FREE_BETA_MAX_STORAGE_BYTES` in `src/lib/billing/plans.ts`). The beta does not override the other per-plan limits; each real plan's native allowance is untouched.
- **No paid checkout.** `requestPlanChangeAction` and `manageSubscriptionAction` (`src/app/(dashboard)/settings/billing/actions.ts`) reject server-side with "Paid plans aren't available during the free beta." — hiding the button is not the only defense.
- **No billing provider configured.** No `BILLING_*` variables exist in Production (§15); billing fails closed.
- **No implicit paid-plan activation.** Adding provider credentials later cannot turn the beta off by itself (the override is unconditional), and nothing in the beta writes a plan or status change.
- **Messaging.** The dashboard shows a Public Beta notice (its dismissal is stored in browser-local storage and listed in the Cookie Policy). The Terms describe the free public beta with no live billing; the Privacy Policy states that no payment provider currently processes live payments.

**Exit invariant — read before ever changing the flag.** Every organization's real subscription and trial dates kept advancing in the database the whole time the beta ran. If `FREE_BETA_MODE` is disabled and a billing provider is configured, organizations past their calendar trial become **read-only immediately, with no warning or grace period**. Ending the beta safely requires Product Owner approval, a defined transition policy (for example a fresh grace period or a trial-date backfill), advance user communication, and testing against Production data shapes. None of that is implemented, by design.

---

## 23. Feedback Widget V1

**Shipped** in PR #194 (merge `967eaf9`), running in Production at the baseline. **Product Owner confirmed in Production:** a real bug report was submitted and its delivery verified in the mailbox; the draggable position and its persistence across reload were verified.

**What it is.** A floating, draggable button inside the authenticated Staff app only (mounted in the `(dashboard)` layout; never on pre-auth or Client Portal pages) with two tabs.

| Tab | Destination | Notes |
|---|---|---|
| Support | `PLATFORM_SUPPORT_EMAIL` (`support@aqenra.com`) | Same resolver as the pre-auth support widget |
| Report a bug | `PLATFORM_FEEDBACK_EMAIL` (`feedback@aqenra.com`) | Own destination, **no fallback**; if unset or malformed the tab says it is unavailable and nothing is sent |

**Behavior and protections**
- Both tabs send with Reply-To set to the signed-in account's own email, with no attachments.
- Identity, role and workspace are resolved server-side from the session; nothing identifying is read from the form (unit and integration tests cover spoofed fields and tenant isolation).
- Rate limits: **5/hour** per user (Support), **10/hour** per user (Report a bug), **30/hour** per workspace. These are in-memory and per instance (§25).
- Bounded validation on every field, HTML-escaped email content, a honeypot field, and a duplicate-submission guard (per-form id plus a content fingerprint).
- Bug-report diagnostics are limited to the page path (no query string or fragment), a server timestamp, the user agent, and the viewport size; they are disclosed in the form. No cookies, tokens, passwords or form contents are ever collected.
- The button's position is remembered in browser-local storage under `aqenra:feedback-widget-position` (coordinates only; no form contents or user data), restored on page load, and clamped to the current window. Disclosed in the Cookie Policy and the Privacy Policy (§14).
- Layout: from the `md` breakpoint up, an in-flow end-of-page clearance keeps the pagination "Next" link and last-row actions clear of the button.
- Keyboard and accessibility: Shift+Arrow moves the button; arrow keys switch tabs; Escape closes and returns focus; reduced-motion is respected.

**Production prerequisites (completed; Product Owner confirmed).** `PLATFORM_FEEDBACK_EMAIL=feedback@aqenra.com` configured in Vercel Production, the required redeploy completed, Cloudflare Email Routing for `feedback@aqenra.com` active, and `support@aqenra.com` routing preserved.

**Rollback.** See §17.

---

## 24. Verification Record at the Baseline (`fc72e83`)

All rows below were checked read-only on October 31, 2026 unless stated. No Production data was changed to produce this evidence.

| Item | Result | Evidence |
|---|---|---|
| App `main` vs Production | `origin/main` = `fc72e83b3e76ea6a11438683099900357f1b75f1`; nothing after it | Git; GitHub deployment records tie that SHA to the Production deployment |
| App Production deployment | `dpl_CfrhiHtA2Xq3nxBdHf26s1cZ1HpG`, target Production, READY, `app.aqenra.com` attached | Vercel CLI |
| Marketing Production deployment | `dpl_67uAHSe3BfMYZMVryXvv4dDhy4S6`, target Production, READY, `aqenra.com` and `www.aqenra.com` attached; `main` = `e9517cf463e48d8ee2934f0a3b979f8de3130ec2` | Vercel CLI; GitHub deployment record |
| Open pull requests | None, in either repository | GitHub |
| Post-merge CI on the baseline (`push` to `main`) | Fast Checks: pass. Integration & E2E: pass — Vitest 324 files passed; Playwright 1623 planned: **1621 passed, 1 flaky (retried), 1 skipped, 0 failed, 0 not run** (19.7 min). | GitHub Actions |
| Pre-merge CI on PR #195 (same suite) | Playwright: 1622 passed, 1 skipped, 0 failed, 0 flaky, 0 not run | GitHub Actions |
| CI limits | Integration & E2E job has a **45-minute** timeout (it was 30; a 30-minute cap cancelled one run on PR #194). Recent runs took about 22–31 minutes. Fast Checks: 10; Production Migration Status: 5. | Workflow files; run history |
| Database migrations | **60** migrations; "Database schema is up to date!" — run automatically after each Production deployment | Production Migration Status workflow, run on `fc72e83` |
| Public legal routes | `/privacy`, `/terms`, `/cookies` return 200; "Effective October 31, 2026" on each; operator and feedback disclosures present | HTTP GET |
| Authentication gates | Anonymous requests to `/dashboard`, `/clients`, `/invoices`, `/settings/billing`, `/platform-admin` get a 307 to login; `/portal` goes to the Portal login | HTTP GET |
| Dev and test surfaces | `/api/e2e-test-storage/*`, `/billing/mock/*`, `/test-only/*` return 404 in Production | HTTP GET |
| Security headers (app) | CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, Referrer-Policy and Permissions-Policy present | HTTP HEAD |
| Security checks | The static security checks (23 at the baseline) pass in CI Fast Checks | GitHub Actions |
| Production environment | All expected variables present; `TEST_MODE`, `BILLING_*` and AI variables absent (§15) | `vercel env ls` (names only) |
| Marketing entry points | CTAs link to `app.aqenra.com/signup` and `/login`; `www` redirects to the apex; `robots.txt` and `sitemap.xml` respond | HTTP GET |
| Signup gating | None in code (no invite-only, waitlist or environment flag); signup and login routes read no environment variables | Code review |

**October 2026 release history (app, merge commits on `main`)**

| PR | Change | Merge |
|---|---|---|
| #191 | Exclude nested worktrees from the build | `8e6c1ed` |
| #192 | E2E fixture isolation and dashboard KPI 320px fix | `659b37e` |
| #193 | Legal identity alignment (individual operator, Privacy/Terms October 31, 2026) | `d4c6700` |
| #194 | Staff Feedback Widget V1 (with legal-release reconciliation, CI timeout 30→45 min, and an invoice E2E wait fix) | `967eaf9` |
| #195 | Cookie Policy effective date aligned to October 31, 2026 | `fc72e83` |
| Marketing #1 | Individual operator on the marketing site | `e9517cf` |

---

## 25. Accepted Launch Limitations

These were reviewed for the Public Beta launch and accepted by the Product Owner. None is a launch blocker.

1. **Online payments deferred.** Paddle is not configured and paid checkout is blocked during the beta (§11, §22).
2. **Marketing wording.** The marketing site still says "pre-launch / preview" and does not mention the Free Public Beta, until separately updated (§9).
3. **Legal review open.** The jurisdiction clause is generic placeholder wording, no postal address is published, and the liability clause is unreviewed. Subject to operator/legal review. No legal counsel approval is claimed (§14).
4. **Rate limiting is not distributed.** Counters are in-memory and per instance and reset on a cold start — an accepted app-wide tradeoff that also applies to the Feedback Widget limits.
5. **Password reset.** No manual Production smoke is recorded. Automated coverage exists (an E2E spec and integration/unit tests for the request, confirm and update paths), and it uses the same email path as the flows verified in Production.
6. **Occasional E2E flakes are tracked.** `settings-uploads-migration.spec.ts:194` retried once in the post-merge CI (its first attempt matched two `table` elements with an ambiguous locator); `company-profile.spec.ts:243` is timing-sensitive and passes when run alone. A third, `invoice-internal-notes-validation-reset.spec.ts:145`, was fixed by correcting a URL wait that also matched `/invoices/new` (PR #194). None is a confirmed Product defect.
7. **No live cross-tenant click-through is claimed.** Tenant isolation is evidenced by automated tests (integration suite, dedicated security checks, and the widget's tenant tests), not by a manual cross-tenant test in Production.
8. **Carried over from earlier handoffs:** the five `npm audit` HIGH findings confined to the Prisma CLI's build-time chain (§10); the Quotes gaps in §21.9; one Portal login belongs to one Client (§21.8).

---

## 26. Post-Launch Improvements

Optional, in no required order. None blocks the launch.

- Align the marketing wording with "Free Public Beta" and announce pricing when it is decided (§9, §13).
- Operator/legal review of the jurisdiction, address and liability wording (§14).
- A shared store for distributed rate limiting (§25, item 4).
- An optional manual Production password-reset smoke (§25, item 5), and an optional live cross-tenant check (§25, item 7).
- Stabilize the tracked flaky specs; consider sharding the E2E job if its runtime keeps growing toward the 45-minute cap.
- Look into an occasional Prisma "record not found" (`P2025`) line in E2E server logs, seen around the Platform Admin Organization Detail page when a fixture organization is deleted mid-request; no test failed because of it and its cause is not proven.
- Cosmetic: a visitor who deep-links to a protected page and is redirected to login sees "Your session expired" even if they never signed in.
- Paddle billing (§11), the AI Assistant (§12), and a defined plan for ending the free beta (§22) when those become priorities.

---

## 27. Public Beta Launch Checklist

**Already done**
- [x] Launch decision recorded: GO, no Product blockers (October 31, 2026).
- [x] Production serves the baseline `fc72e83`; migrations up to date; post-merge CI passed (§24).
- [x] Privacy, Terms and Cookie Policy live, all effective October 31, 2026; operator and contact shown (§14).
- [x] `support@aqenra.com` and `feedback@aqenra.com` routing and delivery confirmed; Feedback Widget V1 confirmed in Production (§8, §23).
- [x] Free Public Beta posture in place: 5 members, 3 GB, no paid checkout (§22).

**Before announcing**
- [ ] Re-check that `app.aqenra.com` is still serving the baseline (or record the new SHA here if something has been deployed since).
- [ ] Write the announcement so it says *Free Public Beta*, states the 5-member / 3 GB limits, names `support@aqenra.com`, and mentions the in-app feedback button — the marketing site does not say this yet (§9).
- [ ] Optional: align the marketing wording first (§26).
- [ ] Optional: run a manual password-reset check in Production (§25, item 5).
- [ ] At the operator's discretion: obtain legal review of the open legal wording (§14).

**After announcing**
- [ ] Watch the `support@` and `feedback@` inboxes (forwarded to the operator's inbox) and reply to users.
- [ ] Check the Platform Admin observability page and the Vercel logs for errors; the Production Migration Status workflow runs automatically after each Production deployment.
- [ ] Keep `FREE_BETA_MODE` on; make no Production environment changes without updating this document.
- [ ] Record anything significant that changes (new baselines, new limitations, decisions) in this document.
