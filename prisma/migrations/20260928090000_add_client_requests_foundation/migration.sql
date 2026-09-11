-- Client Requests / Tickets, Phase 1 (foundation).
--
-- Note: `prisma migrate dev --create-only`'s raw diff output also included
-- three unrelated DROP/ADD CONSTRAINT pairs for Client/Lead/Project's own
-- pre-existing statusDefinitionId foreign keys (the same pre-existing
-- drift already documented and stripped out of migration
-- 20260927090000_add_lead_capture_forms_foundation's own header comment —
-- between migration 20260926090000_add_custom_statuses_foundation, which
-- created them as `NO ACTION ... DEFERRABLE INITIALLY DEFERRED`, and this
-- schema's current `onDelete: Restrict` declaration, which normalizes to a
-- plain RESTRICT with no DEFERRABLE clause). Unrelated to this feature,
-- deliberately stripped out here again rather than silently re-included.

-- CreateEnum
CREATE TYPE "ClientRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClientRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ClientRequestMessageAuthorType" AS ENUM ('STAFF', 'PORTAL');

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE 'CLIENT_REQUEST';

-- CreateTable
CREATE TABLE "ClientRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "portalUserId" UUID,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ClientRequestStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ClientRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedToId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRequestMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "authorType" "ClientRequestMessageAuthorType" NOT NULL,
    "staffUserId" UUID,
    "portalUserId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientRequestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientRequest_organizationId_idx" ON "ClientRequest"("organizationId");

-- CreateIndex
CREATE INDEX "ClientRequest_organizationId_clientId_idx" ON "ClientRequest"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "ClientRequest_organizationId_status_idx" ON "ClientRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ClientRequest_assignedToId_idx" ON "ClientRequest"("assignedToId");

-- CreateIndex
CREATE INDEX "ClientRequest_createdAt_idx" ON "ClientRequest"("createdAt");

-- CreateIndex
CREATE INDEX "ClientRequestMessage_requestId_idx" ON "ClientRequestMessage"("requestId");

-- CreateIndex
CREATE INDEX "ClientRequestMessage_organizationId_idx" ON "ClientRequestMessage"("organizationId");

-- CreateIndex
CREATE INDEX "ClientRequestMessage_createdAt_idx" ON "ClientRequestMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequestMessage" ADD CONSTRAINT "ClientRequestMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequestMessage" ADD CONSTRAINT "ClientRequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequestMessage" ADD CONSTRAINT "ClientRequestMessage_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequestMessage" ADD CONSTRAINT "ClientRequestMessage_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
