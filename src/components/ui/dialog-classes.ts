/**
 * Aqenra Phase 3.1 — native <dialog> centering fix.
 *
 * Root cause (found during Leads Phase 3's manual QA, confirmed via
 * screenshot): a modal, top-layer `<dialog>` is centered entirely by the
 * browser's own UA stylesheet (`dialog:modal { position: fixed; inset: 0;
 * margin: auto; width/height: fit-content; }`) — nothing in this app's
 * own CSS ever set that centering itself. Tailwind's preflight resets
 * `margin: 0` on every element, `dialog` included; author-origin CSS
 * always wins over a user-agent default regardless of selector
 * specificity, so that reset silently deleted the dialog's own centering
 * margin. With `inset: 0` still in effect but `margin` back to `0`, the
 * browser's over-constrained abspos resolution collapses the box to the
 * viewport's literal top-left corner — every native `<dialog>` in the
 * app rendered pinned there instead of centered.
 *
 * The fix re-asserts the exact same `margin: auto` value the UA
 * stylesheet already intended, but as an ordinary Tailwind utility class
 * (`m-auto`) instead of relying on the browser default — so a future
 * preflight/reset change can never silently strip it again. Paired with
 * a bounded max-height + internal scroll so a dialog whose content ends
 * up taller than the viewport (a small landscape phone, a long
 * description) stays fully reachable and scrolls internally instead of
 * running off-screen with no way to scroll to its own buttons.
 *
 * Shared by every centered modal dialog in the app: ConfirmDialog,
 * MarkLeadLostDialog, the inline Suspend-organization dialog
 * (organization-suspension-controls.tsx), and SearchDialog. Deliberately
 * NOT used by AIAssistantPanel's own <dialog> — that one is an
 * intentionally edge-anchored slide-in drawer (full-height on mobile,
 * right-anchored on desktop), not a centered modal, and already defines
 * its own complete positioning (`m-0` plus `md:inset-y-0 md:left-auto
 * md:ml-auto`) — applying this would fight that, not fix anything.
 */
export const DIALOG_CENTER_CLASSES = "m-auto max-h-[90dvh] overflow-y-auto";
