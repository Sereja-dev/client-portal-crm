// Workflow Automations Phase 1. Mirrors lead-metadata.ts's own
// discipline exactly: every editable field's NAME can appear inside a
// changedFields diff array (never its value) — in particular, the
// `conditions`/`actions` JSON blobs themselves NEVER appear anywhere in
// Activity.metadata, only the bare field names "conditions"/"actions"
// when either changed, and "isEnabled"/"archivedAt" for enable/disable/
// archive. This records changes to automation *configuration* only; it
// has no connection to automation *execution*, which does not exist in
// this phase.

export type WorkflowAutomationActivityMetadata = {
  name: string;
  actorName: string;
  /** Only present on UPDATED — field names that changed, never their values. */
  changedFields?: string[];
};

export function buildWorkflowAutomationActivityMetadata(
  automation: { name: string },
  actorName: string,
  changedFields?: string[],
): WorkflowAutomationActivityMetadata {
  return {
    name: automation.name,
    actorName,
    ...(changedFields ? { changedFields } : {}),
  };
}
