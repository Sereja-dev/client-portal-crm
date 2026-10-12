"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useUnsavedChangesScope } from "./unsaved-changes-scope";

/**
 * Forms Improvement Slice C1a — a drop-in replacement for the plain
 * `next/link` `<Link>` every target form's own Cancel/Back control
 * already is (`/invoices`, `/recurring-invoices`, `/quotes` — see each
 * page's own existing JSX, unchanged here in label/styling/destination/
 * placement). Reads `isDirty` from the nearest `UnsavedChangesScope`
 * ancestor; when pristine (or when rendered with no Scope at all) it
 * behaves exactly like the `Link` it replaced — no dialog, no click
 * delay, immediate navigation.
 *
 * When dirty, the click is prevented and the existing shared
 * `ConfirmDialog` (src/components/ui/confirm-dialog.tsx, already
 * proven elsewhere — e.g. QuoteSentPanel's own "Edit sent quote" gate)
 * opens instead. Confirming "Leave" clears this Scope's own dirty flag
 * (so any active `beforeunload` listener is torn down for this specific,
 * explicitly-confirmed navigation — never a global suppression) and
 * then performs the exact same navigation the original Link would have,
 * via `router.push`, exactly once. Choosing "Stay" simply closes the
 * dialog — the destination is never entered, and every typed value is
 * still exactly where the user left it (nothing here touches form
 * state).
 */
export function UnsavedChangesCancelLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const scope = useUnsavedChangesScope();
  const router = useRouter();
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const isDirty = scope?.isDirty ?? false;

  return (
    <>
      <Link
        href={href}
        className={className}
        onClick={(event) => {
          if (!isDirty) return;
          event.preventDefault();
          dialogRef.current?.open();
        }}
      >
        {children}
      </Link>
      <ConfirmDialog
        ref={dialogRef}
        title="Leave without saving?"
        description="You have unsaved changes. If you leave now, those changes will be lost."
        confirmLabel="Leave"
        cancelLabel="Stay"
        destructive
        onConfirm={() => {
          scope?.setIsDirty(false);
          router.push(href);
        }}
      />
    </>
  );
}
