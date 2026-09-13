export type AuthActionState = {
  error: string | null;
  message?: string | null;
};

export type ClientFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<
      | "name"
      | "email"
      | "company"
      | "phone"
      | "status"
      | "statusDefinitionId"
      | "billingLegalName"
      | "taxId"
      | "streetAddress"
      | "city"
      | "state"
      | "postalCode"
      | "country",
      string
    >
  >;
  // Custom Fields Phase 2B — keyed by definitionId (never a fixed field
  // name, since the active definition set is org-configured), kept
  // separate from `fieldErrors` above rather than folded into that fixed
  // union. Shared by ClientFormState/LeadFormState/ProjectFormState —
  // same shape in all three, each with its own copy of this comment.
  customFieldErrors?: Record<string, string>;
};

// Multiple Contacts Phase 2 (Staff UI). Shared by both the Add and Edit
// contact forms — mirrors ClientFormState's own shape exactly. `isPrimary`
// has no field-level error of its own (it's a checkbox, never invalid on
// its own terms) so it's deliberately absent from this union, matching
// PortalInvitationFormState's own precedent of only listing fields that
// can actually produce a validation error.
export type ClientContactFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"name" | "email" | "phone" | "role", string>>;
};

// Custom Fields Phase 2A (Staff UI). CreateDefinitionForm's own shape
// includes `fieldType` (required, create-only); EditDefinitionForm reuses
// this same type but its own parser (parseCustomFieldDefinitionUpdateForm)
// never populates a `fieldType` field error, since fieldType isn't
// editable there at all.
export type CustomFieldDefinitionFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"label" | "fieldType", string>>;
};

export type CustomFieldOptionFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"label", string>>;
};

// Custom Statuses Phase 2B (Staff UI). Mirrors CustomFieldDefinitionFormState's
// own exact shape — `color` is a select, never invalid on its own terms
// (a fixed CustomStatusColor enum with a sensible default, Section F), so
// it's deliberately absent from this union, matching
// ClientContactFormState's own "only list fields that can actually
// produce a validation error" precedent.
export type CustomStatusDefinitionFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"label", string>>;
};

// Tags V2 (Staff UI). Mirrors CustomStatusDefinitionFormState's own exact
// shape — `color` is a select, never invalid on its own terms, so it's
// deliberately absent here too.
export type TagFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"name", string>>;
};

// Public Lead Capture Forms Phase 2A (Staff UI). Mirrors
// CustomStatusDefinitionFormState's own exact shape. `fieldsConfig` has no
// per-sub-field error of its own — the whole per-field table is one
// client-side-validated unit (see FieldsConfigEditor), so a rejection from
// the domain layer's own validateLeadCaptureFormFieldsConfigInput (a
// genuinely unexpected case, since the UI itself prevents every invalid
// combination it knows about before submit) surfaces as the generic
// `error` string, not a field-level one.
export type LeadCaptureFormMetadataFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"name" | "title" | "description" | "successMessage", string>>;
};

export type ProjectFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<"name" | "clientId" | "status" | "statusDefinitionId" | "startDate" | "endDate", string>
  >;
  // Custom Fields Phase 2B — see ClientFormState's own identical field for the full comment.
  customFieldErrors?: Record<string, string>;
};

export type TaskFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<"title" | "projectId" | "status" | "priority" | "dueDate", string>
  >;
};

// Leads / Sales Pipeline Phase 3. Same field set as
// src/lib/validation/lead.ts's own LeadFieldErrors (create/edit's shared
// writable fields) — kept as its own self-contained union here rather
// than imported, matching ClientFormState/TaskFormState's own existing
// convention of not cross-importing from a validation module.
export type LeadFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<"name" | "company" | "email" | "phone" | "source" | "value" | "notes" | "assignedToUserId", string>
  >;
  // Custom Fields Phase 2B — see ClientFormState's own identical field for the full comment.
  customFieldErrors?: Record<string, string>;
};

// Invoice System Slice 2b (docs/invoicing-architecture.md §5/§14 Slice 2).
// "status" is deliberately absent — it is never a submitted create/edit
// form field (DRAFT-only creation; a dedicated lifecycle action owns
// status for existing non-DRAFT invoices, see status-actions.ts).
export type InvoiceScalarFieldKey =
  | "invoiceNumber"
  | "clientId"
  | "projectId"
  | "mode"
  | "amount"
  | "currency"
  | "issueDate"
  | "dueDate"
  | "notes"
  | "internalNotes"
  | "discountType"
  | "discountValue"
  | "taxRatePercent"
  | "taxLabel"
  | "lineItems";

export type InvoiceLineItemFieldKey = "description" | "quantity" | "unitPrice";

export type InvoiceFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<InvoiceScalarFieldKey, string>>;
  /** Keyed by the submitted array index — matches the row order the client rendered. */
  lineItemErrors?: Record<number, Partial<Record<InvoiceLineItemFieldKey, string>>>;
};

export type InvitationFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"email" | "role", string>>;
  message?: string | null;
  /** Set on success so the UI can render a copyable invite link. */
  token?: string;
  /**
   * True when the Invitation was created/updated successfully but the
   * email itself could not be delivered — `message` still describes what
   * happened, this just tells the UI to render it as a warning instead of
   * a success (Copy link remains the fallback either way).
   */
  emailFailed?: boolean;
};

export type InviteAcceptState = {
  error: string | null;
};

export type PortalInvitationFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"email", string>>;
  message?: string | null;
  /** Set on success so the UI can render a copyable invite link. */
  token?: string;
  /**
   * True when the ClientInvitation was created/updated successfully but the
   * email itself could not be delivered — `message` still describes what
   * happened, this just tells the UI to render it as a warning instead of
   * a success (Copy link remains the fallback either way).
   */
  emailFailed?: boolean;
};

export type MembershipActionState = {
  error: string | null;
};

export type AttachmentUploadState = {
  error: string | null;
};

// Sale-Ready Phase A.1 (Business Identity), PR4 — same shape as
// AttachmentUploadState, kept as its own type rather than reused: a logo
// upload is not an Attachment (see logo-mutations.ts), and the two are
// free to diverge independently as either evolves.
export type LogoUploadState = {
  error: string | null;
};

export type CommentActionState = {
  error: string | null;
};

// Communication Timeline Phase 2 (Staff UI). Shared by the create/edit
// note actions on both the Client and Lead edit pages — a note body is
// never invalid on any field other than itself, same reasoning
// CommentActionState's own shape already documents.
export type TimelineNoteActionState = {
  error: string | null;
};

export type CompanyProfileFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<
      | "legalName"
      | "displayName"
      | "country"
      | "currency"
      | "timezone"
      // Sale-Ready Phase A.1 (Business Identity), PR2 — all nine below are
      // optional fields; a fieldError only ever appears for one of them
      // when a *non-empty* value fails its own format check, never for
      // being empty (they're nullable, not required).
      | "supportEmail"
      | "website"
      | "phone"
      | "taxId"
      | "brandColor"
      | "streetAddress"
      | "city"
      | "state"
      | "postalCode",
      string
    >
  >;
  message?: string | null;
};

export type PaymentDetailsFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"bankName" | "accountHolder" | "accountNumber" | "swiftBic" | "paymentInstructions", string>>;
  message?: string | null;
};

export type DomainSettingsFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"customDomain", string>>;
  message?: string | null;
};

// Client Requests / Tickets Phase 2A. Shared by both the Portal create
// form and the (never-built-in-this-phase, but same shape for
// consistency) Staff equivalent.
export type ClientRequestCreateFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"title" | "description" | "priority" | "projectId", string>>;
};

// Shared by the Portal and Staff message composers — a message body is
// never invalid on any field OTHER than itself, so this is deliberately
// just a single generic error, not a fieldErrors map (mirrors
// CommentActionState's own shape for the same reason).
export type ClientRequestMessageFormState = {
  error: string | null;
};

// Time Tracking Phase 2A (Staff UI). Shared by createTimeEntryAction and
// updateTimeEntryAction — one fieldErrors shape covering every
// TimeEntryForm field, including "durationMinutes" for the combined
// Hours+Minutes pair (see combineDurationInput's own doc comment: the UI
// splits duration into two inputs, but any resulting error — whether
// from the hours/minutes combination step itself or from the domain
// layer's own 1..1440 check — is shown as one message under that pair).
export type TimeEntryFormState = {
  error: string | null;
  fieldErrors?: Partial<Record<"userId" | "projectId" | "taskId" | "workDate" | "durationMinutes" | "description", string>>;
};

// Recurring Invoices Phase 2A (Staff UI). Shared by createRecurringInvoiceAction
// and updateRecurringInvoiceAction — the key set matches
// src/lib/validation/recurring-invoice.ts's own RecurringInvoiceFieldErrors
// exactly (not imported directly — this file stays free of a src/lib
// dependency, same "own inline key union" convention TimeEntryFormState/
// InvoiceFormState already use), plus "frequency"/"firstIssueDate" for the
// two create-only fields the domain layer also validates by format before
// ever reaching resolveRecurringInvoiceTarget.
export type RecurringInvoiceFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<
      | "name"
      | "clientId"
      | "projectId"
      | "frequency"
      | "firstIssueDate"
      | "invoiceNumberPrefix"
      | "startingSequence"
      | "dueDateOffsetDays"
      | "currency"
      | "discountType"
      | "discountValue"
      | "taxRatePercent"
      | "taxLabel"
      | "notes"
      | "internalNotes"
      | "lineItems",
      string
    >
  >;
};

// Workflow Automations V1 — Staff Authoring UI. Shared by createWorkflowAutomationAction
// and updateWorkflowAutomationAction. Deliberately a single generic error,
// not a fieldErrors map — createWorkflowAutomation/updateWorkflowAutomation
// (src/lib/workflow-automations/automations.ts) already return one
// consolidated VALIDATION message covering name/trigger/conditions/actions
// together (mirrors ClientRequestMessageFormState's own identical "one
// error, no per-field map" shape, for the same reason: the domain layer
// itself has no per-field error model to surface here).
export type WorkflowAutomationFormState = {
  error: string | null;
};
