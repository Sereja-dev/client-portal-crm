// Leads / Sales Pipeline Phase 2. Mirrors client-metadata.ts's own
// discipline exactly: every editable field's NAME can appear inside a
// changedFields diff array (never its value), while the metadata's own
// top-level, always-present fields are limited to what's already shown
// everywhere in a list/badge UI (name, stage) — matching Client's own
// top-level name+status. email, phone, company, notes, value, and
// lostReason values never appear anywhere in Activity.metadata, only
// (for company/email/phone/value/notes) as an entry in changedFields
// when their value changed, exactly like Client's own email/phone/
// company field names.

const LEAD_TRACKED_FIELDS = [
  "name",
  "company",
  "email",
  "phone",
  "source",
  "value",
  "notes",
  "assignedToUserId",
] as const;

type LeadTrackedSnapshot = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  value: unknown;
  notes: string | null;
  assignedToUserId: string | null;
};

export type LeadActivityMetadata = {
  name: string;
  stage: string;
  actorName: string;
  /** Only present on UPDATED — field names that changed, never their values. */
  changedFields?: string[];
};

// Lead Timeline Activity formatting fix — this used to be bare
// { from, to }, unlike ProjectStatusChangedMetadata/TaskStatusChangedMetadata
// (project-metadata.ts / task-metadata.ts), which have always included
// their own entity's name alongside from/to. buildDataEntityModel()
// (format-activity.ts) requires a top-level entity name for EVERY action
// it handles, STATUS_CHANGED included — omitting it here meant every real
// LEAD STATUS_CHANGED event (moveLeadStageAction, markLeadLostAction)
// rendered as the generic "Activity recorded" fallback. `name` is now
// included, matching the sibling builders' own shape exactly.
export type LeadStageChangeMetadata = {
  name: string;
  from: string;
  to: string;
};

/** Field names (never values) that differ between two Lead snapshots — mirrors diffClientFields exactly. */
export function diffLeadFields(before: LeadTrackedSnapshot, after: LeadTrackedSnapshot): string[] {
  return LEAD_TRACKED_FIELDS.filter((field) => {
    const a = before[field];
    const b = after[field];
    // `value` is a Prisma Decimal on the "before" (already-persisted) side
    // and a plain number on "after" (freshly parsed input) — compare by
    // string form so a genuinely unchanged amount never shows up as a
    // false-positive diff purely from the two different in-memory types.
    if (field === "value") {
      const av = a === null || a === undefined ? null : String(a);
      const bv = b === null || b === undefined ? null : String(b);
      return av !== bv;
    }
    return a !== b;
  });
}

export function buildLeadActivityMetadata(
  lead: { name: string; stage: string },
  actorName: string,
  changedFields?: string[],
): LeadActivityMetadata {
  return {
    name: lead.name,
    stage: lead.stage,
    actorName,
    ...(changedFields ? { changedFields } : {}),
  };
}

export function buildLeadStageChangeMetadata(
  lead: Pick<LeadTrackedSnapshot, "name">,
  from: string,
  to: string,
): LeadStageChangeMetadata {
  return { name: lead.name, from, to };
}
