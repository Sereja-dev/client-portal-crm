"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "success" | "error";
type ToastItem = { id: number; message: string; variant: ToastVariant };

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 4000;

let nextToastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = ++nextToastId;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, TOAST_DURATION_MS);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            // Aqenra Round 3 Design System audit (Toast decision, Option A):
            // this fixed dark pill is intentionally theme-invariant, not a
            // page-embedded surface — ToastProvider is mounted once at the
            // app root (src/app/layout.tsx) and is shared, byte-identical,
            // across staff, Portal, and Platform Admin. As a floating
            // ephemeral overlay (fixed bottom-4 right-4, never composited
            // against a particular page background) it already reads as
            // opaque and legible in every theme, so it was deliberately
            // left out of this migration's page-surface token sweep. Do
            // not make these theme-aware/semantic-surface classes without
            // a dedicated cross-product design review (staff + Portal +
            // Platform Admin, all four theme modes, both variants) — that
            // caution is about reactivity, not color, and still applies.
            //
            // Sky-Blue/Grayscale Theme Redesign V1 (correction pass) — the
            // error variant was previously bg-red-600, a literal color the
            // owner never approved as an exception; the success variant's
            // own bg-gray-900 was also chromatic (Tailwind's "gray" scale
            // is cool-tinted, rgb(17,24,39) — R/G/B unequal), not the
            // literal grayscale the owner's own direction requires. Both
            // are now true-neutral (R=G=B): error is bg-black (this
            // theme's own "most prominent" ink, matching --danger
            // elsewhere), success is a visibly lighter true-neutral gray
            // (bg-neutral-800, rgb(38,38,38) — the same value as
            // --accent-hover) so the two pills stay distinguishable by
            // lightness, never by hue, on top of their own message text
            // (toast.message already states success/failure in full
            // sentences — color was never the only cue).
            className={`pointer-events-auto rounded-md px-4 py-3 text-sm font-medium shadow-lg ${
              toast.variant === "success"
                ? "bg-neutral-800 text-white"
                : "bg-black text-white"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
