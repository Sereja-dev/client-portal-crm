"use client";

import { Fragment, useState, useTransition } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { Role } from "@/generated/prisma/enums";
import type { PermissionCatalogEntry, PermissionGroup, PermissionKey } from "@/lib/permissions/catalog";

export type RolePermissionsDraft = Record<"ADMIN" | "MEMBER", Record<PermissionKey, boolean>>;

type GroupedCatalog = readonly { group: PermissionGroup; entries: readonly PermissionCatalogEntry[] }[];

type EditableRole = "ADMIN" | "MEMBER";

const EDITABLE_ROLES: readonly EditableRole[] = ["ADMIN", "MEMBER"];
const ROLE_LABEL: Record<EditableRole, string> = { ADMIN: "Admin", MEMBER: "Member" };

/**
 * Roles / Permissions V1 management UI (locked spec §11/§12/§15). One
 * shared draft covering BOTH editable roles at once — switching the
 * mobile role tab never discards the other role's unsaved edits. Save
 * calls `action` once per role that actually changed (never a call for
 * an untouched role), so a single Save press can persist edits to Admin
 * and Member together while still going through
 * updateRolePermissionsAction's own one-role-at-a-time contract.
 *
 * Desktop/tablet (`xl:` and up, matching src/components/ui/record-list.tsx's
 * own measured breakpoint) renders a real `<table>` with both role
 * columns visible together. Below `xl`, a role-tab switcher plus a
 * single stacked toggle list avoids the cramped two-column layout locked
 * spec §12 explicitly warns against at 390px.
 */
export function RolePermissionsManager({
  action,
  groups,
  initial,
}: {
  action: (role: Role, state: unknown) => Promise<{ error: string | null }>;
  groups: GroupedCatalog;
  initial: RolePermissionsDraft;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<RolePermissionsDraft>(initial);
  const [savedState, setSavedState] = useState<RolePermissionsDraft>(initial);
  const [activeTab, setActiveTab] = useState<EditableRole>("ADMIN");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDirty = EDITABLE_ROLES.some((role) =>
    groups.some((g) => g.entries.some((entry) => draft[role][entry.key] !== savedState[role][entry.key])),
  );

  function toggle(role: EditableRole, key: PermissionKey) {
    setDraft((prev) => ({ ...prev, [role]: { ...prev[role], [key]: !prev[role][key] } }));
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const changedRoles = EDITABLE_ROLES.filter((role) =>
        groups.some((g) => g.entries.some((entry) => draft[role][entry.key] !== savedState[role][entry.key])),
      );

      for (const role of changedRoles) {
        const result = await action(role, draft[role]);
        if (result.error) {
          setError(result.error);
          showToast(result.error, "error");
          return;
        }
      }

      setSavedState(draft);
      showToast("Permissions saved.");
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p role="alert" className="text-danger mb-4 text-sm">
          {error}
        </p>
      )}

      {/* Desktop/tablet — both role columns visible together. */}
      <div className={`hidden overflow-x-auto xl:block ${CARD_SURFACE_CLASSES}`}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-border-default border-b">
              <th scope="col" className="text-text-muted px-4 py-3 font-medium">
                Permission
              </th>
              <th scope="col" className="text-text-muted px-4 py-3 text-center font-medium">
                Owner
              </th>
              <th scope="col" className="text-text-muted px-4 py-3 text-center font-medium">
                Admin
              </th>
              <th scope="col" className="text-text-muted px-4 py-3 text-center font-medium">
                Member
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.group}>
                {g.entries.map((entry) => (
                  <tr key={entry.key} className="border-border-subtle border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="text-text-primary font-medium">{entry.label}</span>
                      <p className="text-text-muted mt-0.5 text-xs">{entry.description}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-text-muted text-xs">Always allowed</span>
                    </td>
                    {EDITABLE_ROLES.map((role) => (
                      <td key={role} className="px-4 py-3 text-center">
                        <PermissionCheckbox
                          checked={draft[role][entry.key]}
                          onChange={() => toggle(role, entry.key)}
                          label={`${entry.label} for ${ROLE_LABEL[role]}`}
                          disabled={isPending}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile/narrow tablet — role tabs, one stacked list at a time. */}
      <div className="xl:hidden">
        <div role="tablist" aria-label="Role" className="mb-4 flex gap-1">
          {EDITABLE_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              role="tab"
              aria-selected={activeTab === role}
              onClick={() => setActiveTab(role)}
              className={`focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                activeTab === role
                  ? "bg-accent text-white"
                  : "border-border-strong text-text-primary border hover:bg-[var(--hover)]"
              }`}
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>

        <div role="tabpanel" className={`p-4 ${CARD_SURFACE_CLASSES}`}>
          {groups.map((g) => (
            <div key={g.group} className="mb-5 last:mb-0">
              <h3 className="text-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">{g.group}</h3>
              <ul className="space-y-3">
                {g.entries.map((entry) => (
                  <li key={entry.key} className="border-border-subtle flex items-start justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm font-medium">{entry.label}</p>
                      <p className="text-text-muted mt-0.5 text-xs">{entry.description}</p>
                    </div>
                    <PermissionCheckbox
                      checked={draft[activeTab][entry.key]}
                      onChange={() => toggle(activeTab, entry.key)}
                      label={`${entry.label} for ${ROLE_LABEL[activeTab]}`}
                      disabled={isPending}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isPending}
          className="focus-visible:ring-focus-ring bg-accent hover:bg-accent-hover inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {isDirty && !isPending && <span className="text-text-muted text-xs">Unsaved changes</span>}
      </div>
    </div>
  );
}

function PermissionCheckbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="border-border-strong text-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}
