import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { validateLogoFile, buildLogoStoragePath } from "@/lib/storage/logo-files";
import { uploadLogoObject, removeLogoObject } from "@/lib/storage/logo-storage";
import { checkRateLimit, LOGO_UPLOAD_LIMIT } from "@/lib/rate-limit";
import { reserveStorageBytes, releaseStorageReservation } from "@/lib/billing/storage-reservation";
import { REASON_MESSAGES } from "@/lib/billing/enforcement";
import type { LogoUploadState } from "@/types";

const VALIDATION_ERROR_MESSAGES: Record<string, string> = {
  empty_file: "The selected file is empty.",
  file_too_large: "This file is too large. Maximum size is 2 MB.",
  type_not_allowed: "Only PNG, JPEG, and WebP images are supported.",
  extension_mismatch: "The file extension doesn't match its detected type.",
};

/**
 * Sale-Ready Phase A.1 (Business Identity), PR4. OWNER-only — the caller
 * (the Server Action) must call canManageCompanyProfile()/
 * assertCanManageCompanyProfile() first, the same "authorization happens at
 * the call site" shape upsertCompanyProfile() itself already follows.
 *
 * Requires an OrganizationProfile row to already exist. Deliberately never
 * creates one: legalName/country/currency/timezone are all required
 * (non-null) columns on that row, so a logo-triggered create would have to
 * write placeholder values into fields that are otherwise only ever set
 * together, as a deliberate whole, via the Business Identity text form
 * (see upsertCompanyProfile). An OWNER who uploads a logo before ever
 * saving that form gets a clear, actionable error instead.
 */
export async function uploadOrganizationLogo({
  organizationId,
  actorId,
  formData,
}: {
  organizationId: string;
  actorId: string;
  formData: FormData;
}): Promise<LogoUploadState> {
  const limitCheck = checkRateLimit(LOGO_UPLOAD_LIMIT, actorId);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const profile = await prisma.organizationProfile.findUnique({
    where: { organizationId },
    select: { logoUrl: true, logoSizeBytes: true },
  });
  if (!profile) {
    return { error: "Save your business details before uploading a logo." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a file to upload." };
  }

  const validation = validateLogoFile({ name: file.name, type: file.type, size: file.size });
  if (!validation.valid) {
    return { error: VALIDATION_ERROR_MESSAGES[validation.error] };
  }

  // Aqenra Free plan — the logo upload path previously had NO storage-
  // limit check at all: a logo could be written regardless of how far
  // over the organization's quota it would push the total. Gated now,
  // the same way uploadAttachmentForEntity already is. `netAdditionalBytes`
  // — not the new file's full size — is what gets reserved/checked: a
  // replacement REPLACES logoSizeBytes rather than adding to it (one logo
  // per organization, never cumulative), so reserving the full new size
  // on top of the old one still being counted would wrongly reject even
  // a same-size replacement when the organization is already near its
  // ceiling. A same-size-or-smaller replacement is always a no-op here
  // (reserveStorageBytes treats a non-positive amount as an automatic
  // success) — it can only ever reduce total usage.
  const previousLogoSizeBytes = profile.logoSizeBytes ?? 0;
  const netAdditionalBytes = file.size - previousLogoSizeBytes;
  // Wrapped in try/catch for the same reason as
  // uploadAttachmentForEntity's own identical call: reserveStorageBytes
  // performs a real write and can fail on an unexpected DB error, not
  // just return its normal typed `{ok: false}` result.
  let reservation: Awaited<ReturnType<typeof reserveStorageBytes>>;
  try {
    reservation = await reserveStorageBytes(organizationId, netAdditionalBytes);
  } catch {
    return { error: "Failed to save the uploaded logo. Please try again." };
  }
  if (!reservation.ok) {
    return { error: REASON_MESSAGES[reservation.reason] };
  }

  const storagePath = buildLogoStoragePath({
    organizationId,
    uuid: randomUUID(),
    extension: validation.extension,
  });

  const uploadResult = await uploadLogoObject({
    path: storagePath,
    body: file,
    contentType: validation.mimeType,
  });
  if (!uploadResult.ok) {
    await releaseStorageReservation(reservation.reservationId);
    return { error: "Failed to upload the logo. Please try again." };
  }

  const previousLogoUrl = profile.logoUrl;

  try {
    await prisma.organizationProfile.update({
      where: { organizationId },
      // Aqenra Free plan — organization storage accounting
      // (src/lib/billing/usage.ts). `file.size` is already validated
      // above (validateLogoFile) — recorded here, alongside the new
      // logoUrl itself, so the two always change together.
      data: { logoUrl: uploadResult.publicUrl, logoSizeBytes: file.size },
    });
  } catch {
    // Compensate for the already-uploaded object — the DB write is what
    // failed here, not the upload, the same reasoning
    // uploadAttachmentForEntity's own compensation path already follows.
    await removeLogoObject({ publicUrl: uploadResult.publicUrl });
    await releaseStorageReservation(reservation.reservationId);
    return { error: "Failed to save the uploaded logo. Please try again." };
  }

  // The OrganizationProfile row above has now committed its new
  // logoSizeBytes — the real, committed-usage sum reflects these bytes
  // directly now, so the reservation that held this upload's place until
  // now is released.
  await releaseStorageReservation(reservation.reservationId);

  // Best-effort cleanup of the previous logo object, deliberately after
  // the DB write has already committed: a Storage failure here must never
  // fail this request, and must never roll back a logoUrl change that has
  // already succeeded. A leftover Storage object is an invisible orphan.
  if (previousLogoUrl) {
    await removeLogoObject({ publicUrl: previousLogoUrl });
  }

  return { error: null };
}
