import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnsavedChangesScope, useUnsavedChangesScope } from "@/components/forms/unsaved-changes-scope";

/**
 * Forms Improvement Slice C1a — real-render coverage for
 * `UnsavedChangesScope`'s own INITIAL state only. `renderToStaticMarkup`
 * is a one-shot render (no event loop, no re-render across a simulated
 * interaction, and `useEffect` never fires during SSR) — this repo has
 * no jsdom/@testing-library/react harness to drive an actual
 * dirty-toggle sequence and observe the resulting `beforeunload`
 * registration or `useUnsavedChangesScope().setIsDirty` calls (the same
 * limitation `use-bounded-selection.test.tsx`'s own header comment
 * documents for its own hook, and `sidebar.tsx`'s own header comment
 * documents for `useRouter()`/`usePathname()`, which `UnsavedChangesCancelLink`
 * also calls — components that call those hooks throw under
 * `renderToStaticMarkup` and so are not unit-rendered here at all). The
 * real interactive behavior — registering/removing the native
 * `beforeunload` listener as a form's own dirty state changes, and the
 * guarded Cancel/Back Link's open-dialog/Stay/Leave flow — is instead
 * proven in a real browser by test/e2e/unsaved-changes-protection.spec.ts.
 *
 * What a one-shot render CAN prove: the Scope's own default context
 * value (no ancestor Scope = `null`, the deliberate safe default every
 * consumer relies on) and that a mounted Scope starts every form reading
 * as pristine (`isDirty: false`) before any field has ever changed.
 */
function NoScopeProbe() {
  const scope = useUnsavedChangesScope();
  return <output data-has-scope={scope !== null} />;
}

function InScopeProbe() {
  const scope = useUnsavedChangesScope();
  return <output data-has-scope={scope !== null} data-is-dirty={scope?.isDirty ?? "n/a"} />;
}

describe("useUnsavedChangesScope — no ancestor Scope", () => {
  it("returns null when rendered with no UnsavedChangesScope ancestor — every consumer's own documented safe default", () => {
    const html = renderToStaticMarkup(<NoScopeProbe />);
    expect(html).toContain('data-has-scope="false"');
  });
});

describe("UnsavedChangesScope — initial state", () => {
  it("provides a non-null scope to its children", () => {
    const html = renderToStaticMarkup(
      <UnsavedChangesScope>
        <InScopeProbe />
      </UnsavedChangesScope>,
    );
    expect(html).toContain('data-has-scope="true"');
  });

  it("starts pristine (isDirty: false) on first render — before any form inside it has ever reported a change", () => {
    const html = renderToStaticMarkup(
      <UnsavedChangesScope>
        <InScopeProbe />
      </UnsavedChangesScope>,
    );
    expect(html).toContain('data-is-dirty="false"');
  });
});
