import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron/auth";
import { checkRateLimit, CRON_JOB_LIMIT } from "@/lib/rate-limit";
import { retryIntegrationDeliveries } from "@/lib/integrations/jobs/retry-integration-deliveries";

// Never statically cached/optimized — this must actually run, every time
// Vercel Cron (or a manual authorized call) hits it.
export const dynamic = "force-dynamic";

// Bounded per run, same shape/reasoning as notification-delivery's own
// BATCH_LIMIT — a fixed batch size keeps this job's run time predictable
// regardless of backlog size.
const BATCH_LIMIT = 200;

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §25). Vercel Cron sends a GET with
 * `Authorization: Bearer <CRON_SECRET>` — CRON_SECRET is the entire auth
 * boundary, same as every other /api/cron/* route.
 *
 * Deliberately NOT added to vercel.json's own `crons` list in this
 * commit — this repo's own established convention (see
 * src/app/api/cron/invoice-pdf-reconciliation/route.ts, added in a
 * separate, later commit than the route itself: `git log -- vercel.json`
 * shows "chore: activate invoice PDF reconciliation cron" as its own
 * distinct commit) ships a cron route first and registers its schedule
 * only as a deliberate, separate follow-up once it's been manually
 * verified — never auto-registered merely because the route exists.
 * Until that follow-up, this route is reachable only via a manual,
 * authorized (CRON_SECRET-bearing) call — the exact same "ship first,
 * activate later" state that route's own history already establishes as
 * normal for this codebase, not a gap introduced here.
 */
export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  // Defense in depth only — CRON_SECRET is the real barrier. Bucketed by
  // this route's own fixed name, not by caller.
  const limitCheck = checkRateLimit(CRON_JOB_LIMIT, "integration-delivery");
  if (limitCheck.limited) {
    return NextResponse.json({ error: limitCheck.message }, { status: 429 });
  }

  const summary = await retryIntegrationDeliveries({ now: new Date(), limit: BATCH_LIMIT });
  return NextResponse.json(summary);
}
