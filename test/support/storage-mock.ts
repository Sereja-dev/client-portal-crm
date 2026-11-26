// Controllable fake for @/lib/storage/attachments-storage (which imports
// "server-only" and would otherwise throw outside Next's own build — see
// test/integration/setup-mocks.ts for the vi.mock() that swaps it in).
// This never touches a real Supabase Storage bucket; it only lets
// attachment integration tests exercise the REAL uploadAttachmentForEntity/
// deleteAttachmentForEntity Prisma+Activity logic, including the
// upload-succeeds-but-DB-fails compensation path.

let uploadShouldFail = false;
export const removedPaths: string[] = [];

export function setUploadShouldFail(shouldFail: boolean): void {
  uploadShouldFail = shouldFail;
}

/**
 * Aqenra Free plan — reservation-expiry message-accuracy correction.
 * `uploadAttachmentForEntity` has no injectable clock, so the only way to
 * exercise its REAL timing-dependent reservation-consumption path (as
 * opposed to just the underlying primitive, in isolation) is to pause
 * somewhere genuinely inside its own execution and let a concurrent test
 * action run — the real Storage upload call is the one and only await
 * point between "reservation created" and "reservation consumed"
 * (storagePath/the Attachment row are all built synchronously around
 * it). When set, this hook is awaited by `mockUploadAttachmentObject`
 * BEFORE it returns success, giving a test a genuine mid-flight window
 * to, e.g., force the just-created reservation into the past — exactly
 * simulating a slow/stalled upload without a real multi-minute wait or
 * any change to production code.
 */
let midFlightHook: (() => Promise<void> | void) | null = null;

export function setUploadMidFlightHook(hook: (() => Promise<void> | void) | null): void {
  midFlightHook = hook;
}

// Portal Analytics persistence foundation (docs/analytics-architecture.md
// §12, Slice 1) — controllable fake for createAttachmentSignedUrl, the one
// export this module previously left unmocked (nothing needed it until the
// portal download route's own analytics-write-ordering tests did). A
// deterministic successful URL by default, so tests that don't care about
// the signed-URL step at all don't need to configure anything; resettable
// to a forced failure for the one test that specifically needs the 502
// path.
let signedUrlShouldFail = false;

export function setSignedUrlShouldFail(shouldFail: boolean): void {
  signedUrlShouldFail = shouldFail;
}

export function resetStorageMock(): void {
  uploadShouldFail = false;
  signedUrlShouldFail = false;
  removedPaths.length = 0;
  midFlightHook = null;
}

export async function mockUploadAttachmentObject(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (midFlightHook) await midFlightHook();
  if (uploadShouldFail) return { ok: false, reason: "upload_failed" };
  return { ok: true };
}

export async function mockRemoveAttachmentObject({
  path,
}: {
  path: string;
}): Promise<{ ok: true }> {
  removedPaths.push(path);
  return { ok: true };
}

export async function mockCreateAttachmentSignedUrl(): Promise<
  { ok: true; url: string } | { ok: false; reason: string }
> {
  if (signedUrlShouldFail) return { ok: false, reason: "provider_error" };
  return { ok: true, url: "https://mock-storage.test/signed/mock-object" };
}
