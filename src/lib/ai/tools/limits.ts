/**
 * AI Assistant Batch 1B.1 — fixed, non-model-controlled result-size
 * ceilings for every list-returning tool. Never a caller/model-supplied
 * `limit` argument (see each tool's own validator, which rejects a
 * `limit` key outright as unknown) — these are the sole source of "how
 * many rows" for every search tool.
 */
export const SEARCH_CLIENTS_LIMIT = 10;
export const SEARCH_PROJECTS_LIMIT = 10;
export const SEARCH_TASKS_LIMIT = 15;
export const SEARCH_INVOICES_LIMIT = 10;
