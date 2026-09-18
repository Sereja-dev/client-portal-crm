import type { Role } from "@/generated/prisma/enums";

/**
 * Roles / Permissions V1 — the one immutable, code-defined catalog of
 * configurable permission keys (architecture lock validation, locked spec
 * §2/§7). This is the ONLY source of truth for which permission keys
 * exist, what they're called, what they default to, and how they're
 * grouped in the management UI — RolePermissionOverride.permissionKey is
 * a plain String precisely so that adding/removing a key here never
 * requires a database migration (see that model's own schema doc
 * comment). Every other module (resolver, management action, nav
 * gating, tests) imports from here rather than re-deriving any of this.
 *
 * Exactly 9 keys, matching the 9 existing OWNER/ADMIN-vs-MEMBER
 * authorization boundaries the architecture lock validation confirmed
 * against the real repository — no key here represents a boundary that
 * doesn't already exist in the codebase today.
 */
export const PERMISSION_KEYS = [
  "ANALYTICS_VIEW",
  "REPORTS_VIEW",
  "DATA_IMPORT",
  "DATA_EXPORT",
  "RECURRING_INVOICES_MANAGE",
  "TAGS_MANAGE",
  "WORKFLOW_AUTOMATIONS_MANAGE",
  "QUOTE_TEMPLATES_MANAGE",
  "INDUSTRY_PRESETS_APPLY",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Matches the management page's own required grouping (locked spec §11/§15). */
export type PermissionGroup = "Insights" | "Data" | "Finance / Operations" | "Settings";

export type PermissionCatalogEntry = {
  key: PermissionKey;
  label: string;
  description: string;
  group: PermissionGroup;
};

/**
 * Display order doubles as management-UI render order (locked spec §11's
 * own listed order) — never re-sorted at render time.
 */
export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  {
    key: "ANALYTICS_VIEW",
    label: "Analytics",
    description: "View the Analytics dashboard (revenue-adjacent counts, growth trends).",
    group: "Insights",
  },
  {
    key: "REPORTS_VIEW",
    label: "Reports",
    description: "View the Reports page (paid revenue, leads, time, top clients).",
    group: "Insights",
  },
  {
    key: "DATA_IMPORT",
    label: "Import",
    description: "Import Clients and Leads from a CSV file.",
    group: "Data",
  },
  {
    key: "DATA_EXPORT",
    label: "Export",
    description: "Export Clients and Leads to a CSV file.",
    group: "Data",
  },
  {
    key: "RECURRING_INVOICES_MANAGE",
    label: "Recurring invoices",
    description: "View and manage recurring invoice schedules.",
    group: "Finance / Operations",
  },
  {
    key: "TAGS_MANAGE",
    label: "Tags",
    description: "Create, rename, and archive tag definitions. Assigning existing tags to records is never affected by this permission.",
    group: "Settings",
  },
  {
    key: "WORKFLOW_AUTOMATIONS_MANAGE",
    label: "Workflow automations",
    description: "View and manage workflow automations.",
    group: "Settings",
  },
  {
    key: "QUOTE_TEMPLATES_MANAGE",
    label: "Quote templates",
    description: "Create, edit, archive, restore, and duplicate quote templates. Applying an active template to a quote is never affected by this permission.",
    group: "Settings",
  },
  {
    key: "INDUSTRY_PRESETS_APPLY",
    label: "Apply industry presets",
    description: "Apply an industry preset to the organization. Viewing and previewing presets is never affected by this permission.",
    group: "Settings",
  },
] as const;

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/** Fails closed on anything not exactly one of the 9 catalog keys — never a prefix/substring match. */
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_KEY_SET.has(value);
}

/**
 * Groups PERMISSION_CATALOG by its own `group` field, preserving both
 * PERMISSION_CATALOG's own entry order within each group and each
 * group's own first-appearance order (Insights, Data, Finance /
 * Operations, Settings — locked spec §11's own listed order) — the
 * management page renders groups/entries in exactly this order, never
 * re-sorted.
 */
export function getGroupedPermissionCatalog(): readonly { group: PermissionGroup; entries: readonly PermissionCatalogEntry[] }[] {
  const groups: { group: PermissionGroup; entries: PermissionCatalogEntry[] }[] = [];
  for (const entry of PERMISSION_CATALOG) {
    let bucket = groups.find((g) => g.group === entry.group);
    if (!bucket) {
      bucket = { group: entry.group, entries: [] };
      groups.push(bucket);
    }
    bucket.entries.push(entry);
  }
  return groups;
}

export function getPermissionCatalogEntry(key: PermissionKey): PermissionCatalogEntry {
  // PERMISSION_CATALOG and PERMISSION_KEYS are defined together above and
  // kept in lockstep by construction (one entry per key, same order) —
  // this lookup can't miss for a value that already passed isPermissionKey.
  const entry = PERMISSION_CATALOG.find((e) => e.key === key);
  if (!entry) {
    throw new Error(`No catalog entry for permission key "${key}" — PERMISSION_CATALOG/PERMISSION_KEYS have drifted apart.`);
  }
  return entry;
}

/**
 * The catalog default for a given role, independent of any
 * RolePermissionOverride row. `key` is part of the signature (not just
 * `role`) so a future permission whose default genuinely needs to differ
 * from this uniform rule has exactly one place to add that exception —
 * today, every one of the 9 keys defaults identically (locked spec §2/§6,
 * confirmed against the real repository for every key): OWNER is always
 * allowed (though callers should prefer the short-circuit in
 * getEffectivePermission() rather than relying on this for OWNER, since
 * OWNER's access is unconditional and never override-able), ADMIN
 * defaults allowed, MEMBER defaults denied.
 */
export function getDefaultPermission(role: Role, key: PermissionKey): boolean {
  // `key` intentionally participates in this function's signature/body
  // rather than being an unused parameter — see this function's own doc
  // comment on why it exists even though every current key resolves the
  // same way.
  void key;
  return role === "OWNER" || role === "ADMIN";
}
