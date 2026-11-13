"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import type { AttachmentUploadState } from "@/types";
import { FormErrorMessage } from "@/components/ui/form-field";

const initialState: AttachmentUploadState = { error: null };

const ACCEPTED_EXTENSIONS =
  ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx";

export function AttachmentUploadForm({
  action,
  disabled = false,
  disabledReason,
}: {
  action: (
    prevState: AttachmentUploadState,
    formData: FormData,
  ) => Promise<AttachmentUploadState>;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clears the file input after a successful upload — the page's own data
  // refresh (via revalidatePath in the action) is what makes the new file
  // show up in the list; this just resets the control itself.
  useEffect(() => {
    if (!pending && state.error === null) {
      formRef.current?.reset();
    }
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-start gap-3">
      <div className="min-w-[220px] flex-1">
        <FileInput
          id="attachment-file-input"
          name="file"
          required
          disabled={disabled || pending}
          accept={ACCEPTED_EXTENSIONS}
          triggerLabel="Choose file"
        />
        {state.error && (
          <FormErrorMessage className="mt-1 text-sm">
            {state.error}
          </FormErrorMessage>
        )}
        {disabled && disabledReason && !state.error && (
          <p className="text-text-muted mt-1 text-sm">{disabledReason}</p>
        )}
      </div>
      <Button type="submit" loading={pending} disabled={disabled}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
