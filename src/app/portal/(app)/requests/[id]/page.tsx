import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalClientRequest } from "@/lib/client-requests/portal";
import { listClientRequestMessagesForClient } from "@/lib/client-requests/messages";
import { formatClientRequestMessage } from "@/lib/client-requests/format-message";
import { StatusBadge } from "@/components/ui/status-badge";
import { MessageList } from "@/components/client-requests/message-list";
import { MessageComposer } from "@/components/client-requests/message-composer";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { addPortalClientRequestMessageAction } from "../actions";

/**
 * Client Requests / Tickets Phase 2A — Portal request detail. Read-only
 * for status/priority/project (Portal has no Server Action that could
 * ever change any of them — see portal.ts's own doc comment: Portal
 * simply has no such function at all, so there is nothing to guard here
 * beyond not rendering a control that doesn't exist). getPortalClientRequest
 * already excludes an archived request (Phase 2A tightening — see that
 * function's own doc comment), so notFound() here also covers "this
 * request was archived," indistinguishable from "never existed."
 */
export default async function PortalClientRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clientId } = await getCurrentPortalUser();

  const request = await getPortalClientRequest(clientId, id);
  if (!request) {
    notFound();
  }

  const rawMessages = await listClientRequestMessagesForClient(clientId, id);
  const messages = (rawMessages ?? []).map(formatClientRequestMessage);
  const boundAddMessage = addPortalClientRequestMessageAction.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-text-primary min-w-0 truncate text-2xl font-semibold tracking-tight">{request.title}</h1>
        <Link href="/portal/requests" className={`${ACTION_LINK_CLASSES} shrink-0`}>
          Back to requests
        </Link>
      </div>

      <div className={`mb-6 p-6 ${CARD_SURFACE_CLASSES}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-text-muted text-xs font-medium tracking-wide uppercase">Status</p>
            <div className="mt-1">
              <StatusBadge status={request.status} />
            </div>
          </div>
          <div>
            <p className="text-text-muted text-xs font-medium tracking-wide uppercase">Priority</p>
            <div className="mt-1">
              <StatusBadge status={request.priority} />
            </div>
          </div>
          {request.project && (
            <div>
              <p className="text-text-muted text-xs font-medium tracking-wide uppercase">Project</p>
              <p className="text-text-primary mt-1 text-sm">{request.project.name}</p>
            </div>
          )}
          <div>
            <p className="text-text-muted text-xs font-medium tracking-wide uppercase">Submitted</p>
            <p className="text-text-primary mt-1 text-sm" title={request.createdAt.toLocaleString()}>
              {request.createdAt.toLocaleDateString()}
            </p>
          </div>
        </div>

        <p className="text-text-primary mt-4 text-sm whitespace-pre-wrap">{request.description}</p>
      </div>

      <h2 className="text-text-primary mb-3 text-lg font-semibold tracking-tight">Conversation</h2>
      <MessageList messages={messages} />

      <div className="mt-4">
        <MessageComposer action={boundAddMessage} />
      </div>
    </div>
  );
}
