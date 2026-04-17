/**
 * Hosted report viewer — stable, shareable URL for a single audit run.
 *
 * Server component: loads the run from the filesystem store, returns 404
 * if the id is unknown, then hands the interactive portion (filter + list)
 * to a client component.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadRun } from "@/lib/persistence/runs";

import { ReportFilter } from "./filter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------------
// Metadata (Slack / Asana link previews)
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: { runId: string } },
): Promise<Metadata> {
  const report = await loadRun(params.runId);
  if (!report) {
    return { title: "Audit run not found" };
  }
  const { critical, major, minor } = report.summary;
  const total = critical + major + minor;
  const title = `UX audit — ${safeHostname(report.url)}`;
  const description = `${total} finding${total === 1 ? "" : "s"} (${critical} critical, ${major} major, ${minor} minor) for ${report.url}`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReportPage(
  { params }: { params: { runId: string } },
) {
  const report = await loadRun(params.runId);
  if (!report) notFound();

  const { critical, major, minor } = report.summary;
  const total = critical + major + minor;

  return (
    <div className="min-h-screen bg-background text-foreground font-[family-name:var(--font-geist-sans)]">
      <a
        href="#findings"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-foreground focus:text-background focus:rounded-md"
      >
        Skip to findings
      </a>

      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 sticky top-0 z-20">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wide">
                UX audit report
              </p>
              <h1 className="text-xl sm:text-2xl font-semibold leading-tight break-all">
                {safeHostname(report.url)}
              </h1>
            </div>
            <Link
              href="/report"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              All runs &rarr;
            </Link>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-muted-foreground">Audited URL</dt>
              <dd>
                <a
                  href={report.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-foreground break-all hover:underline"
                >
                  {report.url}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Run</dt>
              <dd className="font-mono text-foreground break-all">{report.runId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Generated</dt>
              <dd className="text-foreground">
                <time dateTime={report.timestamp}>{formatTimestamp(report.timestamp)}</time>
              </dd>
            </div>
          </dl>

          <div
            className="flex flex-wrap items-center gap-2"
            aria-label={`${total} total findings`}
          >
            <SummaryBadge label="Critical" count={critical} tone="critical" />
            <SummaryBadge label="Major" count={major} tone="major" />
            <SummaryBadge label="Minor" count={minor} tone="minor" />
            <span className="ml-1 text-xs text-muted-foreground">
              {total} finding{total === 1 ? "" : "s"} total
            </span>
          </div>
        </div>
      </header>

      <main id="findings" className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {total === 0 ? (
          <div
            role="status"
            className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-16 text-center text-sm text-muted-foreground"
          >
            No issues were recorded for this run.
          </div>
        ) : (
          <ReportFilter findings={report.findings} summary={report.summary} />
        )}
      </main>

      <footer className="border-t border-border mt-8">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 text-xs text-muted-foreground">
          Generated by the UX Audit Agent. This page is stateless — anyone with
          the link can view it.
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function SummaryBadge({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "critical" | "major" | "minor";
}) {
  const tones: Record<typeof tone, string> = {
    critical:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
    major:
      "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    minor:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  };
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      <span className="tabular-nums">{count}</span>
      <span>{label}</span>
    </span>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
