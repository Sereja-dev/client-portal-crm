"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { formControlClasses } from "@/components/ui/form-control-classes";
import { useToast } from "@/components/toast/toast-provider";
import { suspendOrganizationAction, reactivateOrganizationAction } from "@/app/(platform-admin)/platform-admin/organizations/[id]/actions";
import { SUSPENSION_REASON_CODES, type SuspensionReasonCode } from "@/lib/platform-admin/organization-suspension-reasons";
import { buildSuspendConfirmationPhrase, canConfirmSuspend, showsPhraseMismatch } from "@/lib/platform-admin/organization-suspension-confirmation";

/**
 * Platform Admin Organization Suspension, PR 2 (+ the
 * ORGANIZATION_IDENTITY_CONFIRMATION_DESIGN correction). The one status
 * indicator + control pair on Organization Detail — deliberately never
 * reuses StatusBadge/STATUS_TONES' own "SUSPENDED" key (that belongs to
 * OrganizationLifecycleStatus, a distinct billing-derived concept — see
 * this feature's own design investigation) and never renders the
 * organization's own id, the acting admin's email, or any audit data —
 * this is an operator control surface, but its own visible text stays as
 * bounded as the tenant-facing /organization-unavailable page's does.
 *
 * Suspend confirmation is keyed to the organization's own slug, never
 * its name: Organization.name is a customer-facing display/brand name
 * (used verbatim in invoice PDFs and notification-email copy) — long,
 * arbitrarily punctuated, and proven across this feature's own two
 * prior hotfixes never reliably retypeable. slug is DB-unique, immutable
 * after creation, and lowercase-ASCII-only (see organization-suspension-
 * confirmation.ts's own header comment) — structurally immune to the
 * browser/OS text-substitution bugs that affected the name-based
 * contract.
 *
 * organization-selection hardening: `organizationName` is reintroduced
 * here, but strictly as a **display-only** prop — an identity summary
 * inside each dialog so an operator whose focus is now trapped in the
 * modal still has an accessible cross-check for which organization they
 * selected (duplicate/generic "<name>'s Workspace" names made this a
 * real risk once the modal's own backdrop visually obscures the page
 * behind it). It is never passed to organization-suspension-
 * confirmation.ts, never compared against anything, and never part of
 * the typed-confirmation contract — that remains exclusively
 * `SUSPEND <slug>`, unchanged.
 */

const REASON_LABELS: Record<SuspensionReasonCode, string> = {
  BILLING_DISPUTE: "Billing dispute",
  POLICY_VIOLATION: "Policy violation",
  SECURITY_RISK: "Security risk",
  CUSTOMER_REQUEST: "Customer request",
  OTHER: "Other",
};

function formatSuspendedSince(suspendedAt: string): string {
  return new Date(suspendedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function OrganizationSuspensionControls({
  organizationId,
  organizationName,
  organizationSlug,
  suspendedAt,
}: {
  organizationId: string;
  /** Display-only — never part of the typed-confirmation contract (see this file's own header comment). */
  organizationName: string;
  organizationSlug: string;
  /** ISO string, or null when active — a plain Date can't cross the Server->Client boundary as a prop. */
  suspendedAt: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-text-muted text-xs font-medium tracking-wide uppercase">Operator status</p>
        <p className="text-text-primary mt-1 text-sm font-medium">
          {suspendedAt ? `Suspended since ${formatSuspendedSince(suspendedAt)}` : "Active"}
        </p>
      </div>
      {suspendedAt ? (
        <ReactivateControl organizationId={organizationId} organizationName={organizationName} organizationSlug={organizationSlug} />
      ) : (
        <SuspendControl organizationId={organizationId} organizationName={organizationName} organizationSlug={organizationSlug} />
      )}
    </div>
  );
}

/** The organization identity summary shared by both dialogs — display-only, never part of the confirmation comparison. */
function OrganizationIdentitySummary({ organizationName, organizationSlug }: { organizationName: string; organizationSlug: string }) {
  return (
    <>
      <span className="text-text-primary wrap-anywhere font-medium">{organizationName}</span> (
      <span className="wrap-anywhere font-mono">{organizationSlug}</span>)
    </>
  );
}

function SuspendControl({
  organizationId,
  organizationName,
  organizationSlug,
}: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState("");
  const [reasonCode, setReasonCode] = useState<SuspensionReasonCode | "">("");
  const titleId = useId();
  const descriptionId = useId();
  const identitySummaryId = useId();
  const confirmInputId = useId();
  const mismatchId = useId();
  const reasonSelectId = useId();

  const confirmationPhrase = buildSuspendConfirmationPhrase(organizationSlug);
  const canConfirm = canConfirmSuspend(confirmText, organizationSlug, reasonCode);
  const phraseMismatches = showsPhraseMismatch(confirmText, organizationSlug);

  function closeAndReset() {
    dialogRef.current?.close();
    setConfirmText("");
    setReasonCode("");
  }

  function runSuspend() {
    if (!canConfirm) return;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof suspendOrganizationAction>>;
      try {
        result = await suspendOrganizationAction(organizationId, reasonCode);
      } catch {
        showToast("Something went wrong. Please try again.", "error");
        return;
      }
      if (result.ok) {
        closeAndReset();
        showToast("Organization suspended");
        router.refresh();
        return;
      }
      showToast(result.message, "error");
    });
  }

  return (
    <>
      <Button type="button" variant="dangerOutline" disabled={pending} onClick={() => dialogRef.current?.showModal()}>
        Suspend
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${identitySummaryId}`}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeAndReset();
        }}
        onClose={() => {
          setConfirmText("");
          setReasonCode("");
        }}
        className="border-border-default bg-surface w-full max-w-sm rounded-lg border p-6 shadow-xl backdrop:bg-black/40"
      >
        <h2 id={titleId} className="text-text-primary text-base font-semibold">
          Suspend organization
        </h2>
        <p id={descriptionId} className="text-text-secondary mt-2 text-sm">
          Suspending blocks staff and client access immediately. No data is deleted, and you can reactivate at any time.
        </p>
        {/*
          organization-selection hardening: a compact, non-interactive
          identity cross-check — display-only, never fed into the
          confirmation comparison below. Its id is added to the dialog's
          own aria-describedby (above) so it's announced automatically
          when the dialog opens, without an extra tab stop or a second
          reference block.
        */}
        <p id={identitySummaryId} className="text-text-secondary mt-2 text-sm">
          You are about to suspend <OrganizationIdentitySummary organizationName={organizationName} organizationSlug={organizationSlug} />.
        </p>

        <label htmlFor={reasonSelectId} className="text-text-secondary mt-4 block text-sm font-medium">
          Reason
        </label>
        <select
          id={reasonSelectId}
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value as SuspensionReasonCode | "")}
          className={formControlClasses(false)}
        >
          <option value="" disabled>
            Select a reason
          </option>
          {SUSPENSION_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {REASON_LABELS[code]}
            </option>
          ))}
        </select>

        {/*
          ORGANIZATION_IDENTITY_CONFIRMATION_DESIGN correction: the
          expected value is now short and slug-derived, so it's stated
          directly inline in this one label — no separate reference
          block (removed along with the fragile "type the exact
          organization name" contract it existed to support).
          wrap-anywhere on both the label and the inline <code> keeps
          this safe at narrow widths even for a longer slug, matching
          this codebase's own established wrap-protection convention.
        */}
        <label htmlFor={confirmInputId} className="text-text-secondary mt-4 block wrap-anywhere text-sm font-medium">
          Type <code className="bg-surface-muted text-text-primary wrap-anywhere rounded px-1 py-0.5 font-mono">{confirmationPhrase}</code> to confirm.
        </label>
        <input
          id={confirmInputId}
          type="text"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={phraseMismatches ? mismatchId : undefined}
          aria-invalid={phraseMismatches ? true : undefined}
          className={formControlClasses(phraseMismatches)}
        />
        {phraseMismatches ? (
          <p id={mismatchId} className="text-danger mt-1 text-sm">
            Doesn&apos;t match.
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={closeAndReset} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="dangerOutline" loading={pending} disabled={!canConfirm || pending} onClick={runSuspend}>
            Suspend
          </Button>
        </div>
      </dialog>
    </>
  );
}

function ReactivateControl({
  organizationId,
  organizationName,
  organizationSlug,
}: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const [pending, startTransition] = useTransition();

  function runReactivate() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof reactivateOrganizationAction>>;
      try {
        result = await reactivateOrganizationAction(organizationId);
      } catch {
        showToast("Something went wrong. Please try again.", "error");
        return;
      }
      if (result.ok) {
        showToast("Organization reactivated");
        router.refresh();
        return;
      }
      showToast(result.message, "error");
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => dialogRef.current?.open()}>
        Reactivate
      </Button>
      <ConfirmDialog
        ref={dialogRef}
        title="Reactivate organization"
        description={
          <>
            Staff and client access to <OrganizationIdentitySummary organizationName={organizationName} organizationSlug={organizationSlug} /> will
            be restored immediately.
          </>
        }
        confirmLabel="Reactivate"
        onConfirm={runReactivate}
      />
    </>
  );
}
