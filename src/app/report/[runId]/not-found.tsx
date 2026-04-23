/**
 * 404 page for a missing or invalid runId.
 * Linked from `notFound()` in the `[runId]/page.tsx` server component.
 */
import Link from "next/link";

export default function ReportNotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground font-[family-name:var(--font-geist-sans)]">
      <main className="mx-auto flex max-w-xl flex-col items-center justify-center px-6 py-24 text-center space-y-5">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-2xl font-semibold">Audit run not found</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The run you&rsquo;re looking for doesn&rsquo;t exist, has been
          deleted, or the link was mistyped. Run IDs are opaque and expire when
          their file is removed from the store.
        </p>
        <Link
          href="/report"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to all runs
        </Link>
      </main>
    </div>
  );
}
