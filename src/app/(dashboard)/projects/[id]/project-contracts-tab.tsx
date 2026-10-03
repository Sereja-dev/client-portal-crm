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
import type { ProjectContractRow } from "./profile-query";

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

/**
 * Documents Slice A — Project Hub's own Contracts tab, mirroring Client
 * Hub's ClientContractsTab (src/app/(dashboard)/clients/[id]/contracts-tab.tsx)
 * column-for-column. No "Client" column here — exactly like
 * ClientContractsTab itself omits a "Project" column: every Contract
 * shown on this tab already belongs to the one Client this Project
 * itself belongs to (Project.clientId is required, and
 * resolveContractTarget() enforces a Contract's own projectId/clientId
 * pair always agree — see src/lib/contracts/target.ts), so repeating it
 * on every row would be pure redundancy, matching this tab's own sibling
 * "do not repeat the container's own already-known relation" convention.
 *
 * Archived Contracts are included, truthfully labeled — same convention
 * as ClientContractsTab and the main /contracts list. No "Create
 * contract" quick action here — explicitly out of this slice's scope
 * (the readiness audit classified it as nice-to-have, not required); an
 * ordinary contextual link to the existing Contracts area is enough.
 */
export function ProjectContractsTab({ contracts }: { contracts: ProjectContractRow[] }) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        title="No contracts yet"
        description="Contracts for this project will appear here."
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
