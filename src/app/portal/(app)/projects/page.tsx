import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalProjects } from "@/lib/client-portal/queries";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export default async function PortalProjectsPage() {
  const { client, clientId } = await getCurrentPortalUser();
  const projects = await getPortalProjects(clientId);

  return (
    <div>
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Projects</h1>
      <p className="text-text-muted mt-1 text-sm">
        {projects.length} {projects.length === 1 ? "project" : "projects"}
      </p>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Projects will appear here once your team adds one."
        />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Client</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Start date</TableHeaderCell>
              <TableHeaderCell>End date</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {projects.map((project) => {
              const presentation = resolveStatusPresentation(project.statusDefinition, project.status);
              return (
              <TableRow key={project.id}>
                <TableCell emphasis>
                  <Link
                    href={`/portal/projects/${project.id}`}
                    className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {project.name}
                  </Link>
                </TableCell>
                <TableCell>{client.name}</TableCell>
                <TableCell>
                  <StatusBadge status={project.status} label={presentation.label} tone={presentation.tone} />
                </TableCell>
                <TableCell>
                  {project.startDate ? project.startDate.toLocaleDateString() : "—"}
                </TableCell>
                <TableCell>
                  {project.endDate ? project.endDate.toLocaleDateString() : "—"}
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
