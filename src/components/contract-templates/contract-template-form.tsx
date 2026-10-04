"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useToast } from "@/components/toast/toast-provider";
import { withToast } from "@/lib/toast-url";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";
import type { ContractTemplateFieldErrors, ContractTemplateWritableInput } from "@/lib/contract-templates/validation";
import type { CreateContractTemplateResult, UpdateContractTemplateResult } from "@/lib/contract-templates/service";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export type ContractTemplateFormDefaults = {
  name?: string;
  title?: string;
  body?: string;
  /** A plain digit string for the input — blank means "no default expiry". `"0"` is valid and means "expires the same day it's issued" (see validation.ts's own [0, 3650] bound). */
  defaultExpiryOffsetDays?: string;
  internalNotes?: string;
};

/**
 * Contract Templates V1 — the single Create/Edit Contract Template form.
 * Built the same way InvoiceTemplateForm itself is (that component's own
 * header comment) rather than useActionState/FormData: `action` already
 * takes a plain, already-typed ContractTemplateWritableInput object, so
 * this component calls it directly inside startTransition and manages
 * fieldErrors as local state.
 *
 * No Client/Project/signatory, contract number, issueDate/effectiveDate,
 * a concrete expiresAt, or status — none of those exist on
 * ContractTemplate (Product Owner decision — see ContractTemplate's own
 * schema comment). `defaultExpiryOffsetDays` is the one Template-only
 * field: a relative day-count, not a date. `internalNotes` is staff-only,
 * copied verbatim into a newly created Contract's own internalNotes
 * (via the existing post-create `onSavedInternalNotes` mechanism —
 * ContractForm's own header comment), never shown to the contract's
 * signatory.
 *
 * No money/line-item fields and no live total preview of any kind —
 * Contract has neither (unlike Invoice/Quote Templates).
 */
export function ContractTemplateForm({
  action,
  defaultValues,
  submitLabel = "Save template",
  pendingLabel = "Saving…",
  successToast,
}: {
  action: (input: ContractTemplateWritableInput) => Promise<CreateContractTemplateResult | UpdateContractTemplateResult>;
  defaultValues?: ContractTemplateFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
  successToast: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [fieldErrors, setFieldErrors] = useState<ContractTemplateFieldErrors>({});

  const [name, setName] = useState(defaultValues?.name ?? "");
  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [body, setBody] = useState(defaultValues?.body ?? "");
  const [defaultExpiryOffsetDays, setDefaultExpiryOffsetDays] = useState(defaultValues?.defaultExpiryOffsetDays ?? "");
  const [internalNotes, setInternalNotes] = useState(defaultValues?.internalNotes ?? "");

  function dismissErrors() {
    setFieldErrors({});
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    dismissErrors();

    const input: ContractTemplateWritableInput = {
      name,
      title,
      body,
      defaultExpiryOffsetDays: defaultExpiryOffsetDays || undefined,
      internalNotes: internalNotes || undefined,
    };

    startTransition(async () => {
      try {
        const result = await action(input);
        if (result.ok) {
          router.push(withToast("/settings/contract-templates", successToast));
          return;
        }
        switch (result.reason) {
          case "VALIDATION":
            setFieldErrors(result.fieldErrors);
            return;
          case "FORBIDDEN":
            showToast("You don't have permission to do that.", "error");
            router.refresh();
            return;
          case "NOT_FOUND":
            showToast("This template could not be found — it may have been removed.", "error");
            router.push("/settings/contract-templates");
            return;
          default:
            showToast(GENERIC_ERROR, "error");
        }
      } catch (err) {
        showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField label="Template name" htmlFor="name" required error={fieldErrors.name}>
        <Input
          id="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? "name-error" : undefined}
        />
      </FormField>
      <p className="text-text-muted -mt-4 text-xs">For your own reference only — never shown to the contract&rsquo;s signatory.</p>

      <FormField label="Contract title" htmlFor="title" required error={fieldErrors.title}>
        <Input
          id="title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.title}
          aria-describedby={fieldErrors.title ? "title-error" : undefined}
        />
      </FormField>

      <FormField label="Contract body" htmlFor="body" required error={fieldErrors.body}>
        <Textarea
          id="body"
          rows={12}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.body}
          aria-describedby={fieldErrors.body ? "body-error" : undefined}
        />
      </FormField>

      <FormField label="Default expiry (days after issue)" htmlFor="defaultExpiryOffsetDays" error={fieldErrors.defaultExpiryOffsetDays}>
        <Input
          id="defaultExpiryOffsetDays"
          inputMode="numeric"
          value={defaultExpiryOffsetDays}
          onChange={(event) => {
            setDefaultExpiryOffsetDays(event.target.value);
            dismissErrors();
          }}
          placeholder="e.g. 30"
          aria-invalid={!!fieldErrors.defaultExpiryOffsetDays}
          aria-describedby="defaultExpiryOffsetDays-hint"
        />
        <p id="defaultExpiryOffsetDays-hint" className="text-text-muted mt-1 text-xs">
          Leave blank for no default. When set, applying this template fills in a new contract&rsquo;s expiry date
          this many days after its issue date (0 means expires the same day it&rsquo;s issued; 0–3650).
        </p>
      </FormField>

      <FormField label="Internal notes" htmlFor="internalNotes" error={fieldErrors.internalNotes}>
        <Textarea
          id="internalNotes"
          rows={3}
          value={internalNotes}
          onChange={(event) => {
            setInternalNotes(event.target.value);
            dismissErrors();
          }}
          aria-invalid={!!fieldErrors.internalNotes}
          aria-describedby={fieldErrors.internalNotes ? "internalNotes-error" : undefined}
        />
      </FormField>
      <p className="text-text-muted -mt-4 text-xs">
        Staff-only — never shown to the contract&rsquo;s signatory. Copied as-is into every contract created from this template.
      </p>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
