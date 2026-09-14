"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useToast } from "@/components/toast/toast-provider";
import { withToast } from "@/lib/toast-url";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";
import type { ContractFieldErrors, ContractWritableInput } from "@/lib/contracts/validation";
import type { CreateContractResult, UpdateContractDocumentResult, UpdateContractInternalNotesResult } from "@/lib/contracts/service";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export type ContractFormOption = { id: string; name: string; clientId: string };

export type ContractFormDefaults = {
  contractNumber?: string;
  clientId?: string;
  projectId?: string;
  signatoryContactId?: string;
  title?: string;
  body?: string;
  issueDate?: string;
  effectiveDate?: string;
  expiresAt?: string;
  /** Create mode only — see this component's own header comment for why this never reaches createContract() directly. */
  internalNotes?: string;
};

/**
 * Contracts Phase 2 (Staff UI) — the single Create/Edit Contract document
 * form. Built the same way QuoteTemplateForm/QuoteForm already are
 * (their own header comments' shared reasoning): `action` already takes
 * a plain, already-typed ContractWritableInput object — matching
 * createContract()/updateContractDocument()'s own exact Phase 1 shape —
 * so this component calls it directly inside startTransition and manages
 * fieldErrors as local state, rather than useActionState/FormData.
 *
 * `internalNotes` is NOT part of ContractWritableInput at all (locked
 * architecture §15/§21: internalNotes is Staff-only metadata, structurally
 * kept out of the document-content shape so a generic update can never
 * bypass SENT immutability for it — see validation.ts's own header
 * comment). This form only ever renders the internalNotes field in
 * create mode (`onSavedInternalNotes` supplied), and after a successful
 * create, saves it via a SEPARATE call to updateContractInternalNotes's
 * own dedicated action — never folded into the create call itself. Edit
 * mode never renders this field at all; internal notes editing after
 * creation happens exclusively through ContractInternalNotesForm on the
 * detail page.
 *
 * Client -> Project/Signatory cascading mirrors InvoiceForm's own exact
 * UX (src/components/invoices/invoice-form.tsx): changing the Client
 * clears a Project/signatory selection that no longer belongs to the
 * newly chosen Client (never silently carries a stale one forward) — a
 * UX convenience only; the server (resolveContractTarget/
 * resolveContractSignatory) is still the real authority regardless
 * (locked architecture §10).
 */
export function ContractForm({
  action,
  onSavedInternalNotes,
  clients,
  projects,
  signatories,
  defaultValues,
  submitLabel = "Save contract",
  pendingLabel = "Saving…",
  successToast,
  cancelHref,
}: {
  action: (input: ContractWritableInput) => Promise<CreateContractResult | UpdateContractDocumentResult>;
  /** Create mode only — called once, best-effort, right after a successful create if the internalNotes field has real content. */
  onSavedInternalNotes?: (contractId: string, notes: string) => Promise<UpdateContractInternalNotesResult>;
  clients: { id: string; name: string }[];
  projects: ContractFormOption[];
  /** Already filtered to this organization's non-archived ClientContacts by the caller page — see resolveContractSignatory's own identical "never offer an archived contact for a new/updated DRAFT" rule. */
  signatories: ContractFormOption[];
  defaultValues?: ContractFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
  successToast: string;
  cancelHref: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [fieldErrors, setFieldErrors] = useState<ContractFieldErrors>({});

  const [clientId, setClientId] = useState(defaultValues?.clientId ?? "");
  const [projectId, setProjectId] = useState(defaultValues?.projectId ?? "");
  const [signatoryContactId, setSignatoryContactId] = useState(defaultValues?.signatoryContactId ?? "");
  const projectsForClient = projects.filter((project) => project.clientId === clientId);
  const signatoriesForClient = signatories.filter((contact) => contact.clientId === clientId);

  const [contractNumber, setContractNumber] = useState(defaultValues?.contractNumber ?? "");
  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [body, setBody] = useState(defaultValues?.body ?? "");
  const [issueDate, setIssueDate] = useState(defaultValues?.issueDate ?? "");
  const [effectiveDate, setEffectiveDate] = useState(defaultValues?.effectiveDate ?? "");
  const [expiresAt, setExpiresAt] = useState(defaultValues?.expiresAt ?? "");
  const [internalNotes, setInternalNotes] = useState(defaultValues?.internalNotes ?? "");

  function dismissErrors() {
    setFieldErrors({});
  }

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    if (projectId && !projects.some((project) => project.id === projectId && project.clientId === nextClientId)) {
      setProjectId("");
    }
    if (signatoryContactId && !signatories.some((contact) => contact.id === signatoryContactId && contact.clientId === nextClientId)) {
      setSignatoryContactId("");
    }
    dismissErrors();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    dismissErrors();

    const input: ContractWritableInput = {
      contractNumber,
      title,
      body,
      clientId,
      projectId: projectId || undefined,
      signatoryContactId: signatoryContactId || undefined,
      issueDate,
      effectiveDate: effectiveDate || undefined,
      expiresAt: expiresAt || undefined,
    };

    startTransition(async () => {
      try {
        const result = await action(input);
        if (result.ok) {
          if (onSavedInternalNotes && internalNotes.trim()) {
            try {
              await onSavedInternalNotes(result.contract.id, internalNotes);
            } catch {
              // Best-effort only — the contract itself was created
              // successfully regardless; a failed notes save is
              // reported but never rolls back or blocks navigation.
              showToast("Contract created, but internal notes could not be saved — add them from the contract page.", "error");
            }
          }
          // Both create and edit always redirect to the same place — the
          // Contract's own detail page. Deliberately not a caller-supplied
          // `redirectTo` callback prop: this Client Component is rendered
          // from a Server Component page, and a plain closure (not a
          // Server Action) cannot cross that boundary as a prop at all
          // ("Functions cannot be passed directly to Client Components").
          router.push(withToast(`/contracts/${result.contract.id}`, successToast));
          return;
        }
        switch (result.reason) {
          case "VALIDATION":
            setFieldErrors(result.fieldErrors);
            return;
          case "INVALID_TARGET":
            setFieldErrors((prev) => ({ ...prev, clientId: "Select a valid client and project." }));
            showToast("The selected client or project is invalid.", "error");
            return;
          case "INVALID_SIGNATORY":
            setFieldErrors((prev) => ({
              ...prev,
              signatoryContactId: "This contact is no longer available — they may have been archived. Choose another or clear this field.",
            }));
            return;
          case "CONTRACT_NUMBER_CONFLICT":
            setFieldErrors((prev) => ({ ...prev, contractNumber: "A contract with this number already exists." }));
            return;
          case "NOT_FOUND":
            showToast("This contract could not be found — it may have been removed.", "error");
            router.push("/contracts");
            return;
          case "NOT_EDITABLE":
            showToast("This contract can no longer be edited — it may have been sent, archived, or changed elsewhere.", "error");
            router.refresh();
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
      <FormField label="Contract number" htmlFor="contractNumber" required error={fieldErrors.contractNumber}>
        <Input
          id="contractNumber"
          value={contractNumber}
          onChange={(event) => {
            setContractNumber(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.contractNumber}
          aria-describedby={fieldErrors.contractNumber ? "contractNumber-error" : undefined}
        />
      </FormField>

      <FormField label="Client" htmlFor="clientId" required error={fieldErrors.clientId}>
        <Select
          id="clientId"
          value={clientId}
          onChange={(event) => handleClientChange(event.target.value)}
          required
          aria-invalid={!!fieldErrors.clientId}
          aria-describedby={fieldErrors.clientId ? "clientId-error" : undefined}
        >
          <option value="" disabled>
            Select a client
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Project" htmlFor="projectId" error={fieldErrors.projectId}>
        <Select
          id="projectId"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            dismissErrors();
          }}
          disabled={!clientId}
          aria-invalid={!!fieldErrors.projectId}
          aria-describedby={fieldErrors.projectId ? "projectId-error" : undefined}
        >
          <option value="">No project</option>
          {projectsForClient.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        {clientId && projectsForClient.length === 0 && (
          <p className="text-text-muted mt-1 text-xs">This client has no projects yet — that&rsquo;s fine, the contract can stay project-less.</p>
        )}
      </FormField>

      <FormField label="Intended signatory" htmlFor="signatoryContactId" error={fieldErrors.signatoryContactId}>
        <Select
          id="signatoryContactId"
          value={signatoryContactId}
          onChange={(event) => {
            setSignatoryContactId(event.target.value);
            dismissErrors();
          }}
          disabled={!clientId}
          aria-invalid={!!fieldErrors.signatoryContactId}
          aria-describedby="signatoryContactId-hint"
        >
          <option value="">No intended signatory</option>
          {signatoriesForClient.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </Select>
        <p id="signatoryContactId-hint" className="text-text-muted mt-1 text-xs">
          Who this contract is addressed to, for reference only — recording this is not the same as that person accepting the
          contract. Only this client&rsquo;s active contacts are shown.
        </p>
      </FormField>

      <FormField label="Title" htmlFor="title" required error={fieldErrors.title}>
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
          rows={16}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            dismissErrors();
          }}
          required
          className="font-mono"
          aria-invalid={!!fieldErrors.body}
          aria-describedby={fieldErrors.body ? "body-error" : "body-hint"}
        />
        {!fieldErrors.body && (
          <p id="body-hint" className="text-text-muted mt-1 text-xs">
            Plain text only. Line breaks and spacing are preserved as written when this contract is shown or sent.
          </p>
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Issue date" htmlFor="issueDate" required error={fieldErrors.issueDate}>
          <Input
            id="issueDate"
            type="date"
            value={issueDate}
            onChange={(event) => {
              setIssueDate(event.target.value);
              dismissErrors();
            }}
            required
            aria-invalid={!!fieldErrors.issueDate}
            aria-describedby={fieldErrors.issueDate ? "issueDate-error" : undefined}
          />
        </FormField>

        <FormField label="Effective date" htmlFor="effectiveDate" error={fieldErrors.effectiveDate}>
          <Input
            id="effectiveDate"
            type="date"
            value={effectiveDate}
            onChange={(event) => {
              setEffectiveDate(event.target.value);
              dismissErrors();
            }}
            aria-invalid={!!fieldErrors.effectiveDate}
            aria-describedby={fieldErrors.effectiveDate ? "effectiveDate-error" : undefined}
          />
        </FormField>

        <FormField label="Expiry date" htmlFor="expiresAt" error={fieldErrors.expiresAt}>
          <Input
            id="expiresAt"
            type="date"
            value={expiresAt}
            onChange={(event) => {
              setExpiresAt(event.target.value);
              dismissErrors();
            }}
            aria-invalid={!!fieldErrors.expiresAt}
            aria-describedby={fieldErrors.expiresAt ? "expiresAt-error" : undefined}
          />
        </FormField>
      </div>

      {onSavedInternalNotes && (
        <FormField label="Internal notes" htmlFor="internalNotes">
          <Textarea
            id="internalNotes"
            rows={3}
            value={internalNotes}
            onChange={(event) => setInternalNotes(event.target.value)}
            aria-describedby="internalNotes-hint"
          />
          <p id="internalNotes-hint" className="text-text-muted mt-1 text-xs">
            Staff-only. Internal notes are never shown as part of the contract document, and stay editable at every later
            stage from the contract page.
          </p>
        </FormField>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
