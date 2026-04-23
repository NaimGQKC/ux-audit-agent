/**
 * MCP tools registry — shared across stdio + HTTP entrypoints.
 *
 *   registerTools(server, { includeLocal: true })  → full local toolset
 *   registerTools(server, { includeLocal: false }) → remote-safe subset
 *
 * includeLocal gates audit_local, auth_session / clear_auth_session, and the
 * project mutation tools (create_project, update_project). list_projects is
 * read-only and registers unconditionally so remote callers can still
 * discover project_ids. The auth_session tools are local-only because they
 * spawn a headed Chrome window on the developer's machine — impossible from
 * the Fly container, where there's no screen to pop it on.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuditPage } from "./audit-page";
import { registerAuditSite } from "./audit-site";
import { registerQuickScan } from "./quick-scan";
import { registerAuditLocal } from "./audit-local";
import { registerAuditScreenshot } from "./audit-screenshot";
import { registerAuthSession } from "./auth-session";
import { registerListProjects } from "./list-projects";
import { registerManageProjects } from "./manage-projects";

export interface RegisterToolsOptions {
  /**
   * Register audit_local, auth_session / clear_auth_session, and the
   * project-mutation tools (create_project, update_project). Only set true
   * on the local stdio server. The remote HTTP server must set this to
   * false — it has no access to the developer's localhost dev server, it
   * cannot pop a browser on their screen for SSO, and it must not expose
   * filesystem-mutation tools.
   */
  includeLocal: boolean;
}

export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
  registerAuditPage(server);
  registerAuditSite(server);
  registerQuickScan(server);
  registerAuditScreenshot(server);
  registerListProjects(server);
  if (opts.includeLocal) {
    registerAuditLocal(server);
    registerAuthSession(server);
    registerManageProjects(server);
  }
}
