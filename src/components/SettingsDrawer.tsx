"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Slide-over right-hand drawer that holds the AuditForm's advanced panels
 * (PRD, repo context, credentials, cookies, screenshot upload, brand settings)
 * in Zen Mode, freeing the main viewport for screenshots + issue lists.
 *
 * Implementation notes:
 *  - Focus is trapped loosely (Escape closes, backdrop click closes).
 *  - Uses `inert` via aria-hidden when closed so keyboard tabbing skips it.
 *  - Purely CSS-driven transition so SSE updates streaming into children
 *    never jank the animation.
 */
export function SettingsDrawer({
  open,
  onClose,
  title = "Audit settings",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while drawer open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 bg-black/40 backdrop-blur-[1px] z-40 transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-background border-l border-border shadow-2xl flex flex-col transform transition-transform duration-300 ease-out ${
          open ? "translate-x-0 pointer-events-auto" : "translate-x-full pointer-events-none"
        }`}
      >
        <header className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="h-11 w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">{children}</div>
      </aside>
    </>
  );
}
