// Controllable fake for @/lib/storage/logo-storage (which imports
// "server-only" and would otherwise throw outside Next's own build — see
// test/integration/setup-mocks.ts for the vi.mock() that swaps it in).
// Mirrors test/support/storage-mock.ts's own shape exactly; kept as an
// independent module since logo Storage and Attachment Storage are
// deliberately separate systems (different bucket, different failure
// modes to control) — see logo-mutations.ts's own doc comment.

let uploadShouldFail = false;
export const removedLogoUrls: string[] = [];
let uploadCounter = 0;

export function setLogoUploadShouldFail(shouldFail: boolean): void {
  uploadShouldFail = shouldFail;
}

/**
 * Aqenra Free plan — reservation-expiry message-accuracy correction.
 * Same exact purpose as storage-mock.ts's own identical hook:
 * `uploadOrganizationLogo` has no injectable clock, so this is the one
 * genuine mid-flight pause point a test can use to simulate a slow/
 * stalled upload (e.g. forcing the just-created reservation into the
 * past) without a real multi-minute wait or any change to production
 * code.
 */
let midFlightHook: (() => Promise<void> | void) | null = null;

export function setLogoUploadMidFlightHook(hook: (() => Promise<void> | void) | null): void {
  midFlightHook = hook;
}

export function resetLogoStorageMock(): void {
  uploadShouldFail = false;
  removedLogoUrls.length = 0;
  uploadCounter = 0;
  midFlightHook = null;
}

export async function mockUploadLogoObject(): Promise<
  { ok: true; publicUrl: string } | { ok: false; reason: string }
> {
  if (midFlightHook) await midFlightHook();
  if (uploadShouldFail) return { ok: false, reason: "upload_failed" };
  uploadCounter += 1;
  return {
    ok: true,
    publicUrl: `https://mock.supabase.test/storage/v1/object/public/logos/mock-logo-${uploadCounter}.png`,
  };
}

export async function mockRemoveLogoObject({ publicUrl }: { publicUrl: string }): Promise<{ ok: true }> {
  removedLogoUrls.push(publicUrl);
  return { ok: true };
}
