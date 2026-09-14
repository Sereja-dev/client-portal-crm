import { parseDateOnly } from "@/lib/invoices/date-only";
import { isUuid } from "@/lib/validation/lead";

/**
 * Contracts Phase 1. Plain-object input, not FormData — no Staff UI
 * exists yet (a later phase), matching Quote's own exact precedent
 * (src/lib/validation/quote.ts's own header comment): every domain
 * function below takes this already-typed input directly; a future form
 * layer can build a FormData -> this-shape adapter without this module
 * changing at all.
 *
 * Structural/format parsing only — this module never touches the
 * database. Client/Project/signatory *ownership* is resolved and
 * enforced separately by resolveContractTarget()/resolveContractSignatory()
 * (the real authorization boundary), never re-derived here.
 */

// Matches QUOTE_NUMBER_MAX_LENGTH exactly (src/lib/validation/quote.ts) —
// a real reference number, not an essay.
export const CONTRACT_NUMBER_MAX_LENGTH = 50;
// Matches QUOTE_TITLE_MAX_LENGTH exactly.
export const CONTRACT_TITLE_MAX_LENGTH = 200;
// This app's one existing "large freeform text" convention is 10,000
// characters (CLIENT_NOTES_MAX_LENGTH/LEAD_NOTES_MAX_LENGTH/
// INVOICE_NOTES_MAX_LENGTH/QUOTE_NOTES_MAX_LENGTH/
// QUOTE_TEMPLATE_NOTES_MAX_LENGTH all agree on this exact number) — but
// `body` is not a "notes" field, it is the actual document content, so a
// plain reuse of that bound would be too small for a genuine multi-page
// contract. 50,000 (a deliberate, bounded 5x multiple of the app's own
// established convention, not an arbitrary new number) is generous
// enough for a real short-to-medium-form freelance/agency contract while
// still being an explicit, enforced ceiling — never accidentally
// unbounded.
export const CONTRACT_BODY_MAX_LENGTH = 50_000;
// Matches CLIENT_NOTES_MAX_LENGTH/QUOTE_NOTES_MAX_LENGTH exactly — this
// really is a "notes" field.
export const CONTRACT_INTERNAL_NOTES_MAX_LENGTH = 10_000;

export type ContractFieldErrors = Partial<
  Record<
    "contractNumber" | "title" | "body" | "clientId" | "projectId" | "signatoryContactId" | "issueDate" | "effectiveDate" | "expiresAt",
    string
  >
>;

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Every field a caller may ever supply directly to create/update a
 * Contract's own DRAFT *document* content. Deliberately excludes
 * organizationId, status, sentAt/acceptedAt/acceptedByUserId/
 * acceptedByPortalUserId/terminatedAt, every snapshot, archivedAt,
 * createdByUserId, createdAt/updatedAt — none of these is ever
 * caller-supplied (see service.ts). Also deliberately excludes
 * `internalNotes` — that field is Staff-only, editable in every status
 * (not just DRAFT), and is parsed/updated through its own separate,
 * dedicated path (parseContractInternalNotes below +
 * updateContractInternalNotes in service.ts) specifically so this
 * shape's own DRAFT-only immutability rule can never accidentally be
 * bypassed by, or accidentally applied to, a field that was never
 * supposed to share it (locked architecture §8).
 */
export type ContractWritableInput = {
  contractNumber: unknown;
  title: unknown;
  body: unknown;
  clientId: unknown;
  projectId?: unknown;
  signatoryContactId?: unknown;
  issueDate: unknown;
  effectiveDate?: unknown;
  expiresAt?: unknown;
};

export type ParsedContractValues = {
  contractNumber: string;
  title: string;
  body: string;
  clientId: string;
  projectId: string | null;
  signatoryContactId: string | null;
  issueDate: Date;
  effectiveDate: Date | null;
  expiresAt: Date | null;
};

export function parseContractInput(input: ContractWritableInput): {
  values: ParsedContractValues;
  fieldErrors: ContractFieldErrors;
} {
  const fieldErrors: ContractFieldErrors = {};

  const contractNumber = trimmedOrNull(input.contractNumber) ?? "";
  if (!contractNumber) {
    fieldErrors.contractNumber = "Contract number is required.";
  } else if (contractNumber.length > CONTRACT_NUMBER_MAX_LENGTH) {
    fieldErrors.contractNumber = `Must be ${CONTRACT_NUMBER_MAX_LENGTH} characters or fewer.`;
  }

  const title = trimmedOrNull(input.title) ?? "";
  if (!title) {
    fieldErrors.title = "Title is required.";
  } else if (title.length > CONTRACT_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Must be ${CONTRACT_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  // Body is deliberately NOT trimmed of internal whitespace/newlines —
  // only checked for "is there real content" via a trimmed-length probe,
  // exactly like every other required free-text field here. The
  // ORIGINAL, untrimmed string is what gets stored (a document's own
  // leading/trailing blank line is the author's choice, not noise to
  // silently strip), unlike contractNumber/title/internalNotes, which
  // are reference/label fields where trimming stray whitespace is
  // clearly correct.
  const bodyRaw = typeof input.body === "string" ? input.body : "";
  const bodyTrimmedLength = bodyRaw.trim().length;
  if (bodyTrimmedLength === 0) {
    fieldErrors.body = "Contract content is required.";
  } else if (bodyRaw.length > CONTRACT_BODY_MAX_LENGTH) {
    fieldErrors.body = `Must be ${CONTRACT_BODY_MAX_LENGTH} characters or fewer.`;
  }

  const clientId = trimmedOrNull(input.clientId) ?? "";
  if (!clientId) {
    fieldErrors.clientId = "Select a client.";
  } else if (!isUuid(clientId)) {
    fieldErrors.clientId = "Select a valid client.";
  }

  const projectIdRaw = trimmedOrNull(input.projectId);
  let projectId: string | null = null;
  if (projectIdRaw !== null) {
    if (!isUuid(projectIdRaw)) {
      fieldErrors.projectId = "Select a valid project.";
    } else {
      projectId = projectIdRaw;
    }
  }

  const signatoryContactIdRaw = trimmedOrNull(input.signatoryContactId);
  let signatoryContactId: string | null = null;
  if (signatoryContactIdRaw !== null) {
    if (!isUuid(signatoryContactIdRaw)) {
      fieldErrors.signatoryContactId = "Select a valid signatory.";
    } else {
      signatoryContactId = signatoryContactIdRaw;
    }
  }

  let issueDate: Date | null = null;
  const issueDateParsed = parseDateOnly(trimmedOrNull(input.issueDate) ?? "");
  if (!issueDateParsed.ok) {
    fieldErrors.issueDate = "Enter a valid issue date.";
  } else {
    issueDate = issueDateParsed.date;
  }

  let effectiveDate: Date | null = null;
  const effectiveDateRaw = trimmedOrNull(input.effectiveDate);
  if (effectiveDateRaw) {
    const effectiveDateParsed = parseDateOnly(effectiveDateRaw);
    if (!effectiveDateParsed.ok) {
      fieldErrors.effectiveDate = "Enter a valid effective date.";
    } else {
      effectiveDate = effectiveDateParsed.date;
      // Cannot take effect before the document itself is dated.
      if (issueDate && effectiveDate.getTime() < issueDate.getTime()) {
        fieldErrors.effectiveDate = "Cannot be earlier than the issue date.";
      }
    }
  }

  let expiresAt: Date | null = null;
  const expiresAtRaw = trimmedOrNull(input.expiresAt);
  if (expiresAtRaw) {
    const expiresAtParsed = parseDateOnly(expiresAtRaw);
    if (!expiresAtParsed.ok) {
      fieldErrors.expiresAt = "Enter a valid expiry date.";
    } else {
      expiresAt = expiresAtParsed.date;
      // Expiry must be strictly after whichever "start" reference
      // applies: the effective date when one is set (the contract can't
      // expire before it even takes effect), else the issue date.
      const startReference = effectiveDate ?? issueDate;
      if (startReference && expiresAt.getTime() <= startReference.getTime()) {
        fieldErrors.expiresAt = effectiveDate
          ? "Must be after the effective date."
          : "Must be after the issue date.";
      }
    }
  }

  return {
    values: {
      contractNumber,
      title,
      body: bodyRaw,
      clientId,
      projectId,
      signatoryContactId,
      issueDate: issueDate ?? new Date(0),
      effectiveDate,
      expiresAt,
    },
    fieldErrors,
  };
}

export function hasContractFormErrors(fieldErrors: ContractFieldErrors): boolean {
  return Object.keys(fieldErrors).length > 0;
}

/**
 * The dedicated, structurally separate parse path for `internalNotes`
 * (see ContractWritableInput's own header comment above for why). Never
 * bundled into parseContractInput/ContractFieldErrors — a caller updating
 * internal notes only ever sees this function's own small, independent
 * result shape, so there is no shared "fieldErrors" object a future edit
 * could accidentally wire into the DRAFT-only document-update path.
 */
export type ParseContractInternalNotesResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseContractInternalNotes(raw: unknown): ParseContractInternalNotesResult {
  const value = trimmedOrNull(raw);
  if (value && value.length > CONTRACT_INTERNAL_NOTES_MAX_LENGTH) {
    return { ok: false, error: `Must be ${CONTRACT_INTERNAL_NOTES_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, value };
}
