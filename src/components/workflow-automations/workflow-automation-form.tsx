"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import type { WorkflowAutomationFormState } from "@/types";

/**
 * Workflow Automations V1 — Staff Authoring UI. The shared create/edit
 * form. Deliberately no business logic here: this component only builds
 * the two JSON blobs (`condition`, `action`) the Server Action layer
 * passes straight through to createWorkflowAutomation/
 * updateWorkflowAutomation unchanged — every rule about which trigger/
 * condition/operator/action/definition is actually valid is enforced
 * exclusively by that existing domain layer (src/lib/workflow-automations/
 * {automations,conditions,actions,custom-reference-validation}.ts,
 * untouched by this UI). What's rendered here is a *subset* driven by
 * already-resolved server data (`triggers`, `entityOptionsByEntityType`)
 * — never an invented field name, operator, or arbitrary definition id.
 *
 * V1 UI scope, deliberately narrower than what the domain model itself
 * allows: at most one condition and exactly one action per automation.
 * The domain layer accepts up to MAX_WORKFLOW_CONDITIONS/MAX_WORKFLOW_ACTIONS
 * of either — this form simply never exercises that range, matching the
 * "smallest coherent UI" scope for this block. A zero-action automation
 * would do nothing observable, so this form always requires exactly one.
 *
 * Trigger is create-only. updateWorkflowAutomation has no
 * triggerEntityType/triggerAction parameter at all — the trigger is
 * immutable after creation (Phase 1's own design) — so mode="edit" always
 * renders the trigger as plain text, never a select, and never resets
 * condition/action state on its account (there is nothing to change).
 */

export type WorkflowAutomationConditionField = {
  name: string;
  kind: "transition" | "snapshot";
  allowedValues: string[];
};

export type WorkflowAutomationTriggerOption = {
  entityType: "LEAD" | "CLIENT";
  action: "STATUS_CHANGED" | "CREATED";
  label: string;
  fields: WorkflowAutomationConditionField[];
  customReferenceEntityType: "LEAD" | "CLIENT";
};

export type WorkflowAutomationCustomStatusOptionUI = { id: string; label: string };

export type WorkflowAutomationCustomFieldOptionUI = {
  id: string;
  label: string;
  fieldType: "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT";
  options: { id: string; label: string }[];
};

export type WorkflowAutomationEntityOptionsUI = {
  customStatuses: WorkflowAutomationCustomStatusOptionUI[];
  customFields: WorkflowAutomationCustomFieldOptionUI[];
};

export type ConditionOperator = "EQUALS" | "NOT_EQUALS" | "CHANGED_TO" | "CHANGED_FROM" | "EXISTS";

const TRANSITION_OPERATORS: readonly ConditionOperator[] = ["EQUALS", "NOT_EQUALS", "CHANGED_TO", "CHANGED_FROM", "EXISTS"];
const SNAPSHOT_OPERATORS: readonly ConditionOperator[] = ["EQUALS", "NOT_EQUALS", "EXISTS"];

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  EQUALS: "is",
  NOT_EQUALS: "is not",
  CHANGED_TO: "changes to",
  CHANGED_FROM: "changes from",
  EXISTS: "is set",
};

type ActionType = "SET_CUSTOM_STATUS" | "SET_CUSTOM_FIELD_VALUE";

const initialState: WorkflowAutomationFormState = { error: null };

export type WorkflowAutomationFormDefaultValues = {
  name: string;
  triggerEntityType: "LEAD" | "CLIENT";
  triggerAction: "STATUS_CHANGED" | "CREATED";
  condition: { field: string; operator: ConditionOperator; value?: string } | null;
  action:
    | { type: "SET_CUSTOM_STATUS"; customStatusDefinitionId: string }
    | { type: "SET_CUSTOM_FIELD_VALUE"; customFieldDefinitionId: string; value: string | number | boolean }
    | null;
};

export function WorkflowAutomationForm({
  mode,
  action,
  triggers,
  entityOptionsByEntityType,
  defaultValues,
  submitLabel = "Create automation",
  pendingLabel = "Creating…",
}: {
  mode: "create" | "edit";
  action: (prevState: WorkflowAutomationFormState, formData: FormData) => Promise<WorkflowAutomationFormState>;
  /** The Phase 2 executable trigger allowlist only (create mode). Ignored in edit mode. */
  triggers: WorkflowAutomationTriggerOption[];
  entityOptionsByEntityType: Record<"LEAD" | "CLIENT", WorkflowAutomationEntityOptionsUI>;
  defaultValues?: WorkflowAutomationFormDefaultValues;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(
    (prevState: WorkflowAutomationFormState, formData: FormData) => callActionWithStaleRecovery(() => action(prevState, formData)),
    initialState,
  );

  const fixedTrigger =
    mode === "edit" && defaultValues
      ? (triggers.find((t) => t.entityType === defaultValues.triggerEntityType && t.action === defaultValues.triggerAction) ??
        // Defensive only — every automation this form ever edits was
        // created through this exact allowlist, so this can't genuinely
        // happen. Falls back to a minimal read-only shape rather than
        // crashing if it somehow does.
        {
          entityType: defaultValues.triggerEntityType,
          action: defaultValues.triggerAction,
          label: `${defaultValues.triggerEntityType} ${defaultValues.triggerAction}`,
          fields: [],
          customReferenceEntityType: defaultValues.triggerEntityType,
        })
      : null;

  const [selectedTriggerKey, setSelectedTriggerKey] = useState<string>(() => {
    if (fixedTrigger) return `${fixedTrigger.entityType}:${fixedTrigger.action}`;
    const first = triggers[0];
    return first ? `${first.entityType}:${first.action}` : "";
  });

  const selectedTrigger =
    (mode === "edit" ? fixedTrigger : triggers.find((t) => `${t.entityType}:${t.action}` === selectedTriggerKey)) ?? null;

  const entityOptions = selectedTrigger ? entityOptionsByEntityType[selectedTrigger.customReferenceEntityType] : undefined;

  // -- Condition state --------------------------------------------------
  const [conditionEnabled, setConditionEnabled] = useState(defaultValues?.condition != null);
  const [conditionField, setConditionField] = useState(
    defaultValues?.condition?.field ?? selectedTrigger?.fields[0]?.name ?? "",
  );
  const [conditionOperator, setConditionOperator] = useState<ConditionOperator>(defaultValues?.condition?.operator ?? "EQUALS");
  const [conditionValue, setConditionValue] = useState(defaultValues?.condition?.value ?? "");

  const activeFieldDef = selectedTrigger?.fields.find((f) => f.name === conditionField);
  const availableOperators = activeFieldDef?.kind === "transition" ? TRANSITION_OPERATORS : SNAPSHOT_OPERATORS;

  function handleTriggerChange(nextKey: string) {
    setSelectedTriggerKey(nextKey);
    const next = triggers.find((t) => `${t.entityType}:${t.action}` === nextKey);
    // Changing the trigger invalidates any condition/action tied to the
    // previous one's own field/entity vocabulary — reset both rather than
    // silently keeping a hidden, now-incompatible configuration.
    setConditionEnabled(false);
    setConditionField(next?.fields[0]?.name ?? "");
    setConditionOperator("EQUALS");
    setConditionValue("");
    setActionType("SET_CUSTOM_STATUS");
    setCustomStatusId("");
    setCustomFieldId("");
    setCustomFieldValue("");
  }

  // -- Action state -------------------------------------------------------
  const [actionType, setActionType] = useState<ActionType>(
    defaultValues?.action?.type ?? "SET_CUSTOM_STATUS",
  );
  const [customStatusId, setCustomStatusId] = useState(
    defaultValues?.action?.type === "SET_CUSTOM_STATUS" ? defaultValues.action.customStatusDefinitionId : "",
  );
  const [customFieldId, setCustomFieldId] = useState(
    defaultValues?.action?.type === "SET_CUSTOM_FIELD_VALUE" ? defaultValues.action.customFieldDefinitionId : "",
  );
  // Always a string in local state, even for a NUMBER-type field's stored
  // value (a genuine JS number when loaded from an existing action) —
  // normalizeNumberValue's own `Number(raw)` coercion already accepts a
  // string just as well, so there is no need to track two representations.
  const [customFieldValue, setCustomFieldValue] = useState<string | boolean>(() => {
    if (defaultValues?.action?.type !== "SET_CUSTOM_FIELD_VALUE") return "";
    const value = defaultValues.action.value;
    return typeof value === "boolean" ? value : String(value);
  });

  const selectedCustomField = entityOptions?.customFields.find((f) => f.id === customFieldId);

  const conditionJson = useMemo(() => {
    if (!conditionEnabled || !conditionField) return "";
    if (conditionOperator === "EXISTS") {
      return JSON.stringify({ field: conditionField, operator: conditionOperator });
    }
    if (!conditionValue) return "";
    return JSON.stringify({ field: conditionField, operator: conditionOperator, value: conditionValue });
  }, [conditionEnabled, conditionField, conditionOperator, conditionValue]);

  const actionJson = useMemo(() => {
    if (actionType === "SET_CUSTOM_STATUS") {
      if (!customStatusId) return "";
      return JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: customStatusId });
    }
    if (!customFieldId) return "";
    if (selectedCustomField?.fieldType === "CHECKBOX") {
      return JSON.stringify({ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: customFieldId, value: Boolean(customFieldValue) });
    }
    if (!customFieldValue) return "";
    return JSON.stringify({ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: customFieldId, value: customFieldValue });
  }, [actionType, customStatusId, customFieldId, customFieldValue, selectedCustomField]);

  const conditionSatisfied = !conditionEnabled || conditionJson !== "";
  const canSubmit = actionJson !== "" && conditionSatisfied;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="triggerEntityType" value={selectedTrigger?.entityType ?? ""} readOnly />
      <input type="hidden" name="triggerAction" value={selectedTrigger?.action ?? ""} readOnly />
      <input type="hidden" name="condition" value={conditionJson} readOnly />
      <input type="hidden" name="action" value={actionJson} readOnly />

      <FormField label="Name" htmlFor="name" required>
        <Input id="name" name="name" defaultValue={defaultValues?.name ?? ""} placeholder="e.g. Notify on lead loss" required />
      </FormField>

      <fieldset className="border-border-default space-y-4 border-t pt-4">
        <legend className="text-text-primary text-base font-semibold">Trigger</legend>
        {mode === "create" ? (
          <FormField label="When this happens" htmlFor="trigger">
            <Select id="trigger" value={selectedTriggerKey} onChange={(event) => handleTriggerChange(event.target.value)} required>
              {triggers.map((trigger) => (
                <option key={`${trigger.entityType}:${trigger.action}`} value={`${trigger.entityType}:${trigger.action}`}>
                  {trigger.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <p className="text-text-secondary text-sm">
            <span className="text-text-primary font-medium">{selectedTrigger?.label}</span>
            <span className="text-text-muted"> — the trigger can&rsquo;t be changed after an automation is created.</span>
          </p>
        )}
      </fieldset>

      {selectedTrigger && selectedTrigger.fields.length > 0 && (
        <fieldset className="border-border-default space-y-4 border-t pt-4">
          <legend className="text-text-primary text-base font-semibold">Condition</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={conditionEnabled}
              onChange={(event) => setConditionEnabled(event.target.checked)}
              className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            />
            <span className="text-text-secondary">Only run when a condition matches</span>
          </label>

          {conditionEnabled && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Field" htmlFor="conditionField">
                <Select
                  id="conditionField"
                  value={conditionField}
                  onChange={(event) => {
                    setConditionField(event.target.value);
                    setConditionOperator("EQUALS");
                    setConditionValue("");
                  }}
                >
                  {selectedTrigger.fields.map((field) => (
                    <option key={field.name} value={field.name}>
                      {field.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Operator" htmlFor="conditionOperator">
                <Select
                  id="conditionOperator"
                  value={conditionOperator}
                  onChange={(event) => setConditionOperator(event.target.value as ConditionOperator)}
                >
                  {availableOperators.map((operator) => (
                    <option key={operator} value={operator}>
                      {OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </Select>
              </FormField>

              {conditionOperator !== "EXISTS" && (
                <FormField label="Value" htmlFor="conditionValue">
                  <Select id="conditionValue" value={conditionValue} onChange={(event) => setConditionValue(event.target.value)}>
                    <option value="" disabled>
                      Select a value
                    </option>
                    {(activeFieldDef?.allowedValues ?? []).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </FormField>
              )}
            </div>
          )}
        </fieldset>
      )}

      <fieldset className="border-border-default space-y-4 border-t pt-4">
        <legend className="text-text-primary text-base font-semibold">Action</legend>
        <FormField label="What to do" htmlFor="actionType" required>
          <Select
            id="actionType"
            value={actionType}
            onChange={(event) => {
              setActionType(event.target.value as ActionType);
              setCustomStatusId("");
              setCustomFieldId("");
              setCustomFieldValue("");
            }}
            required
          >
            <option value="SET_CUSTOM_STATUS">Set custom status</option>
            <option value="SET_CUSTOM_FIELD_VALUE">Set custom field value</option>
          </Select>
        </FormField>

        {actionType === "SET_CUSTOM_STATUS" && (
          <FormField label="Custom status" htmlFor="customStatusId" required>
            <Select id="customStatusId" value={customStatusId} onChange={(event) => setCustomStatusId(event.target.value)} required>
              <option value="" disabled>
                Select a status
              </option>
              {(entityOptions?.customStatuses ?? []).map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </Select>
            {(entityOptions?.customStatuses ?? []).length === 0 && (
              <p className="text-text-muted mt-1 text-xs">
                No active custom statuses exist yet for this entity — create one under Settings → Custom statuses first.
              </p>
            )}
          </FormField>
        )}

        {actionType === "SET_CUSTOM_FIELD_VALUE" && (
          <>
            <FormField label="Custom field" htmlFor="customFieldId" required>
              <Select
                id="customFieldId"
                value={customFieldId}
                onChange={(event) => {
                  setCustomFieldId(event.target.value);
                  setCustomFieldValue("");
                }}
                required
              >
                <option value="" disabled>
                  Select a field
                </option>
                {(entityOptions?.customFields ?? []).map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label}
                  </option>
                ))}
              </Select>
              {(entityOptions?.customFields ?? []).length === 0 && (
                <p className="text-text-muted mt-1 text-xs">
                  No active custom fields exist yet for this entity — create one under Settings → Custom fields first.
                </p>
              )}
            </FormField>

            {selectedCustomField && (
              <FormField label="Value" htmlFor="customFieldValue" required>
                <CustomFieldValueInput field={selectedCustomField} value={customFieldValue} onChange={setCustomFieldValue} />
              </FormField>
            )}
          </>
        )}
      </fieldset>

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} disabled={!canSubmit || pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function CustomFieldValueInput({
  field,
  value,
  onChange,
}: {
  field: WorkflowAutomationCustomFieldOptionUI;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (field.fieldType === "CHECKBOX") {
    return (
      <input
        id="customFieldValue"
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
        className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      />
    );
  }
  if (field.fieldType === "SELECT") {
    return (
      <Select id="customFieldValue" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} required>
        <option value="" disabled>
          Select an option
        </option>
        {field.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      id="customFieldValue"
      type={field.fieldType === "DATE" ? "date" : field.fieldType === "NUMBER" ? "text" : "text"}
      inputMode={field.fieldType === "NUMBER" ? "decimal" : undefined}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      required
    />
  );
}
