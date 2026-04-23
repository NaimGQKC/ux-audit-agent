/**
 * MCP tool: quick_scan
 *
 * Desktop-only single-page scan. Designed for in-flow "does this look
 * broken?" questions during development or PR review.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runQuickScan } from "@/lib/pipelines";
import { validatePublicUrl, sanitizeError, logError } from "@/lib/security";
import { resolveProjectPrdContext } from "@/lib/persistence/projects";
import { formatPipelineResult } from "./format";

export function registerQuickScan(server: McpServer): void {
  server.tool(
    "quick_scan",
    "Fast UX scan — audits a single page at desktop viewport only. Returns the top issues in ~60 seconds. Great for quick checks during development or PR reviews. Pass project_id to attach saved design standards (use list_projects to discover).",
    {
      url: z.string().url().describe("The URL to scan"),
      prd_context: z.string().optional().describe("Optional product requirements"),
      project_id: z.string().optional().describe(
        "Optional project ID to auto-attach saved design standards. Call list_projects to discover available IDs. The project's standardsDoc is merged into prdContext server-side — only the ID is transmitted.",
      ),
    },
    async ({ url, prd_context, project_id }) => {
      const validation = validatePublicUrl(url);
      if (!validation.ok) {
        return {
          content: [{ type: "text" as const, text: `Scan rejected: ${validation.error}` }],
          isError: true,
        };
      }
      const resolved = await resolveProjectPrdContext(project_id, prd_context);
      if (!resolved.ok) {
        const msg = resolved.reason === "invalid_id"
          ? "Invalid project_id — must match /^[a-zA-Z0-9_-]{1,64}$/. Use list_projects to find valid IDs."
          : "Unknown project_id. Use list_projects to see available projects.";
        return {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        };
      }
      try {
        const result = await runQuickScan({ url: validation.url!, prdContext: resolved.prdContext });
        return {
          content: [{ type: "text" as const, text: formatPipelineResult(result) }],
        };
      } catch (err) {
        logError("[mcp/quick_scan]", err);
        return {
          content: [{ type: "text" as const, text: `Scan failed: ${sanitizeError(err, "Scan failed.")}` }],
          isError: true,
        };
      }
    },
  );
}
