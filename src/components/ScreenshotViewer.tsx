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
import type { AuditIssue, PageAudit } from "@/types/audit";
import { SEVERITY_COLORS, SEVERITY_OVERLAY, VIEWPORT_DIMENSIONS } from "@/types/audit";

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
// Screenshot renderers
// ---------------------------------------------------------------------------

function maxWidthForViewport(viewport: ViewportName): number {
  return viewport === "mobile" ? 225 : viewport === "tablet" ? 346 : 504;
}

function ScreenshotPlaceholder({
  page,
  viewport,
}: {
  page: PageAudit;
  viewport: ViewportName;
}) {
  const src = page.screenshots[viewport];
  const dims = VIEWPORT_DIMENSIONS[viewport];
  const maxWidth = maxWidthForViewport(viewport);

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
      style={{ maxWidth, maxHeight: 600 }}
    />
  );
}

function AnnotatedScreenshot({
  page,
  viewport,
  issues,
}: {
  page: PageAudit;
  viewport: ViewportName;
  issues: AuditIssue[];
}) {
  const src = page.screenshots[viewport];
  const dims = VIEWPORT_DIMENSIONS[viewport];
  const maxWidth = maxWidthForViewport(viewport);
  const scale = maxWidth / dims.w;
  const visibleIssues = issues.filter((i) => i.status !== "dismissed");

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
    <div className="relative inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`${page.title} — ${viewport} (annotated)`}
        className="rounded-lg border border-border object-contain"
        style={{ maxWidth, maxHeight: 600 }}
      />
      {visibleIssues.map(
        (issue) =>
          issue.bounding_box && (
            <div
              key={issue.id}
              className={`absolute border-2 rounded-sm ${SEVERITY_OVERLAY[issue.severity]} pointer-events-none`}
              style={{
                left: issue.bounding_box.x * scale,
                top: issue.bounding_box.y * scale,
                width: issue.bounding_box.width * scale,
                height: issue.bounding_box.height * scale,
              }}
            >
              <span
                className={`absolute -top-4 left-0 text-[9px] font-bold px-1 rounded text-white ${SEVERITY_COLORS[issue.severity]}`}
              >
                {issue.title.length > 22
                  ? issue.title.slice(0, 22) + "\u2026"
                  : issue.title}
              </span>
            </div>
          ),
      )}
    </div>
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
}: {
  page: PageAudit;
  viewport: ViewportName;
  activeView: "original" | "annotated" | "fix";
  onViewChange: (view: "original" | "annotated" | "fix") => void;
}) {
  const hasFix = page.issues.some((i) => i.fix);
  const views = ["original", "annotated", ...(hasFix ? ["fix" as const] : [])] as const;

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

      {/* Side-by-side screenshots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Original */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5" />
            Original
          </h3>
          <div className="flex justify-center p-4 bg-muted/30 rounded-xl border border-border">
            <ScreenshotPlaceholder page={page} viewport={viewport} />
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
                className="rounded-lg max-h-[400px] object-contain"
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
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
