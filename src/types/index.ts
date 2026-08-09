export type AuthActionState = {
  error: string | null;
  message?: string | null;
};

export type ClientFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<"name" | "email" | "company" | "phone" | "status", string>
  >;
};

export type ProjectFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<"name" | "clientId" | "status" | "startDate" | "endDate", string>
  >;
};

export type TaskFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<"title" | "projectId" | "status" | "priority" | "dueDate", string>
  >;
};

export type InvoiceFormState = {
  error: string | null;
  fieldErrors?: Partial<
    Record<
      "invoiceNumber" | "projectId" | "amount" | "status" | "dueDate",
      string
    >
  >;
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

export type CommentActionState = {
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
