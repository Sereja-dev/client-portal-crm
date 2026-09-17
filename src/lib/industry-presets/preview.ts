import "server-only";
import type { CustomFieldEntityType, CustomFieldType, CustomStatusEntityType, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { normalizeTagName } from "@/lib/tags/normalize";
import { getIndustryPreset, type IndustryPresetKey } from "./catalog";
import { canApplyIndustryPreset } from "./authorization";
import type { PrismaClientOrTx } from "./types";

/**
 * Industry Presets V1 — server-derived preview (locked spec §8). Reads
 * this organization's ACTUAL current Custom Status/Custom Field/Tag data
 * to compute a truthful ADD/SKIP decision per item — never trusts a
 * client-generated conflict list, and performs NO writes. Uses the exact
 * same conflict rule apply.ts's own transaction re-checks at write time
 * (locked spec §10: "conflict reads for final authoritative decision" —
 * this function and apply.ts's internal re-check are two independent
 * reads of the identical rule, not one shared cached result, so a race
 * between preview and apply can never leave a stale preview believed
 * true).
 */

export type PresetItemDecision = "ADD" | "SKIP";

export type PresetStatusPreviewItem = {
  entityType: CustomStatusEntityType;
  key: string;
  label: string;
  decision: PresetItemDecision;
};

export type PresetFieldPreviewItem = {
  entityType: CustomFieldEntityType;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  decision: PresetItemDecision;
};

export type PresetTagPreviewItem = {
  name: string;
  decision: PresetItemDecision;
};

export type IndustryPresetPreview = {
  key: IndustryPresetKey;
  version: number;
  displayName: string;
  description: string;
  statuses: readonly PresetStatusPreviewItem[];
  fields: readonly PresetFieldPreviewItem[];
  tags: readonly PresetTagPreviewItem[];
  /** True once this exact preset already has a PresetApplication row for this organization. */
  alreadyApplied: boolean;
  /** When this exact preset was applied, if it was — for the "Applied on <date>" copy (locked spec §6). Null unless `alreadyApplied` is true. */
  appliedAt: Date | null;
  /** When set, this organization already applied a DIFFERENT preset — V1 supports one preset application only, no automatic switching (locked spec §5/§9). */
  existingAppliedPreset: { key: IndustryPresetKey; displayName: string } | null;
  /** Whether Apply should be offered at all -- role-gated AND state-gated (already applied this preset, or a different one already applied, both make Apply unavailable regardless of role). */
  canApply: boolean;
};

export type PreviewIndustryPresetResult = { ok: true; preview: IndustryPresetPreview } | { ok: false; reason: "UNKNOWN_PRESET" };

export async function previewIndustryPreset(
  organizationId: string,
  presetKey: unknown,
  actorRole: Role,
  client: PrismaClientOrTx = prisma,
): Promise<PreviewIndustryPresetResult> {
  const preset = getIndustryPreset(presetKey);
  if (!preset) {
    return { ok: false, reason: "UNKNOWN_PRESET" };
  }

  // At most one PresetApplication can ever exist per organization
  // (organizationId is @unique -- see that model's own schema doc
  // comment and apply.ts's identical comment for the concurrency-fix
  // rationale), so a plain findUnique replaces the old findMany +
  // "which one matches" scan.
  const existingApplication = await client.presetApplication.findUnique({
    where: { organizationId },
    select: { presetKey: true, createdAt: true },
  });
  const alreadyApplied = existingApplication?.presetKey === preset.key;
  const existingAppliedPreset =
    existingApplication && existingApplication.presetKey !== preset.key
      ? (() => {
          const other = getIndustryPreset(existingApplication.presetKey);
          return other ? { key: other.key, displayName: other.displayName } : null;
        })()
      : null;

  const statuses: PresetStatusPreviewItem[] = await Promise.all(
    preset.statuses.map(async (seed) => {
      const conflict = await client.customStatusDefinition.findFirst({
        where: { organizationId, entityType: seed.entityType, key: seed.key },
        select: { id: true },
      });
      return { entityType: seed.entityType, key: seed.key, label: seed.label, decision: conflict ? "SKIP" : "ADD" };
    }),
  );

  const fields: PresetFieldPreviewItem[] = await Promise.all(
    preset.fields.map(async (seed) => {
      const conflict = await client.customFieldDefinition.findFirst({
        where: { organizationId, entityType: seed.entityType, key: seed.key },
        select: { id: true },
      });
      return {
        entityType: seed.entityType,
        key: seed.key,
        label: seed.label,
        fieldType: seed.fieldType,
        decision: conflict ? "SKIP" : "ADD",
      };
    }),
  );

  const tags: PresetTagPreviewItem[] = await Promise.all(
    preset.tags.map(async (seed) => {
      const parsed = normalizeTagName(seed.name);
      const normalizedName = parsed.ok ? parsed.value.normalizedName : seed.name.trim().toLowerCase();
      const conflict = await client.tag.findFirst({
        where: { organizationId, normalizedName },
        select: { id: true },
      });
      return { name: seed.name, decision: conflict ? "SKIP" : "ADD" };
    }),
  );

  const canApply = canApplyIndustryPreset(actorRole) && !alreadyApplied && !existingAppliedPreset;

  return {
    ok: true,
    preview: {
      key: preset.key,
      version: preset.version,
      displayName: preset.displayName,
      description: preset.description,
      statuses,
      fields,
      tags,
      alreadyApplied,
      appliedAt: alreadyApplied ? existingApplication?.createdAt ?? null : null,
      existingAppliedPreset,
      canApply,
    },
  };
}
