"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/toast/toast-provider";
import { updateContractInternalNotesAction } from "@/app/(dashboard)/contracts/actions";

/**
 * Contracts Phase 2 (Staff UI) §22 — the dedicated inline internalNotes
 * editor, mirroring InvoiceInternalNotesForm exactly. Works identically
 * regardless of the Contract's own status or archivedAt (locked
 * architecture §8/§15: internalNotes stays Staff-editable in DRAFT,
 * SENT, ACCEPTED, TERMINATED, and archived alike) — this component never
 * checks either, by design, and never routes through the document-edit
 * Server Action.
 */
export function ContractInternalNotesForm({ contractId, initialValue }: { contractId: string; initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();

  function handleSave() {
    startTransition(async () => {
      const result = await updateContractInternalNotesAction(contractId, value);
      if (result.ok) {
        showToast("Internal notes saved");
      } else if (result.reason === "VALIDATION") {
        showToast(result.error, "error");
      } else {
        showToast("This contract could not be found.", "error");
      }
    });
  }

  return (
    <div>
      <label htmlFor="contract-internal-notes" className="text-text-secondary block text-sm font-medium">
        Internal notes
      </label>
      <Textarea id="contract-internal-notes" rows={3} value={value} onChange={(event) => setValue(event.target.value)} />
      <p className="text-text-muted mt-1 text-xs">
        Staff-only — internal notes are never shown as part of the contract document, and can be edited at any stage.
      </p>
      <div className="mt-2">
        <Button type="button" onClick={handleSave} loading={pending} disabled={pending}>
          Save notes
        </Button>
      </div>
    </div>
  );
}
