/**
 * quick-scan pipeline — desktop-only single-page audit.
 *
 * ~60-second check. Designed for in-flow "does this look broken?" questions
 * during development or PR review. Skips axe/Lighthouse/token layers and
 * does not crawl additional routes.
 */

import { makeOutputDir, crawlAndAnalyze } from "./shared";
import type { QuickScanOptions, PipelineResult } from "./types";

export async function runQuickScan(opts: QuickScanOptions): Promise<PipelineResult> {
  const timestamp = new Date().toISOString();
  const outputDir = makeOutputDir("quick");

  const { pages, transport, runId, reportUrl } = await crawlAndAnalyze({
    url: opts.url,
    maxPages: 1,
    viewports: ["desktop"],
    prdContext: opts.prdContext,
    skipDeterministic: true,
    outputDir,
    onProgress: opts.onProgress,
    label: "quick",
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
