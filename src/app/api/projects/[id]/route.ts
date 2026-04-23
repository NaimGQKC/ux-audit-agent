import { NextRequest } from "next/server";
import {
  loadProject,
  saveProject,
  deleteProject,
  isValidProjectId,
  type Project,
} from "@/lib/persistence/projects";
import { requireApiAuth, sanitizeError, logError } from "@/lib/security";

export const dynamic = "force-dynamic";

/** 256 KB cap on JSON bodies — standards docs are big-ish but not unlimited. */
const MAX_BODY_BYTES = 256 * 1024;

interface UpdateProjectBody {
  name?: unknown;
  standardsDoc?: unknown;
  brandTokens?: unknown;
  notes?: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  request: NextRequest,
  ctx: { params: { id: string } },
) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { id } = ctx.params;
  if (!isValidProjectId(id)) {
    return jsonResponse(400, { error: "Invalid project id" });
  }

  try {
    const project = await loadProject(id);
    if (!project) return jsonResponse(404, { error: "Project not found" });
    return Response.json({ project });
  } catch (err) {
    logError("[projects]", err);
    return jsonResponse(500, { error: sanitizeError(err, "Failed to load project.") });
  }
}

export async function PUT(
  request: NextRequest,
  ctx: { params: { id: string } },
) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { id } = ctx.params;
  if (!isValidProjectId(id)) {
    return jsonResponse(400, { error: "Invalid project id" });
  }

  // Reject oversize payloads up-front via Content-Length when available.
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Payload too large" });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  // Backup size check in case the header was missing or lied.
  if (Buffer.byteLength(raw, "utf-8") > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Payload too large" });
  }

  let body: UpdateProjectBody;
  try {
    body = JSON.parse(raw) as UpdateProjectBody;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  // Validate each optional field if present.
  let nextName: string | undefined;
  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return jsonResponse(400, { error: "name must be a string" });
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0) {
      return jsonResponse(400, { error: "Project name must not be empty" });
    }
    if (trimmed.length > 200) {
      return jsonResponse(400, { error: "Project name must be 200 characters or fewer" });
    }
    nextName = trimmed;
  }
  if (body.standardsDoc !== undefined && typeof body.standardsDoc !== "string") {
    return jsonResponse(400, { error: "standardsDoc must be a string" });
  }
  if (body.brandTokens !== undefined && typeof body.brandTokens !== "string") {
    return jsonResponse(400, { error: "brandTokens must be a string" });
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    return jsonResponse(400, { error: "notes must be a string" });
  }

  try {
    const existing = await loadProject(id);
    if (!existing) return jsonResponse(404, { error: "Project not found" });

    const merged: Project = {
      projectId: existing.projectId,
      name: nextName ?? existing.name,
      standardsDoc: body.standardsDoc !== undefined
        ? (body.standardsDoc as string)
        : existing.standardsDoc,
      brandTokens: body.brandTokens !== undefined
        ? (body.brandTokens as string)
        : existing.brandTokens,
      notes: body.notes !== undefined
        ? (body.notes as string)
        : existing.notes,
      createdAt: existing.createdAt,
      // saveProject bumps updatedAt to now — value here is a placeholder.
      updatedAt: existing.updatedAt,
    };
    await saveProject(id, merged);

    // Re-read to surface the bumped updatedAt the store just wrote.
    const saved = await loadProject(id);
    return Response.json({ project: saved ?? merged });
  } catch (err) {
    logError("[projects]", err);
    return jsonResponse(500, { error: sanitizeError(err, "Failed to update project.") });
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: { id: string } },
) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { id } = ctx.params;
  if (!isValidProjectId(id)) {
    return jsonResponse(400, { error: "Invalid project id" });
  }

  try {
    const removed = await deleteProject(id);
    if (!removed) return jsonResponse(404, { error: "Project not found" });
    return new Response(null, { status: 204 });
  } catch (err) {
    logError("[projects]", err);
    return jsonResponse(500, { error: sanitizeError(err, "Failed to delete project.") });
  }
}
