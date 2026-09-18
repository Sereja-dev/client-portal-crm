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
 * validation, locked spec §25). Registered in vercel.json, scheduled
 * daily at 35 5 * * *.
 *
 * Vercel Cron sends a GET with `Authorization: Bearer <CRON_SECRET>` —
 * CRON_SECRET is the entire auth boundary, same as every other
 * /api/cron/* route.
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
