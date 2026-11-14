"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { uploadCompanyLogoAction } from "./actions";
import type { LogoUploadState } from "@/types";
import { FormErrorMessage } from "@/components/ui/form-field";

const initialState: LogoUploadState = { error: null };

// Matches src/lib/storage/logo-config.ts's own ALLOWED_LOGO_TYPES — a
// client-side hint only (narrows what the file picker offers); the real,
// authoritative check is server-side in validateLogoFile(), same "never
// trust the client" contract every other upload in this app already
// follows (see AttachmentUploadForm's own ACCEPTED_EXTENSIONS).
const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp";

/**
 * Sale-Ready Phase A.1 (Business Identity), PR5. A separate <form>/
 * useActionState pair from CompanyProfileForm's own — not nested inside
 * it (HTML forbids a <form> within a <form>), and wired to its own Server
 * Action (uploadCompanyLogoAction, added in PR4) rather than
 * updateCompanyProfileAction. Rendered as its own card in page.tsx,
 * directly after the main form, so the existing Business Identity layout
 * itself is untouched.
 *
 * No delete control — replacing is the only mutation this stage offers
 * (see this PR's own scope); logo removal is a deliberately separate,
 * later concern.
 *
 * Keyed by currentLogoUrl on the outer wrapper below: a successful
 * upload's own revalidatePath("/settings/company") (see actions.ts) is
 * the only thing that ever changes that prop, so a key change here means
 * "an upload just persisted" — remounting a fresh LogoUploadFormInner at
 * that point resets its local preview, its native <input type="file">,
 * and its useActionState all at once, for free, with no manual
 * setState-in-effect or ref-during-render bookkeeping needed. A failed
 * upload never changes currentLogoUrl, so the component deliberately
 * never remounts on failure — the error message and the picked file both
 * stay put for the OWNER to see and retry.
 */
export function LogoUploadForm({ currentLogoUrl }: { currentLogoUrl: string | null }) {
  return <LogoUploadFormInner key={currentLogoUrl ?? "none"} currentLogoUrl={currentLogoUrl} />;
}

function LogoUploadFormInner({ currentLogoUrl }: { currentLogoUrl: string | null }) {
  const [state, formAction, pending] = useActionState(uploadCompanyLogoAction, initialState);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Revokes the current blob: URL whenever a new file replaces it (inside
  // handleFileChange) or when this component instance unmounts — the
  // latter covers both a normal page navigation away and the remount
  // described in this module's own top-level doc comment.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreviewUrl((existing) => {
      if (existing) URL.revokeObjectURL(existing);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  const displayedUrl = previewUrl ?? currentLogoUrl;

  return (
    <div className={`mt-6 space-y-4 p-6 ${CARD_SURFACE_CLASSES}`}>
      <div>
        <h2 className="text-text-primary text-base font-semibold">Logo</h2>
        <p className="text-text-muted mt-1 text-sm">PNG, JPEG, or WebP. Max 2 MB.</p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="border-border-default bg-surface-muted flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border">
          {displayedUrl ? (
            // Deliberately a plain <img>, not next/image: this shows either
            // a client-only blob: URL (a live pre-upload preview) or an
            // external Supabase Storage URL — the former next/image's
            // optimizer cannot process at all, and using it only for the
            // latter would mean two different rendering paths for what is,
            // to this component, the same "show the current logo" concern.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayedUrl} alt="Organization logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-text-muted text-xs">No logo</span>
          )}
        </div>

        <form action={formAction} className="min-w-[220px] flex-1 space-y-2">
          <FileInput
            id="logo-file-input"
            name="file"
            required
            disabled={pending}
            accept={ACCEPTED_TYPES}
            onChange={handleFileChange}
            aria-invalid={!!state.error}
            triggerLabel="Choose logo"
          />
          {state.error && (
            <FormErrorMessage className="text-sm">
              {state.error}
            </FormErrorMessage>
          )}
          <Button type="submit" loading={pending}>
            {pending ? "Uploading…" : currentLogoUrl ? "Replace logo" : "Upload logo"}
          </Button>
        </form>
      </div>
    </div>
  );
}
