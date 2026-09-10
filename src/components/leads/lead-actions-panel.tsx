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

/**
 * The edit page's own stage/lost/convert/archive surface — deliberately
 * separate from LeadForm (generic name/company/email/... edit), matching
 * the backend's own separation: none of these call updateLeadAction.
 * One shared useTransition covers every action here (a user is never
 * meaningfully triggering two of these at once on the same Lead), and
 * every success path calls router.refresh() so the Server Component
 * parent re-fetches the Lead's real current state — this panel never
 * keeps its own duplicate copy of stage/archivedAt/convertedClientId.
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
        router.push(`/clients/${result.clientId}/edit`);
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
