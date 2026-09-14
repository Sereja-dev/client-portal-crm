import { formatStatusLabel } from "@/lib/format";
import { getContractDisplayStatus, type ContractDisplayStatus } from "@/lib/contracts/status";
import type { ContractStatus } from "@/generated/prisma/enums";

export type ContractStatusDisplayInput = {
  status: ContractStatus;
  effectiveDate: Date | null;
  expiresAt: Date | null;
};

const DISPLAY_LABELS: Record<ContractDisplayStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
};

/**
 * Contracts Phase 2 (Staff UI) — the single place the UI decides what a
 * Contract's own status badge/label reads as. Every caller (the list
 * page's table/card rows, the detail page) renders status by calling
 * THIS function, never by re-deriving ACTIVE/EXPIRED inline a second
 * time (locked architecture §4/§26: "Do not duplicate derived-state
 * calculation inside React components") — the real precedence logic
 * lives entirely in the already-reviewed, pure src/lib/contracts/
 * status.ts (Phase 1), this module only maps its result to a stable
 * `{key, label}` pair a <StatusBadge> can render, mirroring
 * src/lib/quotes/status-display.ts's own identical split (shared
 * derivation in src/lib/, presentational mapping colocated with it).
 *
 * `now` is never read here — getContractDisplayStatus() itself defaults
 * it to the real current time only at its own call site, keeping this
 * function itself trivially pure and testable.
 */
export function deriveContractStatusDisplay(contract: ContractStatusDisplayInput): { key: ContractDisplayStatus; label: string } {
  const key = getContractDisplayStatus(contract);
  return { key, label: DISPLAY_LABELS[key] ?? formatStatusLabel(key) };
}
