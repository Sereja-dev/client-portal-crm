import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Platform Admin dedicated hostname (owner-approved convenience, never an
 * access-control mechanism — requirePlatformAdmin() independently
 * re-verifies identity and the PLATFORM_ADMIN_EMAILS allowlist regardless
 * of which hostname was used). Compared by exact equality only, never a
 * substring/suffix match, so a deceptive hostname such as
 * "admin.aqenra.com.attacker.example" can never satisfy this check.
 *
 * Deliberately reads the raw `Host` header, not `request.nextUrl.hostname`:
 * verified empirically (a disposable debug log, removed before commit)
 * that under this project's own `next start` — no reverse proxy in front —
 * `nextUrl.hostname` resolves to a fixed "localhost" regardless of the
 * actual incoming Host header, while `request.headers.get("host")` always
 * carries the real value. The hostname is parsed out with the native URL
 * parser (never manual string/regex splitting), which safely handles a
 * port suffix and an IPv6 literal the same way a browser would.
 */
const PLATFORM_ADMIN_HOSTNAME = "admin.aqenra.com";

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
  // host-isolation policy is introduced. The redirect target's path/query
  // is always this one hardcoded literal, never built from request input;
  // the host/port are the exact ones just matched against the literal
  // above (never a different, attacker-supplied value), and the protocol
  // prefers Vercel's own `x-forwarded-proto` (falling back to this same
  // request's own scheme) only to pick http vs. https on that same,
  // already-verified host — never to decide which host to send anyone to.
  //
  // An already-authenticated visitor is bounced straight through by the
  // existing /login page's own "already signed in" redirect (see
  // src/app/(auth)/login/page.tsx) — no session check is duplicated here.
  // An anonymous visitor sees the normal login form (served on this same
  // hostname) and returns to /platform-admin after signing in. Either way,
  // /platform-admin's own requirePlatformAdmin() guard still runs,
  // completely unchanged, and still denies a non-admin identity.
  if (host && host.hostname.toLowerCase() === PLATFORM_ADMIN_HOSTNAME && request.nextUrl.pathname === "/") {
    const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "") ?? "https";
    const authority = host.port ? `${host.hostname}:${host.port}` : host.hostname;
    return NextResponse.redirect(`${protocol}://${authority}/login?redirectTo=%2Fplatform-admin`);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
