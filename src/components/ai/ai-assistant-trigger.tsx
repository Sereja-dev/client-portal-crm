"use client";

import { useRef } from "react";
import { SparkleIcon } from "@/components/ui/icons";
import { AiAssistantPanel, type AiAssistantPanelHandle } from "./ai-assistant-panel";

/**
 * AI Assistant staff drawer/UI batch. The one mounted instance of the
 * whole feature — a Header trigger button plus the panel it controls,
 * mirroring src/components/search/global-search.tsx's own established
 * shape exactly: mounted here (inside Header, itself only ever rendered
 * by (dashboard)/layout.tsx, never the Portal or Platform Admin layout)
 * rather than as a second, separately-mounted component, since the
 * trigger and the panel need to act on the exact same dialog instance/
 * handle.
 *
 * A staff-only surface by construction, the same structural guarantee
 * global-search.tsx already claims for itself: this component simply
 * never exists in the React tree the Client Portal or Platform Admin
 * renders — there is no flag or runtime check to bypass.
 *
 * `available` is the ONLY signal this component receives about backend
 * state — a plain boolean, server-resolved once in (dashboard)/layout.tsx
 * via the existing isAiAssistantAvailable() (src/lib/ai/providers/
 * provider-factory.ts, unchanged by this batch) and threaded down through
 * Header. This file never imports that function, TEST_MODE, or anything
 * else from src/lib/ai/ except the panel's own client.ts contract
 * (transitively, via AiAssistantPanel) — it has no way to know, and no
 * reason to care, WHY the feature is or isn't available.
 */
export function AiAssistantTrigger({ available }: { available: boolean }) {
  const panelHandleRef = useRef<AiAssistantPanelHandle>(null);

  if (!available) {
    return (
      <button
        type="button"
        disabled
        aria-label="AI Assistant (coming soon)"
        className="border-border-strong text-text-muted flex cursor-not-allowed items-center gap-2 rounded-md border px-3 py-1.5 text-sm opacity-60"
      >
        <SparkleIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">AI Assistant</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="AI Assistant"
        onClick={() => panelHandleRef.current?.open()}
        className="border-border-strong text-text-secondary focus-visible:ring-focus-ring flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <SparkleIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">AI Assistant</span>
      </button>
      <AiAssistantPanel ref={panelHandleRef} />
    </>
  );
}
