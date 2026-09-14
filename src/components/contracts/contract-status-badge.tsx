import { StatusBadge } from "@/components/ui/status-badge";
import { deriveContractStatusDisplay, type ContractStatusDisplayInput } from "@/lib/contracts/status-display";

export type ContractStatusInput = ContractStatusDisplayInput;

/** Renders the real derived display status (DRAFT/SENT/ACCEPTED/ACTIVE/EXPIRED/TERMINATED) — never the stored `status` alone. See status-display.ts's own header comment. */
export function ContractStatusBadge({ contract }: { contract: ContractStatusInput }) {
  const { key, label } = deriveContractStatusDisplay(contract);
  return <StatusBadge status={key} label={label} />;
}
