/**
 * audit-page pipeline — single-page UX audit.
 *
 * Crawls exactly one URL, screenshots at the requested viewports, and runs
 * the 11-lens analysis. No link discovery, no multi-page fan-out. The fastest
 * "give me issues for this specific page" entrypoint.
 */

import { VIEWPORT_NAMES, makeOutputDir, crawlAndAnalyze } from "./shared";
import type { AuditPageOptions, PipelineResult } from "./types";

export async function runAuditPage(opts: AuditPageOptions): Promise<PipelineResult> {
  const timestamp = new Date().toISOString();
  const outputDir = makeOutputDir("page");
  const viewports = opts.viewports ?? VIEWPORT_NAMES;

  const { pages, transport, runId, reportUrl } = await crawlAndAnalyze({
    url: opts.url,
    maxPages: 1,
    viewports,
    cookies: opts.cookies,
    credentials: opts.credentials,
    prdContext: opts.prdContext,
    repoContext: opts.repoContext,
    skipDeterministic: opts.skipDeterministic,
    outputDir,
    onProgress: opts.onProgress,
    label: "page",
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
