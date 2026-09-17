import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { CustomFieldEntityType, CustomStatusEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { normalizeTagName } from "@/lib/tags/normalize";
import {
  getIndustryPreset,
  type IndustryPresetKey,
  type PresetFieldSeed,
  type PresetStatusSeed,
  type PresetTagSeed,
} from "./catalog";
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
 * PRODUCTION TRANSACTION LATENCY FIX (post-launch correction): the
 * original version of this module issued one small, sequential Prisma
 * round trip per catalog item (2 findFirst + 1 create per status, 2
 * findFirst + 1 create + N option creates per field, 1 findFirst + 1
 * create per tag) -- up to ~61 sequential round trips for the largest
 * V1 preset (marketing_agency: 8 statuses + 6 fields incl. one 6-option
 * SELECT + 6 tags). Against local PGlite (in-process, near-zero
 * latency) this was invisible; against a real, networked Postgres
 * instance in Production, cumulative round-trip latency exceeded
 * Prisma's default 5000ms interactive-transaction timeout partway
 * through, throwing P2028 ("query cannot be executed on an expired
 * transaction") and rolling back the whole apply. The fix below keeps
 * the exact same one-atomic-transaction design and the exact same
 * conflict/ordering/side-effect semantics, but replaces the per-item
 * read pattern with a small, fixed number of BATCHED reads (one
 * conflict findMany + one position groupBy per entity kind, regardless
 * of how many catalog items that kind has) and batched writes
 * (createMany/createManyAndReturn), reducing the same marketing_agency
 * worst case to ~10 total operations. See this module's own README-style
 * count in the PR/report that shipped this fix for the full before/after
 * breakdown; test/integration/industry-presets/apply.test.ts's own
 * query-volume regression guard enforces a small fixed upper bound going
 * forward so this can't silently regress back to N+1.
 *
 * WHY THIS MODULE DOES NOT REUSE createCustomStatusDefinition/
 * createCustomFieldDefinition/createCustomFieldOption/createTag (locked
 * spec §23): all four always derive-or-suffix their own key/value on a
 * collision, or (createTag) perform their own per-call existence
 * pre-check -- exactly the near-duplicate-creation and redundant-N+1-read
 * behavior a batched preset apply must avoid. This module computes every
 * conflict decision itself, in bulk, from batched reads, and writes only
 * the items classified ADD -- using the SAME canonical rules those
 * helpers embody (exact stable key, no suffixing; canonical tag name
 * normalization via normalizeTagName) without duplicating or diverging
 * from them.
 *
 * CONCURRENCY (locked spec, concurrency-blocker fix revision) — the
 * actual, final, database-enforced invariant is
 * `PresetApplication.organizationId @unique` (prisma/schema.prisma), NOT
 * a composite `(organizationId, presetKey)` unique: a composite unique
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
 * propagate as a genuine, unexpected error (never swallowed) -- this
 * includes a genuine Tag-uniqueness race against a concurrent, unrelated
 * interactive Tag creation (Tags are not gated by the PresetApplication
 * singleton the way Custom Status/Field rows effectively are within one
 * apply), which surfaces as an ordinary unexpected-failure rollback, not
 * a swallowed or misclassified result.
 *
 * This still uses this repo's own established default transaction
 * behavior (Postgres READ COMMITTED, no Serializable precedent anywhere
 * in this repo) -- the single-column unique index (checked by Postgres
 * on every INSERT, not merely read-then-decided by application code) is
 * what makes READ COMMITTED sufficient here: correctness never depends
 * on a SELECT that a concurrent writer could race past. The explicit
 * `maxWait`/`timeout` below (locked spec §13) is bounded defense-in-depth
 * for a small, fixed-size catalog operation against a real remote
 * Postgres -- batching is the primary fix; the higher ceiling is
 * insurance against an unusually slow moment, never permission for
 * unbounded work inside the transaction.
 */

/** Bounded defense-in-depth only (locked spec §13) -- batching the query pattern below is the actual fix for the Production timeout. Never raise this to accommodate more work; if 15s genuinely isn't enough, the query pattern itself needs another pass, not a bigger number. */
const INDUSTRY_PRESET_TRANSACTION_MAX_WAIT_MS = 5_000;
const INDUSTRY_PRESET_TRANSACTION_TIMEOUT_MS = 15_000;

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

const statusConflictKey = (entityType: CustomStatusEntityType, key: string) => `${entityType}:${key}`;
const fieldConflictKey = (entityType: CustomFieldEntityType, key: string) => `${entityType}:${key}`;

/**
 * Classifies every catalog status into ADD/SKIP with exactly TWO reads
 * total, regardless of how many statuses the preset has: one batched
 * conflict findMany (any existing row, any archived state, counts --
 * locked spec §4/§7), and one batched position groupBy covering every
 * distinct entityType that has at least one ADD candidate (locked spec
 * §5). Positions are then assigned in memory, in catalog order, only to
 * ADD items -- a SKIP never consumes a position slot. Writes only the
 * ADD rows, in one createMany (locked spec §6).
 */
async function applyPresetStatuses(
  tx: Prisma.TransactionClient,
  organizationId: string,
  statuses: readonly PresetStatusSeed[],
): Promise<{ added: PresetApplyStatusOutcome[]; skipped: PresetApplyStatusOutcome[] }> {
  if (statuses.length === 0) {
    return { added: [], skipped: [] };
  }

  const existingRows = await tx.customStatusDefinition.findMany({
    where: {
      organizationId,
      OR: statuses.map((s) => ({ entityType: s.entityType, key: s.key })),
    },
    select: { entityType: true, key: true },
  });
  const conflicts = new Set(existingRows.map((r) => statusConflictKey(r.entityType, r.key)));

  const addSeeds = statuses.filter((s) => !conflicts.has(statusConflictKey(s.entityType, s.key)));
  const skipSeeds = statuses.filter((s) => conflicts.has(statusConflictKey(s.entityType, s.key)));

  const nextPositionByEntityType = new Map<CustomStatusEntityType, number>();
  if (addSeeds.length > 0) {
    const entityTypes = [...new Set(addSeeds.map((s) => s.entityType))];
    const positionGroups = await tx.customStatusDefinition.groupBy({
      by: ["entityType"],
      where: { organizationId, entityType: { in: entityTypes } },
      _max: { position: true },
    });
    for (const entityType of entityTypes) nextPositionByEntityType.set(entityType, -1);
    for (const group of positionGroups) nextPositionByEntityType.set(group.entityType, group._max.position ?? -1);
  }

  const createData = addSeeds.map((seed) => {
    const position = (nextPositionByEntityType.get(seed.entityType) ?? -1) + 1;
    nextPositionByEntityType.set(seed.entityType, position);
    return {
      organizationId,
      entityType: seed.entityType,
      key: seed.key,
      label: seed.label,
      color: null,
      position,
      isDefault: false,
      isSystem: false,
    };
  });

  if (createData.length > 0) {
    await tx.customStatusDefinition.createMany({ data: createData });
  }

  const toOutcome = (seed: PresetStatusSeed): PresetApplyStatusOutcome => ({
    entityType: seed.entityType,
    key: seed.key,
    label: seed.label,
  });
  return { added: addSeeds.map(toOutcome), skipped: skipSeeds.map(toOutcome) };
}

/**
 * Same batching strategy as applyPresetStatuses, for Custom Fields
 * (locked spec §7/§8): one conflict findMany, one position groupBy over
 * only the ADD entity types, one createManyAndReturn for the ADD field
 * rows themselves (returning each new row's own id, needed to attach
 * SELECT options), and -- only for the one field that is both ADD and
 * SELECT -- one createMany for its options in exact catalog order
 * (locked spec §9). A SKIPped field is never touched, so its
 * pre-existing options (if any) are never read or written.
 */
async function applyPresetFields(
  tx: Prisma.TransactionClient,
  organizationId: string,
  fields: readonly PresetFieldSeed[],
): Promise<{ added: PresetApplyFieldOutcome[]; skipped: PresetApplyFieldOutcome[] }> {
  if (fields.length === 0) {
    return { added: [], skipped: [] };
  }

  const existingRows = await tx.customFieldDefinition.findMany({
    where: {
      organizationId,
      OR: fields.map((f) => ({ entityType: f.entityType, key: f.key })),
    },
    select: { entityType: true, key: true },
  });
  const conflicts = new Set(existingRows.map((r) => fieldConflictKey(r.entityType, r.key)));

  const addSeeds = fields.filter((f) => !conflicts.has(fieldConflictKey(f.entityType, f.key)));
  const skipSeeds = fields.filter((f) => conflicts.has(fieldConflictKey(f.entityType, f.key)));

  const nextPositionByEntityType = new Map<CustomFieldEntityType, number>();
  if (addSeeds.length > 0) {
    const entityTypes = [...new Set(addSeeds.map((f) => f.entityType))];
    const positionGroups = await tx.customFieldDefinition.groupBy({
      by: ["entityType"],
      where: { organizationId, entityType: { in: entityTypes } },
      _max: { position: true },
    });
    for (const entityType of entityTypes) nextPositionByEntityType.set(entityType, -1);
    for (const group of positionGroups) nextPositionByEntityType.set(group.entityType, group._max.position ?? -1);
  }

  const createData = addSeeds.map((seed) => {
    const position = (nextPositionByEntityType.get(seed.entityType) ?? -1) + 1;
    nextPositionByEntityType.set(seed.entityType, position);
    return {
      organizationId,
      entityType: seed.entityType,
      key: seed.key,
      label: seed.label,
      fieldType: seed.fieldType,
      required: false as const,
      position,
    };
  });

  let optionCreateData: { definitionId: string; label: string; value: string; position: number }[] = [];
  if (createData.length > 0) {
    const createdRows = await tx.customFieldDefinition.createManyAndReturn({
      data: createData,
      select: { id: true, entityType: true, key: true },
    });
    optionCreateData = createdRows.flatMap((row) => {
      const seed = addSeeds.find((s) => s.entityType === row.entityType && s.key === row.key);
      if (!seed || seed.fieldType !== "SELECT" || !seed.options) return [];
      return seed.options.map((option, position) => ({
        definitionId: row.id,
        label: option.label,
        value: option.value,
        position,
      }));
    });
  }

  if (optionCreateData.length > 0) {
    await tx.customFieldOption.createMany({ data: optionCreateData });
  }

  const toOutcome = (seed: PresetFieldSeed): PresetApplyFieldOutcome => ({
    entityType: seed.entityType,
    key: seed.key,
    label: seed.label,
  });
  return { added: addSeeds.map(toOutcome), skipped: skipSeeds.map(toOutcome) };
}

/**
 * Same batching strategy for Tags (locked spec §10/§11): reuses the
 * canonical `normalizeTagName` (never a re-implemented normalization
 * rule), one conflict findMany keyed on normalizedName (any archived
 * state counts, never restored), and one createMany for the ADD tags.
 * Deliberately bypasses the public, interactive `createTag` helper --
 * not because its normalization/collision rules differ (they don't;
 * this function embodies the exact same rules), but because calling it
 * once per tag would repeat the very per-item existence read this
 * batching pass exists to eliminate, and its own per-call authorization
 * check is already redundant with `applyIndustryPreset`'s own
 * `assertCanApplyIndustryPreset` gate for the whole operation. A
 * genuine unique-violation race against a concurrent, unrelated
 * interactive Tag creation (Tags carry no PresetApplication-style
 * singleton gate of their own) is deliberately left uncaught here -- it
 * propagates as a real, unexpected transaction failure and full
 * rollback, exactly like any other genuinely unexpected error in this
 * transaction, never silently swallowed or misclassified as an expected
 * preset conflict.
 */
async function applyPresetTags(
  tx: Prisma.TransactionClient,
  organizationId: string,
  tags: readonly PresetTagSeed[],
): Promise<{ added: PresetApplyTagOutcome[]; skipped: PresetApplyTagOutcome[] }> {
  if (tags.length === 0) {
    return { added: [], skipped: [] };
  }

  const normalized = tags.map((seed) => {
    const parsed = normalizeTagName(seed.name);
    return parsed.ok
      ? { seed, name: parsed.value.name, normalizedName: parsed.value.normalizedName }
      : { seed, name: seed.name.trim(), normalizedName: seed.name.trim().toLowerCase() };
  });

  const existingRows = await tx.tag.findMany({
    where: { organizationId, normalizedName: { in: normalized.map((n) => n.normalizedName) } },
    select: { normalizedName: true },
  });
  const conflicts = new Set(existingRows.map((r) => r.normalizedName));

  const addEntries = normalized.filter((n) => !conflicts.has(n.normalizedName));
  const skipEntries = normalized.filter((n) => conflicts.has(n.normalizedName));

  if (addEntries.length > 0) {
    await tx.tag.createMany({
      data: addEntries.map((entry) => ({
        organizationId,
        name: entry.name,
        normalizedName: entry.normalizedName,
        color: null,
      })),
    });
  }

  return {
    added: addEntries.map((entry) => ({ name: entry.seed.name })),
    skipped: skipEntries.map((entry) => ({ name: entry.seed.name })),
  };
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

    const statusResult = await applyPresetStatuses(tx, organizationId, preset.statuses);
    const fieldResult = await applyPresetFields(tx, organizationId, preset.fields);
    const tagResult = await applyPresetTags(tx, organizationId, preset.tags);

    return {
      ok: true,
      alreadyApplied: false,
      summary: {
        presetKey: preset.key,
        presetVersion: preset.version,
        appliedAt: presetApplication.createdAt,
        addedStatuses: statusResult.added,
        skippedStatuses: statusResult.skipped,
        addedFields: fieldResult.added,
        skippedFields: fieldResult.skipped,
        addedTags: tagResult.added,
        skippedTags: tagResult.skipped,
      },
    };
  };

  try {
    return client === prisma
      ? await prisma.$transaction((tx) => runApply(tx), {
          maxWait: INDUSTRY_PRESET_TRANSACTION_MAX_WAIT_MS,
          timeout: INDUSTRY_PRESET_TRANSACTION_TIMEOUT_MS,
        })
      : await runApply(client as Prisma.TransactionClient);
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
