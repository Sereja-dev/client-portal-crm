"use server";

import { revalidatePath } from "next/cache";
import type { ImportEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-user";
import { checkRateLimit, IMPORT_EXECUTE_LIMIT } from "@/lib/rate-limit";
import { BillingLimitError } from "@/lib/billing/enforcement";
import { createClientCore, ClientStatusResolutionError } from "@/lib/clients/create-core";
import { createLeadCore } from "@/lib/leads/create-core";
import { canImportData } from "./authorization";
import {
  MAX_IMPORT_FILE_SIZE_BYTES,
  IMPORT_ACCEPTED_EXTENSION,
  IMPORT_ACCEPTED_MIME_TYPES,
  IMPORT_EXECUTION_BATCH_SIZE,
  MAX_IMPORT_ROW_RESULTS,
} from "./constants";
import { parseImportCsv } from "./csv-parse";
import { CLIENT_IMPORT_FIELDS, LEAD_IMPORT_FIELDS, type ClientImportFieldKey, type LeadImportFieldKey } from "./fields";
import { suggestImportMapping, validateImportMapping, type ImportMapping, type MappingValidationError } from "./mapping";
import { validateClientImportRow, validateLeadImportRow } from "./row-validation";
import {
  createImportJob,
  loadImportJob,
  persistImportMapping,
  beginImportExecution,
  completeImportJob,
  failImportJob,
  type ImportRowResultEntry,
} from "./job";

/**
 * CSV Import Phase 2 — every Server Action the import wizard calls,
 * across all five server-touching steps (upload, mapping/preview,
 * execute). Each one independently re-resolves {user, organizationId,
 * membership} via getCurrentMembership() and re-checks canImportData —
 * never trusts a role/org check made by an earlier step in the same
 * wizard session (the same "re-verify every time" discipline this app's
 * other multi-step flows already use).
 *
 * Trust model (Section 9 of the approved architecture — "do NOT trust
 * client-side preview data during confirm"): the browser only ever
 * holds an opaque `importJobId` plus, during the mapping step, the
 * mapping it wants to submit. Once persistImportMapping succeeds, the
 * ONLY thing execute needs from the client is that same importJobId —
 * both the original file content (ImportJob.rawContent) and the
 * accepted mapping (ImportJob.mappingJson) are read back from the
 * database, never re-accepted from the browser at execute time.
 */

type WireMappingEntry = { columnIndex: number; field: string };

function fieldsForEntity(entityType: ImportEntityType) {
  return entityType === "CLIENT" ? CLIENT_IMPORT_FIELDS : LEAD_IMPORT_FIELDS;
}

function mappingErrorMessage(error: MappingValidationError): string {
  switch (error.code) {
    case "missing_required_field":
      return `${error.field === "name" ? "Name" : error.field} must be mapped to a column.`;
    case "duplicate_target":
      return "Each field can only be mapped from one column.";
    case "duplicate_column":
      return "Each column can only be mapped to one field.";
    case "unknown_field":
      return "That mapping target isn't a valid field for this import.";
    case "column_out_of_range":
      return "The mapping no longer matches this file's columns.";
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Upload
// ---------------------------------------------------------------------------

export type UploadImportResult =
  | { ok: true; importJobId: string; headers: string[]; totalRows: number; suggestedMapping: WireMappingEntry[] }
  | { ok: false; reason: "forbidden" | "no_file" | "file_too_large" | "invalid_extension" | "invalid_mime" }
  | { ok: false; reason: "parse_error"; message: string };

export async function uploadImportFileAction(entityType: ImportEntityType, formData: FormData): Promise<UploadImportResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  if (!(await canImportData(organizationId, membership.role))) {
    return { ok: false, reason: "forbidden" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "no_file" };
  }
  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    return { ok: false, reason: "file_too_large" };
  }
  if (!file.name.toLowerCase().endsWith(IMPORT_ACCEPTED_EXTENSION)) {
    return { ok: false, reason: "invalid_extension" };
  }
  // Browser-reported MIME for a .csv file is notoriously inconsistent
  // (empty, text/plain, application/vnd.ms-excel, text/csv all occur in
  // the wild for the same real file) — never trusted alone (extension
  // above is the primary signal), but a MIME that IS present and
  // clearly wrong is still rejected.
  if (file.type && !(IMPORT_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "invalid_mime" };
  }

  const rawText = await file.text();
  const parsed = parseImportCsv(rawText);
  if (!parsed.ok) {
    return { ok: false, reason: "parse_error", message: parsed.error.message };
  }

  const job = await createImportJob({
    organizationId,
    actorId: user.id,
    entityType,
    filename: file.name,
    totalRows: parsed.result.rows.length,
    rawContent: rawText,
  });

  const suggestedMapping = suggestImportMapping(parsed.result.headers, fieldsForEntity(entityType));

  return {
    ok: true,
    importJobId: job.id,
    headers: parsed.result.headers,
    totalRows: parsed.result.rows.length,
    suggestedMapping,
  };
}

// ---------------------------------------------------------------------------
// Step 2/3 — Mapping + Preview (dry-run, no writes)
// ---------------------------------------------------------------------------

export type PreviewImportResult =
  | {
      ok: true;
      totalRows: number;
      validCount: number;
      skippedCount: number;
      failedCount: number;
      rowDetails: ImportRowResultEntry[];
    }
  | { ok: false; reason: "forbidden" | "not_found" }
  | { ok: false; reason: "invalid_mapping"; message: string };

export async function previewImportAction(
  importJobId: string,
  entityType: ImportEntityType,
  mapping: WireMappingEntry[],
): Promise<PreviewImportResult> {
  const { organizationId, membership } = await getCurrentMembership();
  if (!(await canImportData(organizationId, membership.role))) {
    return { ok: false, reason: "forbidden" };
  }

  const job = await loadImportJob(organizationId, importJobId);
  if (!job || job.entityType !== entityType || job.status !== "PENDING" || !job.rawContent) {
    return { ok: false, reason: "not_found" };
  }

  const parsed = parseImportCsv(job.rawContent);
  if (!parsed.ok) {
    return { ok: false, reason: "not_found" };
  }

  const fields = fieldsForEntity(entityType);
  const mappingValidation = validateImportMapping(mapping, fields, parsed.result.headers.length);
  if (!mappingValidation.ok) {
    return { ok: false, reason: "invalid_mapping", message: mappingErrorMessage(mappingValidation.error) };
  }

  const persisted = await persistImportMapping(organizationId, importJobId, mapping);
  if (!persisted) {
    return { ok: false, reason: "not_found" };
  }

  const rowDetails: ImportRowResultEntry[] = [];
  let validCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const seenEmails = new Set<string>();

  for (let i = 0; i < parsed.result.rows.length; i++) {
    const rowNumber = i + 2; // row 1 is the header
    const row = parsed.result.rows[i];

    if (entityType === "CLIENT") {
      const result = await validateClientImportRow(
        organizationId,
        row,
        parsed.result.headers.length,
        mapping as ImportMapping<ClientImportFieldKey>,
        seenEmails,
      );
      if (result.ok) {
        validCount++;
        if (result.values.email) seenEmails.add(result.values.email.toLowerCase());
      } else if (result.outcome === "skipped") {
        skippedCount++;
        if (rowDetails.length < MAX_IMPORT_ROW_RESULTS) rowDetails.push({ row: rowNumber, outcome: "skipped", message: result.message });
      } else {
        failedCount++;
        if (rowDetails.length < MAX_IMPORT_ROW_RESULTS) rowDetails.push({ row: rowNumber, outcome: "failed", message: result.message });
      }
    } else {
      const result = await validateLeadImportRow(row, parsed.result.headers.length, mapping as ImportMapping<LeadImportFieldKey>);
      if (result.ok) {
        validCount++;
      } else {
        failedCount++;
        if (rowDetails.length < MAX_IMPORT_ROW_RESULTS) rowDetails.push({ row: rowNumber, outcome: "failed", message: result.message });
      }
    }
  }

  return { ok: true, totalRows: parsed.result.rows.length, validCount, skippedCount, failedCount, rowDetails };
}

// ---------------------------------------------------------------------------
// Step 5 — Execute (the only step that writes)
// ---------------------------------------------------------------------------

export type ExecuteImportResult =
  | {
      ok: true;
      status: "COMPLETED";
      totalRows: number;
      importedCount: number;
      skippedCount: number;
      failedCount: number;
      rowDetails: ImportRowResultEntry[];
    }
  | { ok: false; reason: "forbidden" | "not_found" | "already_processed" | "rate_limited" }
  | {
      // CSV Import partial-failure fix — a catastrophic, unrecoverable
      // execution-level failure still carries a full, truthful summary of
      // whatever was genuinely accumulated before it stopped (imported
      // rows are real, already-committed Client/Lead rows — never
      // silently reported as if nothing happened). `status: "FAILED"`
      // mirrors ImportJob.status exactly, so the wizard can render this
      // through the same Summary view a COMPLETED run uses, just with a
      // clear FAILED banner layered on top — never stranding the user on
      // the Preview step with only a generic, unhelpful error banner.
      // Deliberately NOT the raw ImportJob row (no rawContent/mappingJson,
      // no internal error message/stack) — only this bounded, explicit
      // view model.
      ok: false;
      reason: "execution_failed";
      status: "FAILED";
      totalRows: number;
      importedCount: number;
      skippedCount: number;
      failedCount: number;
      rowDetails: ImportRowResultEntry[];
      /** Always a short, safe, user-facing summary — never a raw stack/SQL error. */
      failureReason: string;
    };

export async function executeImportAction(importJobId: string, entityType: ImportEntityType): Promise<ExecuteImportResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  if (!(await canImportData(organizationId, membership.role))) {
    return { ok: false, reason: "forbidden" };
  }

  // Coarse-grained, execute-only limit (Section 16) — never reused for
  // per-record Lead/Client create limiting, which stays untouched.
  const limitCheck = checkRateLimit(IMPORT_EXECUTE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const job = await loadImportJob(organizationId, importJobId);
  if (!job || job.entityType !== entityType) {
    return { ok: false, reason: "not_found" };
  }
  // Checked BEFORE the rawContent/mappingJson presence check below:
  // completeImportJob/failImportJob both null out rawContent once a job
  // reaches a terminal status (Section 15's own cleanup rule), so a
  // replayed execute against an already-finished job must be recognized
  // as "already processed," not misread as "never had a mapping" simply
  // because its own successful completion already cleared that field.
  if (job.status !== "PENDING") {
    return { ok: false, reason: "already_processed" };
  }
  if (!job.rawContent || !job.mappingJson) {
    return { ok: false, reason: "not_found" };
  }

  // The transactional single-use replay guard — see beginImportExecution's
  // own doc comment. A double-click, a replayed request, or a second tab
  // all lose this race exactly once: only the first ever flips PENDING ->
  // PROCESSING, every other attempt is rejected here, before any row is
  // ever touched.
  const began = await beginImportExecution(organizationId, importJobId);
  if (!began) {
    return { ok: false, reason: "already_processed" };
  }

  // CSV Import partial-failure fix — declared OUTSIDE the try block (not
  // inside it, as before) so the catch block below can still see
  // whatever was genuinely accumulated up to the moment a catastrophic
  // error stopped execution, instead of discarding it. `job.totalRows`
  // (the total captured at upload time) is the safe fallback for the
  // rare case a catastrophic failure happens before the file can even
  // be re-parsed — genuinely nothing was processed at that point, so 0
  // counts and an empty row list are accurate, not a placeholder.
  const rowResults: ImportRowResultEntry[] = [];
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalRowsProcessed = job.totalRows;

  try {
    const parsed = parseImportCsv(job.rawContent);
    if (!parsed.ok) {
      const failureReason = "The stored file could not be re-read.";
      await failImportJob(importJobId, failureReason, { importedCount, skippedCount, failedCount, rowResults });
      return {
        ok: false,
        reason: "execution_failed",
        status: "FAILED",
        totalRows: totalRowsProcessed,
        importedCount,
        skippedCount,
        failedCount,
        rowDetails: rowResults,
        failureReason,
      };
    }
    totalRowsProcessed = parsed.result.rows.length;

    const fields = fieldsForEntity(entityType);
    const mapping = job.mappingJson as unknown as WireMappingEntry[];
    const mappingValidation = validateImportMapping(mapping, fields, parsed.result.headers.length);
    if (!mappingValidation.ok) {
      const failureReason = "The stored column mapping is no longer valid for this file.";
      await failImportJob(importJobId, failureReason, { importedCount, skippedCount, failedCount, rowResults });
      return {
        ok: false,
        reason: "execution_failed",
        status: "FAILED",
        totalRows: totalRowsProcessed,
        importedCount,
        skippedCount,
        failedCount,
        rowDetails: rowResults,
        failureReason,
      };
    }

    const rows = parsed.result.rows;
    const seenEmails = new Set<string>();

    // Bounded batches (Section 13) — never one giant transaction holding
    // thousands of writes. Each individual row's own Client/Lead creation
    // is still its own small, fully-consistent transaction (via
    // createClientCore/createLeadCore) — one row's failure never rolls
    // back any other row already committed.
    for (let batchStart = 0; batchStart < rows.length; batchStart += IMPORT_EXECUTION_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + IMPORT_EXECUTION_BATCH_SIZE, rows.length);
      for (let rowIndex = batchStart; rowIndex < batchEnd; rowIndex++) {
        const row = rows[rowIndex];
        const rowNumber = rowIndex + 2;

        try {
          if (entityType === "CLIENT") {
            const validation = await validateClientImportRow(
              organizationId,
              row,
              parsed.result.headers.length,
              mapping as ImportMapping<ClientImportFieldKey>,
              seenEmails,
            );
            if (!validation.ok) {
              if (validation.outcome === "skipped") {
                skippedCount++;
                pushRowResult(rowResults, { row: rowNumber, outcome: "skipped", message: validation.message });
              } else {
                failedCount++;
                pushRowResult(rowResults, { row: rowNumber, outcome: "failed", message: validation.message });
              }
              continue;
            }

            await prisma.$transaction(async (tx) => {
              await createClientCore(tx, {
                organizationId,
                userId: user.id,
                actorName: user.name,
                context: "import",
                input: validation.values,
              });
            });
            if (validation.values.email) seenEmails.add(validation.values.email.toLowerCase());
            importedCount++;
            pushRowResult(rowResults, { row: rowNumber, outcome: "imported" });
          } else {
            const validation = await validateLeadImportRow(row, parsed.result.headers.length, mapping as ImportMapping<LeadImportFieldKey>);
            if (!validation.ok) {
              failedCount++;
              pushRowResult(rowResults, { row: rowNumber, outcome: "failed", message: validation.message });
              continue;
            }

            await prisma.$transaction(async (tx) => {
              await createLeadCore(tx, {
                organizationId,
                userId: user.id,
                actorName: user.name,
                context: "import",
                input: validation.values,
              });
            });
            importedCount++;
            pushRowResult(rowResults, { row: rowNumber, outcome: "imported" });
          }
        } catch (err) {
          // Only known, expected per-row rejection reasons are caught
          // here and recorded as a single row's failure — one row's
          // rejection must never roll back or abort the rest of the file
          // (Section 13). Anything else (a genuinely unexpected error —
          // a real bug, a lost DB connection, ...) is deliberately NOT
          // caught here: it propagates to the outer catch below, which
          // stops the whole run and marks the job FAILED, rather than
          // silently swallowing a system-level failure that would make
          // continuing unsafe.
          if (err instanceof BillingLimitError) {
            failedCount++;
            pushRowResult(rowResults, { row: rowNumber, outcome: "failed", message: err.message });
          } else if (err instanceof ClientStatusResolutionError) {
            failedCount++;
            pushRowResult(rowResults, { row: rowNumber, outcome: "failed", message: "Could not assign a status to this row." });
          } else {
            throw err;
          }
        }
      }
    }

    await completeImportJob(importJobId, { importedCount, skippedCount, failedCount, rowResults });
    revalidatePath(entityType === "CLIENT" ? "/clients" : "/leads");

    return {
      ok: true,
      status: "COMPLETED",
      totalRows: rows.length,
      importedCount,
      skippedCount,
      failedCount,
      rowDetails: rowResults.slice(0, MAX_IMPORT_ROW_RESULTS),
    };
  } catch {
    // Unrecoverable, execution-level failure (Section 15) — a safe,
    // generic diagnostic only, never a raw stack/SQL error surfaced to
    // the UI. CSV Import partial-failure fix: `importedCount`/
    // `skippedCount`/`failedCount`/`rowResults` at this point are
    // whatever the loop above genuinely accumulated before this row's
    // own error propagated past its per-row catch (see that catch's own
    // comment on why only known, expected rejection types are ever
    // absorbed there) — every earlier row already committed as a real,
    // independent transaction and stays committed; this failure path
    // must report that truthfully, not as "0 imported," which is what
    // the original defect this fix closes actually did.
    const failureReason = "The import stopped because of an unexpected error partway through.";
    await failImportJob(importJobId, failureReason, { importedCount, skippedCount, failedCount, rowResults });
    return {
      ok: false,
      reason: "execution_failed",
      status: "FAILED",
      totalRows: totalRowsProcessed,
      importedCount,
      skippedCount,
      failedCount,
      rowDetails: rowResults.slice(0, MAX_IMPORT_ROW_RESULTS),
      failureReason,
    };
  }
}

function pushRowResult(target: ImportRowResultEntry[], entry: ImportRowResultEntry): void {
  if (target.length < MAX_IMPORT_ROW_RESULTS) target.push(entry);
}
