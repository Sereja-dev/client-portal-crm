/**
 * AI Assistant Batch 1B.1 — the one shared result shape every read-only
 * domain tool's `TOutput` (see tools/types.ts's own `AiToolDefinition`)
 * is built from. `AiToolDefinition.execute` always resolves (never
 * throws to its caller for an ordinary domain failure — see each tool's
 * own try/catch) — success/failure is a discriminated field in the
 * returned value itself, so a future orchestrator never needs a
 * try/catch around a tool call just to tell "no match" apart from
 * "invalid arguments" apart from "the database is unavailable right
 * now."
 *
 * Exactly three error categories, matching the approved architecture
 * plan's own error contract:
 *  - "invalid_input": the model's own tool-call arguments failed
 *    validation (unknown key, wrong type, oversized string, invalid
 *    enum/date/ref) — rejected before any database query ran.
 *  - "not_found": a single-record lookup (getClientDetail) found nothing
 *    it's allowed to return — a malformed ref, a nonexistent one, and a
 *    real ref belonging to another organization all produce this exact
 *    same category, indistinguishably (see clients.ts's own doc comment
 *    on why this is not an existence oracle).
 *  - "unavailable": a genuine, unexpected failure (e.g. a database
 *    error) — never the raw error message, stack trace, or any
 *    database-specific detail.
 *
 * A search-style tool never uses "not_found" — an empty results array is
 * the correct, non-error representation of "nothing matched" for a list
 * (see each search tool's own doc comment).
 */
export type AiToolExecutionError = "invalid_input" | "not_found" | "unavailable";

export type AiToolResult<T extends object> = ({ ok: true } & T) | { ok: false; error: AiToolExecutionError };

export function toolError(error: AiToolExecutionError): { ok: false; error: AiToolExecutionError } {
  return { ok: false, error };
}

export function toolOk<T extends object>(data: T): { ok: true } & T {
  return { ok: true, ...data };
}
