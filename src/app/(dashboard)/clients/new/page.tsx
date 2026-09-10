import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { getActiveCustomFieldFormDefinitions } from "@/lib/custom-fields/entity-form";
import { buildStatusSelectOptions } from "@/lib/custom-statuses/entity-form";
import { ClientForm } from "@/components/clients/client-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createClientAction } from "./actions";

export default async function NewClientPage() {
  // Custom Fields Phase 2B (Section B) — active CLIENT definitions only;
  // CustomFieldsFormSection itself renders nothing when this is empty.
  const { organizationId } = await getCurrentUserOrganization();
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "CLIENT");
  // Custom Statuses Phase 2B (Section L) — every active CLIENT status
  // definition; no "current" definition to exempt on create.
  const statusOptions = await buildStatusSelectOptions(organizationId, "CLIENT", null);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Add client</h1>
        <Link href="/clients" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ClientForm action={createClientAction} statusOptions={statusOptions} customFieldDefinitions={customFieldDefinitions} />
      </div>
    </div>
  );
}
