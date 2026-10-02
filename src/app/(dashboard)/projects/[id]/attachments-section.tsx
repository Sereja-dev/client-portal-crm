import { AttachmentsSection } from "@/components/attachments/attachments-section";
import { uploadAttachmentAction, deleteAttachmentAction } from "./attachment-actions";

/** Work Hub V1 — moved verbatim from the old `projects/[id]/edit/attachments-section.tsx`; now the Project Hub's own Files tab content directly (see page.tsx), no longer the edit page's own section. */
export function ProjectAttachmentsSection({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  return (
    <AttachmentsSection
      entityType="PROJECT"
      entityId={projectId}
      organizationId={organizationId}
      parentLabel="project"
      uploadAction={uploadAttachmentAction.bind(null, projectId)}
      makeDeleteAction={(attachmentId) => deleteAttachmentAction.bind(null, projectId, attachmentId)}
    />
  );
}
