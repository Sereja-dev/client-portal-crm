"use client";

import { useState } from "react";
import Link from "next/link";
import type { ImportEntityType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import {
  uploadImportFileAction,
  previewImportAction,
  executeImportAction,
  type UploadImportResult,
  type PreviewImportResult,
  type ExecuteImportResult,
} from "@/lib/import/server-actions";
import { MAX_IMPORT_FILE_SIZE_BYTES, MAX_IMPORT_ROWS } from "@/lib/import/constants";

/**
 * CSV Import Phase 2 — the one shared wizard, parameterized per entity
 * (Client/Lead) by its caller (see the two thin page.tsx wrappers). Every
 * server-touching step calls its own dedicated Server Action directly
 * (src/lib/import/server-actions.ts) — no client-side parsing, no
 * client-side validation is ever treated as authoritative (Section 9):
 * this component only ever holds an opaque importJobId plus whatever
 * mapping the user is currently editing; the actual file content and,
 * once accepted, the mapping itself live server-side on the ImportJob
 * row, re-read from there by both preview and execute.
 */

export type ImportFieldOption = { key: string; label: string; required: boolean };

type Step = "upload" | "mapping" | "preview" | "summary";

const CARD_CLASSES = "p-6 border-border-default bg-surface rounded-lg border";
const UNMAPPED_VALUE = "";

function uploadErrorMessage(result: Extract<UploadImportResult, { ok: false }>): string {
  switch (result.reason) {
    case "forbidden":
      return "You don't have permission to import data.";
    case "no_file":
      return "Choose a CSV file to upload.";
    case "file_too_large":
      return `This file is too large. Maximum size is ${Math.round(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))} MB.`;
    case "invalid_extension":
      return "Only .csv files are supported.";
    case "invalid_mime":
      return "This file doesn't look like a CSV file.";
    case "parse_error":
      return result.message;
  }
}

function previewErrorMessage(result: Extract<PreviewImportResult, { ok: false }>): string {
  switch (result.reason) {
    case "forbidden":
      return "You don't have permission to import data.";
    case "not_found":
      return "This import session is no longer available. Start over.";
    case "invalid_mapping":
      return result.message;
  }
}

function executeErrorMessage(result: Extract<ExecuteImportResult, { ok: false }>): string {
  switch (result.reason) {
    case "forbidden":
      return "You don't have permission to import data.";
    case "not_found":
      return "This import session is no longer available. Start over.";
    case "already_processed":
      return "This import has already been run.";
    case "rate_limited":
      return "You've started too many imports recently. Try again later.";
    case "execution_failed":
      return "This import couldn't be completed. No records were changed by this attempt beyond what's shown below.";
  }
}

export function ImportWizard({
  entityType,
  fields,
  listHref,
  entityLabelPlural,
}: {
  entityType: ImportEntityType;
  fields: readonly ImportFieldOption[];
  listHref: string;
  entityLabelPlural: string;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<PreviewImportResult & { ok: true } | null>(null);
  const [summary, setSummary] = useState<(ExecuteImportResult & { ok: true }) | null>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    if (!(formData.get("file") instanceof File) || (formData.get("file") as File).size === 0) {
      setError("Choose a CSV file to upload.");
      return;
    }
    setPending(true);
    try {
      const result = await uploadImportFileAction(entityType, formData);
      if (!result.ok) {
        setError(uploadErrorMessage(result));
        return;
      }
      setImportJobId(result.importJobId);
      setHeaders(result.headers);
      setTotalRows(result.totalRows);
      const initialMapping: Record<number, string> = {};
      for (const suggestion of result.suggestedMapping) {
        initialMapping[suggestion.columnIndex] = suggestion.field;
      }
      setMapping(initialMapping);
      setStep("mapping");
    } finally {
      setPending(false);
    }
  }

  async function handleMappingContinue() {
    if (!importJobId) return;
    setError(null);
    setPending(true);
    try {
      const mappingEntries = Object.entries(mapping)
        .filter(([, field]) => field !== UNMAPPED_VALUE)
        .map(([columnIndex, field]) => ({ columnIndex: Number(columnIndex), field }));
      const result = await previewImportAction(importJobId, entityType, mappingEntries);
      if (!result.ok) {
        setError(previewErrorMessage(result));
        return;
      }
      setPreview(result);
      setStep("preview");
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm() {
    if (!importJobId) return;
    setError(null);
    setPending(true);
    try {
      const result = await executeImportAction(importJobId, entityType);
      if (!result.ok) {
        setError(executeErrorMessage(result));
        return;
      }
      setSummary(result);
      setStep("summary");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ImportSteps current={step} />

      {error && (
        <div className="border-danger bg-danger-subtle text-danger mb-6 rounded-md border px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}

      {step === "upload" && (
        <form onSubmit={handleUpload} className={CARD_CLASSES}>
          <h2 className="text-text-primary text-lg font-semibold">Upload a CSV file</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Up to {Math.round(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))} MB, {MAX_IMPORT_ROWS.toLocaleString()} rows max.
          </p>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="border-border-default text-text-primary mt-4 block w-full rounded-md border px-3 py-2 text-sm"
          />
          <div className="mt-6 flex items-center gap-3">
            <Button type="submit" loading={pending}>
              Continue
            </Button>
            <Link href={listHref} className="text-text-secondary text-sm hover:underline">
              Cancel
            </Link>
          </div>
        </form>
      )}

      {step === "mapping" && (
        <div className={CARD_CLASSES}>
          <h2 className="text-text-primary text-lg font-semibold">Map columns</h2>
          <p className="text-text-secondary mt-1 text-sm">
            {totalRows.toLocaleString()} rows detected. Match each CSV column to an Aqenra field, or leave it unmapped
            to ignore it.
          </p>

          <div className="mt-4 space-y-3">
            {headers.map((header, columnIndex) => (
              <div key={columnIndex} className="flex items-center gap-3">
                <span className="text-text-primary w-1/2 truncate text-sm" title={header || `(column ${columnIndex + 1})`}>
                  {header || `(column ${columnIndex + 1})`}
                </span>
                <select
                  value={mapping[columnIndex] ?? UNMAPPED_VALUE}
                  onChange={(e) =>
                    setMapping((prev) => ({ ...prev, [columnIndex]: e.target.value }))
                  }
                  className="border-border-default text-text-primary bg-surface w-1/2 rounded-md border px-3 py-2 text-sm"
                >
                  <option value={UNMAPPED_VALUE}>Not imported</option>
                  {fields.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                      {field.required ? " (required)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button type="button" onClick={handleMappingContinue} loading={pending}>
              Continue
            </Button>
            <button type="button" onClick={() => setStep("upload")} className="text-text-secondary text-sm hover:underline">
              Back
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className={CARD_CLASSES}>
          <h2 className="text-text-primary text-lg font-semibold">Preview</h2>
          <PreviewSummary preview={preview} />
          <RowResultsList rowDetails={preview.rowDetails} />

          <div className="mt-6 flex items-center gap-3">
            <Button type="button" onClick={handleConfirm} loading={pending} disabled={preview.validCount === 0}>
              Import {preview.validCount.toLocaleString()} {preview.validCount === 1 ? "record" : "records"}
            </Button>
            <button type="button" onClick={() => setStep("mapping")} className="text-text-secondary text-sm hover:underline">
              Back
            </button>
          </div>
        </div>
      )}

      {step === "summary" && summary && (
        <div className={CARD_CLASSES}>
          <h2 className="text-text-primary text-lg font-semibold">Import complete</h2>
          <SummaryCounts summary={summary} />
          <RowResultsList rowDetails={summary.rowDetails} />

          <div className="mt-6">
            <Link href={listHref}>
              <Button type="button">Back to {entityLabelPlural}</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportSteps({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "mapping", label: "Map columns" },
    { key: "preview", label: "Preview" },
    { key: "summary", label: "Summary" },
  ];
  const currentIndex = steps.findIndex((s) => s.key === current);

  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={
              i === currentIndex
                ? "text-text-primary font-medium"
                : i < currentIndex
                  ? "text-text-secondary"
                  : "text-text-muted"
            }
          >
            {i + 1}. {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-text-muted">/</span>}
        </li>
      ))}
    </ol>
  );
}

function PreviewSummary({ preview }: { preview: PreviewImportResult & { ok: true } }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <CountStat label="Total rows" value={preview.totalRows} />
      <CountStat label="Importable" value={preview.validCount} tone="success" />
      <CountStat label="Skipped" value={preview.skippedCount} tone="warning" />
      <CountStat label="Failed" value={preview.failedCount} tone="danger" />
    </dl>
  );
}

function SummaryCounts({ summary }: { summary: ExecuteImportResult & { ok: true } }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <CountStat label="Total rows" value={summary.totalRows} />
      <CountStat label="Imported" value={summary.importedCount} tone="success" />
      <CountStat label="Skipped" value={summary.skippedCount} tone="warning" />
      <CountStat label="Failed" value={summary.failedCount} tone="danger" />
    </dl>
  );
}

function CountStat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "danger" }) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-text-primary";
  return (
    <div>
      <dt className="text-text-secondary text-xs uppercase tracking-wide">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value.toLocaleString()}</dd>
    </div>
  );
}

function RowResultsList({ rowDetails }: { rowDetails: { row: number; outcome: "imported" | "skipped" | "failed"; message?: string }[] }) {
  const notable = rowDetails.filter((r) => r.outcome !== "imported");
  if (notable.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-text-primary text-sm font-medium">Row details</h3>
      <ul className="border-border-default divide-border-default mt-2 max-h-80 divide-y overflow-y-auto rounded-md border text-sm">
        {notable.map((r, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2">
            <span
              className={
                r.outcome === "skipped" ? "text-warning shrink-0 font-medium" : "text-danger shrink-0 font-medium"
              }
            >
              Row {r.row}
            </span>
            <span className="text-text-secondary">{r.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
