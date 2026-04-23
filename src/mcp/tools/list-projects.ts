/**
 * MCP tool: list_projects
 *
 * Read-only — safe on both the local stdio surface and the remote HTTP
 * surface. Callers use this to discover project_ids they can then pass to
 * audit_page / audit_site / quick_scan / audit_local.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProjects } from "@/lib/persistence/projects";
import { sanitizeError, logError } from "@/lib/security";

export function registerListProjects(server: McpServer): void {
  server.tool(
    "list_projects",
    "List saved audit projects. Each project bundles design-standards docs that can be auto-attached to audits by passing its project_id. Use this to discover project IDs before calling audit_page / audit_site / quick_scan / audit_local.",
    {},
    async () => {
      try {
        const projects = await listProjects();
        if (projects.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No projects saved yet." }],
          };
        }
        const lines = projects.map(
          (p) => `- ${p.projectId} — ${p.name} (updated ${p.updatedAt})`,
        );
        return {
          content: [{
            type: "text" as const,
            text: `${projects.length} project(s):\n\n${lines.join("\n")}`,
          }],
        };
      } catch (err) {
        logError("[mcp/list_projects]", err);
        return {
          content: [{ type: "text" as const, text: `Failed to list projects: ${sanitizeError(err, "Unknown error.")}` }],
          isError: true,
        };
      }
    },
  );
}
