import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalContracts } from "@/lib/client-portal/queries";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { EmptyState } from "@/components/ui/empty-state";
import { ContractStatusBadge } from "@/components/contracts/contract-status-badge";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

/**
 * Contracts Portal V1 §6/§7. Shows only this Portal Client's own SENT/
 * ACCEPTED/TERMINATED Contracts (getPortalContracts already excludes
 * DRAFT and archived — see its own doc comment) — DRAFT never appears
 * here, matching Invoice/Quote's own identical "never visible" rule.
 * There is no archive-visibility toggle, no search/filter, and no
 * pagination on this list — matching every other Portal list in this
 * app. No lifecycle action (Accept) is ever rendered on this list — that
 * only ever appears on the detail page.
 */
export default async function PortalContractsPage() {
  const { clientId, organizationId } = await getCurrentPortalUser();
  const contracts = await getPortalContracts(clientId, organizationId);

  return (
    <div>
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Contracts</h1>
      <p className="text-text-muted mt-1 text-sm">
        {contracts.length} {contracts.length === 1 ? "contract" : "contracts"}
      </p>

      {contracts.length === 0 ? (
        <EmptyState title="No contracts" description="Contracts will appear here once your team sends you one." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Contract #</TableHeaderCell>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Issue date</TableHeaderCell>
              <TableHeaderCell>Effective date</TableHeaderCell>
              <TableHeaderCell>Expiry date</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {contracts.map((contract) => (
              <TableRow key={contract.id}>
                <TableCell emphasis>
                  <Link
                    href={`/portal/contracts/${contract.id}`}
                    className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {contract.contractNumber}
                  </Link>
                </TableCell>
                <TableCell>{contract.title}</TableCell>
                <TableCell>{formatDateOnlyForDisplay(contract.issueDate)}</TableCell>
                <TableCell>{contract.effectiveDate ? formatDateOnlyForDisplay(contract.effectiveDate) : "—"}</TableCell>
                <TableCell>{contract.expiresAt ? formatDateOnlyForDisplay(contract.expiresAt) : "—"}</TableCell>
                <TableCell>
                  <ContractStatusBadge contract={contract} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
