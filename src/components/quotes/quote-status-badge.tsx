import { StatusBadge } from "@/components/ui/status-badge";
import { deriveQuoteStatusDisplay, type QuoteStatusDisplayInput } from "@/lib/quotes/status-display";

// Re-exported under its original Phase 3 names so every existing Staff
// call site (list/read-only view) is unaffected — the actual precedence
// logic itself now lives in src/lib/quotes/status-display.ts (moved
// there in Phase 4 so a Client Portal page can reuse it directly without
// ever importing from this Staff-presentation module; see that file's
// own header comment for the full reasoning).
export type QuoteStatusInput = QuoteStatusDisplayInput;
export { deriveQuoteStatusDisplay };

export function QuoteStatusBadge({ quote }: { quote: QuoteStatusInput }) {
  const { key, label } = deriveQuoteStatusDisplay(quote);
  return <StatusBadge status={key} label={label} />;
}
