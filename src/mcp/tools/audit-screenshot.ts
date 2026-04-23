/**
 * MCP tool: audit_screenshot
 *
 * Runs the 11-lens analyzer on a pre-captured screenshot — no crawl, no
 * browser. The "claude.ai chat generates TSX, previews it in the artifact
 * pane, user screenshots the pane, we audit the screenshot" loop lives here.
 * Single viewport, single frame — caller is responsible for capturing the
 * representative state.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { analyzeScreenshots } from "@/lib/analyzer/run";
import { validateAnalysisResult } from "@/lib/analyzer";
import { activeTransport } from "@/lib/claude-client";
import { resolveProjectPrdContext } from "@/lib/persistence/projects";
import { sanitizeError, logError } from "@/lib/security";
import type { PipelineIssue, PipelinePage, PipelineResult } from "@/lib/pipelines";
import { toPipelineIssue } from "@/lib/pipelines/shared";
import { formatPipelineResult } from "./format";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function materialiseImage(
  image_base64: string | undefined,
  image_path: string | undefined,
): Promise<{ ok: true; path: string; cleanup: () => Promise<void> } | { ok: false; reason: string }> {
  const hasB64 = typeof image_base64 === "string" && image_base64.length > 0;
  const hasPath = typeof image_path === "string" && image_path.length > 0;

  if (hasB64 === hasPath) {
    return {
      ok: false,
      reason: "Provide exactly one of image_base64 or image_path.",
    };
  }

  if (hasPath) {
    const abs = path.resolve(image_path!);
    if (!fs.existsSync(abs)) {
      return { ok: false, reason: `image_path not found: ${abs}` };
    }
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) {
      return { ok: false, reason: `image_path is not a file: ${abs}` };
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      return { ok: false, reason: `image exceeds ${MAX_IMAGE_BYTES} bytes` };
    }
    return { ok: true, path: abs, cleanup: async () => {} };
  }

  const stripped = image_base64!.replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/i, "");
  const buf = Buffer.from(stripped, "base64");
  if (buf.length === 0) {
    return { ok: false, reason: "image_base64 decoded to zero bytes (check encoding)" };
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `decoded image exceeds ${MAX_IMAGE_BYTES} bytes` };
  }

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "ux-audit-shot-"));
  const filePath = path.join(dir, "screenshot.png");
  await fsp.writeFile(filePath, buf);
  return {
    ok: true,
    path: filePath,
    cleanup: async () => {
      try {
        await fsp.rm(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

export function registerAuditScreenshot(server: McpServer): void {
  server.tool(
    "audit_screenshot",
    "Analyze a pre-captured screenshot against the 11-lens UX/accessibility framework (Nielsen, WCAG, Gestalt, UX laws). Use this when you already have an image — e.g., a screenshot of the claude.ai artifact/preview pane showing a generated component, a mockup export, or a Figma frame. Pass image_base64 (raw PNG bytes, data URL prefix tolerated) OR image_path (local file). No crawl, no browser — single viewport, single frame. Pass project_id to attach saved design standards.",
    {
      image_base64: z.string().optional().describe(
        "Base64-encoded image bytes. PNG preferred; JPEG/WebP accepted. Data-URL prefix (data:image/png;base64,...) is stripped automatically.",
      ),
      image_path: z.string().optional().describe(
        "Absolute or relative path to a PNG/JPEG file on the MCP host. Mutually exclusive with image_base64.",
      ),
      prd_context: z.string().optional().describe(
        "Optional product requirements or component context (e.g. 'this is the approval dialog for the audit dashboard').",
      ),
      project_id: z.string().optional().describe(
        "Optional project ID to auto-attach saved design standards. Call list_projects to discover available IDs.",
      ),
    },
    async ({ image_base64, image_path, prd_context, project_id }) => {
      const materialised = await materialiseImage(image_base64, image_path);
      if (!materialised.ok) {
        return {
          content: [{ type: "text" as const, text: `Audit rejected: ${materialised.reason}` }],
          isError: true,
        };
      }

      const resolved = await resolveProjectPrdContext(project_id, prd_context);
      if (!resolved.ok) {
        await materialised.cleanup();
        const msg = resolved.reason === "invalid_id"
          ? "Invalid project_id — must match /^[a-zA-Z0-9_-]{1,64}$/. Use list_projects to find valid IDs."
          : "Unknown project_id. Use list_projects to see available projects.";
        return {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        };
      }

      try {
        const analysis = await analyzeScreenshots([materialised.path], {
          prdContext: resolved.prdContext,
          label: "screenshot",
        });

        const basename = path.basename(materialised.path);
        const fileResult = analysis.screenshots[basename] as
          | { issues: unknown[] }
          | undefined;

        const issues: PipelineIssue[] = [];
        if (fileResult) {
          try {
            const validated = validateAnalysisResult(fileResult);
            for (const issue of validated.issues) {
              issues.push(toPipelineIssue(issue));
            }
          } catch {
            // malformed — leave issues empty, surface the raw analyzer error below
          }
        }

        const page: PipelinePage = {
          route: "screenshot",
          url: image_path ? path.basename(image_path) : "pasted screenshot",
          issues,
          screenshotPaths: {},
        };

        const result: PipelineResult = {
          baseUrl: page.url,
          timestamp: new Date().toISOString(),
          pages: [page],
          outputDir: path.dirname(materialised.path),
          transport: activeTransport(),
        };

        const text = analysis.failedBatches > 0 && issues.length === 0
          ? `Analyzer failed: ${analysis.errors[0]?.reason ?? "unknown"}. Try again or send the image with more surrounding context.`
          : formatPipelineResult(result);

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        logError("[mcp/audit_screenshot]", err);
        return {
          content: [
            { type: "text" as const, text: `Audit failed: ${sanitizeError(err, "Audit failed.")}` },
          ],
          isError: true,
        };
      } finally {
        await materialised.cleanup();
      }
    },
  );
}
