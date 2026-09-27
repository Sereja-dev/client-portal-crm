import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import type { ClientProjectRow } from "./profile-query";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

// Mirrors ProjectStatusBadge (projects/page.tsx) exactly — kept as its
// own small local copy rather than a shared export, matching that page's
// own "identical helper, not centralized" precedent.
function ProjectStatusBadge({ project }: { project: ClientProjectRow }) {
  const presentation = resolveStatusPresentation(project.statusDefinition, project.status);
  return <StatusBadge status={project.status} label={presentation.label} tone={presentation.tone} />;
}

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

export function ClientProjectsTab({ clientId, projects }: { clientId: string; projects: ClientProjectRow[] }) {
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Projects for this client will appear here."
        action={
          <Link href={`/projects/new?clientId=${clientId}`} className={PRIMARY_LINK_CLASSES}>
            Create project
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Start</TableHeaderCell>
              <TableHeaderCell>End</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell emphasis>
                  <Link href={`/projects/${project.id}/edit`} className={ACTION_LINK_CLASSES}>
                    {project.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <ProjectStatusBadge project={project} />
                </TableCell>
                <TableCell>{formatDate(project.startDate)}</TableCell>
                <TableCell>{formatDate(project.endDate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordCardList>
        {projects.map((project) => (
          <RecordCard key={project.id}>
            <RecordCardField
              label="Name"
              value={
                <Link href={`/projects/${project.id}/edit`} className={ACTION_LINK_CLASSES}>
                  {project.name}
                </Link>
              }
              emphasis
            />
            <RecordCardField label="Status" value={<ProjectStatusBadge project={project} />} />
            <RecordCardField label="Start" value={formatDate(project.startDate)} />
            <RecordCardField label="End" value={formatDate(project.endDate)} />
          </RecordCard>
        ))}
      </RecordCardList>
    </>
  );
}
