/**
 * Custom Statuses Phase 2B (Section F/T) — the one canonical color
 * picker option list, shared by the create and edit dialogs. Supported
 * colors come exclusively from the CustomStatusColor enum (Section F: "No
 * arbitrary hex picker") — labels are the same semantic-tone vocabulary
 * StatusBadge's own STATUS_TONES map already established app-wide, never
 * invented here.
 */
export const COLOR_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "NEUTRAL", label: "Neutral" },
  { value: "INFO", label: "Info (blue)" },
  { value: "WARNING", label: "Warning (yellow)" },
  { value: "SUCCESS", label: "Success (green)" },
  { value: "DANGER", label: "Danger (red)" },
  { value: "MUTED", label: "Muted" },
];
