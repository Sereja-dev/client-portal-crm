import { getCurrentMembership } from "@/lib/current-user";
import { listTags } from "@/lib/tags/definitions";
import { TagsDefinitionsList, type TagDefinitionRow } from "@/components/tags/tags-definitions-list";
import { EmptyState } from "@/components/ui/empty-state";
import { createTagAction, updateTagAction, archiveTagAction } from "./actions";

/**
 * Tags V2 — Settings → Tags. OWNER/ADMIN-only, mirroring
 * settings/workflow-automations/page.tsx's own exact gate and its "not
 * available" render (never a redirect, never a 404) rather than a
 * partial/read-only view for a MEMBER — the same discipline every other
 * privileged-only Settings page in this app already uses. Server-side
 * authorization is the real boundary (see actions.ts's own header
 * comment); hiding the nav entry (settings-nav.tsx's own tagsOnly gate)
 * is discoverability only.
 *
 * Lists every tag (active + archived) once — the archived toggle flips
 * between them client-side with no extra round trip, matching Custom
 * Statuses' own settings page.
 */
export default async function TagsSettingsPage() {
  const { organizationId, membership } = await getCurrentMembership();
  const canManageTags = membership.role === "OWNER" || membership.role === "ADMIN";

  if (!canManageTags) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState title="Not available" description="You don't have permission to view tags." />
      </div>
    );
  }

  const tags = await listTags(organizationId, { includeArchived: true });

  const rows: TagDefinitionRow[] = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    archivedAt: tag.archivedAt,
    editAction: updateTagAction.bind(null, tag.id),
    archiveAction: archiveTagAction.bind(null, tag.id),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Tags</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Create tags to organize and filter your clients and leads. Anyone on your team can add or
        remove tags on a client or lead, but only owners and admins can create, rename, or archive
        a tag itself.
      </p>

      <TagsDefinitionsList tags={rows} createAction={createTagAction} />
    </div>
  );
}
