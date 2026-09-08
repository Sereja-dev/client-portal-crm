import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalInvoice } from "@/lib/client-portal/queries";
import { getPortalInvoiceAttachments } from "@/lib/client-portal/attachments";
import { formatCurrency } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { PortalAttachmentsList } from "@/components/client-portal/portal-attachments-list";

export default async function PortalInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { clientId, organizationId } = await getCurrentPortalUser();

  // Scoped by id + clientId + organizationId (+ project.clientId inside
  // the query), never a bare id lookup — an invoice belonging to a
  // different Client simply doesn't match, indistinguishable from a
  // nonexistent id.
  const invoice = await getPortalInvoice(clientId, organizationId, id);

  if (!invoice) {
    notFound();
  }

  // The Invoice lookup above is already scoped by id + clientId +
  // project.clientId — this only re-applies the
  // entityType/entityId/organizationId boundary on the Attachment table,
  // it does not re-verify Invoice ownership.
  const attachments = await getPortalInvoiceAttachments(invoice);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/portal/invoices" className={ACTION_LINK_CLASSES}>
        ← Back to invoices
      </Link>

      <div className={`mt-4 p-6 ${CARD_SURFACE_CLASSES}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-text-primary text-xl font-semibold tracking-tight">
            {invoice.invoiceNumber}
          </h1>
          <StatusBadge status={invoice.status} />
        </div>

        <p className="text-text-primary mt-2 text-2xl font-semibold tracking-tight">
          {formatCurrency(invoice.amount, invoice.currency)}
        </p>

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Client
            </dt>
            <dd className="text-text-primary mt-1 text-sm">{invoice.clientName}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Project
            </dt>
            <dd className="text-text-primary mt-1 text-sm">{invoice.projectName ?? "No project"}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Issue date
            </dt>
            <dd className="text-text-primary mt-1 text-sm">
              {invoice.issueDate.toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Due date
            </dt>
            <dd className="text-text-primary mt-1 text-sm">
              {invoice.dueDate ? invoice.dueDate.toLocaleDateString() : "—"}
            </dd>
          </div>
          {invoice.paidAt && (
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
                Paid on
              </dt>
              <dd className="text-text-primary mt-1 text-sm">
                {invoice.paidAt.toLocaleDateString()}
              </dd>
            </div>
          )}
        </dl>

        {invoice.hasArchivedPdf && (
          <div className="mt-6">
            <a
              href={`/api/portal/invoices/${invoice.id}/pdf`}
              className={ACTION_LINK_CLASSES}
            >
              Download PDF
            </a>
          </div>
        )}

        <div className="border-border-default mt-8 border-t pt-6">
          <h2 className="text-text-primary text-sm font-semibold">Attachments</h2>
          <PortalAttachmentsList
            attachments={attachments}
            emptyDescription="Files shared for this invoice will appear here."
          />
        </div>
      </div>
    </div>
  );
}
