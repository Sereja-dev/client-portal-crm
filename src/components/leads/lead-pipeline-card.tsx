"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LeadStage } from "@/generated/prisma/enums";
import { moveLeadStageAction, markLeadLostAction } from "@/app/(dashboard)/leads/actions";
import type { PipelineLead } from "@/app/(dashboard)/leads/pipeline-query";
import { LEAD_STAGES, isLostLeadStage } from "@/lib/leads/stages";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarkLeadLostDialog, type MarkLeadLostDialogHandle } from "@/components/leads/mark-lead-lost-dialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { formatCurrency, formatStatusLabel } from "@/lib/format";
import { useToast } from "@/components/toast/toast-provider";

// Not imported from @/lib/rate-limit here — same reasoning as
// LeadActionsPanel's own identical constant: that barrel also re-exports
// src/lib/rate-limit/ip.ts, which uses next/headers, a server-only API
// that must never end up in a Client Component's own bundle.
const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

const MOVABLE_STAGES = LEAD_STAGES.filter((s) => !isLostLeadStage(s.value));

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * One Lead's card inside the Pipeline board (src/components/leads/
 * lead-pipeline-board.tsx). Deliberately reuses moveLeadStageAction /
 * markLeadLostAction / MarkLeadLostDialog directly — the exact same
 * calls LeadActionsPanel's own edit-page stage controls already make, no
 * parallel business logic. No drag-and-drop anywhere: stage movement is
 * always this explicit "Move to" <select>, matching the edit page's own
 * control for the same reason (never offering a value the backend would
 * reject as invalid_stage; LOST has its own dedicated Mark Lost flow).
 */
export function LeadPipelineCard({ lead }: { lead: PipelineLead }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const lostDialogRef = useRef<MarkLeadLostDialogHandle>(null);

  const isConverted = lead.convertedClientId !== null;
  const isLost = isLostLeadStage(lead.stage);

  function handleStageChange(next: string) {
    startTransition(async () => {
      const result = await moveLeadStageAction(lead.id, next as LeadStage);
      if (result.ok) {
        showToast("Stage updated");
        router.refresh();
        return;
      }
      if (result.reason === "converted_locked") {
        showToast("This lead has already converted — its stage is locked.", "error");
      } else if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast(GENERIC_ERROR, "error");
      }
      router.refresh();
    });
  }

  function handleMarkLost(lostReason: string) {
    startTransition(async () => {
      const result = await markLeadLostAction(lead.id, lostReason || undefined);
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

  return (
    <li className={`min-w-0 p-3 text-sm ${CARD_SURFACE_CLASSES}`}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Link
          href={`/leads/${lead.id}/edit`}
          className={`min-w-0 truncate font-medium text-text-primary hover:underline focus-visible:ring-focus-ring rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`}
          title={lead.name}
        >
          {lead.name}
        </Link>
        {isConverted && <StatusBadge status="WON" label="Converted" />}
      </div>

      {lead.company && <p className="mt-0.5 min-w-0 truncate text-text-secondary">{lead.company}</p>}

      <dl className="mt-2 space-y-1 text-xs text-text-muted">
        {lead.value && (
          <div className="flex justify-between gap-2">
            <dt>Value</dt>
            <dd className="text-text-secondary">{formatCurrency(Number(lead.value))}</dd>
          </div>
        )}
        {lead.source && (
          <div className="flex justify-between gap-2">
            <dt>Source</dt>
            <dd className="min-w-0 truncate text-text-secondary">{formatStatusLabel(lead.source)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>Assignee</dt>
          <dd className="min-w-0 truncate text-text-secondary">{lead.assignedTo?.name ?? "Unassigned"}</dd>
        </div>
      </dl>

      {isConverted ? (
        <p className="mt-3 text-xs text-text-muted">
          Converted to a{" "}
          {lead.convertedClientId ? (
            <Link href={`/clients/${lead.convertedClientId}/edit`} className={ACTION_LINK_CLASSES}>
              client
            </Link>
          ) : (
            "client"
          )}
          .
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            aria-label={`Move ${lead.name} to stage`}
            value={lead.stage}
            disabled={isPending}
            onChange={(event) => handleStageChange(event.target.value)}
            // flex-1/min-w-0 only — layout utilities, never a property
            // formControlClasses already sets itself (padding/text-size/
            // width), matching this app's own documented rule against
            // appending a same-property override class onto a shared
            // component (see button.tsx's own header comment for the real
            // production bug that rule exists to prevent).
            className="min-w-0 flex-1"
          >
            {isLost && <option value="LOST">Lost</option>}
            {MOVABLE_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          {!isLost && (
            <Button type="button" variant="dangerOutline" disabled={isPending} onClick={() => lostDialogRef.current?.open()}>
              Mark lost
            </Button>
          )}
        </div>
      )}

      <MarkLeadLostDialog ref={lostDialogRef} onConfirm={handleMarkLost} />
    </li>
  );
}
