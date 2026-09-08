import { prisma } from "@/lib/prisma";
import type { ProjectStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { classifyInvoiceArchival } from "@/lib/invoices/pdf/classify-archival";

// Same definition the staff Dashboard KPI already uses for "active
// projects" (src/app/(dashboard)/dashboard/query.ts) — kept identical so
// the word means the same thing in both places.
const ACTIVE_PROJECT_STATUS: ProjectStatus = "IN_PROGRESS";

// Invoice System Official Slice 5 (docs/invoicing-architecture.md §10) —
// the one authoritative Portal-visible status set. DRAFT is never
// visible to a portal identity on any surface: not the list ("all" or
// "open"), not the detail page, not the overview's recent-invoices or
// open-aggregate. A DRAFT invoice belongs to the still-in-progress
// pre-Issue workflow, which is never shown to a client.
// Exported — this is now the one authoritative Portal-visible status set,
// also reused by verifyPortalAttachmentAccess() in ./attachments (Client
// Portal Audit Finding 1) so an INVOICE-scoped attachment can never be
// reachable for an Invoice status this module itself would never show.
// There is no import in the other direction (this file has no dependency
// on ./attachments, directly or transitively), so this reuse creates no
// circular dependency.
export const VISIBLE_PORTAL_STATUSES: readonly InvoiceStatus[] = ["SENT", "OVERDUE", "PAID", "CANCELLED"];

// PAID and CANCELLED are deliberately excluded from "open" — an invoice
// the client no longer owes money on, or one that was called off, isn't
// outstanding work. DRAFT is excluded too — see VISIBLE_PORTAL_STATUSES
// above; "open" is always a subset of "visible," never a separate escape
// hatch that could re-admit DRAFT.
const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = ["SENT", "OVERDUE"];

export const PORTAL_INVOICE_FILTERS = ["all", "open", "paid"] as const;
export type PortalInvoiceFilter = (typeof PORTAL_INVOICE_FILTERS)[number];

/** Invalid/missing filter values always fall back to "all", never an error. */
export function parsePortalInvoiceFilter(raw: string | undefined): PortalInvoiceFilter {
  return (PORTAL_INVOICE_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as PortalInvoiceFilter)
    : "all";
}

export type PortalProjectSummary = {
  id: string;
  name: string;
  status: ProjectStatus;
  startDate: Date | null;
  endDate: Date | null;
};

export type PortalProjectDetail = PortalProjectSummary & {
  /** Project.description — a client-facing work summary (see seed.ts's own
   * usage, e.g. "Full redesign of the marketing site and blog."), never
   * Project.budget or any staff-internal field. */
  description: string | null;
  clientName: string;
  /**
   * Project.organizationId — kept on this internal, already-scoped detail
   * model purely so the caller can pass it straight into the attachment
   * query (see client-portal/attachments.ts) without a second Prisma round
   * trip. Never render this field in any portal page's JSX.
   */
  organizationId: string | null;
};

export type PortalInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  /** Null for a project-less Invoice (Quotes / Estimates Phase 2.3) — every portal page renders "No project" (or omits the row) rather than assuming a value. */
  projectName: string | null;
  issueDate: Date;
  dueDate: Date | null;
  amount: number;
  currency: string;
  status: InvoiceStatus;
};

export type PortalInvoiceDetail = PortalInvoiceSummary & {
  paidAt: Date | null;
  clientName: string;
  /**
   * Invoice.organizationId directly (Quotes / Estimates Phase 2.3 —
   * never derived from Project, which may not exist at all for a
   * project-less Invoice; see client-portal/attachments.ts's own doc
   * comment on why this must be the Invoice's own column, not the
   * Project's). Kept on this internal, already-scoped detail model so
   * the caller can pass it straight into the attachment query. Never
   * render this field in any portal page's JSX.
   */
  organizationId: string;
  /**
   * Invoice System Official Slice 3, Portal Invoice PDF access —
   * classifyInvoiceArchival()'s own "archived" outcome, computed here from
   * fields never exposed on this type. The page renders a Download PDF
   * link only when this is true; pdfStoragePath/documentVersion/
   * issuerSnapshot/recipientSnapshot/any ledger data are never added to
   * this type and never cross into any portal page's JSX.
   */
  hasArchivedPdf: boolean;
};

export type PortalOverview = {
  activeProjectsCount: number;
  openInvoicesCount: number;
  outstandingAmount: number;
  recentProjects: PortalProjectSummary[];
  recentInvoices: PortalInvoiceSummary[];
};

const PROJECT_SUMMARY_SELECT = {
  id: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
} as const;

const INVOICE_SUMMARY_SELECT = {
  id: true,
  invoiceNumber: true,
  issueDate: true,
  dueDate: true,
  amount: true,
  currency: true,
  status: true,
  project: { select: { name: true } },
} as const;

function toInvoiceSummary(invoice: {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  amount: unknown;
  currency: string;
  status: InvoiceStatus;
  project: { name: string } | null;
}): PortalInvoiceSummary {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    projectName: invoice.project?.name ?? null,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    amount: Number(invoice.amount),
    currency: invoice.currency,
    status: invoice.status,
  };
}

/**
 * All Client Portal reads are scoped by clientId alone — the caller must
 * always pass the clientId that getCurrentPortalUser()/getOptionalPortalUser()
 * resolved for the current identity, never a value from a query string,
 * form field, or cookie. No caching layer sits in front of any of these.
 * Invoice reads additionally require organizationId (also from the
 * verified portal identity) as defense in depth beyond clientId.
 */
export async function getPortalOverview(
  clientId: string,
  organizationId: string,
): Promise<PortalOverview> {
  const [activeProjectsCount, openInvoicesAgg, recentProjects, recentInvoices] =
    await Promise.all([
      prisma.project.count({ where: { clientId, status: ACTIVE_PROJECT_STATUS } }),
      prisma.invoice.aggregate({
        where: { clientId, organizationId, status: { in: [...OPEN_INVOICE_STATUSES] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.project.findMany({
        where: { clientId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: PROJECT_SUMMARY_SELECT,
      }),
      prisma.invoice.findMany({
        where: { clientId, organizationId, status: { in: [...VISIBLE_PORTAL_STATUSES] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: INVOICE_SUMMARY_SELECT,
      }),
    ]);

  return {
    activeProjectsCount,
    openInvoicesCount: openInvoicesAgg._count._all,
    outstandingAmount: Number(openInvoicesAgg._sum.amount ?? 0),
    recentProjects,
    recentInvoices: recentInvoices.map(toInvoiceSummary),
  };
}

export async function getPortalProjects(clientId: string): Promise<PortalProjectSummary[]> {
  return prisma.project.findMany({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: PROJECT_SUMMARY_SELECT,
  });
}

/**
 * Scoped by id + clientId together — a foreign Client's (or foreign
 * organization's) project id simply doesn't match, indistinguishable from
 * a nonexistent one. Callers must notFound() on null, never fall back to
 * a bare id lookup.
 */
export async function getPortalProject(
  clientId: string,
  projectId: string,
): Promise<PortalProjectDetail | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, clientId },
    select: {
      ...PROJECT_SUMMARY_SELECT,
      description: true,
      organizationId: true,
      client: { select: { name: true } },
    },
  });

  if (!project) return null;

  return {
    id: project.id,
    name: project.name,
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    description: project.description,
    clientName: project.client.name,
    organizationId: project.organizationId,
  };
}

export async function getPortalInvoices(
  clientId: string,
  organizationId: string,
  filter: PortalInvoiceFilter,
): Promise<PortalInvoiceSummary[]> {
  // "all" is never unfiltered — it means "every Portal-visible status,"
  // not "every status in the database." DRAFT is excluded from every
  // branch here, not only "open" (Invoice System Official Slice 5,
  // docs/invoicing-architecture.md §10).
  const statusWhere =
    filter === "open"
      ? { in: [...OPEN_INVOICE_STATUSES] }
      : filter === "paid"
        ? ("PAID" as const)
        : { in: [...VISIBLE_PORTAL_STATUSES] };

  // Quotes / Estimates Phase 2.3 — clientId (primary) + organizationId
  // (defense in depth) are the complete Portal tenant boundary; a
  // project-based defense-in-depth filter is deliberately NOT added here
  // (it would silently exclude a project-less Invoice from this list
  // entirely — see the Invoice / Project Coupling Audit).
  const invoices = await prisma.invoice.findMany({
    where: {
      clientId,
      organizationId,
      status: statusWhere,
    },
    orderBy: { createdAt: "desc" },
    select: INVOICE_SUMMARY_SELECT,
  });

  return invoices.map(toInvoiceSummary);
}

/**
 * Scoped by id + clientId + organizationId together — clientId is the
 * primary Portal tenant boundary, organizationId is defense in depth.
 * Callers must notFound() on null.
 */
export async function getPortalInvoice(
  clientId: string,
  organizationId: string,
  invoiceId: string,
): Promise<PortalInvoiceDetail | null> {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      clientId,
      organizationId,
      // Invoice System Official Slice 5 (docs/invoicing-architecture.md
      // §10) — a DRAFT invoice must never resolve here, exactly like a
      // nonexistent/cross-tenant id: this returns null, and the caller's
      // existing notFound() produces the identical generic 404.
      status: { in: [...VISIBLE_PORTAL_STATUSES] },
    },
    select: {
      ...INVOICE_SUMMARY_SELECT,
      paidAt: true,
      client: { select: { name: true } },
      finalizedAt: true,
      pdfStoragePath: true,
      pdfGeneratedAt: true,
      issuerSnapshot: true,
      recipientSnapshot: true,
      documentVersion: true,
    },
  });

  if (!invoice) return null;

  return {
    ...toInvoiceSummary(invoice),
    paidAt: invoice.paidAt,
    clientName: invoice.client.name,
    organizationId,
    hasArchivedPdf: classifyInvoiceArchival(invoice).kind === "archived",
  };
}
