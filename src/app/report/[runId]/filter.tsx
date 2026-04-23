"use client";

/**
 * Interactive portion of the hosted report viewer:
 *  - Severity filter (radio group)
 *  - Filtered + sorted finding cards
 *  - Per-card expand/collapse for description + suggested fix
 *  - Copy-link button for the run
 *
 * This component is intentionally self-contained so the surrounding page
 * can stay a server component and stream.
 */
import { useMemo, useState } from "react";

import type { UXIssue } from "@/lib/analyzer";

type SeverityFilter = "all" | "critical" | "major" | "minor";

const SEVERITY_ORDER: Record<UXIssue["severity"], number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

const SEVERITY_PILL: Record<UXIssue["severity"], string> = {
  critical:
    "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  major:
    "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  minor:
    "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface ReportFilterProps {
  findings: UXIssue[];
  summary: { critical: number; major: number; minor: number };
  /** Map of screenshot filename -> URL so cards can thumbnail evidence. */
  screenshotUrlBase?: string;
}

export function ReportFilter({ findings, summary, screenshotUrlBase }: ReportFilterProps) {
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const sorted = useMemo(() => {
    const source = filter === "all" ? findings : findings.filter((f) => f.severity === filter);
    return [...source].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
  }, [findings, filter]);

  const onCopyLink = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: select the URL in a prompt so users can copy manually.
      window.prompt("Copy this link:", window.location.href);
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const filterOptions: Array<{ value: SeverityFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: findings.length },
    { value: "critical", label: "Critical", count: summary.critical },
    { value: "major", label: "Major", count: summary.major },
    { value: "minor", label: "Minor", count: summary.minor },
  ];

  return (
    <div className="space-y-6">
      <div
        role="toolbar"
        aria-label="Report filters"
        className="flex flex-wrap items-center gap-3"
      >
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Filter by severity</legend>
          {filterOptions.map((opt) => {
            const active = filter === opt.value;
            return (
              <label
                key={opt.value}
                className={cx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer select-none transition-colors",
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="severity-filter"
                  value={opt.value}
                  checked={active}
                  onChange={() => setFilter(opt.value)}
                  className="sr-only"
                />
                <span>{opt.label}</span>
                <span
                  aria-hidden="true"
                  className={cx(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
                    active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground",
                  )}
                >
                  {opt.count}
                </span>
              </label>
            );
          })}
        </fieldset>

        <button
          type="button"
          onClick={onCopyLink}
          className="ml-auto inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-live="polite"
        >
          <LinkIcon />
          <span>{copied ? "Link copied" : "Copy link"}</span>
        </button>
      </div>

      {sorted.length === 0 ? (
        <div
          role="status"
          className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground"
        >
          No findings match this filter.
        </div>
      ) : (
        <ol className="space-y-4" aria-label="Findings">
          {sorted.map((issue, idx) => (
            <li key={issue.id ?? `${issue.title}-${idx}`}>
              <FindingCard
                issue={issue}
                expanded={!!expanded[issue.id ?? String(idx)]}
                onToggle={() => toggle(issue.id ?? String(idx))}
                screenshotUrlBase={screenshotUrlBase}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal card
// ---------------------------------------------------------------------------

interface FindingCardProps {
  issue: UXIssue;
  expanded: boolean;
  onToggle: () => void;
  screenshotUrlBase?: string;
}

function FindingCard({ issue, expanded, onToggle, screenshotUrlBase }: FindingCardProps) {
  const wcag = issue.wcag_ref?.filter(Boolean) ?? [];
  const thumbnail = issue.evidence_screenshot
    ? screenshotUrlBase
      ? `${screenshotUrlBase.replace(/\/$/, "")}/${issue.evidence_screenshot}`
      : issue.evidence_screenshot
    : null;

  return (
    <article
      className="rounded-xl border border-border bg-card text-card-foreground shadow-sm"
      aria-labelledby={`finding-${issue.id}-title`}
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cx(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                SEVERITY_PILL[issue.severity],
              )}
            >
              {issue.severity}
            </span>
            <span className="text-xs text-muted-foreground">{issue.principle}</span>
          </div>
          <h3
            id={`finding-${issue.id}-title`}
            className="text-base font-semibold leading-snug text-foreground"
          >
            {issue.title}
          </h3>
        </div>
      </header>

      <div className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-3 min-w-0">
          <dl className="grid gap-2 text-xs">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Element</dt>
              <dd className="font-mono text-foreground break-words">
                {issue.affected_element || "—"}
              </dd>
            </div>
            {issue.element_selector && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Selector</dt>
                <dd className="font-mono text-foreground break-all">
                  {issue.element_selector}
                </dd>
              </div>
            )}
            {wcag.length > 0 && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">WCAG</dt>
                <dd className="flex flex-wrap gap-1">
                  {wcag.map((ref) => (
                    <span
                      key={ref}
                      className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {ref}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          <p
            className={cx(
              "text-sm text-foreground/90 leading-relaxed whitespace-pre-line",
              !expanded && "line-clamp-3",
            )}
          >
            {issue.description}
          </p>

          {expanded && issue.suggested_fix && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Suggested fix
              </p>
              <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                {issue.suggested_fix}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`finding-${issue.id}-details`}
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            <span>{expanded ? "Show less" : "Show suggested fix"}</span>
            <ChevronIcon open={expanded} />
          </button>

          {/* A11y: screen readers announce the collapsed/expanded content. */}
          <span id={`finding-${issue.id}-details`} className="sr-only" aria-live="polite">
            {expanded ? "Expanded" : "Collapsed"}
          </span>
        </div>

        {thumbnail && (
          <a
            href={thumbnail}
            target="_blank"
            rel="noreferrer"
            className="block shrink-0 overflow-hidden rounded-lg border border-border bg-muted md:w-40"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnail}
              alt={`Screenshot evidence for ${issue.title}`}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </a>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Inline icons (no lucide import — keep the bundle small on a public page)
// ---------------------------------------------------------------------------

function LinkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("transition-transform", open && "rotate-180")}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
