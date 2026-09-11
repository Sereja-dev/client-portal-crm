import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getOrganizationClientRequest } from "@/lib/client-requests/staff";
import { listClientRequestMessagesForOrganization } from "@/lib/client-requests/messages";
import { formatClientRequestMessage } from "@/lib/client-requests/format-message";
import { StatusBadge } from "@/components/ui/status-badge";
import { MessageList } from "@/components/client-requests/message-list";
import { MessageComposer } from "@/components/client-requests/message-composer";
import { StaffRequestControls } from "@/components/client-requests/staff-request-controls";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { addStaffClientRequestMessageAction } from "../actions";

/**
 * Client Requests / Tickets Phase 2A — Staff request detail. Scoped by
 * id + organizationId together via getOrganizationClientRequest — a
 * foreign org's request id simply doesn't match, indistinguishable from
 * a nonexistent one, matching every other entity detail route in this
 * app exactly. `members`/`projects` are fetched here (organization
 * Memberships; this exact request's own Client's Projects) and handed
 * down to StaffRequestControls as plain, already-scoped data — that
 * component never fetches or filters anything itself.
 */
export default async function ClientRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  const request = await getOrganizationClientRequest(organizationId, id);
  if (!request) {
    notFound();
  }

  const [rawMessages, members, projects] = await Promise.all([
    listClientRequestMessagesForOrganization(organizationId, id),
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    }),
    // Same-Client Projects only (§"PROJECT": "Staff project selector: only
    // Projects belonging to same Client") — never every Project in the
    // organization.
    prisma.project.findMany({
      where: { organizationId, clientId: request.clientId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const messages = (rawMessages ?? []).map(formatClientRequestMessage);
  const memberOptions = members.map((m) => ({ id: m.user.id, name: m.user.name }));
  const boundAddMessage = addStaffClientRequestMessageAction.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-text-primary min-w-0 truncate text-2xl font-semibold tracking-tight">{request.title}</h1>
        <Link href="/requests" className={`${ACTION_LINK_CLASSES} shrink-0`}>
          Back to requests
        </Link>
      </div>

      <div className={`mb-6 p-6 ${CARD_SURFACE_CLASSES}`}>
        <dl className="text-text-muted grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="font-medium tracking-wide uppercase">Client</dt>
            <dd className="text-text-secondary mt-0.5">{request.client.name}</dd>
          </div>
          <div>
            <dt className="font-medium tracking-wide uppercase">Submitted by</dt>
            <dd className="text-text-secondary mt-0.5">{request.portalUser?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium tracking-wide uppercase">Created</dt>
            <dd className="text-text-secondary mt-0.5" title={request.createdAt.toLocaleString()}>
              {request.createdAt.toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="font-medium tracking-wide uppercase">Updated</dt>
            <dd className="text-text-secondary mt-0.5" title={request.updatedAt.toLocaleString()}>
              {request.updatedAt.toLocaleDateString()}
            </dd>
          </div>
        </dl>

        {request.archivedAt !== null && (
          <p className="border-border-strong bg-surface-recessed text-text-secondary mt-4 rounded-md border border-dashed px-4 py-3 text-sm">
            This request is archived. The client can no longer view or message it.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          <StatusBadge status={request.priority} />
          {request.archivedAt !== null && <StatusBadge status="ARCHIVED" />}
        </div>

        <p className="text-text-primary mt-4 text-sm whitespace-pre-wrap">{request.description}</p>
      </div>

      <div className={`mb-6 p-6 ${CARD_SURFACE_CLASSES}`}>
        <StaffRequestControls
          requestId={request.id}
          status={request.status}
          priority={request.priority}
          assignedToId={request.assignedToId}
          projectId={request.projectId}
          archivedAt={request.archivedAt?.toISOString() ?? null}
          members={memberOptions}
          projects={projects}
        />
      </div>

      <h2 className="text-text-primary mb-3 text-lg font-semibold tracking-tight">Conversation</h2>
      <MessageList messages={messages} />

      {request.archivedAt === null && (
        <div className="mt-4">
          <MessageComposer action={boundAddMessage} />
        </div>
      )}
    </div>
  );
}
