import "server-only";

/**
 * Public Lead Capture Forms, Phase 1 (foundation). The V1 field set is
 * deliberately small and fixed — visible/required/order/label-override
 * for exactly these five built-in Lead fields, never a generic
 * drag-and-drop schema engine and never arbitrary Custom Field submission
 * (both explicitly out of scope for this phase — see the approved Phase 1
 * spec). A later phase can extend this list; nothing here assumes it
 * never will.
 */
export const LEAD_CAPTURE_FORM_FIELD_KEYS = ["name", "company", "email", "phone", "message"] as const;

export type LeadCaptureFormFieldKey = (typeof LEAD_CAPTURE_FORM_FIELD_KEYS)[number];

export function isLeadCaptureFormFieldKey(value: unknown): value is LeadCaptureFormFieldKey {
  return typeof value === "string" && (LEAD_CAPTURE_FORM_FIELD_KEYS as readonly string[]).includes(value);
}

export type LeadCaptureFormFieldConfig = {
  visible: boolean;
  required: boolean;
  order: number;
  /** null = use this field's own default label below. */
  label: string | null;
};

export type LeadCaptureFormFieldsConfig = Partial<Record<LeadCaptureFormFieldKey, LeadCaptureFormFieldConfig>>;

/** Every key present, never partial — what a submission/render pass actually works against. */
export type ResolvedLeadCaptureFormFieldsConfig = Record<LeadCaptureFormFieldKey, LeadCaptureFormFieldConfig>;

export const LEAD_CAPTURE_FORM_DEFAULT_LABELS: Record<LeadCaptureFormFieldKey, string> = {
  name: "Name",
  company: "Company",
  email: "Email",
  phone: "Phone",
  message: "Message",
};

const LEAD_CAPTURE_FORM_FIELD_LABEL_MAX_LENGTH = 100;

/**
 * A fresh object literal every call — never a shared mutable reference a
 * caller could accidentally hold onto and mutate across organizations.
 */
export function defaultLeadCaptureFormFieldsConfig(): ResolvedLeadCaptureFormFieldsConfig {
  return {
    name: { visible: true, required: true, order: 0, label: null },
    company: { visible: true, required: false, order: 1, label: null },
    email: { visible: true, required: false, order: 2, label: null },
    phone: { visible: true, required: false, order: 3, label: null },
    message: { visible: true, required: false, order: 4, label: null },
  };
}

/**
 * Fills in any field key missing from `config` with its own default entry
 * — never partial output. Also the single place `name`'s own
 * visible/required are forced true regardless of what was stored: Lead.name
 * is NOT NULL at the database itself (see parseLeadInput's own identical
 * requirement), so a public form that could hide or optionalize the one
 * field every Lead must have would only ever produce a confusing 500-style
 * failure downstream — silently enforced here, the same "protected
 * invariant" shape as the LEAD default status lock (setDefaultCustomStatusDefinition's
 * own LEAD_DEFAULT_LOCKED rule), just coerced rather than rejected since
 * there's no caller-facing action boundary here to reject at.
 */
export function resolveLeadCaptureFormFieldsConfig(config: LeadCaptureFormFieldsConfig): ResolvedLeadCaptureFormFieldsConfig {
  const defaults = defaultLeadCaptureFormFieldsConfig();
  const resolved = { ...defaults };
  for (const key of LEAD_CAPTURE_FORM_FIELD_KEYS) {
    const entry = config[key];
    if (entry) {
      resolved[key] = { ...defaults[key], ...entry };
    }
  }
  resolved.name = { ...resolved.name, visible: true, required: true };
  return resolved;
}

export type PublicLeadCaptureFormField = {
  key: LeadCaptureFormFieldKey;
  label: string;
  required: boolean;
};

/**
 * The safe, public render schema: visible fields only, in configured
 * order, with each label resolved to its override or default — never the
 * raw stored config (which may describe hidden fields, and whose own
 * shape is an internal implementation detail).
 */
export function buildPublicLeadCaptureFormFields(config: LeadCaptureFormFieldsConfig): PublicLeadCaptureFormField[] {
  const resolved = resolveLeadCaptureFormFieldsConfig(config);
  return LEAD_CAPTURE_FORM_FIELD_KEYS.filter((key) => resolved[key].visible)
    .sort((a, b) => resolved[a].order - resolved[b].order)
    .map((key) => ({
      key,
      label: resolved[key].label ?? LEAD_CAPTURE_FORM_DEFAULT_LABELS[key],
      required: resolved[key].required,
    }));
}

/**
 * Validates a staff-supplied partial fields config (e.g. from a future
 * settings form). Unknown keys, wrong-typed values, or an out-of-range
 * order are all rejected outright — this never silently drops or
 * coerces a malformed *staff* input (unlike resolveLeadCaptureFormFieldsConfig's
 * own defaulting, which only ever fills in what's genuinely absent).
 */
export function validateLeadCaptureFormFieldsConfigInput(
  raw: unknown,
): { ok: true; config: LeadCaptureFormFieldsConfig } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, config: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Fields configuration must be an object." };
  }

  const config: LeadCaptureFormFieldsConfig = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLeadCaptureFormFieldKey(key)) {
      return { ok: false, error: `Unknown field "${key}".` };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, error: `Invalid configuration for field "${key}".` };
    }
    const entry = value as Record<string, unknown>;

    const visible = entry.visible;
    if (visible !== undefined && typeof visible !== "boolean") {
      return { ok: false, error: `Field "${key}": visible must be a boolean.` };
    }
    const required = entry.required;
    if (required !== undefined && typeof required !== "boolean") {
      return { ok: false, error: `Field "${key}": required must be a boolean.` };
    }
    const order = entry.order;
    if (order !== undefined && (typeof order !== "number" || !Number.isInteger(order) || order < 0)) {
      return { ok: false, error: `Field "${key}": order must be a non-negative integer.` };
    }
    let label: string | null | undefined = undefined;
    if (entry.label !== undefined) {
      if (entry.label !== null && typeof entry.label !== "string") {
        return { ok: false, error: `Field "${key}": label must be a string or null.` };
      }
      const trimmed = entry.label === null ? null : entry.label.trim();
      if (trimmed && trimmed.length > LEAD_CAPTURE_FORM_FIELD_LABEL_MAX_LENGTH) {
        return { ok: false, error: `Field "${key}": label must be ${LEAD_CAPTURE_FORM_FIELD_LABEL_MAX_LENGTH} characters or fewer.` };
      }
      label = trimmed || null;
    }

    const defaults = defaultLeadCaptureFormFieldsConfig()[key];
    config[key] = {
      visible: visible ?? defaults.visible,
      required: required ?? defaults.required,
      order: order ?? defaults.order,
      label: label !== undefined ? label : defaults.label,
    };
  }

  return { ok: true, config };
}
