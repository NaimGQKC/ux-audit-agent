/**
 * MCP tool: audit_local — the "shield" for local development.
 *
 * Intentionally only registered on the LOCAL (stdio) server. The remote
 * HTTP server can't see the developer's laptop so "localhost" has no
 * meaning there.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  runAuditLocal,
  DevServerNotFoundError,
  AmbiguousRouteFileError,
  DEFAULT_DEV_PORTS,
} from "@/lib/pipelines";
import { sanitizeError, logError } from "@/lib/security";
import { resolveProjectPrdContext } from "@/lib/persistence/projects";
import { formatPipelineResult } from "./format";

// Restrict route paths to safe characters — no schemes, no hosts, no URL
// injection via `..` or //. The pipeline still normalises to a leading `/`.
const SAFE_ROUTE = /^\/?[a-zA-Z0-9\-_/]*\/?$/;

export function registerAuditLocal(server: McpServer): void {
  server.tool(
    "audit_local",
    "Run a UX/accessibility audit against a running local dev server (npm run dev). Auto-detects the port (3000/5173/4200/...) and can derive the route from a Next.js route file path. Use this as a shield while coding: call it right after editing a page or component to catch issues before they ship, instead of waiting for a post-release audit. Pass project_id to attach saved design standards (use list_projects to discover).",
    {
      path: z
        .string()
        .optional()
        .describe("Route path to audit, e.g. '/signup'. Defaults to '/' if neither `path` nor `file` is given."),
      file: z
        .string()
        .optional()
        .describe(
          "Repo-relative path to a Next.js route file (e.g. 'src/app/signup/page.tsx'). The tool derives the URL path from it. If `path` is also supplied, `path` wins.",
        ),
      port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional()
        .describe("Dev-server port. Auto-detected across common ports if omitted."),
      prd_context: z.string().optional().describe("Optional product requirements or context to evaluate against"),
      project_id: z.string().optional().describe(
        "Optional project ID to auto-attach saved design standards. Call list_projects to discover available IDs. The project's standardsDoc is merged into prdContext server-side — only the ID is transmitted.",
      ),
    },
    async ({ path: routePath, file, port, prd_context, project_id }) => {
      if (routePath && !SAFE_ROUTE.test(routePath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Rejected: `path` must match /^\\/?[a-zA-Z0-9\\-_/]*\\/?$/ — pass a clean route like `/signup`.",
            },
          ],
          isError: true,
        };
      }
      if (file && (file.includes("..") || file.startsWith("/") || /[\x00-\x1f]/.test(file))) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Rejected: `file` must be a repo-relative path without `..`.",
            },
          ],
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
        const result = await runAuditLocal({
          routePath,
          file,
          port,
          prdContext: resolved.prdContext,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: formatPipelineResult(result, `Audited ${result.baseUrl}`),
            },
          ],
        };
      } catch (err) {
        if (err instanceof DevServerNotFoundError) {
          const probed = port ? `:${port}` : ` on common ports (${DEFAULT_DEV_PORTS.join(", ")})`;
          return {
            content: [
              {
                type: "text" as const,
                text: `No local dev server detected${probed}. Start one with \`npm run dev\` (or similar) and try again.`,
              },
            ],
            isError: true,
          };
        }
        if (err instanceof AmbiguousRouteFileError) {
          return {
            content: [{ type: "text" as const, text: err.message }],
            isError: true,
          };
        }
        logError("[mcp/audit_local]", err);
        return {
          content: [{ type: "text" as const, text: `Audit failed: ${sanitizeError(err, "Audit failed.")}` }],
          isError: true,
        };
      }
    },
  );
}
