import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";
import { ProjectProfileHeader } from "./profile-header";
import { ProjectOverviewTab } from "./overview-tab";
import { ProjectTasksTab } from "./project-tasks-tab";
import { ProjectTimeTab } from "./project-time-tab";
import { ProjectInvoicesTab } from "./project-invoices-tab";
import { ProjectActivityTab } from "./activity-tab";
import { ProjectAttachmentsSection } from "./attachments-section";
import {
  fetchProjectHealth,
  fetchProjectTasks,
  fetchProjectTimeEntries,
  fetchProjectInvoices,
} from "./profile-query";

/**
 * Project Hub V1 — the new canonical "open/view project" destination
 * (Projects & Tasks Work Hub, read-only audit §X/§Y). `/projects/[id]/edit`
 * is unchanged in kind and remains the dedicated Project-field-editing
 * route; this page owns every relationship/history surface instead
 * (Comments, Attachments — moved here from `/edit`, never duplicated on
 * both), plus the new Overview/Tasks/Time/Invoices/Activity/Files tabs —
 * mirroring Client Profile Hub's own architecture exactly.
 *
 * Query architecture (identical discipline to Client Hub's own
 * profile-query.ts, directly informed by the proven Leads Pipeline P2028
 * incident): every read here is independently bounded and tenant-scoped
 * by organizationId+projectId together — never one shared
 * `prisma.$transaction([...])` wrapping unrelated reads, and never every
 * tab's own data fetched on one request. Only the Project itself +
 * (Overview only) health are fetched unconditionally; each other tab's
 * own relationship rows are fetched ONLY when that tab is the one being
 * rendered.
 */

const TABS = ["overview", "tasks", "time", "invoices", "activity", "files"] as const;
type ProjectHubTab = (typeof TABS)[number];

const TAB_LABELS: Record<ProjectHubTab, string> = {
  overview: "Overview",
  tasks: "Tasks",
  time: "Time",
  invoices: "Invoices",
  activity: "Activity",
  files: "Files",
};

function TabNav({ projectId, activeTab }: { projectId: string; activeTab: ProjectHubTab }) {
  return (
    <nav aria-label="Project sections" className="border-border-default mt-6 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <li key={tab}>
              <Link
                href={`/projects/${projectId}?tab=${tab}`}
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

export default async function ProjectHubPage({
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
  // a partial/blank page.
  const activeTab = parseEnumParam(resolvedSearchParams.tab, TABS) ?? "overview";
  const now = new Date();

  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    include: {
      statusDefinition: { select: { label: true, color: true } },
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!project) {
    notFound();
  }

  const isModerator = membership.role === "OWNER" || membership.role === "ADMIN";

  return (
    <div>
      <ProjectProfileHeader
        project={{
          id: project.id,
          name: project.name,
          status: project.status,
          statusDefinition: project.statusDefinition,
          startDate: project.startDate,
          endDate: project.endDate,
          client: project.client,
          owner: project.owner,
        }}
      />

      <TabNav projectId={project.id} activeTab={activeTab} />

      <div className="mt-6">
        {activeTab === "overview" && (
          <ProjectOverviewTab
            description={project.description}
            health={await fetchProjectHealth(organizationId, project.id, now)}
          />
        )}

        {activeTab === "tasks" && (
          <ProjectTasksTab
            projectId={project.id}
            tasks={await fetchProjectTasks(organizationId, project.id)}
            currentUserId={user.id}
            now={now}
          />
        )}

        {activeTab === "time" && (
          <ProjectTimeTab projectId={project.id} entries={await fetchProjectTimeEntries(organizationId, project.id)} />
        )}

        {activeTab === "invoices" && (
          <ProjectInvoicesTab
            clientId={project.client.id}
            invoices={await fetchProjectInvoices(organizationId, project.id)}
          />
        )}

        {activeTab === "activity" && (
          <ProjectActivityTab
            organizationId={organizationId}
            projectId={project.id}
            currentUserId={user.id}
            isModerator={isModerator}
          />
        )}

        {activeTab === "files" && <ProjectAttachmentsSection projectId={project.id} organizationId={organizationId} />}
      </div>
    </div>
  );
}
