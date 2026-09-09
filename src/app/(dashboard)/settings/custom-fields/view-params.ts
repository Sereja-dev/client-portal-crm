import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";
import { CustomFieldEntityType } from "@/generated/prisma/enums";
import type { CustomFieldEntityType as CustomFieldEntityTypeValue } from "@/generated/prisma/enums";

/**
 * Custom Fields Phase 2A (Staff UI, Section C) — which entity type's
 * definitions the page currently shows, driven by `?entity=`. Mirrors
 * leads/view-params.ts's own parseLeadView exactly: an invalid/missing
 * value always falls back safely (CLIENT, the first canonical entity)
 * rather than throwing — this is a pure UI-mode concern, never
 * security-relevant (every domain-layer call is independently
 * organization-scoped regardless of which tab is showing).
 */

export const CUSTOM_FIELD_ENTITY_TABS = Object.values(CustomFieldEntityType);

const DEFAULT_ENTITY_TYPE: CustomFieldEntityTypeValue = "CLIENT";

export function parseCustomFieldEntityTypeParam(searchParams: RawSearchParams): CustomFieldEntityTypeValue {
  return parseEnumParam(searchParams.entity, CUSTOM_FIELD_ENTITY_TABS) ?? DEFAULT_ENTITY_TYPE;
}

export const ENTITY_TYPE_LABELS: Record<CustomFieldEntityTypeValue, string> = {
  CLIENT: "Clients",
  LEAD: "Leads",
  PROJECT: "Projects",
};

/** Builds a /settings/custom-fields?entity=... href. */
export function buildCustomFieldsHref(entityType: CustomFieldEntityTypeValue): string {
  return `/settings/custom-fields?entity=${entityType}`;
}
