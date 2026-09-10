import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";
import { CustomStatusEntityType } from "@/generated/prisma/enums";
import type { CustomStatusEntityType as CustomStatusEntityTypeValue } from "@/generated/prisma/enums";

/**
 * Custom Statuses Phase 2B (Staff UI, Section C) — which entity type's
 * definitions the page currently shows, driven by `?entity=`. Byte-for-
 * byte mirror of settings/custom-fields/view-params.ts's own
 * parseCustomFieldEntityTypeParam: an invalid/missing value always falls
 * back safely (CLIENT, the first canonical entity) rather than throwing
 * — a pure UI-mode concern, never security-relevant (every domain-layer
 * call is independently organization-scoped regardless of which tab is
 * showing).
 */

export const CUSTOM_STATUS_ENTITY_TABS = Object.values(CustomStatusEntityType);

const DEFAULT_ENTITY_TYPE: CustomStatusEntityTypeValue = "CLIENT";

export function parseCustomStatusEntityTypeParam(searchParams: RawSearchParams): CustomStatusEntityTypeValue {
  return parseEnumParam(searchParams.entity, CUSTOM_STATUS_ENTITY_TABS) ?? DEFAULT_ENTITY_TYPE;
}

export const ENTITY_TYPE_LABELS: Record<CustomStatusEntityTypeValue, string> = {
  CLIENT: "Clients",
  LEAD: "Leads",
  PROJECT: "Projects",
};

/** Builds a /settings/custom-statuses?entity=... href. */
export function buildCustomStatusesHref(entityType: CustomStatusEntityTypeValue): string {
  return `/settings/custom-statuses?entity=${entityType}`;
}
