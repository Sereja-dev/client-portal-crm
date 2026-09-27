import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { TagChipList } from "@/components/tags/tag-chip-list";
import type { TagAssignmentDisplay } from "@/lib/tags/list-query";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Role } from "@/generated/prisma/enums";
import type { CustomStatusColor } from "@/generated/prisma/enums";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const SECONDARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring border-border-strong bg-surface text-text-primary rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export type ProfileClient = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  statusDefinition: { label: string; color: CustomStatusColor | null } | null;
  owner: { id: string; name: string } | null;
};

/**
 * Client Profile Hub V1 — compact header, truthful existing data only.
 * No internal ids exposed; missing optional fields (company/email/
 * phone/owner) are simply omitted rather than rendered as placeholder
 * clutter. Quick actions live here rather than a separate toolbar —
 * this is the one "immediate profile action area" Section 5 asks for.
 */
export function ClientProfileHeader({
  client,
  tags,
  canManagePortal,
}: {
  client: ProfileClient;
  tags: TagAssignmentDisplay[];
  canManagePortal: boolean;
}) {
  const presentation = resolveStatusPresentation(client.statusDefinition, client.status);

  return (
    <div className="border-border-default bg-surface rounded-lg border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-text-primary text-2xl font-semibold tracking-tight">{client.name}</h1>
            <StatusBadge status={client.status} label={presentation.label} tone={presentation.tone} />
          </div>
          {client.company && <p className="text-text-secondary mt-1 text-sm">{client.company}</p>}
          <dl className="text-text-secondary mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {client.email && (
              <div className="flex gap-1">
                <dt className="text-text-muted">Email:</dt>
                <dd>{client.email}</dd>
              </div>
            )}
            {client.phone && (
              <div className="flex gap-1">
                <dt className="text-text-muted">Phone:</dt>
                <dd>{client.phone}</dd>
              </div>
            )}
            {client.owner && (
              <div className="flex gap-1">
                <dt className="text-text-muted">Owner:</dt>
                <dd>{client.owner.name}</dd>
              </div>
            )}
          </dl>
          {tags.length > 0 && (
            <div className="mt-3">
              <TagChipList tags={tags} />
            </div>
          )}
        </div>

        <Link href={`/clients/${client.id}/edit`} className={ACTION_LINK_CLASSES}>
          Edit client
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={`/projects/new?clientId=${client.id}`} className={PRIMARY_LINK_CLASSES}>
          Create project
        </Link>
        <Link href={`/invoices/new?clientId=${client.id}`} className={SECONDARY_LINK_CLASSES}>
          Create invoice
        </Link>
        <Link href={`/quotes/new?clientId=${client.id}`} className={SECONDARY_LINK_CLASSES}>
          Create quote
        </Link>
        <Link href={`/clients/${client.id}?tab=contacts`} className={SECONDARY_LINK_CLASSES}>
          Add contact
        </Link>
        {canManagePortal && (
          <Link href={`/clients/${client.id}?tab=overview#portal-access`} className={SECONDARY_LINK_CLASSES}>
            Invite to portal
          </Link>
        )}
      </div>
    </div>
  );
}

export function canManagePortalAccess(role: Role): boolean {
  return role === Role.OWNER || role === Role.ADMIN;
}
