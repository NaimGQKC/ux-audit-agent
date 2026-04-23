/**
 * Shared types for the decoupled audit pipelines.
 *
 * Each pipeline takes an options object and returns a PipelineResult. No
 * SSE, no HTTP — callers (MCP tools, API routes, CLI) wrap these in the
 * transport-specific glue they need.
 */

import type { ViewportName, Cookie } from "../crawler";

export interface PipelineIssue {
  id: string;
  title: string;
  severity: "critical" | "major" | "minor";
  category: "accessibility" | "usability" | "visual" | "responsive";
  principle: string;
  description: string;
  affected_element: string;
  recommendation: string;
  suggested_fix: string;
  acceptance_criteria: string;
  affected_viewports: string[];
}

export interface PipelinePage {
  route: string;
  url: string;
  issues: PipelineIssue[];
  screenshotPaths: Partial<Record<ViewportName, string>>;
}

export interface PipelineResult {
  baseUrl: string;
  timestamp: string;
  pages: PipelinePage[];
  /** Where screenshots live on disk (temp dir). Caller owns cleanup. */
  outputDir: string;
  /** Which transport was used (sdk vs cli). */
  transport: "sdk" | "cli";
  /**
   * Run id under which findings were persisted to `.audit-runs/<runId>.json`.
   * Absent if persistence was skipped or failed.
   */
  runId?: string;
  /**
   * Public URL to the /report/<runId> viewer (triage + push-to-Asana surface).
   * Base URL comes from UX_AUDIT_PUBLIC_BASE_URL env var, falling back to
   * http://localhost:3000. Absent if the run wasn't persisted.
   */
  reportUrl?: string;
}

export interface PipelineProgress {
  onProgress?: (detail: string) => void;
}

// ---------------------------------------------------------------------------
// Per-pipeline option types — kept deliberately narrow so each tool exposes
// only the flags that make sense for it.
// ---------------------------------------------------------------------------

export interface AuditPageOptions extends PipelineProgress {
  url: string;
  prdContext?: string;
  repoContext?: string;
  viewports?: ViewportName[];
  cookies?: Cookie[];
  credentials?: { email: string; password: string };
  /** Skip axe + Lighthouse runs. */
  skipDeterministic?: boolean;
}

export interface AuditSiteOptions extends AuditPageOptions {
  /** Maximum pages to crawl. Default: 10. */
  maxPages?: number;
}

export interface QuickScanOptions extends PipelineProgress {
  url: string;
  prdContext?: string;
}

export interface AuditLocalOptions extends PipelineProgress {
  /** Route path like "/signup". Defaults to "/". */
  routePath?: string;
  /** Route file (e.g. "src/app/signup/page.tsx"). */
  file?: string;
  /** Dev server port. Auto-detected if omitted. */
  port?: number;
  prdContext?: string;
}
