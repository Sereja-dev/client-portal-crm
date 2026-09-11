import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalProjects } from "@/lib/client-portal/queries";
import { PortalRequestCreateForm } from "@/components/client-requests/portal-request-create-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createPortalClientRequestAction } from "../actions";

/**
 * Client Requests / Tickets Phase 2A — Portal "New request" page.
 * `getPortalProjects(clientId)` is the exact same existing query
 * src/app/portal/(app)/projects/page.tsx's own list uses — already
 * scoped to this Portal Client's own Projects only, reused as-is (never
 * a second, parallel "projects for a select" query).
 */
export default async function NewPortalClientRequestPage() {
  const { clientId } = await getCurrentPortalUser();
  const projects = await getPortalProjects(clientId);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">New request</h1>
        <Link href="/portal/requests" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <PortalRequestCreateForm action={createPortalClientRequestAction} projects={projects} />
      </div>
    </div>
  );
}
