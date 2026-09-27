import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { ContractStatusBadge } from "@/components/contracts/contract-status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import type { ClientContractRow } from "./profile-query";

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

/**
 * Archived Contracts are included, truthfully labeled — matching the
 * existing /contracts list page's own convention exactly (archivedAt is
 * orthogonal to status there too). No "Create contract" quick action
 * here — not part of this block's requested scope (Section 15); an
 * ordinary contextual link to the existing Contracts area is enough.
 */
export function ClientContractsTab({ contracts }: { contracts: ClientContractRow[] }) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        title="No contracts yet"
        description="Contracts for this client will appear here."
        action={
          <Link href="/contracts" className={ACTION_LINK_CLASSES}>
            Go to Contracts
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Contract #</TableHeaderCell>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Effective</TableHeaderCell>
              <TableHeaderCell>Expires</TableHeaderCell>
              <TableHeaderCell>Signatory</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {contracts.map((contract) => (
              <TableRow key={contract.id}>
                <TableCell emphasis>
                  <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                    {contract.contractNumber}
                  </Link>
                  {contract.archivedAt !== null && <span className="text-text-muted ml-2 text-xs">Archived</span>}
                </TableCell>
                <TableCell>{contract.title}</TableCell>
                <TableCell>
                  <ContractStatusBadge contract={contract} />
                </TableCell>
                <TableCell>{formatDate(contract.effectiveDate)}</TableCell>
                <TableCell>{formatDate(contract.expiresAt)}</TableCell>
                <TableCell>{contract.signatoryContact?.name ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordCardList>
        {contracts.map((contract) => (
          <RecordCard key={contract.id}>
            <RecordCardField
              label="Contract #"
              value={
                <>
                  <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                    {contract.contractNumber}
                  </Link>
                  {contract.archivedAt !== null && <span className="text-text-muted ml-2 text-xs">Archived</span>}
                </>
              }
              emphasis
            />
            <RecordCardField label="Title" value={contract.title} />
            <RecordCardField label="Status" value={<ContractStatusBadge contract={contract} />} />
            <RecordCardField label="Effective" value={formatDate(contract.effectiveDate)} />
            <RecordCardField label="Expires" value={formatDate(contract.expiresAt)} />
            <RecordCardField label="Signatory" value={contract.signatoryContact?.name ?? "—"} />
          </RecordCard>
        ))}
      </RecordCardList>
    </>
  );
}
