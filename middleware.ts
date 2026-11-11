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
 * forged header to influence. The one exception is the TEST_MODE branch,
 * which real deployments can never take — enforced by scripts/security-
 * checks/check-no-test-mode.mjs, which fails CI if `TEST_MODE` ever
 * appears in committed config — so this is the project's own existing,
 * audited escape hatch for exactly this class of "local/E2E needs
 * something Production never does," not a new one invented here.
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
    if (TEST_MODE) {
      // Local/E2E only (see the header comment above) — the real Vercel
      // deployment has no TLS-terminating reverse proxy of its own in
      // front for this app to be behind, so this http-only branch models
      // the local Playwright webServer only, never Production. The
      // authority here is exactly the host/port already matched above
      // (never a different, attacker-supplied value) — only needed so the
      // local test, which has no real DNS for this hostname, stays on the
      // same already-resolved host:port pair it was reached on.
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
