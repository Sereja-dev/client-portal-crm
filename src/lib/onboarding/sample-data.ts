import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Demo Vs Real Workspace Separation — "Start with sample data" (read-only
 * audit §10/§11, this implementation's §5-§8). The pure data-shape half of
 * that action: what counts as "not empty" (countExistingBusinessData/
 * isWorkspaceEmpty) and exactly what the bounded sample dataset contains
 * (createSampleWorkspaceData). The actual "use server" mutation entry point
 * — auth, the atomic isDemo claim, the emptiness guard, and the
 * transaction that ties them together — lives in
 * src/app/(dashboard)/actions.ts (startWithSampleDataAction), not here;
 * this module performs no guard of its own and is never safe to call
 * unguarded (see createSampleWorkspaceData's own doc comment).
 *
 * Same shape as every other domain module's own PrismaClientOrTx (see
 * src/lib/tags/types.ts and its many siblings) — every function here
 * accepts either the top-level singleton or an already-open transaction,
 * defined independently here (not imported) to keep this module decoupled
 * from an unrelated domain's own internals.
 */
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export type SampleDataEntityCounts = {
  clients: number;
  projects: number;
  tasks: number;
  invoices: number;
};

/**
 * The exact four entity types the read-only audit's own §6/§10 named as
 * "existing real business data" a non-empty workspace must be judged by —
 * precisely the four the sample dataset below creates, never a broader
 * or narrower set. Always scoped by organizationId; never any other
 * predicate.
 */
export async function countExistingBusinessData(
  client: PrismaClientOrTx,
  organizationId: string,
): Promise<SampleDataEntityCounts> {
  const [clients, projects, tasks, invoices] = await Promise.all([
    client.client.count({ where: { organizationId } }),
    client.project.count({ where: { organizationId } }),
    client.task.count({ where: { organizationId } }),
    client.invoice.count({ where: { organizationId } }),
  ]);
  return { clients, projects, tasks, invoices };
}

export function isWorkspaceEmpty(counts: SampleDataEntityCounts): boolean {
  return counts.clients === 0 && counts.projects === 0 && counts.tasks === 0 && counts.invoices === 0;
}

/**
 * UI-visibility helper only — reused by the Dashboard page (server-side)
 * to decide whether to render the "Start with sample data" prompt at all.
 * Deliberately the exact same emptiness definition the mutating action
 * itself enforces (countExistingBusinessData/isWorkspaceEmpty above), so
 * the prompt's visibility can never drift from what the action would
 * actually allow — but this function is NOT itself a security boundary:
 * the action re-derives and re-checks everything server-side, inside its
 * own transaction, regardless of what this returned a moment earlier.
 */
export async function isEligibleForSampleData(organizationId: string): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { isDemo: true },
  });
  if (!organization || organization.isDemo) {
    return false;
  }
  const counts = await countExistingBusinessData(prisma, organizationId);
  return isWorkspaceEmpty(counts);
}

function daysFromNow(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Creates the small, bounded, professional sample dataset described in the
 * read-only audit's §7/this implementation's §7: two Clients, one Project,
 * three Tasks, one Invoice — the minimum set that renders coherently
 * together (a Project needs a Client, an Invoice needs a Client and can
 * reference the Project, Tasks need the Project) with nothing left
 * dangling. Every email uses the `.example`/`example.com` domain (IANA-
 * reserved for documentation, RFC 2606 — guaranteed never a real,
 * resolvable, deliverable address), and no Task carries a past due date —
 * deliberately never the messy, chaotic, or overdue-looking content the
 * read-only audit's own §7 found in the wild (`qweqweqwe`, `nose`, random
 * overdue noise) and explicitly asked this dataset to avoid.
 *
 * Writes DIRECT Prisma rows — never a Server Action, never
 * createActivity()/dispatchNotificationsForActivity() — mirroring
 * prisma/seed-collaboration.ts's own established "skip the Server Action,
 * write the row" precedent for sample/demo content exactly (see that
 * file's own doc comment), and satisfying check-onboarding-security.mjs's
 * existing invariant that nothing under src/lib/onboarding ever imports
 * createActivity or writes a Notification row.
 *
 * Performs NO guard of its own (no emptiness check, no isDemo check) — it
 * is only ever safe to call from inside startWithSampleDataAction's own
 * transaction, immediately after that action has already atomically
 * claimed Organization.isDemo and re-verified the workspace is still
 * genuinely empty in the same transaction. Calling this any other way is a
 * bug, not a supported use.
 */
export async function createSampleWorkspaceData(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; ownerId: string; now?: Date },
): Promise<void> {
  const { organizationId, ownerId } = params;
  const now = params.now ?? new Date();

  const primaryClient = await tx.client.create({
    data: {
      organizationId,
      userId: ownerId,
      name: "Harborview Design Co.",
      company: "Harborview Design Co.",
      email: "hello@harborviewdesign.example",
      status: "ACTIVE",
      notes: "Sample client — feel free to edit or delete.",
    },
  });

  await tx.client.create({
    data: {
      organizationId,
      userId: ownerId,
      name: "Fernwood Consulting",
      company: "Fernwood Consulting",
      email: "contact@fernwoodconsulting.example",
      status: "LEAD",
      notes: "Sample client — feel free to edit or delete.",
    },
  });

  const project = await tx.project.create({
    data: {
      organizationId,
      clientId: primaryClient.id,
      ownerId,
      name: "Brand Refresh",
      description: "A sample project showing how clients, projects, tasks, and invoices connect.",
      status: "IN_PROGRESS",
      startDate: daysFromNow(now, -14),
    },
  });

  await tx.task.createMany({
    data: [
      {
        organizationId,
        projectId: project.id,
        assigneeId: ownerId,
        title: "Draft new visual identity",
        status: "DONE",
        priority: "MEDIUM",
        dueDate: daysFromNow(now, -3),
        completedAt: daysFromNow(now, -2),
      },
      {
        organizationId,
        projectId: project.id,
        assigneeId: ownerId,
        title: "Share moodboard with client",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        dueDate: daysFromNow(now, 4),
      },
      {
        organizationId,
        projectId: project.id,
        assigneeId: ownerId,
        title: "Prepare final brand guidelines",
        status: "TODO",
        priority: "LOW",
        dueDate: daysFromNow(now, 12),
      },
    ],
  });

  await tx.invoice.create({
    data: {
      organizationId,
      clientId: primaryClient.id,
      projectId: project.id,
      invoiceNumber: "SAMPLE-0001",
      status: "SENT",
      amount: "2400.00",
      subtotal: "2400.00",
      currency: "USD",
      issueDate: daysFromNow(now, -2),
      dueDate: daysFromNow(now, 28),
      notes: "Sample invoice — feel free to edit or delete.",
    },
  });
}
