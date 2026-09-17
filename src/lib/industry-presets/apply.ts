import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { CustomFieldEntityType, CustomStatusEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { createTag } from "@/lib/tags/definitions";
import { getIndustryPreset, type IndustryPresetKey, type PresetFieldSeed, type PresetStatusSeed } from "./catalog";
import { assertCanApplyIndustryPreset, IndustryPresetAccessError, type IndustryPresetActor } from "./authorization";
import type { PrismaClientOrTx } from "./types";

/**
 * Industry Presets V1 — the atomic apply transaction (locked spec §9/§10/
 * §11/§12/§13). ENTIRE application happens inside one database
 * transaction: the PresetApplication row itself (inserted FIRST -- see
 * below), the final authoritative conflict re-check for every item, and
 * every Custom Status/Custom Field/Option/Tag create. Any genuinely
 * unexpected failure rolls the whole thing back, including that first
 * row -- no partial installation, ever (never CSV-style partial
 * success). A normal, expected per-item conflict is a SKIP, not a
 * transaction failure.
 *
 * WHY THIS MODULE DOES NOT REUSE createCustomStatusDefinition/
 * createCustomFieldDefinition/createCustomFieldOption (locked spec §23):
 * all three always derive-or-suffix their own key/value on a collision
 * (deriveUniqueCustomStatusKey/deriveUniqueCustomFieldDefinitionKey/
 * deriveUniqueCustomFieldOptionValue) -- exactly the near-duplicate-
 * creation behavior a preset must never produce (locked spec §7: "Do NOT
 * call a helper that auto-suffixes on collision for preset application").
 * The two narrow primitives below (createPresetStatusIfAbsent/
 * createPresetFieldIfAbsent) instead check for the catalog's own EXACT,
 * stable key and either create with that literal key or skip --
 * mirroring those helpers' own position-append/isSystem/isDefault
 * conventions, never their suffixing behavior. Tags need no analogous
 * primitive: createTag's own existing collision behavior (pre-check
 * across ANY state including archived, return DUPLICATE_NAME, never
 * suffix) already matches presets' required semantics exactly, so it is
 * reused directly, unmodified.
 *
 * CONCURRENCY (locked spec, concurrency-blocker fix revision) — the
 * actual, final, database-enforced invariant is
 * `PresetApplication.organizationId @unique` (prisma/schema.prisma), NOT
 * the earlier `@@unique([organizationId, presetKey])` this model used
 * before this fix: a composite unique on (organizationId, presetKey)
 * only ever rejects a duplicate SAME-preset row -- it can never stop two
 * concurrent transactions from each successfully inserting a row for
 * the same organization with two DIFFERENT presetKey values, since
 * those two rows don't collide with each other at all. A plain unique
 * on `organizationId` alone closes that gap: at most one
 * PresetApplication row can ever exist for a given organization, full
 * stop, regardless of which preset it names.
 *
 * That row is therefore created FIRST inside this transaction, before
 * any Custom Status/Field/Tag read or write -- it IS the concurrency
 * gate, not an afterthought recorded once everything else has already
 * succeeded. Two concurrent `applyIndustryPreset` calls for the same
 * organization race on that one insert: exactly one can ever win it
 * (Postgres blocks the second INSERT until the first's transaction
 * resolves, then re-checks); the loser's transaction throws, is fully
 * rolled back by `prisma.$transaction` (including whatever it had
 * already written before hitting this insert -- nothing, since it's
 * first), and this module re-reads the now-committed winning row
 * OUTSIDE the failed transaction to classify the result truthfully
 * (`classifyExistingApplication` below) -- same preset as the loser
 * requested -> idempotent already-applied; a different preset -> the
 * normal PRESET_SWITCH_NOT_SUPPORTED result. Never inferred from the
 * raw P2002 alone. `isPresetApplicationOrganizationConflict` below
 * matches ONLY this exact unique index (a single "organizationId"
 * field) -- an unrelated P2002 from a Custom Status/Custom Field/Tag
 * table has a different field fingerprint and is deliberately left to
 * propagate as a genuine, unexpected error (never swallowed).
 *
 * This still uses this repo's own established default transaction
 * behavior (`prisma.$transaction` with no explicit isolation level --
 * Postgres READ COMMITTED), the same default every other aggregate
 * mutation in this codebase already uses (src/lib/custom-statuses/
 * definitions.ts, src/lib/custom-fields/definitions.ts, src/lib/tags/
 * definitions.ts) -- no Serializable-isolation precedent exists
 * anywhere in this repo, and this module does not introduce one
 * speculatively. The single-column unique index (checked by Postgres on
 * every INSERT, not merely read-then-decided by application code) is
 * what makes READ COMMITTED sufficient here: unlike the pre-fix design,
 * correctness no longer depends on a SELECT that a concurrent writer
 * could race past.
 */

export type PresetApplyStatusOutcome = { entityType: CustomStatusEntityType; key: string; label: string };
export type PresetApplyFieldOutcome = { entityType: CustomFieldEntityType; key: string; label: string };
export type PresetApplyTagOutcome = { name: string };

export type IndustryPresetApplySummary = {
  presetKey: IndustryPresetKey;
  presetVersion: number;
  appliedAt: Date;
  addedStatuses: readonly PresetApplyStatusOutcome[];
  skippedStatuses: readonly PresetApplyStatusOutcome[];
  addedFields: readonly PresetApplyFieldOutcome[];
  skippedFields: readonly PresetApplyFieldOutcome[];
  addedTags: readonly PresetApplyTagOutcome[];
  skippedTags: readonly PresetApplyTagOutcome[];
};

export type ApplyIndustryPresetResult =
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "UNKNOWN_PRESET" }
  | { ok: false; reason: "PRESET_SWITCH_NOT_SUPPORTED"; existingPresetKey: string }
  | { ok: true; alreadyApplied: true }
  | { ok: true; alreadyApplied: false; summary: IndustryPresetApplySummary };

/**
 * Creates a CUSTOM status definition for this EXACT catalog key, or
 * reports a skip if one already exists for this organization+entityType
 * (any state, including archived -- locked spec §7: "if exists -> SKIP
 * (includes archived)"). Never suffixes. `position` is current max + 1,
 * same convention as createCustomStatusDefinition's own.
 */
async function createPresetStatusIfAbsent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  seed: PresetStatusSeed,
): Promise<{ decision: "ADD" | "SKIP" }> {
  const existing = await tx.customStatusDefinition.findFirst({
    where: { organizationId, entityType: seed.entityType, key: seed.key },
    select: { id: true },
  });
  if (existing) {
    return { decision: "SKIP" };
  }

  const last = await tx.customStatusDefinition.findFirst({
    where: { organizationId, entityType: seed.entityType },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = (last?.position ?? -1) + 1;

  await tx.customStatusDefinition.create({
    data: {
      organizationId,
      entityType: seed.entityType,
      key: seed.key,
      label: seed.label,
      color: null,
      position,
      isDefault: false,
      isSystem: false,
    },
  });
  return { decision: "ADD" };
}

/**
 * Creates a custom field definition for this EXACT catalog key (skip on
 * any existing match, any state -- same rule as statuses), and, only
 * when the definition itself was newly created, its SELECT options in
 * catalog order with their own exact literal values. An already-existing
 * field is never touched, so its options (if any) are never appended to
 * either -- strictly additive, no partial modification of a pre-existing
 * definition (locked spec §7/§12).
 */
async function createPresetFieldIfAbsent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  seed: PresetFieldSeed,
): Promise<{ decision: "ADD" | "SKIP" }> {
  const existing = await tx.customFieldDefinition.findFirst({
    where: { organizationId, entityType: seed.entityType, key: seed.key },
    select: { id: true },
  });
  if (existing) {
    return { decision: "SKIP" };
  }

  const last = await tx.customFieldDefinition.findFirst({
    where: { organizationId, entityType: seed.entityType },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = (last?.position ?? -1) + 1;

  const definition = await tx.customFieldDefinition.create({
    data: {
      organizationId,
      entityType: seed.entityType,
      key: seed.key,
      label: seed.label,
      fieldType: seed.fieldType,
      required: false,
      position,
    },
  });

  if (seed.fieldType === "SELECT" && seed.options) {
    let optionPosition = 0;
    for (const option of seed.options) {
      await tx.customFieldOption.create({
        data: {
          definitionId: definition.id,
          label: option.label,
          value: option.value,
          position: optionPosition,
        },
      });
      optionPosition += 1;
    }
  }

  return { decision: "ADD" };
}

/**
 * Reads the just-lost-the-race organization's now-committed
 * PresetApplication row. In real Postgres, the winning transaction's
 * COMMIT is what makes our own INSERT fail with a unique violation in
 * the first place, so the row is unconditionally already visible to any
 * fresh read the instant that violation is raised -- no genuine race
 * window exists here. A short bounded retry is kept anyway, purely as
 * cheap defensive insurance against a transient read-visibility hiccup
 * (never a lock, never a delay-based guess at the "right" wait), and
 * throws the real underlying error if the row is still missing once the
 * retries are exhausted -- that would mean something genuinely wrong,
 * not an expected race, and must not be swallowed.
 */
async function findApplicationForOrganizationWithRetry(
  client: PrismaClientOrTx,
  organizationId: string,
  attempts = 5,
  delayMs = 20,
): Promise<{ presetKey: string }> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const found = await client.presetApplication.findUnique({
      where: { organizationId },
      select: { presetKey: true },
    });
    if (found) return found;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Exhausted every retry -- surface this as the real, unexpected
  // failure it now is (a genuinely missing row after a unique-violation
  // that can only happen because a winner committed it) rather than a
  // classified race outcome.
  return client.presetApplication.findUniqueOrThrow({
    where: { organizationId },
    select: { presetKey: true },
  });
}

type DriverAdapterMeta = {
  driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
};

/**
 * True ONLY for PresetApplication's own `organizationId` unique index --
 * the sole concurrency gate this module relies on. Same detection shape
 * every other domain module's own isKeyConflict/isNormalizedNameConflict
 * already establishes: an ordered array of quoted column names from
 * `meta.driverAdapterError.cause.constraint.fields` (this project's own
 * empirically-verified P2002 signal -- `error.meta.target` is never
 * populated on this Prisma/driver-adapter stack). Deliberately narrow
 * (exactly one field, exactly "organizationId") so an unrelated P2002 --
 * CustomStatusDefinition's own (organizationId, entityType, key),
 * CustomFieldDefinition's own equivalent, CustomFieldOption's own
 * (definitionId, value), or Tag's own (organizationId, normalizedName)
 * -- is never misclassified as this race and always propagates as a
 * genuine, unexpected error instead of being silently swallowed.
 */
function isPresetApplicationOrganizationConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const fields = (err.meta as DriverAdapterMeta | undefined)?.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(fields) && fields.length === 1 && fields[0] === '"organizationId"';
}

/** Same preset already applied -> idempotent; a different one -> no switching (locked spec §4/§9). Used both by the sequential pre-check (fast path, not the guarantee) and by the post-race reclassification after losing the concurrency gate (the actual guarantee). */
function classifyExistingApplication(
  existingPresetKey: string,
  requestedPresetKey: IndustryPresetKey,
): ApplyIndustryPresetResult {
  if (existingPresetKey === requestedPresetKey) {
    return { ok: true, alreadyApplied: true };
  }
  return { ok: false, reason: "PRESET_SWITCH_NOT_SUPPORTED", existingPresetKey };
}

/**
 * Applies a preset to `organizationId` on behalf of `actor` (locked spec
 * §9). `presetKey` is the only meaningful input -- organizationId/actor
 * are always caller-resolved server-side (see the Server Action layer),
 * never trusted from client input directly.
 */
export async function applyIndustryPreset(
  organizationId: string,
  actor: IndustryPresetActor,
  presetKey: unknown,
  client: PrismaClientOrTx = prisma,
): Promise<ApplyIndustryPresetResult> {
  // Authorization checked first, before any DB read -- mirrors
  // createTag/createWorkflowAutomation's own ordering (a MEMBER never
  // learns whether the submitted key is even a real preset).
  try {
    assertCanApplyIndustryPreset(actor.role);
  } catch (err) {
    if (err instanceof IndustryPresetAccessError) {
      return { ok: false, reason: "FORBIDDEN" };
    }
    throw err;
  }

  const preset = getIndustryPreset(presetKey);
  if (!preset) {
    return { ok: false, reason: "UNKNOWN_PRESET" };
  }

  // Sequential pre-check -- a fast, friendly result for the overwhelming
  // common case (no concurrent request racing this one), and the exact
  // same organizationId @unique lookup the post-race reclassification
  // below reuses. NEVER the concurrency guarantee itself (locked spec
  // §4): two calls can both pass this check before either commits
  // anything, which is exactly why the transaction below re-derives the
  // real answer from the first INSERT's own outcome, not from this read.
  const existing = await client.presetApplication.findUnique({
    where: { organizationId },
    select: { presetKey: true },
  });
  if (existing) {
    return classifyExistingApplication(existing.presetKey, preset.key);
  }

  const runApply = async (tx: Prisma.TransactionClient): Promise<ApplyIndustryPresetResult> => {
    // THE concurrency gate (locked spec §3/§16): attempted FIRST, before
    // any Custom Status/Field/Tag read or write. Either this transaction
    // now definitively owns the one-and-only PresetApplication row for
    // this organization, or it throws because a concurrent transaction's
    // own insert already committed -- handled in the outer catch below,
    // never here.
    const presetApplication = await tx.presetApplication.create({
      data: {
        organizationId,
        presetKey: preset.key,
        presetVersion: preset.version,
        appliedByUserId: actor.id,
      },
    });

    const addedStatuses: PresetApplyStatusOutcome[] = [];
    const skippedStatuses: PresetApplyStatusOutcome[] = [];
    for (const seed of preset.statuses) {
      const { decision } = await createPresetStatusIfAbsent(tx, organizationId, seed);
      const outcome: PresetApplyStatusOutcome = { entityType: seed.entityType, key: seed.key, label: seed.label };
      (decision === "ADD" ? addedStatuses : skippedStatuses).push(outcome);
    }

    const addedFields: PresetApplyFieldOutcome[] = [];
    const skippedFields: PresetApplyFieldOutcome[] = [];
    for (const seed of preset.fields) {
      const { decision } = await createPresetFieldIfAbsent(tx, organizationId, seed);
      const outcome: PresetApplyFieldOutcome = { entityType: seed.entityType, key: seed.key, label: seed.label };
      (decision === "ADD" ? addedFields : skippedFields).push(outcome);
    }

    const addedTags: PresetApplyTagOutcome[] = [];
    const skippedTags: PresetApplyTagOutcome[] = [];
    for (const seed of preset.tags) {
      const result = await createTag(organizationId, actor, { name: seed.name }, tx);
      (result.ok ? addedTags : skippedTags).push({ name: seed.name });
    }

    return {
      ok: true,
      alreadyApplied: false,
      summary: {
        presetKey: preset.key,
        presetVersion: preset.version,
        appliedAt: presetApplication.createdAt,
        addedStatuses,
        skippedStatuses,
        addedFields,
        skippedFields,
        addedTags,
        skippedTags,
      },
    };
  };

  try {
    return client === prisma ? await prisma.$transaction((tx) => runApply(tx)) : await runApply(client as Prisma.TransactionClient);
  } catch (err) {
    if (isPresetApplicationOrganizationConflict(err)) {
      // Lost the concurrency race: a concurrent transaction's own
      // PresetApplication insert committed first, and this transaction
      // (which had written nothing else yet -- the insert above is
      // always the first statement) has already been fully rolled back
      // by prisma.$transaction. Re-read the now-committed row OUTSIDE
      // the failed transaction and classify truthfully -- never inferred
      // from the P2002 alone (locked spec §5).
      const winner = await findApplicationForOrganizationWithRetry(client, organizationId);
      return classifyExistingApplication(winner.presetKey, preset.key);
    }
    throw err;
  }
}
