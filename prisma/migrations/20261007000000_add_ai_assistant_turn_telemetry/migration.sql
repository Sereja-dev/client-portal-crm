-- AI Production Monitoring V1 (bounded orchestration-turn telemetry
-- only -- see docs/production-observability-runbook.md's own AI
-- Monitoring V1 section, and prisma/schema.prisma's own doc comment on
-- AiAssistantTurnTelemetry for the full design). Purely additive: one
-- new enum (AiAssistantTurnOutcome) and one new table
-- (AiAssistantTurnTelemetry), no existing table/column/constraint is
-- touched, no backfill required (there is no pre-existing data for this
-- brand-new table).
--
-- Hand-authored (this environment's `prisma migrate dev`/`migrate diff`
-- cannot compute a diff here -- its shadow-database step fails against
-- the single-instance local PGlite Postgres this sandbox uses in place
-- of Docker/system Postgres, see test/support/local-postgres.ts's own
-- doc comment and 20261006000000_add_integrations_foundation/
-- migration.sql's own identical note), closely following the exact
-- CREATE TYPE / CREATE TABLE / CREATE INDEX shape Prisma itself
-- generates for a structurally identical enum-plus-table addition
-- (compare 20261002090000_add_import_job_foundation/migration.sql's own
-- ImportJob table for the same enum-column + plain-columns + single
-- index shape).
--
-- Deliberately no foreign key anywhere in this table: AiAssistantTurnTelemetry
-- has no organizationId/userId column at all (see the model's own
-- schema.prisma doc comment for why), so there is nothing here for a
-- ON DELETE CASCADE/SET NULL clause to ever reference.

-- CreateEnum
CREATE TYPE "AiAssistantTurnOutcome" AS ENUM ('SUCCESS', 'LIMIT_EXCEEDED', 'TIMEOUT', 'PROVIDER_ERROR', 'INVALID_RESPONSE', 'EMPTY_ANSWER', 'REF_LEAK');

-- CreateTable
CREATE TABLE "AiAssistantTurnTelemetry" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "outcome" "AiAssistantTurnOutcome" NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "providerCalls" INTEGER NOT NULL,
    "toolCalls" INTEGER NOT NULL,
    "toolNames" JSONB NOT NULL DEFAULT '[]',
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "AiAssistantTurnTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAssistantTurnTelemetry_createdAt_idx" ON "AiAssistantTurnTelemetry"("createdAt");
