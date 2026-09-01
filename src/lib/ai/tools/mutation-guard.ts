/**
 * AI Assistant Batch 1A — the one enforceable, mechanical (not
 * prompt-wording) barrier against a mutation-capable tool ever entering
 * the registry. Every later batch that adds a real tool (business-data
 * reads, and nothing else, per the approved architecture plan) has its
 * tool name checked against this list at registration time — see
 * registry.ts's own registerAiTool(), which calls
 * assertNotMutationLikeToolName() unconditionally, not as something a
 * future author could forget to opt into.
 *
 * This is deliberately a name-shape check, not a substitute for reviewing
 * what a tool's `execute` function actually does — a tool literally
 * cannot be a create/update/delete/send/etc. operation and also pass
 * ordinary code review with an honest name, so this exists as a second,
 * cheap, always-on layer: a reviewer (or a future AI-assisted PR) that
 * tries to slip in `sendInvoiceReminder` or `archiveTask` is caught
 * mechanically, before human review even starts, never relying solely on
 * "the system prompt says read-only" (the task's own explicit
 * instruction).
 *
 * Matches on whole path segments, case-insensitively, split on
 * camelCase/PascalCase/snake_case/kebab-case word boundaries — so
 * `searchClients` never false-positives on containing no forbidden word,
 * while `archiveTask`, `archive_task`, and `ARCHIVE-TASK` all correctly
 * trip the `archive` entry regardless of casing/separator convention a
 * future author might use.
 */

export const MUTATION_LIKE_NAME_FRAGMENTS = [
  "create",
  "update",
  "delete",
  "remove",
  "archive",
  "send",
  "invite",
  "suspend",
  "reactivate",
  "upload",
  "write",
  "mutate",
  "execute",
] as const;

/** Splits a tool name into lowercase word fragments across camelCase/PascalCase/snake_case/kebab-case boundaries — e.g. "sendInvoiceReminder" / "send_invoice_reminder" / "SEND-INVOICE-REMINDER" all produce ["send", "invoice", "reminder"]. */
function toWordFragments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((fragment) => fragment.toLowerCase())
    .filter(Boolean);
}

export function isMutationLikeToolName(name: string): boolean {
  const fragments = new Set(toWordFragments(name));
  return MUTATION_LIKE_NAME_FRAGMENTS.some((forbidden) => fragments.has(forbidden));
}

export function assertNotMutationLikeToolName(name: string): void {
  if (isMutationLikeToolName(name)) {
    throw new Error(
      `AI tool name "${name}" contains a mutation-like word fragment and cannot be registered. ` +
        "The AI Assistant is read-only/drafting-only by construction — see tools/mutation-guard.ts.",
    );
  }
}
