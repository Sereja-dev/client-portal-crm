import Link from "next/link";
import { LeadCaptureFormEditor } from "@/components/lead-capture-forms/lead-capture-form-editor";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createLeadCaptureFormAction } from "../actions";

export default function NewLeadCaptureFormPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Create lead capture form</h1>
        <Link href="/settings/lead-capture-forms" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <LeadCaptureFormEditor action={createLeadCaptureFormAction} submitLabel="Create form" pendingLabel="Creating…" />
      </div>
    </div>
  );
}
