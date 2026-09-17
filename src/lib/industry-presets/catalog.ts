import type { CustomFieldEntityType, CustomFieldType, CustomStatusEntityType } from "@/generated/prisma/enums";

/**
 * Industry Presets V1 — the code-defined, immutable-at-runtime preset
 * catalog (locked spec §2/§Preset-catalog-architecture). Mirrors
 * src/lib/custom-statuses/constants.ts's own SYSTEM_STATUS_DEFINITIONS
 * precedent: a plain, typed, hardcoded constant — no database-backed
 * global preset-definition table exists or is ever created.
 *
 * A preset gives a workspace a SAFE STARTING configuration for its
 * industry — it is never a different product mode. Applying a preset
 * only ever ADDS Custom Statuses / Custom Fields / Tags; it never
 * renames, archives, deletes, or otherwise touches anything that already
 * exists, and never changes system status defaults (see apply.ts's own
 * header comment for the full conflict semantics). The four preset keys
 * below are the entire V1 catalog — no more, no fewer (validation.ts's
 * own unit tests enforce this exactly).
 *
 * Every custom-field definition in this catalog is `required: false` —
 * V1 never creates a required preset field (locked spec: "do NOT create
 * required preset fields"). Every status/field/tag key or name below is
 * a stable, explicit, hardcoded machine identity chosen once here, never
 * derived at apply-time from a label — apply.ts's own creation
 * primitives check for this EXACT key and skip on any collision, they
 * never auto-suffix (unlike createCustomStatusDefinition/
 * createCustomFieldDefinition's own interactive auto-suffix behavior,
 * which is deliberately not reused for presets — see apply.ts).
 */

export type IndustryPresetKey = "freelancer" | "creative_agency" | "marketing_agency" | "general_services";

export const INDUSTRY_PRESET_KEYS: readonly IndustryPresetKey[] = [
  "freelancer",
  "creative_agency",
  "marketing_agency",
  "general_services",
];

export type PresetStatusSeed = {
  entityType: CustomStatusEntityType;
  /** Stable, explicit, hardcoded key — checked for an exact collision at apply time, never auto-suffixed (locked spec §7/§12). */
  key: string;
  label: string;
};

export type PresetFieldOptionSeed = {
  label: string;
  /** Stable, explicit, hardcoded value — created verbatim in catalog order, never auto-suffixed. */
  value: string;
};

export type PresetFieldSeed = {
  entityType: CustomFieldEntityType;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  /** Always false in V1 — no preset field is ever required (locked spec). Kept as an explicit literal field, not omitted, so validation.ts can assert it directly against the catalog data rather than trusting a comment. */
  required: false;
  /** Present only for `fieldType: "SELECT"` — non-empty, unique labels/values, created in this exact order. */
  options?: readonly PresetFieldOptionSeed[];
};

export type PresetTagSeed = {
  name: string;
};

export type IndustryPresetDefinition = {
  key: IndustryPresetKey;
  /** Positive integer — recorded on PresetApplication.presetVersion at apply time (locked spec §3/§Application-semantics). V1 defines every preset at version 1; nothing in this scope ever bumps it. */
  version: number;
  displayName: string;
  description: string;
  statuses: readonly PresetStatusSeed[];
  fields: readonly PresetFieldSeed[];
  tags: readonly PresetTagSeed[];
};

const FREELANCER: IndustryPresetDefinition = {
  key: "freelancer",
  version: 1,
  displayName: "Freelancer / Solo Consultant",
  description: "Starter configuration for independent consultants and solo service businesses.",
  statuses: [
    { entityType: "LEAD", key: "discovery_scheduled", label: "Discovery Scheduled" },
    { entityType: "LEAD", key: "follow_up", label: "Follow-up" },
    { entityType: "LEAD", key: "negotiation", label: "Negotiation" },
    { entityType: "PROJECT", key: "awaiting_client", label: "Awaiting Client" },
    { entityType: "PROJECT", key: "revisions", label: "Revisions" },
    { entityType: "CLIENT", key: "retainer", label: "Retainer" },
  ],
  fields: [
    { entityType: "LEAD", key: "service_interest", label: "Service Interest", fieldType: "TEXT", required: false },
    { entityType: "LEAD", key: "budget", label: "Budget", fieldType: "NUMBER", required: false },
    { entityType: "LEAD", key: "referral_source", label: "Referral Source", fieldType: "TEXT", required: false },
    { entityType: "LEAD", key: "target_start_date", label: "Target Start Date", fieldType: "DATE", required: false },
    {
      entityType: "CLIENT",
      key: "preferred_contact_method",
      label: "Preferred Contact Method",
      fieldType: "SELECT",
      required: false,
      options: [
        { label: "Email", value: "email" },
        { label: "Phone", value: "phone" },
        { label: "Messaging", value: "messaging" },
      ],
    },
    { entityType: "PROJECT", key: "project_type", label: "Project Type", fieldType: "TEXT", required: false },
  ],
  tags: [{ name: "Referral" }, { name: "Retainer" }, { name: "One-off" }, { name: "Priority" }],
};

const CREATIVE_AGENCY: IndustryPresetDefinition = {
  key: "creative_agency",
  version: 1,
  displayName: "Creative / Design Agency",
  description: "Starter configuration for design, branding, web, and creative-service teams.",
  statuses: [
    { entityType: "LEAD", key: "brief_received", label: "Brief Received" },
    { entityType: "LEAD", key: "estimate_sent", label: "Estimate Sent" },
    { entityType: "LEAD", key: "negotiation", label: "Negotiation" },
    { entityType: "PROJECT", key: "creative_brief", label: "Creative Brief" },
    { entityType: "PROJECT", key: "in_review", label: "In Review" },
    { entityType: "PROJECT", key: "revisions", label: "Revisions" },
    { entityType: "PROJECT", key: "client_approval", label: "Client Approval" },
    { entityType: "CLIENT", key: "retainer", label: "Retainer" },
  ],
  fields: [
    {
      entityType: "LEAD",
      key: "service_type",
      label: "Service Type",
      fieldType: "SELECT",
      required: false,
      options: [
        { label: "Branding", value: "branding" },
        { label: "Web Design", value: "web_design" },
        { label: "Graphic Design", value: "graphic_design" },
        { label: "UI/UX", value: "ui_ux" },
        { label: "Other", value: "other" },
      ],
    },
    { entityType: "LEAD", key: "budget", label: "Budget", fieldType: "NUMBER", required: false },
    { entityType: "PROJECT", key: "deliverable_type", label: "Deliverable Type", fieldType: "TEXT", required: false },
    { entityType: "PROJECT", key: "revision_round", label: "Revision Round", fieldType: "NUMBER", required: false },
    { entityType: "CLIENT", key: "brand_guidelines_url", label: "Brand Guidelines URL", fieldType: "TEXT", required: false },
  ],
  tags: [{ name: "Branding" }, { name: "Web Design" }, { name: "UI/UX" }, { name: "Rush" }, { name: "Retainer" }],
};

const MARKETING_AGENCY: IndustryPresetDefinition = {
  key: "marketing_agency",
  version: 1,
  displayName: "Marketing / Digital Agency",
  description: "Starter configuration for marketing, campaign, and digital-service teams.",
  statuses: [
    { entityType: "LEAD", key: "discovery_audit", label: "Discovery / Audit" },
    { entityType: "LEAD", key: "strategy_proposed", label: "Strategy Proposed" },
    { entityType: "LEAD", key: "negotiation", label: "Negotiation" },
    { entityType: "PROJECT", key: "strategy", label: "Strategy" },
    { entityType: "PROJECT", key: "campaign_live", label: "Campaign Live" },
    { entityType: "PROJECT", key: "reporting", label: "Reporting" },
    { entityType: "PROJECT", key: "awaiting_approval", label: "Awaiting Approval" },
    { entityType: "CLIENT", key: "retainer", label: "Retainer" },
  ],
  fields: [
    {
      entityType: "LEAD",
      key: "primary_channel",
      label: "Primary Channel",
      fieldType: "SELECT",
      required: false,
      options: [
        { label: "SEO", value: "seo" },
        { label: "Paid Search", value: "paid_search" },
        { label: "Paid Social", value: "paid_social" },
        { label: "Email", value: "email" },
        { label: "Content", value: "content" },
        { label: "Other", value: "other" },
      ],
    },
    { entityType: "LEAD", key: "budget", label: "Budget", fieldType: "NUMBER", required: false },
    { entityType: "PROJECT", key: "campaign_start", label: "Campaign Start", fieldType: "DATE", required: false },
    { entityType: "PROJECT", key: "campaign_end", label: "Campaign End", fieldType: "DATE", required: false },
    { entityType: "PROJECT", key: "monthly_ad_spend", label: "Monthly Ad Spend", fieldType: "NUMBER", required: false },
    { entityType: "CLIENT", key: "website_url", label: "Website URL", fieldType: "TEXT", required: false },
  ],
  tags: [
    { name: "SEO" },
    { name: "PPC" },
    { name: "Social" },
    { name: "Email" },
    { name: "Content" },
    { name: "Retainer" },
  ],
};

const GENERAL_SERVICES: IndustryPresetDefinition = {
  key: "general_services",
  version: 1,
  displayName: "General Services",
  description: "A lightweight starter configuration for general service businesses.",
  statuses: [
    { entityType: "LEAD", key: "follow_up", label: "Follow-up" },
    { entityType: "LEAD", key: "estimate_sent", label: "Estimate Sent" },
    { entityType: "LEAD", key: "negotiation", label: "Negotiation" },
    { entityType: "PROJECT", key: "scheduled", label: "Scheduled" },
    { entityType: "PROJECT", key: "waiting_on_client", label: "Waiting on Client" },
    { entityType: "PROJECT", key: "quality_check", label: "Quality Check" },
    { entityType: "CLIENT", key: "repeat_client", label: "Repeat Client" },
  ],
  fields: [
    { entityType: "LEAD", key: "service_requested", label: "Service Requested", fieldType: "TEXT", required: false },
    { entityType: "LEAD", key: "budget", label: "Budget", fieldType: "NUMBER", required: false },
    { entityType: "PROJECT", key: "service_type", label: "Service Type", fieldType: "TEXT", required: false },
    {
      entityType: "CLIENT",
      key: "preferred_contact_method",
      label: "Preferred Contact Method",
      fieldType: "SELECT",
      required: false,
      options: [
        { label: "Email", value: "email" },
        { label: "Phone", value: "phone" },
        { label: "Messaging", value: "messaging" },
      ],
    },
  ],
  tags: [{ name: "New Inquiry" }, { name: "Repeat Client" }, { name: "Priority" }, { name: "Referral" }],
};

/** The entire V1 catalog — exactly four presets, keyed by their own stable machine key. */
export const INDUSTRY_PRESET_CATALOG: Readonly<Record<IndustryPresetKey, IndustryPresetDefinition>> = {
  freelancer: FREELANCER,
  creative_agency: CREATIVE_AGENCY,
  marketing_agency: MARKETING_AGENCY,
  general_services: GENERAL_SERVICES,
};

export function isIndustryPresetKey(value: unknown): value is IndustryPresetKey {
  return typeof value === "string" && (INDUSTRY_PRESET_KEYS as readonly string[]).includes(value);
}

/** Resolves a preset from the code catalog — an unknown key returns null (never throws), so every caller can reject it safely (locked spec §Application-semantics: "unknown key -> reject safely"). */
export function getIndustryPreset(key: unknown): IndustryPresetDefinition | null {
  if (!isIndustryPresetKey(key)) return null;
  return INDUSTRY_PRESET_CATALOG[key];
}

export function listIndustryPresets(): readonly IndustryPresetDefinition[] {
  return INDUSTRY_PRESET_KEYS.map((key) => INDUSTRY_PRESET_CATALOG[key]);
}

/** "6 statuses · 6 fields · 4 tags" — the concise summary the main Settings page's own cards render (locked spec §6), never a full content dump. */
export function summarizeIndustryPreset(preset: IndustryPresetDefinition): {
  statusCount: number;
  fieldCount: number;
  tagCount: number;
} {
  return {
    statusCount: preset.statuses.length,
    fieldCount: preset.fields.length,
    tagCount: preset.tags.length,
  };
}
