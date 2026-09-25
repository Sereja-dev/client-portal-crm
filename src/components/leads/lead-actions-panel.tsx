"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LeadStage, CustomStatusColor } from "@/generated/prisma/enums";
import {
  assignLeadStatusDefinitionAction,
  markLeadLostAction,
  archiveLeadAction,
  unarchiveLeadAction,
  convertLeadToClientAction,
} from "@/app/(dashboard)/leads/actions";
import { isLostLeadStage } from "@/lib/leads/stages";
import type { StatusSelectOption } from "@/lib/custom-statuses/entity-form";
import { buildLeadStatusSelectOptions } from "@/components/leads/lead-status-options";
import { LeadStageBadge } from "@/components/leads/lead-stage-badge";
import { MarkLeadLostDialog, type MarkLeadLostDialogHandle } from "@/components/leads/mark-lead-lost-dialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { useToast } from "@/components/toast/toast-provider";

// Not imported from @/lib/rate-limit here: that barrel also re-exports
// src/lib/rate-limit/ip.ts, which uses next/headers — a server-only API
// that must never end up in a Client Component's own bundle. The literal
// string is intentionally identical to RATE_LIMIT_MESSAGE
// (src/lib/rate-limit/index.ts) — the actual rate-limit *decision* is
// always made server-side inside the real action; this is purely a
// display string for its already-generic result.
const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Leads Pipeline V1 (Section 17) — matches this file's own established
// PRIMARY/secondary Button token pair (Button itself has no polymorphic
// asChild support, so a real navigating action is always a styled
// <Link> — same precedent leads/page.tsx's own PRIMARY_LINK_CLASSES
// documents).
const SUCCESS_PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const SUCCESS_SECONDARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring border-border-strong bg-surface text-text-primary rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * The edit page's own stage/lost/convert/archive surface — deliberately
 * separate from LeadForm (generic name/company/email/... edit), matching
 * the backend's own separation: none of these call updateLeadAction.
 * One shared useTransition covers every action here (a user is never
 * meaningfully triggering two of these at once on the same Lead), and
 * every success path calls router.refresh() so the Server Component
 * parent re-fetches the Lead's real current state — this panel never
 * keeps its own duplicate copy of stage/archivedAt/convertedClientId.
 *
 * Leads Pipeline V1 (Section 16/17/18) — convertLeadToClientAction
 * itself is completely unchanged (still the one canonical conversion
 * action, still enforcing duplicate-email confirmation, entitlement,
 * transaction atomicity, quote reconciliation, Activity, workflows, and
 * race safety exactly as before). Only the POST-success UX changes here:
 * instead of an immediate router.push to the new Client, a successful
 * conversion now sets local `justConverted` state and this panel renders
 * a small bounded success block (Client created + View client/Create
 * project/Create quote/Create invoice) in its place — never during the
 * duplicate-confirmation step (that dialog still runs to completion
 * first; `justConverted` is only ever set from the real `result.ok`
 * branch, after conversion has actually succeeded and a real clientId
 * exists).
 */
export function LeadActionsPanel({
  leadId,
  stage,
  statusDefinition,
  statusOptions,
  currentStatusDefinitionId,
  archivedAt,
  convertedClientId,
}: {
  leadId: string;
  stage: LeadStage;
  statusDefinition?: { label: string; color: CustomStatusColor | null } | null;
  /** Custom Statuses Phase 2B (Section M) — every active LEAD definition, plus this Lead's own current one if archived; see leads/[id]/edit/page.tsx's own comment. */
  statusOptions: StatusSelectOption[];
  currentStatusDefinitionId?: string;
  archivedAt: string | null;
  convertedClientId: string | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [duplicateMessage, setDuplicateMessage] = useState("");
  // Leads Pipeline V1 (Section 17) — set only from a real, successful
  // convertLeadToClientAction result within this same page session;
  // never persisted, never derived from props (a fresh page load always
  // starts with this null, falling back to the existing "Converted to a
  // client" static state below, driven by the real convertedClientId
  // prop).
  const [justConverted, setJustConverted] = useState<{ clientId: string } | null>(null);

  const lostDialogRef = useRef<MarkLeadLostDialogHandle>(null);
  const archiveDialogRef = useRef<ConfirmDialogHandle>(null);
  const duplicateDialogRef = useRef<ConfirmDialogHandle>(null);

  const isConverted = convertedClientId !== null;
  const isLost = isLostLeadStage(stage);
  const isArchived = archivedAt !== null;

  // Section M (CRITICAL) — system LOST is never offered as a NEW target
  // here; only reachable via the dedicated Mark Lost dialog below.
  const selectableStatusOptions = buildLeadStatusSelectOptions(statusOptions, currentStatusDefinitionId ?? null);

  function handleStatusChange(definitionId: string) {
    startTransition(async () => {
      const result = await assignLeadStatusDefinitionAction(leadId, definitionId);
      if (result.ok) {
        showToast("Status updated");
        router.refresh();
        return;
      }
      switch (result.reason) {
        case "converted_locked":
          showToast("This lead has already converted — its stage is locked.", "error");
          break;
        case "rate_limited":
          showToast(RATE_LIMIT_MESSAGE, "error");
          break;
        case "use_mark_lost_action":
          showToast('Use "Mark lost" to mark this lead as lost.', "error");
          break;
        case "status_archived":
          showToast("This status is archived and can't be assigned.", "error");
          break;
        default:
          showToast(GENERIC_ERROR, "error");
      }
      router.refresh();
    });
  }

  function handleMarkLost(lostReason: string) {
    startTransition(async () => {
      const result = await markLeadLostAction(leadId, lostReason || undefined);
      if (result.ok) {
        showToast("Lead marked lost");
        router.refresh();
        return;
      }
      if (result.reason === "converted_locked") {
        showToast("This lead has already converted and can't be marked lost.", "error");
        router.refresh();
      } else if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast("Couldn't mark this lead lost. Check the reason and try again.", "error");
      }
    });
  }

  function handleArchiveToggle(archive: boolean) {
    startTransition(async () => {
      const result = archive ? await archiveLeadAction(leadId) : await unarchiveLeadAction(leadId);
      if (result.ok) {
        showToast(archive ? "Lead archived" : "Lead unarchived");
        router.refresh();
        return;
      }
      if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast(GENERIC_ERROR, "error");
      }
    });
  }

  function runConversion(confirmDuplicate: boolean) {
    startTransition(async () => {
      const result = await convertLeadToClientAction(leadId, { confirmDuplicate });
      if (result.ok) {
        showToast("Lead converted to client");
        // Leads Pipeline V1 (Section 17) — no more immediate navigation:
        // this panel now shows its own bounded success state (below)
        // instead. router.refresh() still runs so the rest of this same
        // page (the Stage badge, the now-locked stage control) reflects
        // the real post-conversion Lead state alongside it.
        setJustConverted({ clientId: result.clientId });
        router.refresh();
        return;
      }
      switch (result.reason) {
        case "requires_duplicate_confirmation":
          setDuplicateMessage(result.message);
          duplicateDialogRef.current?.open();
          return;
        case "entitlement_blocked":
          showToast(result.message, "error");
          return;
        case "already_converted":
          showToast("This lead has already been converted.", "error");
          router.refresh();
          return;
        case "rate_limited":
          showToast(RATE_LIMIT_MESSAGE, "error");
          return;
        // not_found / lost — the Lead's own state changed (in another
        // tab, or concurrently) since this page loaded.
        default:
          showToast("This lead can no longer be converted.", "error");
          router.refresh();
      }
    });
  }

  // Leads Pipeline V1 (Section 17/18) — the bounded post-conversion
  // success state. Deliberately its own early return, not woven into
  // the normal `isConverted` branch below: this is a one-time "you just
  // did this" panel (local state, never derived from props), not the
  // persistent "this Lead has been converted" state a returning visitor
  // sees on a fresh page load — those stay two genuinely different UI
  // moments, per this panel's own header comment.
  if (justConverted) {
    return (
      <div className="border-border-default space-y-4 border-t pt-4">
        <div>
          <p className="text-text-primary text-sm font-semibold">Client created</p>
          <p className="text-text-secondary mt-1 text-sm">Choose what to do next.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/clients/${justConverted.clientId}/edit`} className={SUCCESS_PRIMARY_LINK_CLASSES}>
            View client
          </Link>
          <Link href={`/projects/new?clientId=${justConverted.clientId}`} className={SUCCESS_SECONDARY_LINK_CLASSES}>
            Create project
          </Link>
          <Link href={`/quotes/new?clientId=${justConverted.clientId}`} className={SUCCESS_SECONDARY_LINK_CLASSES}>
            Create quote
          </Link>
          <Link href={`/invoices/new?clientId=${justConverted.clientId}`} className={SUCCESS_SECONDARY_LINK_CLASSES}>
            Create invoice
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border-default space-y-4 border-t pt-4">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary text-sm font-medium">Stage</span>
        <LeadStageBadge stage={stage} definition={statusDefinition} />
      </div>

      {isConverted ? (
        <p className="text-text-muted text-sm">
          This lead has been converted — its stage is locked to Won and can no longer be changed.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-48">
            <Select
              aria-label="Change status"
              value={currentStatusDefinitionId ?? ""}
              disabled={isPending}
              onChange={(event) => handleStatusChange(event.target.value)}
            >
              {selectableStatusOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.archived ? " (archived)" : ""}
                </option>
              ))}
            </Select>
          </div>
          {!isLost && (
            <Button
              type="button"
              variant="dangerOutline"
              disabled={isPending}
              onClick={() => lostDialogRef.current?.open()}
            >
              Mark lost
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        {!isConverted && !isArchived && !isLost && (
          <Button type="button" disabled={isPending} onClick={() => runConversion(false)}>
            Convert to client
          </Button>
        )}
        {isArchived ? (
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => handleArchiveToggle(false)}
          >
            Unarchive
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => archiveDialogRef.current?.open()}
          >
            Archive
          </Button>
        )}
      </div>

      {isConverted && convertedClientId && (
        <p className="text-text-secondary text-sm">
          Converted to a{" "}
          <Link href={`/clients/${convertedClientId}/edit`} className={ACTION_LINK_CLASSES}>
            client
          </Link>
          .
        </p>
      )}

      <MarkLeadLostDialog ref={lostDialogRef} onConfirm={handleMarkLost} />

      <ConfirmDialog
        ref={archiveDialogRef}
        title="Archive lead"
        description="Archived leads are hidden from the default list. You can unarchive it later."
        confirmLabel="Archive"
        onConfirm={() => handleArchiveToggle(true)}
      />

      <ConfirmDialog
        ref={duplicateDialogRef}
        title="Client already exists"
        description={duplicateMessage}
        confirmLabel="Create anyway"
        onConfirm={() => runConversion(true)}
      />
    </div>
  );
}
