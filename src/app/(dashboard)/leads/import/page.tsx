import { notFound } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canImportData } from "@/lib/import/authorization";
import { LEAD_IMPORT_FIELDS } from "@/lib/import/fields";
import { ImportWizard } from "@/components/import/import-wizard";

/**
 * CSV Import Phase 2 — page-level gate (OWNER/ADMIN only). Same
 * defense-in-depth note as clients/import/page.tsx: the real
 * authorization boundary is every Server Action's own independent
 * canImportData(organizationId, membership.role) re-check.
 */
export default async function LeadsImportPage() {
  const { organizationId, membership } = await getCurrentMembership();
  if (!(await canImportData(organizationId, membership.role))) {
    notFound();
  }

  return (
    <div>
      <h1 className="text-text-primary mb-6 text-2xl font-semibold tracking-tight">Import Leads</h1>
      <ImportWizard entityType="LEAD" fields={LEAD_IMPORT_FIELDS} listHref="/leads" entityLabelPlural="Leads" />
    </div>
  );
}
