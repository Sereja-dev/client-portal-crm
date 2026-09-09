import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveCustomFieldFormDefinitions } from "@/lib/custom-fields/entity-form";
import { ProjectForm } from "@/components/projects/project-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createProjectAction } from "./actions";

// Matches Button's own primary variant tokens — same constant used by
// the Clients/Invoices/Projects/Tasks list pages' own primary action.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export default async function NewProjectPage() {
  const { organizationId } = await getCurrentUserOrganization();
  const clients = await prisma.client.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  // Custom Fields Phase 2B (Section B) — active PROJECT definitions only.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "PROJECT");

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Add project
        </h1>
        <Link href="/projects" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="You need a client first"
          description="Projects must belong to a client. Add one before creating a project."
          action={
            <Link href="/clients/new" className={PRIMARY_LINK_CLASSES}>
              Add client
            </Link>
          }
        />
      ) : (
        <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <ProjectForm action={createProjectAction} clients={clients} customFieldDefinitions={customFieldDefinitions} />
        </div>
      )}
    </div>
  );
}
