import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveCustomFieldFormDefinitions } from "@/lib/custom-fields/entity-form";
import { LeadForm } from "@/components/leads/lead-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createLeadFormAction } from "./actions";

export default async function NewLeadPage() {
  const { organizationId } = await getCurrentUserOrganization();

  // Same-organization Staff members only — mirrors team/page.tsx's own
  // Membership query exactly.
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: { user: { select: { id: true, name: true } } },
  });
  const assignees = memberships.map((m) => ({ id: m.user.id, name: m.user.name }));
  // Custom Fields Phase 2B (Section B) — active LEAD definitions only.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "LEAD");

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Add lead</h1>
        <Link href="/leads" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <LeadForm action={createLeadFormAction} assignees={assignees} customFieldDefinitions={customFieldDefinitions} />
      </div>
    </div>
  );
}
