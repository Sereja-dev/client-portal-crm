import { notFound } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canImportData } from "@/lib/import/authorization";
import { CLIENT_IMPORT_FIELDS } from "@/lib/import/fields";
import { ImportWizard } from "@/components/import/import-wizard";

/**
 * CSV Import Phase 2 — page-level gate (OWNER/ADMIN only). This is a
 * defense-in-depth convenience, not the real authorization boundary:
 * every Server Action in src/lib/import/server-actions.ts independently
 * re-checks canImportData(organizationId, membership.role) itself, so a MEMBER can never
 * actually upload/preview/execute an import even if they somehow reached
 * this page directly.
 */
export default async function ClientsImportPage() {
  const { organizationId, membership } = await getCurrentMembership();
  if (!(await canImportData(organizationId, membership.role))) {
    notFound();
  }

  return (
    <div>
      <h1 className="text-text-primary mb-6 text-2xl font-semibold tracking-tight">Import Clients</h1>
      <ImportWizard entityType="CLIENT" fields={CLIENT_IMPORT_FIELDS} listHref="/clients" entityLabelPlural="Clients" />
    </div>
  );
}
