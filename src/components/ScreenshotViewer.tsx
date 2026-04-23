"use client";

import { Badge } from "@/components/ui/badge";
import {
  Monitor,
  Tablet,
  Smartphone,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import type { ViewportName } from "@/lib/crawler";
import type { PageAudit } from "@/types/audit";
import { VIEWPORT_DIMENSIONS } from "@/types/audit";
import { AnnotatedScreenshot } from "./AnnotatedScreenshot";

// ---------------------------------------------------------------------------
// Viewport toggle
// ---------------------------------------------------------------------------

export function ViewportToggle({
  active,
  onChange,
}: {
  active: ViewportName;
  onChange: (v: ViewportName) => void;
}) {
  const viewports: { key: ViewportName; label: string; icon: React.ReactNode }[] = [
    { key: "mobile", label: "Mobile", icon: <Smartphone className="w-4 h-4" /> },
    { key: "tablet", label: "Tablet", icon: <Tablet className="w-4 h-4" /> },
    { key: "desktop", label: "Desktop", icon: <Monitor className="w-4 h-4" /> },
  ];

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-muted p-0.5">
      {viewports.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            active === v.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v.icon}
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screenshot size resolution
// ---------------------------------------------------------------------------

/**
 * Compact vs. Zen-Mode sizing:
 *  - `fullHeight = false` keeps the original tight column layout used when
 *    the expanded AuditForm is visible.
 *  - `fullHeight = true` expands to ~70 vh tall so the side-by-side view
 *    dominates the viewport when the StatusBar is collapsed.
 */
function dimsForViewport(viewport: ViewportName, fullHeight: boolean) {
  if (fullHeight) {
    return viewport === "mobile"
      ? { maxWidth: 360, maxHeight: Math.round(0.7 * 1000) }
      : viewport === "tablet"
        ? { maxWidth: 540, maxHeight: Math.round(0.7 * 1000) }
        : { maxWidth: 780, maxHeight: Math.round(0.7 * 1000) };
  }
  return viewport === "mobile"
    ? { maxWidth: 225, maxHeight: 600 }
    : viewport === "tablet"
      ? { maxWidth: 346, maxHeight: 600 }
      : { maxWidth: 504, maxHeight: 600 };
}

function ScreenshotPlaceholder({
  page,
  viewport,
  fullHeight,
}: {
  page: PageAudit;
  viewport: ViewportName;
  fullHeight: boolean;
}) {
  const src = page.screenshots[viewport];
  const { maxWidth, maxHeight } = dimsForViewport(viewport, fullHeight);
  const dims = VIEWPORT_DIMENSIONS[viewport];

  if (!src) {
    return (
      <div
        className="bg-muted rounded-lg border border-border flex items-center justify-center text-muted-foreground text-sm"
        style={{ width: maxWidth, height: maxWidth * (dims.h / dims.w) }}
      >
        No screenshot
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={`${page.title} — ${viewport}`}
      className="rounded-lg border border-border object-contain"
      style={{ maxWidth, maxHeight }}
    />
  );
}

// ---------------------------------------------------------------------------
// Combined viewer with view mode toggle
// ---------------------------------------------------------------------------

export function ScreenshotViewer({
  page,
  viewport,
  activeView,
  onViewChange,
  hoveredIssueId,
  onPinClick,
  fullHeight = false,
}: {
  page: PageAudit;
  viewport: ViewportName;
  activeView: "original" | "annotated" | "fix";
  onViewChange: (view: "original" | "annotated" | "fix") => void;
  hoveredIssueId?: string | null;
  onPinClick?: (issue: import("@/types/audit").AuditIssue) => void;
  fullHeight?: boolean;
}) {
  const hasFix = page.issues.some((i) => i.fix);
  const views = ["original", "annotated", ...(hasFix ? ["fix" as const] : [])] as const;
  const dims = dimsForViewport(viewport, fullHeight);

  return (
    <>
      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        {views.map((view) => (
          <button
            key={view}
            onClick={() => onViewChange(view)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeView === view
                ? view === "fix"
                  ? "bg-violet-100 text-violet-700 shadow-sm"
                  : "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {view === "original"
              ? "Original"
              : view === "annotated"
                ? "Issues"
                : "Fix"}
          </button>
        ))}
      </div>

      {/* Side-by-side screenshots — in Zen Mode fills the width of the viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Original */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5" />
            Original
          </h3>
          <div className="flex justify-center p-4 bg-muted/30 rounded-xl border border-border">
            <ScreenshotPlaceholder page={page} viewport={viewport} fullHeight={fullHeight} />
          </div>
        </div>
        {/* Annotated or Fix */}
        {activeView === "fix" && page.issues.find((i) => i.fix) ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-violet-600 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5" />
              Generated Fix
            </h3>
            <div className="flex justify-center p-4 bg-violet-50/30 rounded-xl border-2 border-violet-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.issues.find((i) => i.fix)!.fix!.imageUrl}
                alt="Generated fix mockup"
                className="rounded-lg object-contain"
                style={{ maxHeight: dims.maxHeight }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Annotated Issues
              <Badge variant="secondary" className="ml-1 text-xs">
                {page.issues.filter((i) => i.status !== "dismissed").length}{" "}
                active
              </Badge>
            </h3>
            <div className="flex justify-center p-4 bg-muted/30 rounded-xl border border-border">
              <AnnotatedScreenshot
                page={page}
                viewport={viewport}
                issues={page.issues}
                hoveredIssueId={hoveredIssueId ?? null}
                onPinClick={onPinClick}
                maxWidth={dims.maxWidth}
                maxHeight={dims.maxHeight}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
