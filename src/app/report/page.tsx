/**
 * Report index — lists all persisted audit runs, newest first.
 * Links each row to `/report/<runId>`.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { listRuns } from "@/lib/persistence/runs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Audit runs — UX Audit Agent",
  description: "Hosted index of all saved UX audit runs.",
};

export default async function ReportIndexPage() {
  const runs = await listRuns();

  return (
    <div className="min-h-screen bg-background text-foreground font-[family-name:var(--font-geist-sans)]">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 space-y-2">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            UX Audit Agent
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold">Audit runs</h1>
          <p className="text-sm text-muted-foreground">
            Every saved run has a stable, shareable URL. Click any row to view
            the full report.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {runs.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
            {runs.map((run) => (
              <li key={run.runId}>
                <Link
                  href={`/report/${run.runId}`}
                  className="flex flex-col gap-1 px-4 py-4 sm:px-5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground truncate">
                      {safeHostname(run.url)}
                    </span>
                    <time
                      dateTime={run.timestamp}
                      className="shrink-0 font-mono text-xs text-muted-foreground"
                    >
                      {formatTimestamp(run.timestamp)}
                    </time>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {run.url}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground/70 truncate">
                    {run.runId}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center space-y-3">
      <h2 className="text-base font-semibold text-foreground">No audit runs yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
        Runs appear here once the audit pipeline calls <code className="rounded bg-background px-1 py-0.5 text-xs font-mono border border-border">saveRun()</code>.
        You can also drop JSON files directly into <code className="rounded bg-background px-1 py-0.5 text-xs font-mono border border-border">.audit-runs/</code> at the repo root.
      </p>
    </div>
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
