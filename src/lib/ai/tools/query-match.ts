/**
 * AI Assistant Multi-Entity Search Matching — shared, pure query
 * tokenizer, imported by both the real Product tools (searchInvoices/
 * searchProjects/searchTasks/searchClients) and the isolated benchmark
 * harness's own fixture-backed tool-runtime (scripts/ai-provider-eval/
 * tool-runtime.ts), so both sides tokenize a query identically and can
 * never silently drift apart. Zero dependencies (no Prisma, no
 * Supabase, no Next.js) — same discipline as this directory's other
 * zero-dependency modules (validation.ts, result.ts, output-projection.ts,
 * limits.ts, mutation-guard.ts) that the benchmark already imports
 * directly; see scripts/ai-provider-eval/test/source-isolation.test.ts
 * for the mechanical proof this file must also satisfy.
 *
 * Root cause this fixes: every AI search tool previously required the
 * ENTIRE trimmed query to be a substring of one single searchable field
 * (Prisma's own `contains`, or the benchmark's own prior `matchesQuery`).
 * A natural query that legitimately names two different entities living
 * in two different fields (e.g. "Brightline Robotics Warehouse
 * Automation Pilot" — a client name plus a project name) could never
 * satisfy that single-field check, even though the record itself is an
 * exact match once each named entity is considered independently. This
 * tokenizer is the shared first step toward the fix: split the query
 * into meaningful tokens so each tool can then require every token to be
 * found SOMEWHERE across that one record's own searchable fields (an
 * AND of per-token ORs — never the other way around, and never an
 * any-token OR, which would be far too loose — see each call site's own
 * doc comment).
 *
 * Deliberately conservative: no stopword list, no stemming, no fuzzy
 * matching, embeddings, or trigram search — none of those is needed to
 * fix the proven defect, and every one would add nondeterminism or
 * infrastructure this benchmark-parity design explicitly avoids.
 */

/**
 * Trailing/leading "wrapping" punctuation a model or a human might type
 * around an entity name inside an otherwise-plain query — a sentence
 * comma, a closing parenthesis, a quote, a trailing possessive
 * apostrophe. Deliberately does NOT include the hyphen (`-`): splitting
 * or stripping on it would break an invoice-number token like
 * "INV-1004" into two meaningless fragments. Applied only at a token's
 * own leading/trailing edge (see stripWrappingPunctuation below), so an
 * apostrophe INSIDE a token (e.g. "O'Brien") is never touched — only a
 * token that starts or ends with one of these characters is affected.
 */
const WRAPPING_PUNCTUATION_PATTERN = /^[.,;:!?"'()[\]{}]+|[.,;:!?"'()[\]{}]+$/g;

function stripWrappingPunctuation(token: string): string {
  return token.replace(WRAPPING_PUNCTUATION_PATTERN, "");
}

/**
 * True if `token` contains no letter or digit at all (e.g. a lone "-"
 * left over after a query like "Brightline - Robotics" is split on
 * whitespace — the hyphen is deliberately never stripped as wrapping
 * punctuation, since that would also corrupt "INV-1004", but a token
 * that is ENTIRELY punctuation carries no search meaning and must not
 * become a real AND condition: under this design's own all-tokens-must-
 * match rule, a stray punctuation-only token would otherwise require
 * every result to literally contain that character somewhere, silently
 * failing every query it appears in for any field that never happens to
 * contain it).
 */
function isPunctuationOnly(token: string): boolean {
  return !/\p{L}|\p{N}/u.test(token);
}

/**
 * Splits an already-length-validated query (see validation.ts's own
 * isValidOptionalQuery / AI_TOOL_QUERY_MAX_LENGTH — this function does
 * not re-check length, that is each caller's own validator's job) into
 * deterministic search tokens:
 *
 *   1. trim outer whitespace
 *   2. collapse internal whitespace runs (including newlines/tabs) to a
 *      single space
 *   3. split on whitespace only — never on hyphens or apostrophes
 *   4. strip leading/trailing wrapping punctuation from each piece
 *   5. discard any piece that becomes empty after stripping, or that
 *      contains no letter or digit at all (see isPunctuationOnly below)
 *
 * Pure and deterministic — the same input always produces the same
 * token array, in the same order (order is never significant to any
 * caller, which only ever uses the result as an unordered AND-set, but
 * determinism itself matters for test reproducibility). Case is
 * deliberately left UNCHANGED here: Product compares tokens against
 * Prisma's own `mode: "insensitive"` contains filter, and the benchmark
 * lowercases both the token and each candidate field itself at compare
 * time (mirroring how the pre-existing single-field matcher already
 * lowercased both sides) — so case-insensitivity is each caller's own
 * concern, not this shared structural step's.
 */
export function tokenizeAiSearchQuery(query: string): string[] {
  const collapsed = query.trim().replace(/\s+/g, " ");
  if (!collapsed) return [];

  return collapsed
    .split(" ")
    .map(stripWrappingPunctuation)
    .filter((token) => token.length > 0 && !isPunctuationOnly(token));
}
