/**
 * MCP tools: create_project + update_project — LOCAL-ONLY mutations.
 *
 * Filesystem writes happen here, so these tools must only register on the
 * local stdio server (see src/mcp/tools/index.ts `includeLocal` gate). The
 * remote HTTP connector exposes list_projects for read-only discovery but
 * never these write paths.
 *
 * Each field is capped at 256 KB to keep the JSON store small and prevent
 * runaway payloads from a confused model; the usual design-standards doc
 * sits well under that.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  saveProject,
  loadProject,
  generateProjectId,
  isValidProjectId,
  type Project,
} from "@/lib/persistence/projects";
import { sanitizeError, logError } from "@/lib/security";

const MAX_FIELD = 256 * 1024; // 256 KB per field guard

function tooLarge(s: string | undefined): boolean {
  return typeof s === "string" && Buffer.byteLength(s, "utf-8") > MAX_FIELD;
}

export function registerManageProjects(server: McpServer): void {
  server.tool(
    "create_project",
    "Create a new audit project with a name and optional design-standards doc (markdown). Returns the new project_id. Use this to save a standards doc once so future audits can attach it via project_id. LOCAL ONLY.",
    {
      name: z.string().min(1).max(200).describe("Human-readable project name"),
      standards_doc: z.string().optional().describe("Markdown — the design/UX standards that audits for this project will evaluate against"),
      brand_tokens: z.string().optional().describe("Optional brand tokens or design-system summary"),
      notes: z.string().optional().describe("Freeform notes"),
    },
    async ({ name, standards_doc, brand_tokens, notes }) => {
      if (tooLarge(standards_doc) || tooLarge(brand_tokens) || tooLarge(notes)) {
        return {
          content: [{ type: "text" as const, text: "Field exceeds 256 KB limit." }],
          isError: true,
        };
      }
      try {
        const projectId = generateProjectId(name);
        const now = new Date().toISOString();
        const project: Project = {
          projectId,
          name: name.trim(),
          standardsDoc: standards_doc,
          brandTokens: brand_tokens,
          notes,
          createdAt: now,
          updatedAt: now,
        };
        await saveProject(projectId, project);
        return {
          content: [{
            type: "text" as const,
            text: `Created project.\n\n  project_id: ${projectId}\n  name: ${project.name}\n\nAttach to audits via the project_id arg.`,
          }],
        };
      } catch (err) {
        logError("[mcp/create_project]", err);
        return {
          content: [{ type: "text" as const, text: `Failed to create project: ${sanitizeError(err, "Unknown error.")}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "update_project",
    "Update fields on an existing audit project. Any field you pass replaces the stored value; fields you omit are left alone. LOCAL ONLY.",
    {
      project_id: z.string().describe("ID of the project to update (see list_projects)"),
      name: z.string().min(1).max(200).optional(),
      standards_doc: z.string().optional(),
      brand_tokens: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({ project_id, name, standards_doc, brand_tokens, notes }) => {
      if (!isValidProjectId(project_id)) {
        return {
          content: [{ type: "text" as const, text: "Invalid project_id." }],
          isError: true,
        };
      }
      if (tooLarge(standards_doc) || tooLarge(brand_tokens) || tooLarge(notes)) {
        return {
          content: [{ type: "text" as const, text: "Field exceeds 256 KB limit." }],
          isError: true,
        };
      }
      try {
        const existing = await loadProject(project_id);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: "Project not found." }],
            isError: true,
          };
        }
        const merged: Project = {
          ...existing,
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(standards_doc !== undefined ? { standardsDoc: standards_doc } : {}),
          ...(brand_tokens !== undefined ? { brandTokens: brand_tokens } : {}),
          ...(notes !== undefined ? { notes } : {}),
          updatedAt: new Date().toISOString(),
        };
        await saveProject(project_id, merged);
        return {
          content: [{
            type: "text" as const,
            text: `Updated project ${project_id}.`,
          }],
        };
      } catch (err) {
        logError("[mcp/update_project]", err);
        return {
          content: [{ type: "text" as const, text: `Failed to update project: ${sanitizeError(err, "Unknown error.")}` }],
          isError: true,
        };
      }
    },
  );
}
