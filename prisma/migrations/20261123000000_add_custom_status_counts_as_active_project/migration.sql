-- Aqenra Free plan — custom Project status classification.
--
-- Adds the one explicit classification every Project CustomStatusDefinition
-- row carries: does a project in this status count toward the Free plan's
-- 5-active-project limit? See CustomStatusDefinition.countsAsActiveProject's
-- own schema comment for the full "why".
--
-- Backward compatibility during a rolling deployment: this column is
-- nullable with no default, so OLD application code (which has never heard
-- of it) continues to SELECT/INSERT exactly as before — Prisma only ever
-- reads/writes columns its own generated client knows about, so an old
-- instance simply never sees this column exist. This migration must still
-- be applied BEFORE the new application code is deployed (standard
-- additive-migration-then-deploy ordering for this repo) — the new code's
-- own Prisma client selects this column on every Project status read, and
-- would fail with a P2022 (column not found) against an un-migrated
-- database. There is no cron/background job involved here that would need
-- its own fail-open handling for a narrower migration-ordering gap (unlike
-- the earlier, now-rejected session-limit work) — this column is read
-- synchronously on nearly every page that touches Projects, so the correct
-- and sufficient safeguard is strict migrate-before-deploy ordering, not a
-- defensive runtime fallback.
--
-- Backfill (safe default for every row that already exists):
--   - System PLANNING/IN_PROGRESS/ON_HOLD -> true (counts as active) —
--     exactly what the Free plan's own already-shipped rule already
--     enforced for these three statuses.
--   - System COMPLETED/CANCELLED -> false (does not count) — likewise
--     already the shipped rule.
--   - Every pre-existing CUSTOM Project status (any organization, any
--     label) -> true. This is the exact same anti-bypass default the
--     Free-plan branch's own resolveProjectCountsTowardActiveLimit already
--     applied before this column existed (a custom status could not be
--     used to dodge the active-project limit). It changes nothing about
--     current behavior for any organization: no existing organization is
--     on the FREE plan (nothing auto-converts an existing organization),
--     so this column has no observable effect for them today. An owner or
--     staff member can reclassify any existing custom status explicitly
--     through Settings -> Custom statuses once this ships.
--   - CLIENT/LEAD definitions (system or custom) are left NULL — the
--     column is not applicable to them at all.
ALTER TABLE "CustomStatusDefinition" ADD COLUMN     "countsAsActiveProject" BOOLEAN;

UPDATE "CustomStatusDefinition"
SET "countsAsActiveProject" = true
WHERE "entityType" = 'PROJECT' AND "isSystem" = true AND "key" IN ('planning', 'in_progress', 'on_hold');

UPDATE "CustomStatusDefinition"
SET "countsAsActiveProject" = false
WHERE "entityType" = 'PROJECT' AND "isSystem" = true AND "key" IN ('completed', 'cancelled');

UPDATE "CustomStatusDefinition"
SET "countsAsActiveProject" = true
WHERE "entityType" = 'PROJECT' AND "isSystem" = false;
