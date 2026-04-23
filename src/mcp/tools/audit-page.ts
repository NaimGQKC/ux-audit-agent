/**
 * MCP tool: audit_page
 *
 * Thin wrapper over the audit-page pipeline. No crawl fan-out, no SSE —
 * the pipeline already knows how to do its job. This file's only job is to
 * register the tool definition and map MCP args to pipeline options.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runAuditPage } from "@/lib/pipelines";
import { validatePublicUrl, sanitizeError, logError } from "@/lib/security";
import { resolveProjectPrdContext } from "@/lib/persistence/projects";
import { formatPipelineResult } from "./format";
import { parseCookiesJson } from "./cookies";

export function registerAuditPage(server: McpServer): void {
  server.tool(
    "audit_page",
    "Run a UX/accessibility audit on a single page. Screenshots the URL at mobile/tablet/desktop viewports and analyzes against Nielsen heuristics, WCAG 2.1/2.2, Gestalt principles, UX laws, and more. Returns structured issues with severity, principle citations, and fix recommendations. For SSO-protected sites on the LOCAL stdio server: run auth_session first — every subsequent audit call reuses the saved session automatically. For the REMOTE HTTP server: pass cookies_json (exported from DevTools) since remote can't drive a browser on your machine. Pass project_id to attach saved design standards (use list_projects to discover).",
    {
      url: z.string().url().describe("The full URL to audit (must be http or https)"),
      prd_context: z.string().optional().describe("Optional product requirements or context to evaluate against"),
      email: z.string().optional().describe("Email/username for auto-login if the page has a simple form login (not for SSO — use auth_session instead)"),
      password: z.string().optional().describe("Password for auto-login (never logged or persisted)"),
      cookies_json: z.string().optional().describe(
        "JSON array of cookies to inject — the remote-MCP escape hatch for authenticated audits. Export from DevTools → Application → Cookies as JSON. Each entry must have name, value, domain, path (required) plus optional expires/httpOnly/secure/sameSite. Local stdio callers should prefer auth_session + automatic profile reuse.",
      ),
      project_id: z.string().optional().describe(
        "Optional project ID to auto-attach saved design standards. Call list_projects to discover available IDs. The project's standardsDoc is merged into prdContext server-side — only the ID is transmitted.",
      ),
    },
    async ({ url, prd_context, email, password, cookies_json, project_id }) => {
      const validation = validatePublicUrl(url);
      if (!validation.ok) {
        return {
          content: [{ type: "text" as const, text: `Audit rejected: ${validation.error}` }],
          isError: true,
        };
      }
      const cookiesResult = parseCookiesJson(cookies_json);
      if (!cookiesResult.ok) {
        return {
          content: [{ type: "text" as const, text: `Audit rejected: ${cookiesResult.error}` }],
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
        const credentials = email && password ? { email, password } : undefined;
        const cookies = cookiesResult.cookies.length > 0 ? cookiesResult.cookies : undefined;
        const result = await runAuditPage({ url: validation.url!, prdContext: resolved.prdContext, credentials, cookies });
        return {
          content: [{ type: "text" as const, text: formatPipelineResult(result) }],
        };
      } catch (err) {
        logError("[mcp/audit_page]", err);
        return {
          content: [{ type: "text" as const, text: `Audit failed: ${sanitizeError(err, "Audit failed.")}` }],
          isError: true,
        };
      }
    },
  );
}
