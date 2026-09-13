/**
 * CSV Import Phase 2 — the one shared set of hard limits every part of
 * the import flow (upload validation, the CSV parser wrapper, preview,
 * and execute) reads from, so a future change to any of these is never
 * a multi-file hunt.
 */

// Same 10 MB precedent as attachments (src/lib/storage/attachments-config.ts's
// own MAX_ATTACHMENT_SIZE_BYTES) — reused rather than inventing a second,
// unrelated file-size ceiling for the same kind of upload.
export const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Conservative, low-thousands v1 ceiling: the whole flow is synchronous
// (no background worker/queue — see the approved architecture), executed
// in bounded batches inside one request/response cycle, so an unbounded
// row count would risk a timed-out or resource-exhausted execute request
// long before the 10 MB file-size cap alone would ever stop it (a 10 MB
// file of short rows can easily hold tens of thousands of them). 5,000
// rows is comfortably inside what a single bounded-batch synchronous
// execute can process well within a normal request timeout at this
// app's current scale.
export const MAX_IMPORT_ROWS = 5_000;

// Execute processes rows in bounded chunks (never one giant transaction
// holding thousands of writes — see the approved architecture's own
// "Batching / partial success" requirement).
export const IMPORT_EXECUTION_BATCH_SIZE = 50;

// The completed summary page shows row-level detail for at most this
// many rows — the aggregate imported/skipped/failed counts stored on
// ImportJob are always exact regardless of this cap; this only bounds
// how much per-row detail is persisted/rendered.
export const MAX_IMPORT_ROW_RESULTS = 500;

export const IMPORT_ACCEPTED_MIME_TYPES = ["text/csv", "application/vnd.ms-excel", "text/plain"] as const;
export const IMPORT_ACCEPTED_EXTENSION = ".csv";
