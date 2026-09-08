"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ContactFormDialog } from "./contact-form-dialog";
import type { ClientContactFormState } from "@/types";

/**
 * Multiple Contacts Phase 2 (Staff UI). Used both above the active
 * contacts table and as the empty state's own call to action — same
 * component either way, only the trigger's visual variant differs
 * (primary-filled in the empty state so it reads as the obvious next
 * step; secondary/outlined next to an already-populated list).
 */
export function AddContactButton({
  action,
  variant = "secondary",
  label = "Add contact",
}: {
  action: (
    prevState: ClientContactFormState,
    formData: FormData,
  ) => Promise<ClientContactFormState>;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" variant={variant} onClick={() => dialogRef.current?.showModal()}>
        {label}
      </Button>
      <ContactFormDialog dialogRef={dialogRef} title="Add contact" mode="add" action={action} />
    </>
  );
}
