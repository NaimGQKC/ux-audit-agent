/**
 * audit-site pipeline — full-site UX audit.
 *
 * Crawls the entry URL, discovers same-origin links, screenshots every route
 * (up to maxPages) at 3 viewports, and runs the full 11-lens analysis per
 * page. Use audit-page for a single page — this is the comprehensive one.
 */

import { VIEWPORT_NAMES, makeOutputDir, crawlAndAnalyze } from "./shared";
import type { AuditSiteOptions, PipelineResult } from "./types";

const DEFAULT_MAX_PAGES = 10;

export async function runAuditSite(opts: AuditSiteOptions): Promise<PipelineResult> {
  const timestamp = new Date().toISOString();
  const outputDir = makeOutputDir("site");
  const viewports = opts.viewports ?? VIEWPORT_NAMES;

  const { pages, transport, runId, reportUrl } = await crawlAndAnalyze({
    url: opts.url,
    maxPages: opts.maxPages ?? DEFAULT_MAX_PAGES,
    viewports,
    cookies: opts.cookies,
    credentials: opts.credentials,
    prdContext: opts.prdContext,
    repoContext: opts.repoContext,
    skipDeterministic: opts.skipDeterministic,
    outputDir,
    onProgress: opts.onProgress,
    label: "site",
  });

  return {
    baseUrl: opts.url,
    timestamp,
    pages,
    outputDir,
    transport,
    runId,
    reportUrl,
  };
}
