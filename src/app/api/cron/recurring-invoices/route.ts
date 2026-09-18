import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron/auth";
import { checkRateLimit, CRON_JOB_LIMIT } from "@/lib/rate-limit";
import { processDueRecurringInvoices, BATCH_SIZE } from "@/lib/recurring-invoices/jobs/process-due-recurring-invoices";

// Never statically cached/optimized — this must actually run, every time
// an authorized caller hits it.
export const dynamic = "force-dynamic";

// Same 60s ceiling both existing cron routes already use — see
// process-due-recurring-invoices.ts's own BATCH_SIZE comment for the
// worst-case timing analysis this bound and that batch size were chosen
// together against.
export const maxDuration = 60;

/**
 * Recurring Invoices Phase 2B-1 — the due-batch cron route.
 *
 * Registered in vercel.json, scheduled daily at 0 6 * * *.
 *
 * Vercel Cron, or a manual authorized call, sends a GET with
 * `Authorization: Bearer <CRON_SECRET>`. No session, Membership, or
 * portal cookie is ever read here — CRON_SECRET remains the complete auth
 * boundary, checked once via the shared helper before anything else runs.
 * `now` is resolved exactly once here and threaded through the entire
 * batch (every due-date comparison and every generateRecurringInvoiceOccurrence
 * call shares this same value) — never re-read mid-request.
 */
export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  // Defense in depth only — CRON_SECRET is the real barrier. Bucketed by
  // this route's own fixed identifier, isolated from every other cron
  // job's own bucket.
  const limitCheck = checkRateLimit(CRON_JOB_LIMIT, "recurring-invoices");
  if (limitCheck.limited) {
    return NextResponse.json({ error: limitCheck.message }, { status: 429 });
  }

  const now = new Date();
  const summary = await processDueRecurringInvoices(now, BATCH_SIZE);
  return NextResponse.json(summary);
}
