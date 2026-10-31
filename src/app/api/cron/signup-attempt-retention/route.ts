import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron/auth";
import { checkRateLimit, CRON_JOB_LIMIT } from "@/lib/rate-limit";
import { cleanupSignupAttempts } from "@/lib/signup-attempts/retention";

// Never statically cached/optimized — this must actually run, every time
// Vercel Cron (or a manual authorized call) hits it.
export const dynamic = "force-dynamic";

// A bounded batch per pass, a bounded number of passes per run (see
// cleanupSignupAttempts) — a large backlog clears gradually over several
// daily runs rather than in one long-running delete.
const BATCH_SIZE = 500;

/**
 * Daily retention for unactivated SignupAttempt rows (90 days from the
 * latest recorded attempt — see src/lib/signup-attempts/retention.ts).
 * Same trust boundary as every other cron route: CRON_SECRET via the shared
 * helper is the entire auth boundary; no session, Membership or portal
 * cookie is ever read. Returns aggregate counts only.
 */
export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const limitCheck = checkRateLimit(CRON_JOB_LIMIT, "signup-attempt-retention");
  if (limitCheck.limited) {
    return NextResponse.json({ error: limitCheck.message }, { status: 429 });
  }

  try {
    const summary = await cleanupSignupAttempts({ now: new Date(), batchSize: BATCH_SIZE });
    return NextResponse.json(summary);
  } catch {
    // Fixed line, no error text: nothing identifying can reach the logs. A
    // failed run is safe to retry; the next scheduled run picks up the rest.
    console.error("[signup-attempts] retention cleanup failed.");
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }
}
