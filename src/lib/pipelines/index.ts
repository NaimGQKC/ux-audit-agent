/**
 * Decoupled audit pipelines.
 *
 * Each pipeline is a pure function: input options in, results out. No SSE,
 * no HTTP, no MCP coupling. Callers wrap these in whatever transport glue
 * they need — the Next.js API route, the local stdio MCP server, the remote
 * HTTP MCP server, the CLI.
 */

export { runAuditPage } from "./audit-page";
export { runAuditSite } from "./audit-site";
export { runQuickScan } from "./quick-scan";
export {
  runAuditLocal,
  detectDevServer,
  routeFromFile,
  DevServerNotFoundError,
  AmbiguousRouteFileError,
  DEFAULT_DEV_PORTS,
} from "./audit-local";

export type {
  PipelineIssue,
  PipelinePage,
  PipelineResult,
  PipelineProgress,
  AuditPageOptions,
  AuditSiteOptions,
  QuickScanOptions,
  AuditLocalOptions,
} from "./types";
