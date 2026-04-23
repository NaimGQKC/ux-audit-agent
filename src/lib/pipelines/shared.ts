/**
 * Internal helpers shared by the individual pipelines.
 *
 * Keep these deliberately small — each pipeline is meant to be readable in
 * one sitting, and most of the audit machinery already lives in the crawler
 * and analyzer modules.
 */

import * as path from "node:path";
import * as os from "node:os";
import {
  crawlAndScreenshot,
  hasPersistedSession,
  type CrawlResult,
  type Cookie,
  type ViewportName,
  type AxeFinding,
  VIEWPORTS,
} from "../crawler";
import { analyzeScreenshots } from "../analyzer/run";
import { validateAnalysisResult, type UXIssue } from "../analyzer";
import { activeTransport } from "../claude-client";
import { saveRun, summarize, isValidRunId } from "../persistence/runs";
import type { PipelineIssue, PipelinePage } from "./types";

function publicBaseUrl(): string {
  const raw = process.env.UX_AUDIT_PUBLIC_BASE_URL?.trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export const VIEWPORT_NAMES: ViewportName[] = Object.keys(VIEWPORTS) as ViewportName[];

export function makeOutputDir(label: string): string {
  return path.join(
    os.tmpdir(),
    `ux-audit-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
}

export function toPipelineIssue(i: UXIssue): PipelineIssue {
  return {
    id: i.id,
    title: i.title,
    severity: i.severity,
    category: i.category,
    principle: i.principle,
    description: i.description,
    affected_element: i.affected_element,
    recommendation: i.recommendation,
    suggested_fix: i.suggested_fix,
    acceptance_criteria: i.acceptance_criteria,
    affected_viewports: i.affected_viewports,
  };
}

/**
 * Crawl + analyze shared between audit-page, audit-site, quick-scan.
 * Returns the pages array ready to be wrapped in a PipelineResult.
 */
export async function crawlAndAnalyze(args: {
  url: string;
  maxPages: number;
  viewports: ViewportName[];
  cookies?: Cookie[];
  credentials?: { email: string; password: string };
  prdContext?: string;
  repoContext?: string;
  skipDeterministic?: boolean;
  outputDir: string;
  onProgress?: (detail: string) => void;
  label: string;
}): Promise<{
  pages: PipelinePage[];
  transport: "sdk" | "cli";
  runId?: string;
  reportUrl?: string;
}> {
  const progress = args.onProgress ?? (() => {});
  const transport = activeTransport();

  // Auto-reuse the persistent browser profile when one exists and the caller
  // didn't pass explicit cookies. This is what makes the "run auth_session
  // once, everything else just works" flow end-to-end: the crawler picks up
  // the SSO session from disk without the MCP tool having to round-trip
  // cookies across JSON-RPC. On the Fly.io container hasPersistedSession()
  // always returns false (no ~/.ux-audit-agent dir), so this is a no-op there.
  const useProfile = !args.cookies?.length && hasPersistedSession();

  progress("Crawling and screenshotting...");
  const outcome = await crawlAndScreenshot(args.url, args.outputDir, args.cookies, useProfile, {
    maxRoutes: args.maxPages,
    credentials: args.credentials,
    skipAxe: args.skipDeterministic,
    skipTokens: args.skipDeterministic,
    captureInteractions: false,
  });

  if ("needsAuth" in outcome && outcome.needsAuth) {
    throw new Error(
      `The page at ${args.url} requires authentication. ` +
        `Local MCP: run auth_session({ url: "${args.url}" }) to log in once, then retry. ` +
        `Remote MCP: pass email+password or the cookies_json escape hatch.`,
    );
  }
  if ("needsSSOLogin" in outcome && outcome.needsSSOLogin) {
    throw new Error(
      `The page at ${args.url} triggered an SSO redirect to ${outcome.redirectUrl}. ` +
        `Local MCP: run auth_session({ url: "${args.url}" }) to complete the handshake once — ` +
        `it opens a headed Chrome window, saves the session, and lets this call succeed on the next try. ` +
        `If you already ran it, the saved session may have expired: run clear_auth_session then auth_session again. ` +
        `Remote MCP cannot drive a browser on your machine; use the cookies_json escape hatch.`,
    );
  }

  const manifest = (outcome as CrawlResult).manifest;
  const pages: PipelinePage[] = [];
  // Full-fidelity UXIssue records kept alongside the lossy PipelineIssue
  // conversion so persisted /report/<runId>.json contains bounding_box,
  // steps_to_reproduce, and deterministic-layer enrichment the chat output
  // intentionally omits.
  const allFullFindings: UXIssue[] = [];
  const seenFullIds = new Set<string>();

  for (let idx = 0; idx < manifest.routes.length; idx++) {
    const routeEntry = manifest.routes[idx];
    const pngs: string[] = [];
    for (const vp of args.viewports) {
      const filename = routeEntry.screenshots[vp];
      if (filename) pngs.push(path.join(args.outputDir, filename));
    }
    if (pngs.length === 0) continue;

    // Group axe findings by screenshot basename for CONFIRMED_ISSUES injection
    const axeFindingsByScreenshot: Record<string, AxeFinding[]> = {};
    for (const finding of routeEntry.axeFindings ?? []) {
      const filename = routeEntry.screenshots[finding.viewport];
      if (!filename) continue;
      (axeFindingsByScreenshot[filename] ??= []).push(finding);
    }

    progress(`Analyzing ${routeEntry.route} (${idx + 1}/${manifest.routes.length})...`);

    const analysis = await analyzeScreenshots(pngs, {
      prdContext: args.prdContext,
      repoContext: args.repoContext,
      axeFindingsByScreenshot,
      label: `${args.label}-${idx}`,
    });

    const allIssues: UXIssue[] = [];
    const seenIds = new Set<string>();
    for (const vp of args.viewports) {
      const filename = routeEntry.screenshots[vp];
      if (!filename) continue;
      const fileResult = analysis.screenshots[filename] as { issues: unknown[] } | undefined;
      if (!fileResult) continue;
      try {
        const validated = validateAnalysisResult(fileResult);
        for (const issue of validated.issues) {
          if (!seenIds.has(issue.id)) {
            seenIds.add(issue.id);
            allIssues.push(issue);
          }
          if (!seenFullIds.has(issue.id)) {
            seenFullIds.add(issue.id);
            allFullFindings.push(issue);
          }
        }
      } catch {
        // skip malformed
      }
    }

    const screenshotPaths: Partial<Record<ViewportName, string>> = {};
    for (const vp of args.viewports) {
      const filename = routeEntry.screenshots[vp];
      if (filename) screenshotPaths[vp] = path.join(args.outputDir, filename);
    }

    pages.push({
      route: routeEntry.route,
      url: routeEntry.url,
      issues: allIssues.map(toPipelineIssue),
      screenshotPaths,
    });
  }

  // Persist findings to .audit-runs/<runId>.json so the /report/<runId> viewer
  // can pick them up. Runs started from any pipeline (MCP quick_scan, audit_page,
  // audit_site, audit_local) become triage-able in the web UI with the same
  // approve/dismiss/push-to-Asana flow the API route already uses. The crawler's
  // sessionId (tmpdir basename, e.g. "ux-audit-quick-1776883896288-n8ke") is
  // already shaped to satisfy RUN_ID_RE so it doubles as the runId.
  const runId = manifest.sessionId;
  let reportUrl: string | undefined;
  if (isValidRunId(runId)) {
    try {
      await saveRun(runId, {
        runId,
        url: args.url,
        timestamp: manifest.timestamp,
        findings: allFullFindings,
        summary: summarize(allFullFindings),
      });
      reportUrl = `${publicBaseUrl()}/report/${runId}`;
      progress(`Report saved: ${reportUrl}`);
    } catch (err) {
      progress(`Warning: failed to save report: ${(err as Error).message}`);
    }
  }

  return { pages, transport, runId: reportUrl ? runId : undefined, reportUrl };
}
