import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";
import { getTagsForEntities } from "@/lib/tags/list-query";
import { ClientProfileHeader, canManagePortalAccess } from "./profile-header";
import { ClientContactsSection } from "./contacts-section";
import { ClientAttachmentsSection } from "./attachments-section";
import { TimelineSection } from "@/components/timeline/timeline-section";
import {
  createClientTimelineNoteAction,
  editClientTimelineNoteAction,
  deleteClientTimelineNoteAction,
} from "./timeline-actions";
import { ClientOverviewTab } from "./overview-tab";
import { ClientProjectsTab } from "./projects-tab";
import { ClientTasksTab } from "./tasks-tab";
import { ClientInvoicesTab } from "./invoices-tab";
import { ClientQuotesTab } from "./quotes-tab";
import { ClientContractsTab } from "./contracts-tab";
import {
  fetchClientHealth,
  fetchClientProjects,
  fetchClientTasks,
  fetchClientInvoices,
  fetchClientQuotes,
  fetchClientContracts,
} from "./profile-query";

/**
 * Client Profile Hub V1 — the new canonical "open/view client"
 * destination (see Client Hub readiness audit, Section O). `/clients/
 * [id]/edit` is unchanged and remains the dedicated Client-field-editing
 * route; this page owns every relationship/history surface instead
 * (Contacts, Files, Portal Access, Timeline — moved here from `/edit`,
 * never duplicated on both), plus the new Projects/Tasks/Invoices/
 * Quotes/Contracts tabs and the Overview health strip.
 *
 * Query architecture (Section 16/H of the readiness audit, directly
 * informed by the proven Leads Pipeline P2028 incident): every read here
 * is independently bounded and tenant-scoped by organizationId+clientId
 * together — never one shared `prisma.$transaction([...])` wrapping
 * unrelated reads, and never every tab's own data fetched on one
 * request. Only the Client itself + its tags + (Overview only) health
 * are fetched unconditionally; each other tab's own relationship rows
 * are fetched ONLY when that tab is the one being rendered.
 */

const TABS = [
  "overview",
  "contacts",
  "projects",
  "tasks",
  "invoices",
  "quotes",
  "contracts",
  "files",
  "activity",
] as const;
type ClientProfileTab = (typeof TABS)[number];

const TAB_LABELS: Record<ClientProfileTab, string> = {
  overview: "Overview",
  contacts: "Contacts",
  projects: "Projects",
  tasks: "Tasks",
  invoices: "Invoices",
  quotes: "Quotes",
  contracts: "Contracts",
  files: "Files",
  activity: "Activity",
};

function TabNav({ clientId, activeTab }: { clientId: string; activeTab: ClientProfileTab }) {
  return (
    <nav aria-label="Client profile sections" className="border-border-default mt-6 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <li key={tab}>
              <Link
                href={`/clients/${clientId}?tab=${tab}`}
                aria-current={isActive ? "page" : undefined}
                className={`inline-block rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-accent text-accent border-b-2"
                    : "text-text-secondary hover:bg-[var(--hover)] border-b-2 border-transparent"
                }`}
              >
                {TAB_LABELS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default async function ClientProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const { user, organizationId, membership } = await getCurrentMembership();
  const resolvedSearchParams = await searchParams;
  // Unknown/invalid `tab` falls back to Overview — never an error, never
  // a partial/blank page (Section 6's own explicit requirement).
  const activeTab = parseEnumParam(resolvedSearchParams.tab, TABS) ?? "overview";

  const client = await prisma.client.findFirst({
    where: { id, organizationId },
    include: {
      statusDefinition: { select: { label: true, color: true } },
      user: { select: { id: true, name: true } },
    },
  });

  if (!client) {
    notFound();
  }

  const tagsByClientId = await getTagsForEntities(organizationId, "CLIENT", [client.id]);
  const canManagePortal = canManagePortalAccess(membership.role);

  const actor = { id: user.id, name: user.name, role: membership.role };

  return (
    <div>
      <ClientProfileHeader
        client={{
          id: client.id,
          name: client.name,
          company: client.company,
          email: client.email,
          phone: client.phone,
          status: client.status,
          statusDefinition: client.statusDefinition,
          owner: client.user,
        }}
        tags={tagsByClientId.get(client.id) ?? []}
        canManagePortal={canManagePortal}
      />

      <TabNav clientId={client.id} activeTab={activeTab} />

      <div className="mt-6">
        {activeTab === "overview" && (
          <ClientOverviewTab
            client={{ notes: client.notes, createdAt: client.createdAt }}
            health={await fetchClientHealth(organizationId, client.id, actor)}
            clientId={client.id}
            role={membership.role}
          />
        )}

        {activeTab === "contacts" && <ClientContactsSection clientId={client.id} organizationId={organizationId} />}

        {activeTab === "projects" && (
          <ClientProjectsTab clientId={client.id} projects={await fetchClientProjects(organizationId, client.id)} />
        )}

        {activeTab === "tasks" && <ClientTasksTab tasks={await fetchClientTasks(organizationId, client.id)} />}

        {activeTab === "invoices" && (
          <ClientInvoicesTab clientId={client.id} invoices={await fetchClientInvoices(organizationId, client.id)} />
        )}

        {activeTab === "quotes" && (
          <ClientQuotesTab clientId={client.id} quotes={await fetchClientQuotes(organizationId, client.id)} />
        )}

        {activeTab === "contracts" && (
          <ClientContractsTab contracts={await fetchClientContracts(organizationId, client.id)} />
        )}

        {activeTab === "files" && <ClientAttachmentsSection clientId={client.id} organizationId={organizationId} />}

        {activeTab === "activity" && (
          <TimelineSection
            entityType="CLIENT"
            entityId={client.id}
            organizationId={organizationId}
            actor={actor}
            createAction={createClientTimelineNoteAction.bind(null, client.id)}
            makeEditAction={(noteId) => editClientTimelineNoteAction.bind(null, client.id, noteId)}
            makeDeleteAction={(noteId) => deleteClientTimelineNoteAction.bind(null, client.id, noteId)}
          />
        )}
      </div>
    </div>
  );
}
