/**
 * Multiple Contacts Phase 2 (Staff UI). Mirrors src/lib/validation/
 * client.ts and lead.ts's own conventions exactly: the same EMAIL_PATTERN,
 * the same trim-then-null-if-empty rule for optional text fields, the same
 * bounded max-length-per-field shape. `phone` has no format validation
 * beyond a max length — matches Client.phone's own existing convention
 * (src/lib/validation/client.ts's parseClientForm never validates phone
 * format either, only trims it).
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CONTACT_NAME_MAX_LENGTH = 200;
export const CONTACT_EMAIL_MAX_LENGTH = 320; // RFC 5321 maximum
export const CONTACT_PHONE_MAX_LENGTH = 32;
// A role is a short descriptor ("Owner", "Billing contact"), not a
// freeform note — capped well short of NOTES-style fields.
export const CONTACT_ROLE_MAX_LENGTH = 100;

export type ClientContactFieldErrors = Partial<Record<"name" | "email" | "phone" | "role", string>>;

export type ParsedClientContactInput = {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  isBilling: boolean;
};

/** Trims, then treats an empty result as absent — matches client.ts's own trimmedOrNull. */
function trimmedOrNull(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Shared by both the Add and Edit contact forms. `isPrimary` is parsed
 * here for both (the raw checkbox value), but the Edit action never reads
 * it back out of the result — see updateContactAction's own comment for
 * why: primary can only ever change through the dedicated "Set primary"
 * action, never a plain field edit.
 */
export function parseClientContactForm(formData: FormData): {
  values: ParsedClientContactInput;
  fieldErrors: ClientContactFieldErrors;
} {
  const name = String(formData.get("name") ?? "").trim();
  const email = trimmedOrNull(formData.get("email"));
  const phone = trimmedOrNull(formData.get("phone"));
  const role = trimmedOrNull(formData.get("role"));
  const isPrimary = formData.get("isPrimary") === "on";
  const isBilling = formData.get("isBilling") === "on";

  const fieldErrors: ClientContactFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Name is required.";
  } else if (name.length > CONTACT_NAME_MAX_LENGTH) {
    fieldErrors.name = `Must be ${CONTACT_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (email) {
    if (!EMAIL_PATTERN.test(email)) {
      fieldErrors.email = "Enter a valid email address.";
    } else if (email.length > CONTACT_EMAIL_MAX_LENGTH) {
      fieldErrors.email = `Must be ${CONTACT_EMAIL_MAX_LENGTH} characters or fewer.`;
    }
  }

  if (phone && phone.length > CONTACT_PHONE_MAX_LENGTH) {
    fieldErrors.phone = `Must be ${CONTACT_PHONE_MAX_LENGTH} characters or fewer.`;
  }

  if (role && role.length > CONTACT_ROLE_MAX_LENGTH) {
    fieldErrors.role = `Must be ${CONTACT_ROLE_MAX_LENGTH} characters or fewer.`;
  }

  return {
    values: { name, email, phone, role, isPrimary, isBilling },
    fieldErrors,
  };
}
