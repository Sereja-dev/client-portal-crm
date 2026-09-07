import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Gate for every /api/cron/* Route Handler — reads process.env.CRON_SECRET
 * (a server-only secret, never NEXT_PUBLIC_) and requires it verbatim as
 * `Authorization: Bearer <secret>`. Never reads a query string or any other
 * header, and never logs the secret or the caller's header value.
 *
 * Deliberately fails closed: if CRON_SECRET itself is unset (a deployment
 * that forgot to configure it), every call is rejected — there is no
 * "open" fallback state. The same generic 401 covers every failure reason
 * (missing header, malformed, wrong secret, unset env) so a caller can
 * never distinguish "you got the secret wrong" from "this deployment isn't
 * configured for cron at all."
 *
 * The comparison itself is timing-safe (node:crypto's timingSafeEqual),
 * mirroring the exact same timingSafeEqualStrings pattern this app's own
 * Paddle webhook signature check already uses
 * (src/lib/billing/provider/paddle-provider.ts) — a plain `!==` string
 * comparison short-circuits on the first mismatched byte, which in
 * principle lets a sufficiently-patient network attacker infer a secret
 * one character at a time from response-time differences. Different-length
 * inputs are rejected before ever reaching timingSafeEqual (which throws on
 * a length mismatch, rather than returning false) — the observable "the
 * length differs" leak this accepts is the same tradeoff every other
 * timing-safe comparison in this app already makes.
 *
 * No TEST_MODE bypass exists here on purpose — unlike the identity/Storage
 * test-mode swaps elsewhere in this app, weakening auth itself would be a
 * second, weaker code path. Tests instead set a real (test-only) CRON_SECRET
 * value in their own environment and authenticate through this exact same
 * check, the same way E2E already sets a placeholder INVITATION_FROM_EMAIL
 * rather than bypassing email delivery's own logic.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");

  if (!secret || !header || !timingSafeEqualStrings(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
