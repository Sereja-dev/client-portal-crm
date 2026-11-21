# Aqenra Launch Handoff

> **Refreshed November 21, 2026 (reviewed against app `main` `e1b22bf1`, marketing unchanged at `8844cca`).** §1–§20 describe the current Production state. §21 is the preserved September 2026 Quotes/Invoice smoke record (historical). §22–§27 are the Public Beta additions written at the October 31, 2026 launch baseline (`fc72e83`, kept as the historical launch record and updated where facts have since changed): Free Beta posture, Feedback Widget, verification records, accepted limitations, post-launch list, and the launch checklist. §28–§30 were added on November 1, 2026 and partly corrected in §31: the SignupAttempt and Growth dashboard work, Website Traffic (built but deliberately disabled), and the operations still waiting on a real event. §31 is the November 18, 2026 reconciliation covering everything shipped between the 2026-11-01 and 2026-11-18 baselines (appearance/theme, recurring invoices, contracts, Client Portal outstanding totals, signup/invitation hardening, Platform Admin's dedicated domain, the SignupAttempt/retention evidence re-check, a test-only Calendar fix, the marketing footer/theme, and the optional roadmap). §32 is the November 21, 2026 reconciliation covering what shipped since (`1a7a3a0` → `e1b22bf1`): a Next.js dependency security update, a Tasks table breakpoint-margin fix, a test-only feedback-widget fix, and one newly observed flaky test. Read §31 and §32 alongside the sections they correct, not as replacements for them.
>
> Evidence labels used throughout: **Verified** = checked with read-only CLI/HTTP/CI evidence on the date given; **Verified from current source** = checked by reading the code itself on the date given (no live/CI evidence needed because the fact is the code); **Product Owner confirmed** = verified manually by the Product Owner (not re-checked by this document); **Inferred** = a plausible explanation supported by partial evidence (e.g. an HTTP 200 observed close to a scheduled time, without a log identifying the actual trigger) — not the same as Verified; **Pending organic event** = cannot be evidenced until a real signup, login or scheduled run happens, and no such event has been observed yet; **Open — actionable** = a specific verification still to be done; **Accepted limitation** = reviewed and accepted by the Product Owner, not a blocker; **Explicitly deferred** = the Product Owner chose to postpone this specific check, not an oversight; **Optional post-launch** = nice to have, no required order; **Not performed** / **Unverified** = no verification is claimed. A pending, open, deferred or unverified item is an evidence question, not a Product defect.

## 1. Current Status

**Overall status: Public Beta launch-ready. Launch decision: GO — no Product blockers identified (Product Owner decision, October 31, 2026).**

Aqenra runs as a **Free Public Beta**: no paid checkout, **5 members** and **3 GB of storage** per organization, and trial/subscription enforcement suspended by `FREE_BETA_MODE` (see §22). Online payments (Paddle) and the AI Assistant remain intentionally not enabled.

- **Current** app baseline SHA: `e1b22bf122fa62a71b5edd78a9b9be6618070480` (`main`, merge of PR #236). Verified directly against `origin/main` and GitHub's own `main` ref on 2026-11-21 (see §32). This is the exact commit this documentation pass was reviewed against — three merges ahead of the 2026-11-18 baseline below: PR #235 (Next.js dependency security update, merge `9c7f8ed4e0`), PR #237 (Tasks table breakpoint-margin fix, merge `91cc487e`), PR #236 itself (test-only feedback-widget fix). The deployment/alias record below is carried over from the 2026-11-01 baseline (`2a12e7a`) and was not independently re-checked on 2026-11-21 — see §32 for what was and wasn't re-verified at this baseline.
- **Previous** app baseline SHA (2026-11-18): `1a7a3a0300d4b243fd595b45fa045953068075bf` (merge of PR #233). Verified directly against `origin/main` on 2026-11-18 (see §31).
- **Earlier** app baseline SHA (2026-11-01): `2a12e7a8fce8eea666cc6501f0484ee033987ce9` (merge of PR #200). Production deployment `dpl_3HXhCVCJd2xUw8wyFrfNEtpXmnjh`, READY, target Production, `app.aqenra.com` attached (Verified 2026-11-01, see §24).
- **Current** marketing baseline SHA: `8844ccaa2358802c9d956a799b82c2abbef01eed` (`main`, merge of Marketing PR #5, 2026-11-16 — sky-blue theme match and footer personal-name removal, see §31.I). Verified directly against the marketing repo's `origin/main` on 2026-11-18. Not independently re-checked for a fresh Production deployment/alias record at this baseline.
- **Previous** marketing baseline SHA (2026-11-01): `42fd441368b0cc55a1024464101d099057c65a86` (merge of Marketing PR #4). Production deployment `dpl_9nLYq2zuFhnFrAdN1LxK2c9Z9c1Z`, READY, target Production, `aqenra.com` and `www.aqenra.com` attached (Verified 2026-11-01).
- Historical Public Beta launch baseline (October 31, 2026): app `fc72e83b3e76ea6a11438683099900357f1b75f1` (deployment `dpl_CfrhiHtA2Xq3nxBdHf26s1cZ1HpG`), marketing `e9517cf463e48d8ee2934f0a3b979f8de3130ec2` (deployment `dpl_67uAHSe3BfMYZMVryXvv4dDhy4S6`). Kept as the launch record in §24.
- Production domains: `https://aqenra.com`, `https://www.aqenra.com` (308 to the apex), `https://app.aqenra.com` — all responding (Verified 2026-11-01, see §24).
- Production database: **61** migrations, "Database schema is up to date!" (Verified 2026-11-01 on `2a12e7a`). **Six** Vercel cron jobs are deployed (§2).
- Already live: the SaaS app (Staff + Client Portal + Platform Admin), Quotes (§21), the redesigned onboarding (Product Owner confirmed), the Staff Feedback Widget V1 (§23), the marketing site (now describing the Free Public Beta, §9), transactional email, Supabase Storage, the Platform Admin Growth dashboard with SignupAttempt recording (§28), and the Privacy Policy, Terms of Service and Cookie Policy (§14).
- Built but deliberately **not active**: Website Traffic — the Platform Admin integration is shipped, collection is disabled, no visitor data exists, and activation is deferred by the Product Owner (§29).
- Intentionally disabled/deferred:
  - **Paddle billing** — not configured in Production, fails closed; paid checkout is additionally blocked server-side during the beta (see §11, §22)
  - **AI Assistant** — not configured in Production, fails closed (see §12)
  - **Public dollar pricing** — not finalized (see §13)
  - **Website Traffic collection** — disabled; no analytics script, token or environment variable exists in Production (see §29)

**Launch decision record.** The decision is **GO** for Public Beta. A read-only launch review on 2026-10-31 found no launch blockers and no required code change, and a read-only reconciliation on 2026-11-01 again found no P0 blocker. The limitations the Product Owner accepted are in §25; the post-launch improvement list is §26; the short launch checklist is §27; the operations still waiting on a real event are in §30.

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

**Scheduled jobs (Vercel Cron, app project; Verified 2026-11-01 in the deployed configuration of `2a12e7a`).** Six jobs, all daily, all UTC, all behind `CRON_SECRET` (an unauthenticated request returns 401). The plan is Vercel **Hobby**, whose cron timing is only accurate to within the hour.

| Route | Schedule (UTC) | Purpose (by route) |
|---|---|---|
| `/api/cron/notification-delivery` | 05:00 | Notification email delivery |
| `/api/cron/notification-cleanup` | 05:30 | Deletes read in-app notifications after 90 days |
| `/api/cron/integration-delivery` | 05:35 | Integrations delivery |
| `/api/cron/signup-attempt-retention` | **05:45** | Deletes unactivated SignupAttempt records 90 days after their last recorded attempt (§28) |
| `/api/cron/recurring-invoices` | 06:00 | Recurring invoices |
| `/api/cron/invoice-pdf-reconciliation` | 07:00 | Invoice PDF archive reconciliation |

**Isolation notes**
- Marketing and the SaaS app are **intentionally isolated**: separate repos, separate Vercel projects, no shared code or runtime dependency. This is deliberate, in part to keep the SaaS product cleanly separable for a future transfer/sale.
- `app.aqenra.com` (auth, API, Portal, billing webhook, Platform Admin) must **never** be moved into the marketing project or repo.
- Cloudflare DNS for the apex, `www`, and `app` records is intentionally **DNS-only** (grey-clouded) for Vercel's own domain verification and TLS to work correctly. Do not enable the Cloudflare orange-cloud proxy on these records without deliberate review — it can break Vercel's certificate issuance and routing.

---

## 3. Git / Repositories

**client-portal-crm**
- Path: `~/Projects/freelance/client-portal-crm`
- Remote: `git@github.com:Sereja-dev/client-portal-crm.git`
- Current `main` SHA: `2a12e7a8fce8eea666cc6501f0484ee033987ce9` (Verified 2026-11-01: equals `origin/main` and the latest Production deployment; no open pull requests). Launch baseline of October 31: `fc72e83`.

**aqenra-marketing**
- Path: `~/Projects/freelance/aqenra-marketing`
- Remote: `https://github.com/Sereja-dev/aqenra-marketing.git`
- Current `main` SHA: `42fd441368b0cc55a1024464101d099057c65a86` (Verified 2026-11-01: equals `origin/main` and the latest Production deployment; no open pull requests). Launch baseline of October 31: `e9517cf`.

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
| Platform Admin access | **Product Owner confirmed**; unauthenticated denial Verified 2026-11-01 | `PLATFORM_ADMIN_EMAILS` is present in Vercel Production (value not inspected). The Product Owner states the Platform Admin Growth dashboard is Production-verified and the authentication hardening is complete; that is not re-verified by this document. Unauthenticated requests to `/platform-admin/*` get a 307 to login (Verified). |
| transactional email delivery | **DONE (manual, Production)** | A real Resend email was sent and successfully used during the Staff invited-signup test above. |
| Resend sender/domain | Functional (inferred from successful send) | No direct Resend-dashboard domain-verification check was performed; the successful real delivery above is the evidence. |
| Storage attachments upload | Not independently re-verified in Production | Config/metadata-verified only (see §7); no manual UI upload test performed. |
| Storage signed download | Not independently re-verified in Production | Same as above. |
| Storage deletion cleanup | Automated test coverage: PASS | Verified via integration tests (Attachment DB row + Storage object removal on delete); not a manual Production test. |
| attachments bucket hardening | **DONE (verified against real Production metadata)** | Direct, read-only query against Production confirmed `file_size_limit`/`allowed_mime_types` are set to match the app's own limits. |
| marketing desktop | Automated verification only | Screenshot pass (4 breakpoints) against the built artifact pre-deploy; live content confirmed matches via HTTP fetch. Not manually reviewed in a live browser. |
| marketing mobile | Automated verification only | Same as above. |
| marketing CTAs | **DONE (verified live)** | Live `href` targets on `aqenra.com` confirmed pointing at `app.aqenra.com/login` and `/signup`; since Marketing PR #2 the primary CTA reads **Start free** (§9). |
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
| Privacy / Terms / Cookie Policy (live) | **DONE (Verified 2026-11-01; Product Owner checked the launch versions)** | HTTP 200 on all three. **Privacy: "Effective November 1, 2026"; Terms and Cookie Policy: "Effective October 31, 2026".** Operator and contact present; feedback, Staff sign-up records and prospective website-analytics disclosures present. See §14. |
| `support@aqenra.com` and `feedback@aqenra.com` routing | **DONE (Product Owner confirmed)** | Cloudflare Email Routing active; real forwarding to the operator's inbox verified; `support@` routing preserved when `feedback@` was added. See §8. |
| Feedback Widget V1 | **DONE (Product Owner confirmed, Production)** | A real bug report was submitted and its delivery verified in the mailbox; the draggable position and its persistence across reload were verified. See §23. |
| Staff password reset (Production) | **Not performed** | Automated coverage exists (§25); no manual Production smoke is recorded. |
| Cross-tenant live click-through (Production) | **Not performed** | Tenant isolation is evidenced by automated tests only (§25). |
| SignupAttempt table and migration | **Verified (Production)** | `20261031000000_add_signup_attempt_foundation` applied to Production on 2026-11-01 with the approved wrapper (additive); status then 61 migrations, up to date (§24, §28). |
| Platform Admin Growth dashboard | **Product Owner confirmed (Production)**; deployment and denial Verified 2026-11-01 | `/platform-admin/growth` shipped in PR #198; the Product Owner states it is Production-verified. Unauthenticated access gets a 307 to login. See §28. |
| Website Traffic section on Growth | **Product Owner confirmed (UI)**; disabled state Verified | Shipped in PR #199; the section shows its safe "not enabled" state. Collection is **disabled** and no tracking exists (§29). |
| First real SignupAttempt record | **Pending organic event** | No organic Staff signup has been observed since recording shipped. Evidence will be on the Growth page (§30). |
| First SignupAttempt retention cron run | **Pending organic event** (scheduled) | First run is 05:45 UTC on 2026-11-02 (Hobby: ±1 hour). No run has been observed (§30). |
| Staff signup → confirm → login after the SignupAttempt changes | **Open — actionable** | The Staff signup action and first-login provisioning changed on 2026-11-01; covered by CI (integration + E2E) only. One real signup would close it. Not a known defect (§30). |

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
- Platform Admin authorization via an env-var allowlist, never tied to workspace ownership; every Platform Admin query calls the guard first (enforced by static security checks — 25 pass in CI), with no server actions, route handlers or raw SQL in the Platform Admin code. The Product Owner states the Platform Admin authentication hardening is complete.
- Growth and SignupAttempt (§28): registration data is read only through guard-first Platform Admin queries, is never exposed to Staff or Portal routes, and the recorder stores no passwords, tokens, links, IPs or user agents.
- Website Traffic (§29): the only outbound credentialed call in Platform Admin is gated by a strict `WEBSITE_TRAFFIC_ENABLED === "true"` check, is server-side only, never falls back to the app's own Vercel project, and logs nothing.
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
- Concept: two overlapping rounded squares — no letterform, no resemblance to the generic Next.js/Vercel triangle it replaced. Originally shipped in the app's own "Aqenra Indigo" accent colors; recolored to sky-blue along with the rest of the UI (see the theme update below, §31.A). **Verified from current source 2026-11-18**: `src/app/icon.svg` now hardcodes `#075A94`/`#0369A1` (sky-blue), not the earlier indigo values.
- The generic stock favicon has been removed from both repos (app and marketing).
- The marketing Open Graph image: it contained no generic mark. Its tagline was updated on 2026-11-01 (Marketing PR #2) from the pre-launch wording to "Free Public Beta · registration open".
- **Marketing messaging (Verified live 2026-11-01; shipped in Marketing PR #2, merge `1e9aad2`).** The site presents Aqenra as a **Free Public Beta with registration open**: hero badge "Free Public Beta · registration open", the note "Free during the public beta. No payment required. Features and availability may evolve.", the stage stat "Free Public Beta · no payment required", a launch section titled "Aqenra is open for registration — free during the public beta.", a FAQ "Is Aqenra available now?" (yes; no payment required; paid plans and online payments are not available), and a footer line "Free Public Beta · registration open · no payment required". The primary CTAs read **Start free** (header, mobile menu, hero, launch section) and go to `https://app.aqenra.com/signup`; "Sign in" goes to `https://app.aqenra.com/login`; Privacy and Terms link to the app's legal pages. The nav and footer label is "Free beta". The earlier "advanced pre-launch · pre-revenue" and "Open preview" wording is gone. No paid plan, price, date, customer count or testimonial is stated. This closes the former marketing-wording limitation (§25).
- The marketing Cookie page describes the planned, not-yet-enabled analytics measurement in prospective terms (§14, §29). The marketing site contains **no** analytics component, package or script.
- **Corrected 2026-11-18 (Marketing PR #5, merge `8844cca`; app PR #231, merge `698e4f5`):** the owner asked for the operator's personal name to be removed from public footers. Both the app and marketing footers now show only "© {year} Aqenra" / "© {year} Aqenra. All rights reserved." — the personal-name line is gone from both. The full legal pages (Privacy/Terms/Cookie Policy) and the marketing Cookie page still name the operator in full; only the public footer label changed (§14 has the precise wording and where each still applies).
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

**Live documents (Verified 2026-11-01: HTTP 200 on each; the Product Owner verified the launch versions manually on 2026-10-31)**

| Document | URL | Effective |
|---|---|---|
| Privacy Policy | `https://app.aqenra.com/privacy` | **November 1, 2026** (re-dated when the Staff sign-up records disclosure and the prospective website-analytics disclosure were added) |
| Terms of Service | `https://app.aqenra.com/terms` | **October 31, 2026** |
| Cookie Policy | `https://app.aqenra.com/cookies` | **October 31, 2026** (first published October 27, 2026; re-dated when the "Feedback button position" storage disclosure was added, PR #195) |

**Operator identity.** Aqenra is operated by **Umerenko Sergei, an individual, under the Aqenra brand**; "Aqenra is a product name, not a registered company". Contact: `support@aqenra.com`. These come from the shared legal configuration (`src/lib/legal/platform-config.ts`); Production sets no legal-name, address, jurisdiction or effective-date overrides (names checked 2026-10-31), so the code defaults apply.

**Where it appears.** The three legal pages, the Platform Admin configuration labels, every transactional email's legal footer, and the marketing Cookie page still name the operator in full. **Corrected 2026-11-18** — the public footers do not: the app's Staff/public footer (`src/components/layout/footer.tsx`, via `getPlatformCopyrightLine()`) now renders only "© {year} Aqenra" (**Verified from current source**), and the marketing footer renders only "© {year} Aqenra. All rights reserved." (**Verified from current source** against the marketing repo's `origin/main`, PR #5). Neither public footer names the operator since Marketing PR #5 / app PR #231 (2026-11-16); this is a public-footer-label change only — the operator-identity fact above, and every other place it appears, is unchanged. The marketing site's Privacy/Terms links point to the app's pages above. The marketing Cookie page carries no date of its own and links to the app's dated Cookie Policy.

**Disclosures added with the Feedback Widget.** Privacy: "Feedback from inside the app" (what a message or bug report includes). Cookie Policy: "Feedback button position" (browser-local storage of the button's coordinates only).

**Disclosures added on 2026-11-01 (Privacy Policy, effective November 1, 2026).**
- **Staff sign-up records** (PR #197): what is recorded for a Staff signup attempt (email, first and latest recorded attempt, attempt count, signup origin, activation time), that it includes attempts never completed through email confirmation, that the record holds no password, confirmation link, IP address or browser details, and that unactivated records are deleted automatically once 90 days have passed since the most recent recorded attempt (a daily, batched cleanup, so a record may outlive the 90 days briefly). The cleanup removes only the sign-up record and does not delete or change any Supabase Auth account.
- **Website analytics (if enabled)** (PR #199, corrected in PR #200): written in prospective terms only ("We may measure…", "If and when we switch it on…"). The application-level "no third-party analytics" claim is scoped to the application itself.
- **Three factual corrections shipped in PR #200 (Privacy) and Marketing PR #4 (Cookie page):** (1) retention — Vercel keeps the data available for the plan's reporting window and may keep it longer; Aqenra promises no deletion date; (2) browser storage — the no-cookies statement is attributed to Vercel and the unverified claim that the script uses no browser storage was removed (Aqenra adds none of its own); (3) URL parameters — the recorded web address can include a query string, and query strings are intended to be removed before events are sent. **That sanitizer is not implemented** (§29).
- **Marketing Cookie page:** no effective date of its own. It says the site itself sets no cookies, browser storage, tracking pixels or advertising trackers, describes the planned cookieless measurement (analytics cookies — none, according to Vercel; functional browser storage set by the site — none), and promises to state the switch-on date.

**Date rule.** A revised policy is never backdated; a revision gets its own new date in the same reviewed change that ships its wording (see the history comment in `platform-config.ts`). When website analytics is eventually switched on, the Privacy Policy date and the Marketing Cookie page must be updated on the actual publication day (Asia/Bangkok), and the activation requirements in §29 apply.

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

Names checked 2026-10-31 with `vercel env ls production`; no value was read or printed. Re-checked 2026-11-01 (structure and names only): the Production environment is unchanged — its most recent change predates 2026-11-01 — and none of the Website Traffic variables below exist.

**Deferred (missing intentionally)**

| Variable | Category | Status |
|---|---|---|
| `BILLING_PROVIDER` / `BILLING_ENVIRONMENT` / `BILLING_API_KEY` / `BILLING_WEBHOOK_SECRET` / `BILLING_STARTER_PRICE_ID` / `BILLING_PRO_PRICE_ID` / `NEXT_PUBLIC_BILLING_CLIENT_TOKEN` | Paddle | Missing intentionally |
| `AI_PROVIDER` | AI | Missing intentionally |
| `AQENRA_OPENAI_API_KEY` | AI | Missing intentionally |
| `TEST_MODE` | Test infra | Absent intentionally |
| `WEBSITE_TRAFFIC_ENABLED` / `VERCEL_ANALYTICS_TOKEN` / `VERCEL_ANALYTICS_PROJECT_ID` / `VERCEL_ANALYTICS_TEAM_ID` / `WEBSITE_TRAFFIC_COLLECTION_START` / `WEBSITE_TRAFFIC_REPORTING_WINDOW_DAYS` | Website Traffic | Absent intentionally — collection is disabled; activation deferred (§29). The names are documented, without values, in `.env.example` |
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
- Platform Admin (owner-only access; Growth dashboard, §28)
- Marketing (now describing the Free Public Beta, §9)
- Domains
- Branding
- Security hardening

### Website Traffic activation (deferred)
Not a launch gate. Required before collection may ever be switched on (details in §29): applicable visitor jurisdictions and the consent approach (legal review); the Vercel Hobby commercial-use question and the hosting plan; a live test of the Web Analytics read API with a project-scoped token (explicit Product Owner approval); token lifetime, scope and storage; the real collection start date and the day-bucket timezone; the `beforeSend` query-string sanitizer; verification of the script's browser-storage behavior; and the publication-day Privacy and Cookie-page updates.

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

**SignupAttempt retention cron (§28):** to stop it, remove the `/api/cron/signup-attempt-retention` entry from `vercel.json` and redeploy; the route stays protected by `CRON_SECRET`. The project-wide "Disable Cron Jobs" setting also stops it but stops all six jobs — avoid unless urgent. **Do not drop the `SignupAttempt` table as a rollback:** it holds personal data collected under the published disclosure, Prisma migrations are forward-only, and the previous application code ignores the table. Recording is best-effort and cannot block signup or login, so a recording defect is fixed forward.

**Website Traffic (§29):** it is disabled; leave `WEBSITE_TRAFFIC_ENABLED` unset. If it were ever enabled and misbehaved, unsetting it (and redeploying) restores the disabled state.

**AI:** remove or blank `AI_PROVIDER` (or `AQENRA_OPENAI_API_KEY`) in Vercel Production and redeploy — restores the fail-closed state immediately.

**Paddle:** remove or blank the billing provider environment variables in Vercel Production and redeploy — restores the fail-closed "not configured" state immediately.

No destructive database rollback is documented here, as none is required for any of the above.

---

## 18. Known Good Baselines

**App (current):** `2a12e7a8fce8eea666cc6501f0484ee033987ce9` (2026-11-01)
**Marketing (current):** `42fd441368b0cc55a1024464101d099057c65a86` (2026-11-01)

**App (Public Beta launch baseline, historical):** `fc72e83b3e76ea6a11438683099900357f1b75f1` (2026-10-31)
**Marketing (Public Beta launch baseline, historical):** `e9517cf463e48d8ee2934f0a3b979f8de3130ec2` (2026-10-31)

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
- Do not enable Website Traffic (`WEBSITE_TRAFFIC_ENABLED`), create an analytics token, enable Vercel Web Analytics or add an analytics component to the marketing site outside the activation requirements in §29.
- Do not drop the `SignupAttempt` table or backfill it from Supabase Auth without a separate decision: a backfill would be deleted by the 90-day retention cron for any unconfirmed signup older than 90 days.
- Do not delete a user's account by hand without also removing their `SignupAttempt` row (there is no cascade).
- Do not backdate the Privacy Policy: a changed policy text needs a new effective date set on its actual publication day (Asia/Bangkok).

---

## 20. Exact Next Steps

1. Decide whether launch is free/no-billing first, or paid immediately. — **DECIDED: Free Public Beta** (§22).
2. Decide Starter/Pro dollar pricing. — **Deferred** to after launch (business decision, §13).
3. Configure `support@aqenra.com` and update the contact locations. — **DONE** (§8, §14). `feedback@aqenra.com` is also configured (§23).
4. If/when paid: configure Paddle sandbox, run E2E, then live (§11). — **Deferred.**
5. Create the OpenAI Production project/key only when AI is ready to be enabled (§12). — **Deferred.**
6. Post-configuration smoke tests for whichever of Paddle/AI is enabled later. — **Not applicable until enabled.**
7. Public Beta launch. — **Decision recorded: GO.** Remaining steps are the checklist in §27.
8. Marketing messaging aligned with the Free Public Beta. — **DONE** (2026-11-01, §9).
9. Staff signup recording, Platform Admin Growth dashboard and the 90-day retention cron. — **Shipped** (2026-11-01, §28). Evidence still pending a real event: §30.
10. Website Traffic. — **Built, disabled, activation deferred by the Product Owner** (§29).
11. Operations waiting on a real event (first SignupAttempt record, first retention cron run, post-change Staff signup, final `main` CI). — **See §30.**

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

**November 1, 2026 release history (merge commits on `main`)**

| PR | Change | Merge |
|---|---|---|
| #196 | Launch handoff refresh for the Free Public Beta (baseline `fc72e83`) | `090d540` |
| #197 | SignupAttempt foundation: table and additive migration, Staff signup-attempt recording, atomic activation with User creation, 90-day retention cron, Privacy Policy disclosure (effective November 1, 2026) | `3c4694e` |
| #198 | Platform Admin Growth dashboard | `374ad7d` |
| #199 | Website Traffic preparation: disabled-by-default Platform Admin section, prospective Privacy and Cookie-page disclosures | `f776938` |
| #200 | Privacy Policy wording correction (retention, browser storage, URL parameters) | `2a12e7a` |
| Marketing #2 | Free Public Beta copy ("Start free", Open Graph tagline) | `1e9aad2` |
| Marketing #3 | Prospective cookieless-analytics disclosure on the Cookie page | `cd987f1` |
| Marketing #4 | Cookie-page wording correction (same three corrections) | `42fd441` |

**Verification record at the November 1, 2026 baseline (app `2a12e7a`, marketing `42fd441`)** — checked read-only on 2026-11-01 unless stated; no Production data was changed to produce it.

| Item | Result | Evidence |
|---|---|---|
| App `main` vs Production | `origin/main` = `2a12e7a8fce8eea666cc6501f0484ee033987ce9` = latest Production deployment; no open pull requests | Git; GitHub deployment records |
| App Production deployment | `dpl_3HXhCVCJd2xUw8wyFrfNEtpXmnjh`, target Production, READY, `app.aqenra.com` attached; six crons in the deployed configuration | Vercel CLI and API (read-only) |
| Marketing Production deployment | `dpl_9nLYq2zuFhnFrAdN1LxK2c9Z9c1Z`, target Production, READY, `aqenra.com` and `www.aqenra.com` attached; `main` = `42fd441368b0cc55a1024464101d099057c65a86`; no open pull requests | Vercel CLI and API; GitHub |
| Database migrations | **61** migrations; "Database schema is up to date!"; nothing pending or failed | Production Migration Status workflow, run on `2a12e7a` |
| Public routes | `aqenra.com/`, `/cookies`, and `app.aqenra.com/login`, `/signup`, `/privacy` return 200; `www.aqenra.com` returns 308 to the apex | HTTP GET |
| Privacy Policy | "Effective November 1, 2026"; Staff sign-up records, 90-day retention and the prospective website-analytics wording (with the three corrections) present | HTTP GET |
| Marketing Cookie page | Prospective analytics description with the three corrections; no claim that analytics is active; no mention of a sanitizer as shipped | HTTP GET |
| Tracking disabled | Marketing `package.json` has only Next.js and React; no analytics component or script in `src`; `/_vercel/insights/script.js` returns 404; the marketing project's Web Analytics setting has no `enabledAt`; none of the Website Traffic variables exist in CRM Production | Git; HTTP GET; Vercel API (keys and names only) |
| Platform Admin and cron denial | Unauthenticated `/platform-admin/growth` → 307 to login; unauthenticated `/api/cron/signup-attempt-retention` → 401 | HTTP GET |
| Static security checks | 25 pass in CI Fast Checks | GitHub Actions |
| Post-merge CI on `2a12e7a` (`push` to `main`) | Fast Checks: pass. Production Migration Status: pass. Integration & E2E: **pass** — Vitest 329 of 329 files; Playwright 1639 planned: **1638 passed, 0 failed, 0 flaky, 1 skipped, 0 not run** (15.4 min). Checked after the run completed (2026-11-01). | GitHub Actions |
| PR CI before merge (PR #200, same code) | Vitest 329 of 329 files; Playwright 1639 planned: **1638 passed, 0 failed, 0 flaky, 1 skipped, 0 not run** | GitHub Actions |

---

## 25. Accepted Launch Limitations

These were reviewed for the Public Beta launch and accepted by the Product Owner. None is a launch blocker.

1. **Online payments deferred.** Paddle is not configured and paid checkout is blocked during the beta (§11, §22).
2. **Marketing wording — closed 2026-11-01.** The marketing site now describes the Free Public Beta with a "Start free" CTA (Marketing PR #2, §9). Kept here so the earlier acceptance is not mistaken for an open item.
3. **Legal review open.** The jurisdiction clause is generic placeholder wording, no postal address is published, and the liability clause is unreviewed. Subject to operator/legal review. No legal counsel approval is claimed (§14).
4. **Rate limiting is not distributed.** Counters are in-memory and per instance and reset on a cold start — an accepted app-wide tradeoff that also applies to the Feedback Widget limits.
5. **Password reset.** No manual Production smoke is recorded. Automated coverage exists (an E2E spec and integration/unit tests for the request, confirm and update paths), and it uses the same email path as the flows verified in Production.
6. **Occasional E2E flakes are tracked and undiagnosed.** `settings-uploads-migration.spec.ts:194` retried once in the post-merge CI (its first attempt matched two `table` elements with an ambiguous locator); `company-profile.spec.ts:243` is timing-sensitive and passes when run alone. One, `invoice-internal-notes-validation-reset.spec.ts:145`, was fixed by correcting a URL wait that also matched `/invoices/new` (PR #194). Since then three more first-attempt failures passed on Playwright's automatic retry in later PR runs: `client-column-customization.spec.ts:136` (empty column headers on the first attempt, PR #197), `projects-tasks-migration.spec.ts:112` (two `Comment` textareas matched, PR #197) and `client-column-customization.spec.ts:204` (expected row order not yet present, PR #199). A Calendar navigation test was also fixed for timing in **PR #230** (merge `c2f5d9a`, 2026-11-16) — a **test-only** change (the navigation timing in the spec itself), not a product-code fix; §31.H has the detail and its own stated limitation. A `feedback-widget.spec.ts:293` flake (first attempt failed with the dragged button measured outside the viewport immediately after a live `setViewportSize()`, `x = -382`; the retry passed) was likewise addressed by a **test-only** change in **PR #236** (merge `e1b22bf1`, 2026-11-21): an `expect.poll`-based wait for the post-resize layout to settle, matching an idiom already used one test earlier in the same file. §32.C has the detail and explicitly does not claim the original race was proven, only that it is a strongly supported hypothesis. Most recently, `project-column-customization.spec.ts:119` ("default state: all seven canonical Project desktop columns are present, matching today's table exactly") failed on its first attempt and passed on retry in the post-merge CI for commit `e1b22bf1` (2026-11-21) — a single observation; §32.D has the detail. The causes of every flake in this item remain undiagnosed except where a fix is explicitly cited above, so none is classified as unrelated or as a Product defect; the final retry of each passed.
7. **No live cross-tenant click-through is claimed.** Tenant isolation is evidenced by automated tests (integration suite, dedicated security checks, and the widget's tenant tests), not by a manual cross-tenant test in Production.
8. **Carried over from earlier handoffs:** the five `npm audit` HIGH findings confined to the Prisma CLI's build-time chain (§10); the Quotes gaps in §21.9; one Portal login belongs to one Client (§21.8).
9. **Vercel Hobby plan and commercial use (Product Owner decision, 2026-11-01).** The Product Owner decided not to buy Vercel Pro and not to contact Vercel Support. Vercel restricts Hobby to non-commercial personal use and defines commercial use broadly (financial gain of anyone involved in any part of production, including advertising the sale of a product or service). Whether a free public beta of a product planned to become paid is permitted is **not explicitly addressed** by the terms: a standing hosting-plan ambiguity that is accepted, not resolved. No claim is made either way.
10. **Website Traffic deferred.** The integration is shipped and collection is disabled (§29). There is no visitor data and none will exist until separately activated.
11. **Hobby runtime logs are kept for one hour** (Vercel's documented limit). A failure of SignupAttempt recording or of the retention cron is not retrievable from logs after about an hour; the durable evidence is the Growth page data. Hobby cron timing is also only accurate to within the hour.
12. **SignupAttempt history is incomplete.** Recording began on 2026-11-01 and no backfill was run; earlier accounts appear only as "Without a recorded signup". Recorded attempts are a lower bound (attempts rejected before an Auth user id was returned are not counted). Unactivated records are deleted 90 days after their last attempt (§28).

---

## 26. Post-Launch Improvements

Optional, in no required order. None blocks the launch.

- Announce pricing when it is decided (§13). (The marketing wording was already aligned with "Free Public Beta" on 2026-11-01, §9.)
- Operator/legal review of the jurisdiction, address and liability wording (§14).
- A shared store for distributed rate limiting (§25, item 4).
- An optional manual Production password-reset smoke (§25, item 5), and an optional live cross-tenant check (§25, item 7).
- Website Traffic activation, if the Product Owner later chooses to pursue it (§29).
- Decide the Vercel hosting plan if the commercial-use ambiguity or the Hobby limits (§25, items 9 and 11) start to matter.
- Stabilize the tracked flaky specs (§25, item 6); consider sharding the E2E job if its runtime keeps growing toward the 45-minute cap.
- Look into an occasional Prisma "record not found" (`P2025`) line in E2E server logs, seen around the Platform Admin Organization Detail page when a fixture organization is deleted mid-request; no test failed because of it and its cause is not proven.
- Cosmetic: a visitor who deep-links to a protected page and is redirected to login sees "Your session expired" even if they never signed in.
- Paddle billing (§11), the AI Assistant (§12), and a defined plan for ending the free beta (§22) when those become priorities.

---

## 27. Public Beta Launch Checklist

**Already done**
- [x] Launch decision recorded: GO, no Product blockers (October 31, 2026).
- [x] Production serves the launch baseline `fc72e83` (2026-10-31); migrations up to date; post-merge CI passed (§24). Current baseline `2a12e7a` with 61 migrations: §24.
- [x] Privacy (effective November 1, 2026), Terms and Cookie Policy (effective October 31, 2026) live; operator and contact shown (§14).
- [x] Marketing site describes the Free Public Beta with a "Start free" CTA (§9).
- [x] SignupAttempt recording, the Growth dashboard and the 90-day retention cron are shipped; Website Traffic is built and disabled (§28, §29).
- [x] `support@aqenra.com` and `feedback@aqenra.com` routing and delivery confirmed; Feedback Widget V1 confirmed in Production (§8, §23).
- [x] Free Public Beta posture in place: 5 members, 3 GB, no paid checkout (§22).

**Before announcing**
- [ ] Re-check that `app.aqenra.com` is still serving the current baseline `2a12e7a` (or record the new SHA here if something has been deployed since).
- [ ] Write the announcement so it says *Free Public Beta*, states the 5-member / 3 GB limits, names `support@aqenra.com`, and mentions the in-app feedback button. The marketing site already says *Free Public Beta* (§9) but does not state the limits or the feedback button.
- [ ] Open — actionable: confirm one real standalone Staff signup → confirm → login after the SignupAttempt changes (§30).
- [ ] Optional: run a manual password-reset check in Production (§25, item 5).
- [ ] At the operator's discretion: obtain legal review of the open legal wording (§14).

**After announcing**
- [ ] Watch the `support@` and `feedback@` inboxes (forwarded to the operator's inbox) and reply to users.
- [ ] Check the Platform Admin observability page and the Vercel logs for errors; the Production Migration Status workflow runs automatically after each Production deployment.
- [ ] Keep `FREE_BETA_MODE` on; make no Production environment changes without updating this document.
- [ ] Record anything significant that changes (new baselines, new limitations, decisions) in this document.
- [ ] Pending organic events: the first real SignupAttempt record and the first retention cron run (§30).

---

## 28. SignupAttempt and the Platform Admin Growth Dashboard

**Shipped 2026-11-01** in PR #197 (merge `3c4694e`) and PR #198 (merge `374ad7d`); Verified deployed (§24).

**What is recorded.** One `SignupAttempt` row per Supabase Auth identity that submitted a **Staff** signup after the release: normalized email, origin (`STANDALONE` or `INVITED`, taken from the invitation token — never inferred), first and latest recorded attempt times, a recorded-attempt count, and an activation time. Portal signups are never recorded. Nothing else is stored — no password, confirmation token or link, request body, IP address, user agent or Auth metadata. Recording is best-effort and time-bounded: a failure is logged as one fixed line and can never block or fail a signup or login.

**Activation.** The Prisma `User` row and the matching attempt's activation are written in one transaction when the account is first provisioned, so a committed account always carries its activation; if that step is unavailable, the account is still created and activation falls back to a best-effort write. `User.createdAt` is the authoritative app-account creation time. No email-confirmation timestamp is shown anywhere, because Supabase Auth is not queried.

**Production migration.** `20261031000000_add_signup_attempt_foundation` (additive: one table, two enums, two indexes, two CHECK constraints) was applied to Production on 2026-11-01 with the approved wrapper, before the code was deployed. No other table was touched.

**Historical limitations.**
- Recording **began with the 2026-11-01 release**. **No historical backfill has been run.** Accounts created earlier appear on the Growth page only as "Without a recorded signup", and signup counts cover the recording period only; a zero before it is not evidence that nobody registered.
- Recorded attempts are a lower bound; `firstAttemptedAt` is when this application first recorded the identity, not necessarily the true signup time of an older account.
- A backfill (not authorized) would need care: retention would delete any backfilled unconfirmed signup older than 90 days.

**Retention (published in the Privacy Policy, effective 2026-11-01).** A daily cron (`/api/cron/signup-attempt-retention`, 05:45 UTC) deletes **unactivated** records whose latest recorded attempt is more than 90 days old (exactly 90 days is kept), in bounded batches (500 per batch, at most five batches per run). Prisma `User` existence is authoritative: a record whose account exists is never deleted (it is repaired to the account's creation time instead). The job only reads `User` and only writes `SignupAttempt`; it never touches Supabase Auth, organizations, memberships or business data. Activated records follow the account's lifecycle. Deleting a record does not delete the Auth identity.

**Growth dashboard (`/platform-admin/growth`, owner-only).** Cards separate signup identities, recorded attempts, activated Staff accounts and workspaces (organizations) so they are never read as the same thing; 7 / 30 / 90-day UTC windows with a two-series daily chart (days before recording show a gap, not zero); and a paginated, searchable, stably sorted registration directory with UTC timestamps, origin, attempt count, status and at most three linked workspaces per row. Status is derived from `User` existence, not only from the recorded activation. Reads are bounded (counts, aggregates, one page, or capped single-column reads) and a cap is reported rather than hidden. **Product Owner confirmed** in Production; the page and its guard-first queries are covered by unit, integration and E2E tests.

**Evidence, corrected 2026-11-18 (see §31.G for the full re-check).** This section's earlier wording ("no organic Staff signup has been observed") is stale: **Owner-confirmed**, the Product Owner subsequently reported at least one real Staff signup that did not result in an activated account — i.e. a signup attempt that stayed pending. This is exactly the "recorded attempt, no activation" state this feature was built to surface; it is not, by itself, evidence of a Product defect. The specific cause (abandonment, an unconfirmed-retry edge case, delivery failure, or something else) is **unverified** — see §31.E/§31.G for what was and wasn't investigated, and why the Product Owner explicitly deferred further investigation of the Supabase retry question. No claim is made here about how many such records exist or their exact detail; this section was not re-queried against the live Growth dashboard on 2026-11-18.

---

## 29. Website Traffic (Built, Deliberately Disabled)

**Shipped 2026-11-01** in PR #199 (merge `f776938`) with disclosure corrections in PR #200 (merge `2a12e7a`) and Marketing PRs #3 and #4. **Collection is DISABLED and activation is deferred by the Product Owner.**

**What exists.**
- A "Website traffic" section on `/platform-admin/growth` that reads the official Vercel Web Analytics query API server-side. **Product Owner confirmed** in Production (UI); the safe "not enabled" state is what it shows. It makes no request unless `WEBSITE_TRAFFIC_ENABLED` is exactly `true`, and it needs a server-only token, the marketing project id and a collection start date. Failures become typed states and cannot affect the registration dashboard. Daily visitors are per-UTC-day figures (never "unique people over a period"); there are no sessions and no visitor-to-signup conversion.
- Prospective disclosures: the Privacy Policy bullet "Website analytics (if enabled)" and a paragraph on the Marketing Cookie page, both worded so they do not claim analytics is active.

**What does not exist (Verified 2026-11-01).** No analytics component, package or script in the marketing site (its only dependencies are Next.js and React; `/_vercel/insights/script.js` returns 404); the marketing project's Web Analytics setting has no `enabledAt`; none of the Website Traffic environment variables exist in CRM Production, and no Vercel analytics token was created. **No visitor has been counted and no traffic history exists**; nothing can be backfilled.

**Decisions (Product Owner, 2026-11-01).** No Vercel Pro subscription, no contact with Vercel Support, no activation at this time.

**Hobby facts that apply if it is ever activated** (Vercel documentation): Web Analytics is free on Hobby up to 50,000 events a month (a 3-day grace period, then collection pauses; it resumes after 7 days); the reporting window is 1 month; custom events and UTM parameters are not available. Whether the read API is supported on Hobby, and whether a project-scoped token can call it, are **not documented** and would need a live test.

**Activation requirements preserved (all open, none started).**
1. Visitor jurisdictions and the consent approach, with legal review.
2. The Vercel Hobby commercial-use question and the hosting plan (§25, item 9).
3. A live test of the Web Analytics read API with a project-scoped token, with explicit Product Owner approval: the `by` parameter form, the `pageviews` and `visitors` fields, whether `teamId` is accepted, the reporting-window edge, the day-bucket timezone, and the documented rate limits (none published).
4. Token lifetime, scope and secure storage.
5. The real collection start date, and a conservative reporting-window setting (28 days) until the live test settles it.
6. **The `beforeSend` sanitizer: strip query strings and fragments from every event URL before collection starts. It is NOT implemented.**
7. Verification of the standard script's browser-storage behavior.
8. On the publication day: the Marketing Cookie page states the switch-on date, and the Privacy Policy effective date is updated.

---

## 30. Pending Operations and Evidence

These are **evidence questions, not Product defects.** No Product bug is known for any of them.

| Item | Classification | What is needed | Notes |
|---|---|---|---|
| First real SignupAttempt record | **Owner-confirmed (corrected 2026-11-18)** | None further to close this specific item. | At least one real Staff signup has occurred and did not result in an activated account (Owner-confirmed, §28, §31.E/G). The exact record detail was not independently re-queried against `/platform-admin/growth` as part of this documentation pass. |
| First retention cron execution | **Inferred, not proven** (corrected 2026-11-18) | A second independent observation, and verification of an actual 90-day-old-record deletion, remain open — see note. | One HTTP 200 was observed close to the scheduled 05:45 UTC time in an earlier check, but the available log did not explicitly identify Vercel Cron as the trigger, so this is an inference, not proof. A second observation was not established, and by the nature of Vercel Hobby's ~1-hour log retention (§25, item 11), it is very unlikely any further historical run can still be independently re-verified after the fact — this is a standing evidence gap, not a pending task that will resolve itself. |
| Staff signup → confirm → login after the SignupAttempt changes | **Open — actionable** | One real standalone Staff signup, confirmation email and login — organic, or one the Product Owner chooses to perform. | The Staff signup action and first-login provisioning changed on 2026-11-01. They are covered by CI (integration and E2E) but have not been observed in a real Production signup since. A real signup would also produce the first SignupAttempt record above. |
| Final post-merge CI on `main` (`2a12e7a`) | **Verified** (complete, passed) | None. | Fast Checks, Production Migration Status and Integration & E2E all passed; counts in §24. Re-check the status after any later deployment. |
| Earlier Playwright flaky tests | **Accepted limitation** | None required. | §25, item 6. |
| Website Traffic activation | **Accepted limitation** (deferred) | Only if the Product Owner reopens it. | §29. |
| Vercel Hobby commercial-use ambiguity | **Accepted limitation** (Product Owner decision) | Only if the Product Owner reopens it. | §25, item 9. |
| Manual password-reset smoke; live cross-tenant check | **Optional post-launch** | None required. | §25, items 5 and 7. |
| Client Portal mixed-currency authenticated Production smoke | **Explicitly deferred by the Product Owner** | A manual, authenticated Production check of the outstanding-by-currency totals with a client carrying invoices in more than one currency. | Automated integration (`test/integration/portal-invoices/outstanding-by-currency.test.ts`) and E2E (`test/e2e/portal-outstanding-by-currency.spec.ts`) coverage exists (§31.D). The Product Owner chose to defer the authenticated Production smoke until the end — not performed, not forgotten, and not evidence of a defect. |
| Supabase Admin `generateLink` retry behavior for an existing unconfirmed signup | **Explicitly deferred by the Product Owner** | A separately authorized experiment against a demonstrably isolated, non-Production Supabase environment (see §31.E/G). | A 2026-11-18 read-only readiness assessment found no such environment currently ready: the repo's own local Supabase CLI stack cannot run on this machine (Docker is not installed) and would additionally need a temporary, non-committed config change; no demonstrably separate hosted non-Production project is evidenced. Verdict: NEEDS SETUP. No experiment has been run. There is currently no confirmed user-facing defect tied to this question. |

---

## 31. November 18, 2026 Reconciliation (baseline app `1a7a3a0`, marketing `8844cca`)

This section reconciles everything shipped between the 2026-11-01 baseline (§1–§30) and 2026-11-18, and corrects the specific claims in earlier sections noted inline above. It distinguishes, per item: confirmed from current source, confirmed by a named CI/deployment record, owner-confirmed manual behavior, inferred from partial evidence, unverified, explicitly deferred by the owner, and optional future functionality. Nothing in this section implies a product-code change beyond what each item states — most of this work is UI/test/documentation, and is labelled as such.

### A. Appearance and interface

**Verified from current source, with PRs cited.** The dark-theme accent and the overall theme were reworked from indigo/purple to sky-blue, and the light theme to a black-and-white style, in **PR #226** (`feat/sky-blue-grayscale-theme`, merge `21e52eb`, 2026-11-14). Light-theme hover/contrast on interactive controls was then improved in two follow-ups: **PR #227** (`fix/sidebar-light-hover-contrast`, merge `26cf697`, 2026-11-15) and **PR #229** (`fix/light-hover-visibility`, merge `c02c770`, 2026-11-16) — the latter explicitly covers the account-menu and related interactive controls. The favicon/logomark was recolored to match (§9; `src/app/icon.svg` now hardcodes the sky-blue `#075A94`/`#0369A1`, verified from current source 2026-11-18).

The floating Feedback Widget's idle-vs-active prominence and the light-theme hover fix are **Owner-confirmed** manually; this document does not independently re-verify either in Production. No E2E/visual-regression suite is claimed to cover the exact idle/active visual states.

### B. Recurring invoices

**Verified from current source, with PRs cited.** The recurring-invoices list was made responsive — a card layout on narrow screens, a table on wider ones — across **PR #215** (`fix/recurring-line-item-actions-visible`, merge `aaecbf8`, 2026-11-04) and **PR #218** (`fix/recurring-invoices-list-responsive`, merge `95ddbd0`, 2026-11-05), with a later desktop-table wrapping fix for long user-authored values (commit `b67255a`, already on `main`). A generic breakpoint E2E spec (`test/e2e/responsive-list-tables-breakpoint.spec.ts`) exists and exercises list/table breakpoint behavior.

The Product Owner supplied screenshots of the Production interface demonstrating the responsive behavior at the breakpoints shown (**Owner-confirmed**, screenshot-based). **Unverified**: any viewport, data shape, or browser not shown in those screenshots — the screenshots demonstrate what they show and no more.

### C. Contracts

**Verified from current source.** The contract number in the main contracts list is a link that opens the detail page, shipped in **PR #220** (`feat/contract-number-link`, merge `bd2bea3`, 2026-11-09). Automated coverage exists for contract numbering/formatting/validation (`test/unit/contracts-numbering.test.ts`, `test/unit/contracts-validation.test.ts`, `test/unit/contract-columns.test.ts`) but **no dedicated integration or E2E test was found that clicks the contract-number link and asserts navigation to the detail page** — checked by name search in `test/integration/` and `test/e2e/` on 2026-11-18.

The Product Owner manually opened contract **C-0002** via this link (**Owner-confirmed**, one example). **Do not generalize**: this confirms the link works for that one contract; it does not establish behavior for every contract state (e.g. a contract without a number, a deleted/archived contract, or a cross-tenant id), which remain **unverified**.

### D. Client Portal outstanding totals

**Verified from current source.** Portal outstanding totals were changed to show open amounts separately by currency in **PR #217** (`fix/portal-outstanding-by-currency`, merge `4ca802c`, 2026-11-04). Automated coverage exists and was confirmed present on 2026-11-18: integration (`test/integration/portal-invoices/outstanding-by-currency.test.ts`) and E2E (`test/e2e/portal-outstanding-by-currency.spec.ts`), plus adjacent currency-isolation coverage (`test/integration/dashboard/currency-isolation.test.ts`, `test/unit/ai/tools/organization-summary-currency.test.ts`).

**Explicitly deferred by the Product Owner**: the authenticated, mixed-currency Production smoke test (a real client with invoices in more than one currency, checked while signed in to Production) was deferred to the end and has **not** been performed (also tracked in §30's table). This is not marked complete anywhere in this document, and should not be read as complete from the automated coverage above — automated tests and a live Production smoke answer different questions.

### E. Signup and invitations

**Verified from current source and CI, with PRs cited.**
- Invalid or expired signup confirmation links now display guidance on both the Staff and Portal signup pages, shipped in **PR #232** (merge `d61af61`, 2026-11-16), together with a wording fix so the page never implies a fresh attempt is guaranteed to succeed. Verified via a read-only Production GET against both pages' `?invalid=1` state as part of that PR's post-merge verification.
- The existing, company-controlled Client Portal invitation-resend action (`resendClientInvitationAction`, `src/app/(dashboard)/clients/[id]/portal-access-actions.ts`) gained integration test coverage in **PR #233** (merge `1a7a3a0`, 2026-11-18, 13 tests, confirmed present by name in the Vitest CI output both pre- and post-merge). This is test coverage for existing behavior, not a product change.
- **Verified from current source** (`src/app/(dashboard)/clients/[id]/portal-access-actions.ts:189-196`): if email delivery fails after a resend's token rotation, the previous token is already invalidated by the same update — the old invitation link no longer works. The company can copy the newly generated link from the same screen, or retry the resend, subject to the per-invitation rate limiter (`RESEND_PORTAL_INVITE_LIMIT`, in-memory and per-instance, §25 item 4).
- **Unverified, explicitly deferred by the Product Owner**: what the real Supabase Admin API (`generateLink({ type: "signup" })`) returns when called again for an existing Auth user whose email is not yet confirmed. A 2026-11-18 read-only readiness assessment (not reported elsewhere in this document; see §30's table) found no demonstrably isolated non-Production Supabase environment currently ready to answer this safely — verdict **NEEDS SETUP** (the repo's own local Supabase CLI stack cannot run without Docker, which is not installed on the machine checked, and would additionally need a temporary config change; no separate hosted non-Production project is evidenced). No experiment has been run. **There is currently no confirmed user-facing defect tied to this open question** — it explains an observed "pending" SignupAttempt record (§28, §31.G) only as a possibility, not a proven cause. Do not read "a new invitation was sent" or "the person can try signing up again" anywhere in this product as a guarantee of successful registration.

### F. Platform Admin

**Verified from current source and from prior deployment checks in this engagement.** A dedicated `admin.aqenra.com` hostname is configured and has been attached to Production app deployments in every deployment check performed across this engagement to date. **Owner-confirmed**: the Product Owner successfully opened Platform Admin using the admin URL.

**Verified from current source** (`middleware.ts`, lines 7-12, Platform Admin routing block): the dedicated hostname is explicitly documented in-code as "owner-approved convenience, never an access-control mechanism" — the same comment states that `requirePlatformAdmin()` independently re-verifies identity and the `PLATFORM_ADMIN_EMAILS` allowlist regardless of which hostname was used. The hostname comparison is by exact equality only (never substring/suffix), so a deceptive hostname cannot satisfy the check. `PLATFORM_ADMIN_EMAILS` itself is a comma-separated env-var allowlist, not a database table (`src/lib/platform-admin/authorization.ts`'s own header comment). **Do not read the existence of the dedicated hostname as an access-control mechanism by itself.**

**Not claimed**: the exact contents of `PLATFORM_ADMIN_EMAILS` were not read or disclosed as part of this reconciliation (per this document's own rule against publishing environment-variable values), so this document makes no claim about how many individuals are currently allowlisted — only that access is gated by that allowlist, checked independently of hostname.

### G. SignupAttempt retention cron

**Corrected 2026-11-18** (see also §28 and §30's table, both updated above). Two claims from the 2026-11-01 baseline no longer hold:
1. "No organic Staff signup has been observed" — **Owner-confirmed** superseded: at least one real signup occurred and did not result in an activated account. No claim is made here about its exact recorded detail (not independently re-queried against `/platform-admin/growth` in this pass).
2. "No retention-cron run is claimed to have occurred" — superseded by an earlier observation of one HTTP 200 close to the scheduled 05:45 UTC time. This is correctly classified as **Inferred, not proven**: the available log did not explicitly identify Vercel Cron (rather than some other trigger) as the source, and a second independent observation was not established. Given Vercel Hobby's documented ~1-hour log retention (§25, item 11), a historical run from that point is very unlikely to be independently re-verifiable after the fact — this is reported as a standing evidence gap, not as something expected to resolve with more waiting.

Actual deletion of any 90-day-old unactivated record has **not** been verified either way — the earliest a real record could cross 90 days is roughly late January 2027 (consistent with the original §28 timeline), so this remains **not yet testable**, not a failure.

### H. Calendar test

**Verified from current source and CI.** **PR #230** (`fix/calendar-navigation-flake`, merge `c2f5d9a`, 2026-11-16) fixed a Calendar E2E navigation-timing flake. **This changed the test's own timing/wait logic, not product functionality** — no Calendar feature code changed in this PR. Limitation, stated accurately: fixing one flake's root cause does not prove no other timing-sensitive flake can recur elsewhere in the suite; the other, separately-tracked flaky specs in §25 item 6 remain undiagnosed and are unaffected by this fix.

### I. Marketing site and footer

**Verified from current source** (read directly against the marketing repo's `origin/main`, not the possibly-stale local working tree — its footer file was found stale during this reconciliation and re-checked via `git show origin/main:...` to get the real current text). **Marketing PR #5** (`feat/sky-blue-theme-and-footer`, merge `8844cca`, 2026-11-16) updated the marketing site to the same sky-blue accent as the app (§31.A) and removed the operator's personal name from the public footer; the corresponding app-side footer change is **PR #231** (`chore/footer-remove-personal-name`, merge `698e4f5`, 2026-11-16). Current exact text, verified from source: marketing footer "© {year} Aqenra. All rights reserved."; app footer "© {year} Aqenra" (§9, §14 — both corrected above).

**Preserved**: this is a public-footer-label change only. The operator's full legal identity remains published in full on the Privacy Policy, Terms of Service, and the marketing Cookie page (§14) — nothing here removes or weakens any legal disclosure, only the short public-footer line.

The marketing deployment itself (a fresh Production alias/deployment-record check at the `8844cca` baseline) was **not** independently re-verified as part of this documentation-only task — see §1's note on this. Do not read the marketing repo's own commit history as proof of a live Production deployment without that separate check.

### J. Optional roadmap and launch limitations

- **Client custom-domain DNS verification — corrected 2026-11-18.** README.md previously stated "Settings → Domain lets an organization save a custom domain... disclosed in the UI itself." **Verified from current source**: this is stale. `src/app/(dashboard)/settings/domain/page.tsx`'s own code comment ("Unfinished Features Cleanup (Block 17)") confirms the custom-domain input/save UI and its read-only status display were both removed per product decision, because no DNS/domain verification or routing exists anywhere in the app — a saved domain would otherwise sit at "Pending" forever. The page today shows only the always-current, auto-generated subdomain. The backend (`OrganizationDomainSettings`, `upsertDomainSettings()`, `updateDomainSettingsAction`, and Platform Admin's own read-only visibility into this data) is unchanged — this was a Staff-facing UI removal, not a backend removal. This document's own README.md correction is tracked below.
- **Paddle sandbox / real checkout and webhook validation**: unchanged from §11 — no sandbox or live end-to-end test has been performed. **Explicitly deferred**, not a blocker for the Free Public Beta.
- **Trial-ending reminders and billing-reconciliation cron**: unchanged, already documented in README.md's own "Deliberately not built" list — both are optional, defense-in-depth additions, not required for correctness; not duplicated here.
- **Website Traffic analytics**: unchanged from §29 — built, collection disabled, activation deferred by the Product Owner; its own prerequisite list (§29) is still fully open and was not re-checked as part of this pass.
- **Deferred client-facing/marketing-site follow-ups**: none beyond what §25/§26 and this section already list; no additional deferred item was found during this reconciliation.

None of the above is a confirmed Production bug; each is either an accepted limitation, an explicit Product Owner deferral, or optional functionality that was never built.

---

## 32. November 21, 2026 Reconciliation (baseline app `e1b22bf1`)

This section reconciles everything shipped on `main` between the 2026-11-18 baseline (`1a7a3a0`, §31) and 2026-11-21 (`e1b22bf1`): a dependency security update, a genuine product-layout fix, a test-only fix, and one newly observed flaky test. It distinguishes confirmed-from-source and CI-confirmed facts from inferred/unconfirmed hypotheses and does not present any hypothesis here as proven.

### A. Dependency: Next.js security update

**Verified from source and CI.** **PR #235** (`chore/nextjs-security-update`, merge `9c7f8ed4e0`, 2026-11-19) updated `next` from `16.4.2` to `16.4.6`. Per that PR's own recorded investigation: the installed `16.4.2` fell inside the affected range of seven published GitHub Security Advisories (cache-related and Edge-cookie issues); all seven are fixed in the official `16.4.5` release, and `16.4.6` is a routine bug-fix backport six days later with no additional advisory content. Only `next`, `@next/env`, and the platform-specific `@next/swc-*` optional binaries changed in the lockfile — no other package, peer-dependency range, or companion package moved. Local validation recorded on that PR: clean `npm ci`, production build succeeding without the prior intermittent `SecurityFatalError` nudge, `tsc --noEmit` clean, lint clean, `security:check` 25/25, unit tests 5742/5742, integration tests 3503/3503 (identical counts to the pre-update baseline), and a targeted E2E run (194/194 passed, 0 flaky).

**Not claimed**: that the app was ever actually compromised or exploited, or that every one of the seven advisories' exact exploitation conditions was exhaustively checked across every code path (one, the Edge-cookie advisory, was checked against `middleware.ts` only, not every route handler). The build no longer showing the advisory nudge corroborates, but does not by itself prove, that every vulnerability is resolved. This update does not change the separate, pre-existing `npm audit` HIGH findings confined to the Prisma CLI's build-time chain (§25, item 8) — those are unrelated to Next.js and remain open.

### B. Tasks table breakpoint margin

**Confirmed by CI and direct local measurement; the cross-platform cause is explicitly not claimed as proven.** PR #236's own CI run (before PR #236 was synchronized with this fix) surfaced a genuine, deterministic failure — not a retry-masked flake, since both the first attempt and the automatic retry failed identically — in `test/e2e/responsive-list-tables-breakpoint.spec.ts` at the `/tasks` 1280px breakpoint: the table's own `scrollWidth` (1009px) exceeded its wrapper's `clientWidth` (1006px) by more than the test's existing 1px rounding tolerance.

A read-only investigation found the root structural cause: the Tasks table had grown from the 9 header cells this breakpoint's own width budget was originally measured against (documented in `responsive-list-tables-breakpoint.spec.ts`'s own header comment, not previously recorded in this document, and corrected in that spec file by PR #237 itself) to 11 — a selection checkbox column and an Assignee column were added, and the Actions cell gained a third control — all before this specific CI failure was noticed. Locally (macOS Chromium), the identical fixture content measured with **zero** margin (`scrollWidth === clientWidth` exactly, not over) rather than a true overflow. **The exact reason the Linux CI measurement differed from the macOS measurement by those few pixels was not identified** — a cross-platform font-rendering/text-shaping difference is a plausible candidate, not a confirmed cause, and this document does not assert it as proven.

**PR #237** (`fix/tasks-table-breakpoint-margin`, merge `91cc487e`, 2026-11-21) is a genuine, narrowly-scoped **product-code** fix, not a test-only change: an additive, opt-in `dense` prop was added to the shared `TableHeaderCell`/`TableCell` (`src/components/ui/table.tsx`, `px-4` → `px-3`, defaulting to `false` so every other table in the app renders unchanged) and applied, together with a tightened Actions-cell internal gap, to the Tasks table only. Measured locally: the table's true minimum required width at 1280px (read by forcing its wrapper far narrower than its natural size, since the shared `Table` component's own `min-w-full` otherwise stretches the table to exactly fill its container and masks any real margin) dropped from 970px to 874px against 1006px available — margin went from 36px to roughly 132px. A realistic longer-content row that previously overflowed by 74px locally fit exactly afterward. Validated: the full `responsive-list-tables-breakpoint.spec.ts` (92/92, later 109/109 alongside neighboring specs), `tsc --noEmit` clean, lint clean, production build succeeded, and CI (Linux) passed cleanly for this fix both on its own PR and after being merged to `main`.

**Not claimed**: that this fix guarantees zero overflow for every possible content length (a sufficiently long realistic row can still require the wrapper's own existing horizontal scroll — nothing hides it, and no action control becomes inaccessible), or that the macOS/Linux measurement gap itself is understood. What is confirmed is that real, measured margin was restored and the originally-failing CI assertion now passes.

### C. Feedback widget test fix

**Verified from source and CI; the original race is explicitly not claimed as proven.** The original flake (documented in this PR's own investigation notes, carried over here): `feedback-widget.spec.ts:293` failed once in CI with the dragged button's measured position outside the viewport (`x = -382`) immediately after a live `setViewportSize()` call on an already-mounted, already-dragged widget; the unmodified retry passed. The `-382` value exactly matches the arithmetic predicted by a stale-frame race (the button's CSS `right` offset reflecting its pre-shrink, unclamped value for one render) — **a strongly supported hypothesis, not a confirmed root cause**: the original failure was never reproduced locally (20 runs plus CPU-throttling diagnostics up to 6x across 240 samples never caught a stale frame).

**PR #236** (`fix/feedback-widget-viewport-shrink-race`, merge `e1b22bf1`, 2026-11-21) is a **test-only** change: it adds `isInsideViewport()` (a predicate) and `expectInsideViewportEventually()` (polls that predicate for up to its existing timeout, then calls the original assertion so a genuine, persistent violation still fails with its original per-edge message), and applies it to the one call site that lacked it — an idiom already used one test earlier in the same file. A negative control (temporarily disabling the widget's own clamping logic, then restoring it byte-for-byte) confirmed the new helper does fail on a genuine, persistent violation; this establishes the helper's correctness, not that the original CI failure was specifically a transient-frame race. Local validation: the repaired test (1/1), the full spec (24/24), neighboring component specs (17/17), `tsc --noEmit` clean, lint clean, production build succeeded. Both this PR's own CI run and the subsequent post-merge CI on `main` passed with this exact test included in the aggregate; CI's own all-green reporter does not print individual passing-test names, so this test's pass cannot be confirmed by name in those logs beyond the aggregate.

### D. Newly observed flake: `project-column-customization.spec.ts`

**Observed once; not diagnosed.** In the post-merge CI run for `main` commit `e1b22bf1` (2026-11-21), `test/e2e/project-column-customization.spec.ts:119` ("default state (fresh browser, no stored preference): all seven canonical Project desktop columns are present, matching today's table exactly") failed on its first attempt and passed on Playwright's automatic retry. This is a single observation in a single CI run, unrelated by file to PR #235, #236 or #237's own changes (none of those PRs touch this spec or the Projects column-customization feature). **No cause is claimed** — it is recorded here, and in §25 item 6, following this document's own existing convention for first-attempt-failure/retry-pass flakes, not classified as a Product defect.
