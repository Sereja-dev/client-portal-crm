import "server-only";
import { prisma } from "@/lib/prisma";
import type { CreatedActivity } from "@/lib/notifications/notification-rules";
import { resolveWorkflowTrigger, isExecutableWorkflowTrigger } from "./triggers";
import { evaluateWorkflowAutomationConditions } from "./evaluate-conditions";
import { runWorkflowAutomation, recordWorkflowAutomationFailure } from "./execute-run";

/**
 * Workflow Automations Phase 2 — the single explicit dispatch entry
 * point. Every originating Staff mutation this phase wires (Lead status/
 * stage changes, Staff Client creation, Lead → Client conversion — see
 * each call site's own comment) calls this function exactly once, after
 * its own transaction has already committed, passing the very
 * CreateActivityResult that transaction produced.
 *
 * Deliberately NOT a global createActivity() hook (Phase 1's own
 * create-activity.ts remains completely untouched by this phase — see
 * its own header comment) and deliberately NOT gated by `actorId !==
 * null` (Portal and cron/system Activity rows write actorId: null too —
 * see triggers.ts's own header comment for the concrete counter-
 * examples). Safety instead comes from a purely structural fact: this
 * function is only ever called from the handful of Staff-only functions
 * enumerated in this phase's own commit — never from inside
 * execute-run.ts, never from any Portal/public/cron code path.
 *
 * Best-effort, non-throwing, top to bottom: every code path here
 * resolves, never rejects — matching deliverNotificationEmails's own
 * established contract exactly. A hiccup anywhere in automation
 * evaluation or execution must never make an already-successful Staff
 * mutation appear to fail back to its own caller.
 */
export async function dispatchWorkflowAutomations(activity: CreatedActivity): Promise<void> {
  try {
    // Phase 2 only executes the strict subset of Phase 1's trigger
    // allowlist that can actually produce a valid, non-empty automation
    // (see triggers.ts's own isExecutableWorkflowTrigger comment) —
    // INVOICE.STATUS_CHANGED/CLIENT_REQUEST.STATUS_CHANGED never reach
    // any further than this check, regardless of which call sites exist.
    if (!isExecutableWorkflowTrigger(activity.entityType, activity.action)) {
      return;
    }
    const trigger = resolveWorkflowTrigger(activity.entityType, activity.action);
    if (!trigger) {
      // Unreachable given the check above (every executable trigger is
      // by construction also a configurable one), but never assumed.
      return;
    }

    // Candidate lookup — always scoped by the triggering Activity's own
    // organizationId, never a cached or ambient value (Phase 2 execution
    // audit §11). Uses the exact composite index Phase 1 added for this.
    const automations = await prisma.workflowAutomation.findMany({
      where: {
        organizationId: activity.organizationId,
        triggerEntityType: activity.entityType,
        triggerAction: activity.action,
        isEnabled: true,
        archivedAt: null,
      },
    });
    if (automations.length === 0) return;

    for (const automation of automations) {
      try {
        const evaluation = evaluateWorkflowAutomationConditions(automation.conditions, activity.metadata, trigger);
        if (evaluation.status === "NOT_MATCHED") {
          // No action, no run row — a condition mismatch is not an event
          // worth recording (Phase 2 execution audit §6).
          continue;
        }
        if (evaluation.status === "INVALID_CONFIG") {
          // The stored conditions no longer validate against this
          // trigger's current vocabulary — a real, reportable failure,
          // distinct from a legitimate mismatch, but one that never
          // reached action execution at all.
          await recordWorkflowAutomationFailure(automation.id, activity.id, "invalid_condition_config", null);
          continue;
        }
        await runWorkflowAutomation(automation, activity, trigger);
      } catch {
        // One automation's unexpected failure must never prevent
        // evaluating the rest of the candidates — runWorkflowAutomation
        // is already designed to never throw; this is a final,
        // defensive backstop, not the primary safety mechanism.
      }
    }
  } catch {
    // Top-level non-throwing guarantee — see this function's own header
    // comment. Nothing above this point may ever propagate to the
    // caller's own already-successful Staff mutation.
  }
}
