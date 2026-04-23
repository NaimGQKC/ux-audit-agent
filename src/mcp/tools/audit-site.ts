/**
 * MCP tool: audit_site
 *
 * Full-site audit wrapper over the audit-site pipeline. Crawls same-origin
 * pages up to max_pages and runs the full 11-lens analysis per page.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runAuditSite } from "@/lib/pipelines";
import { validatePublicUrl, sanitizeError, logError } from "@/lib/security";
import { resolveProjectPrdContext } from "@/lib/persistence/projects";
import { formatPipelineResult } from "./format";
import { parseCookiesJson } from "./cookies";

export function registerAuditSite(server: McpServer): void {
  server.tool(
    "audit_site",
    "Run a full-site UX audit. Crawls the URL, discovers all same-origin pages (up to max_pages), screenshots each at 3 viewports, and runs the full 11-lens analysis. Use audit_page for a single page — this is the comprehensive site-wide version. For SSO-protected sites on the LOCAL stdio server: run auth_session first — the crawl reuses the saved session automatically. For the REMOTE HTTP server: pass cookies_json (exported from DevTools) since remote can't drive a browser on your machine. Pass project_id to attach saved design standards (use list_projects to discover).",
    {
      url: z.string().url().describe("The entry URL to start crawling from"),
      max_pages: z.number().int().min(1).max(30).default(10).describe("Maximum pages to audit (default: 10)"),
      prd_context: z.string().optional().describe("Optional product requirements to evaluate against"),
      email: z.string().optional().describe("Email/username for auto-login (simple form login only — use auth_session for SSO)"),
      password: z.string().optional().describe("Password for auto-login"),
      cookies_json: z.string().optional().describe(
        "JSON array of cookies to inject — the remote-MCP escape hatch for authenticated audits. Export from DevTools → Application → Cookies as JSON. Each entry must have name, value, domain, path (required) plus optional expires/httpOnly/secure/sameSite. Local stdio callers should prefer auth_session + automatic profile reuse.",
      ),
      project_id: z.string().optional().describe(
        "Optional project ID to auto-attach saved design standards. Call list_projects to discover available IDs. The project's standardsDoc is merged into prdContext server-side — only the ID is transmitted.",
      ),
    },
    async ({ url, max_pages, prd_context, email, password, cookies_json, project_id }) => {
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
        const result = await runAuditSite({
          url: validation.url!,
          maxPages: max_pages,
          prdContext: resolved.prdContext,
          credentials,
          cookies,
        });
        return {
          content: [{ type: "text" as const, text: formatPipelineResult(result) }],
        };
      } catch (err) {
        logError("[mcp/audit_site]", err);
        return {
          content: [{ type: "text" as const, text: `Audit failed: ${sanitizeError(err, "Audit failed.")}` }],
          isError: true,
        };
      }
    },
  );
}
