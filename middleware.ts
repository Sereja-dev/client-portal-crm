import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { TEST_MODE } from "@/lib/test-mode";

/**
 * Platform Admin dedicated hostname (owner-approved convenience, never an
 * access-control mechanism — requirePlatformAdmin() independently
 * re-verifies identity and the PLATFORM_ADMIN_EMAILS allowlist regardless
 * of which hostname was used). Compared by exact equality only, never a
 * substring/suffix match, so a deceptive hostname such as
 * "admin.aqenra.com.attacker.example" can never satisfy this check.
 *
 * Deliberately reads the raw `Host` header, not `request.nextUrl.hostname`:
 * verified empirically (a disposable debug log, removed before the first
 * commit) that under this project's own `next start` — no reverse proxy in
 * front — `nextUrl.hostname` resolves to a fixed "localhost" regardless of
 * the actual incoming Host header, while `request.headers.get("host")`
 * always carries the real value. This matches Next.js's own documented
 * behavior for exactly this situation (node_modules/next/dist/docs/01-app/
 * 03-api-reference/05-config/01-next-config-js/serverActions.md, under
 * `allowedOrigins`): "the browser sends [the public host] while the server
 * reports something like `localhost:3000`" — and is also the same trust
 * boundary (`host`/`x-forwarded-host`) Next.js's own CSRF check in that
 * same file already relies on. The hostname is parsed out with the native
 * URL parser (never manual string/regex splitting) — empirically verified
 * (a disposable Node script, not committed) against a battery of
 * adversarial raw Host values: embedded userinfo (`evil.com@admin.aqenra
 * .com` / `admin.aqenra.com@evil.com`), a fragment, a backslash, an
 * embedded path, a malformed or well-formed IPv6 literal, a trailing dot,
 * mixed case and surrounding whitespace. Every one either fails to match
 * this literal, or matches only because the genuinely-parsed host
 * component (exactly how a real browser would interpret the same
 * authority string) really is this literal.
 *
 * SECURITY NOTE on what is NOT trusted: Vercel's own request-headers
 * documentation (https://vercel.com/docs/headers/request-headers, fetched
 * 2026-11-11) describes what `x-forwarded-proto` and `x-forwarded-host`
 * MEAN ("typically `https` in production and `http` in development" /
 * "identical to the `host` header") but, unlike `x-forwarded-for` (which
 * it explicitly says Vercel overwrites "to prevent IP spoofing"), it makes
 * no equivalent guarantee that `x-forwarded-proto` cannot be set or
 * overwritten by the client before reaching this deployment. Whether it is
 * reliably authoritative in this app's actual Vercel setup therefore
 * CANNOT be established from available documentation alone, and is exactly
 * why this code no longer reads it at all for a security-relevant choice:
 * the Production redirect target below is a single fixed literal, with no
 * header-sourced scheme or authority whatsoever, so there is nothing for a
 * forged header to influence.
 *
 * ON TEST_MODE, STATED CAREFULLY (an earlier version of this comment
 * overclaimed "real deployments can never take" the local branch —
 * corrected after review). scripts/security-checks/check-no-test-mode.mjs
 * verifies, statically, that no file COMMITTED to this repository
 * (.env.example, vercel.json, package.json) ever sets `TEST_MODE=1`, and
 * that every importer of the shared TEST_MODE gate under `src/` is on an
 * exhaustive, reviewed allowlist. It has no visibility at all into Vercel
 * Production's actual configured environment variables — those live
 * outside this repository — so "no committed config sets TEST_MODE" is
 * not the same claim as "TEST_MODE is unset in Production." If it ever
 * were set there at runtime, `TEST_MODE` (read fresh from
 * `process.env.TEST_MODE` on every cold start, since it is not a
 * `NEXT_PUBLIC_` variable and is therefore never inlined at build time)
 * would genuinely be `true` there too, and this code, taken alone, would
 * choose the http branch — the same honest limitation every one of this
 * project's other ~23 TEST_MODE consumers already has, not a new one.
 *
 * `!process.env.VERCEL` below is an additional, independent signal, not a
 * claim that the risk above is now impossible: `VERCEL` is a Vercel-
 * documented system environment variable Vercel's own infrastructure sets
 * on every deployment (Production and Preview alike), never set by this
 * project's own committed config or by playwright.config.ts's webServer
 * env (confirmed directly — that block sets VERCEL_URL/VERCEL_ENV/
 * VERCEL_GIT_* for an unrelated Configuration-page test, but never the
 * bare `VERCEL` key). So even in the scenario above — TEST_MODE somehow
 * set in Vercel Production — this specific redirect would still choose
 * the fixed https literal, because VERCEL would also genuinely be set
 * there. This narrows, but does not by itself prove closed, the one
 * residual gap neither this check nor that one can rule out from code
 * alone: whether Vercel's own system VERCEL value could ever be shadowed
 * by a project environment variable deliberately given the same name —
 * not independently verifiable without inspecting the actual Production
 * configuration, which is outside this task's boundaries.
 */
const PLATFORM_ADMIN_HOSTNAME = "admin.aqenra.com";

/** The one real-world destination this rule ever redirects to — a fixed literal, never built from any request header. */
const PRODUCTION_ADMIN_LOGIN_REDIRECT = `https://${PLATFORM_ADMIN_HOSTNAME}/login?redirectTo=%2Fplatform-admin`;

/** Null on a missing or unparseable Host header — never throws. */
function parseHostHeader(rawHost: string | null): { hostname: string; port: string } | null {
  if (!rawHost) return null;
  try {
    const parsed = new URL(`http://${rawHost}/`);
    return { hostname: parsed.hostname, port: parsed.port };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const host = parseHostHeader(request.headers.get("host"));

  // Root-only, this one hostname only: every other path on this hostname,
  // and every path (including "/") on every other hostname, falls straight
  // through to the exact same behavior as before this change — no broader
  // host-isolation policy is introduced.
  //
  // An already-authenticated visitor is bounced straight through by the
  // existing /login page's own "already signed in" redirect (see
  // src/app/(auth)/login/page.tsx) — no session check is duplicated here.
  // An anonymous visitor sees the normal login form (served on this same
  // hostname) and returns to /platform-admin after signing in. Either way,
  // /platform-admin's own requirePlatformAdmin() guard still runs,
  // completely unchanged, and still denies a non-admin identity.
  if (host && host.hostname.toLowerCase() === PLATFORM_ADMIN_HOSTNAME && request.nextUrl.pathname === "/") {
    if (TEST_MODE && !process.env.VERCEL) {
      // Local/E2E only (see the header comment above, including exactly
      // what this second condition does and does not guarantee) — this
      // http-only branch models the local Playwright webServer, never a
      // real Vercel deployment. The authority here is exactly the
      // host/port already matched above (never a different, attacker-
      // supplied value) — only needed so the local test, which has no
      // real DNS for this hostname, stays on the same already-resolved
      // host:port pair it was reached on.
      const authority = host.port ? `${host.hostname}:${host.port}` : host.hostname;
      return NextResponse.redirect(`http://${authority}/login?redirectTo=%2Fplatform-admin`);
    }
    return NextResponse.redirect(PRODUCTION_ADMIN_LOGIN_REDIRECT);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
