"use client";

import type { ViewportName } from "@/lib/crawler";
import type { AuditIssue, PageAudit } from "@/types/audit";
import { VIEWPORT_DIMENSIONS } from "@/types/audit";

// ---------------------------------------------------------------------------
// Severity colors — hex values so the SVG pin can render outside Tailwind
// ---------------------------------------------------------------------------

const PIN_FILL: Record<AuditIssue["severity"], string> = {
  critical: "#DC143C", // Crimson
  major: "#F97316",    // Orange-500
  minor: "#F59E0B",    // Amber-500
};

const PIN_RING: Record<AuditIssue["severity"], string> = {
  critical: "rgba(220,20,60,0.35)",
  major: "rgba(249,115,22,0.35)",
  minor: "rgba(245,158,11,0.35)",
};

// ---------------------------------------------------------------------------
// AnnotatedScreenshot — numbered SVG pins + dashed bounding boxes
// ---------------------------------------------------------------------------

/**
 * Renders the screenshot image with:
 *  - Per-issue numbered circular pin (24 px) anchored at the bounding box's
 *    top-left corner, color-coded by severity.
 *  - Per-issue bounding box drawn as a 1 px dashed outline with a white inner
 *    glow so the outline stays visible on both dark and light backgrounds.
 *  - An interactive sync signal: when `hoveredIssueId` matches an issue, its
 *    pin pulses (animated outer ring) and gains a soft drop shadow, and its
 *    bounding box highlights with a stronger glow.
 *  - Each pin region is a button: clicking routes through `onPinClick` so the
 *    parent can open the associated Asana ticket (once pushed) or scroll to
 *    the matching IssueCard.
 *
 * The `issues` array is expected to be pre-sorted by severity; pin numbers
 * are assigned as `visibleIssues.indexOf(issue) + 1`, so #1 is always the
 * most severe on the page.
 */
export function AnnotatedScreenshot({
  page,
  viewport,
  issues,
  hoveredIssueId,
  onPinClick,
  maxWidth,
  maxHeight,
}: {
  page: PageAudit;
  viewport: ViewportName;
  issues: AuditIssue[];
  hoveredIssueId?: string | null;
  onPinClick?: (issue: AuditIssue) => void;
  maxWidth: number;
  maxHeight: number;
}) {
  const src = page.screenshots[viewport];
  const dims = VIEWPORT_DIMENSIONS[viewport];
  const scale = maxWidth / dims.w;
  const visibleIssues = issues.filter(
    (i) => i.status !== "dismissed" && i.bounding_box,
  );

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
        className="rounded-lg border border-border object-contain select-none"
        style={{ maxWidth, maxHeight }}
        draggable={false}
      />
      {visibleIssues.map((issue, index) => {
        const box = issue.bounding_box!;
        const left = box.x * scale;
        const top = box.y * scale;
        const width = box.width * scale;
        const height = box.height * scale;
        const active = hoveredIssueId === issue.id;
        const fill = PIN_FILL[issue.severity];
        const ring = PIN_RING[issue.severity];
        const pinNumber = index + 1;
        const hasAsana = Boolean(issue.asanaUrl);
        const label = hasAsana
          ? `Issue ${pinNumber}: ${issue.title} — open Asana ticket`
          : `Issue ${pinNumber}: ${issue.title} — jump to details`;

        return (
          <button
            key={issue.id}
            type="button"
            data-pin={issue.id}
            onClick={() => onPinClick?.(issue)}
            title={hasAsana ? "Open Asana ticket" : "Jump to issue details"}
            aria-label={label}
            className="absolute cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            style={{ left, top, width, height, padding: 0, background: "transparent", border: "none" }}
          >
            {/* Bounding box — 1 px dashed with dual-contrast inner glow */}
            <div
              aria-hidden="true"
              className={`absolute inset-0 rounded-sm transition-[box-shadow] duration-200 ease-out ${
                active ? "opacity-100" : "opacity-90"
              }`}
              style={{
                border: `1px dashed ${fill}`,
                boxShadow: active
                  ? `inset 0 0 0 1px rgba(255,255,255,0.95), 0 0 0 3px ${ring}, 0 4px 16px rgba(0,0,0,0.25)`
                  : `inset 0 0 0 1px rgba(255,255,255,0.75), 0 0 0 1px rgba(0,0,0,0.08)`,
              }}
            />

            {/* Numbered pin — anchored at the top-left corner of the box */}
            <Pin
              number={pinNumber}
              fill={fill}
              ring={ring}
              active={active}
              hasAsana={hasAsana}
            />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pin — 24×24 circular SVG marker with centered index number
// ---------------------------------------------------------------------------

function Pin({
  number,
  fill,
  ring,
  active,
  hasAsana,
}: {
  number: number;
  fill: string;
  ring: string;
  active: boolean;
  hasAsana: boolean;
}) {
  // The pin sits "on" the top-left corner, overlapping the box by ~8px.
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: -12,
        top: -12,
        overflow: "visible",
        filter: active
          ? "drop-shadow(0 2px 6px rgba(0,0,0,0.35))"
          : "drop-shadow(0 1px 2px rgba(0,0,0,0.2))",
        transition: "filter 200ms ease-out, transform 200ms ease-out",
        transform: active ? "scale(1.08)" : "scale(1)",
      }}
    >
      {/* Outer animated ring — only visible when active */}
      {active && (
        <circle
          cx={12}
          cy={12}
          r={11}
          fill={ring}
          style={{
            transformOrigin: "12px 12px",
            animation: "uxPinPulse 1.4s ease-out infinite",
          }}
        />
      )}
      {/* Main circle */}
      <circle
        cx={12}
        cy={12}
        r={10}
        fill={fill}
        stroke="#ffffff"
        strokeWidth={1.5}
      />
      {/* Number */}
      <text
        x={12}
        y={12}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontSize={number > 9 ? 10 : 11}
        fontWeight={700}
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        style={{ userSelect: "none" }}
      >
        {number}
      </text>
      {/* Asana link indicator — tiny dot top-right once the ticket exists */}
      {hasAsana && (
        <circle
          cx={19}
          cy={5}
          r={3.5}
          fill="#ffffff"
          stroke={fill}
          strokeWidth={1.5}
        />
      )}

      {/* Keyframes (scoped via style tag — runs fine in dev HMR and prod). */}
      <style>{`
        @keyframes uxPinPulse {
          0%   { transform: scale(1);   opacity: 0.9; }
          70%  { transform: scale(1.9); opacity: 0;   }
          100% { transform: scale(1.9); opacity: 0;   }
        }
      `}</style>
    </svg>
  );
}
