import { NextRequest } from "next/server";
import {
  listProjects,
  saveProject,
  generateProjectId,
  type Project,
} from "@/lib/persistence/projects";
import { requireApiAuth, sanitizeError, logError } from "@/lib/security";

export const dynamic = "force-dynamic";

/** 256 KB cap on JSON bodies — standards docs are big-ish but not unlimited. */
const MAX_BODY_BYTES = 256 * 1024;

interface CreateProjectBody {
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

export async function GET(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  try {
    const projects = await listProjects();
    return Response.json({ projects });
  } catch (err) {
    logError("[projects]", err);
    return jsonResponse(500, { error: sanitizeError(err, "Failed to list projects.") });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

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

  let body: CreateProjectBody;
  try {
    body = JSON.parse(raw) as CreateProjectBody;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (typeof body.name !== "string") {
    return jsonResponse(400, { error: "Missing required field: name" });
  }
  const trimmedName = body.name.trim();
  if (trimmedName.length === 0) {
    return jsonResponse(400, { error: "Project name must not be empty" });
  }
  if (trimmedName.length > 200) {
    return jsonResponse(400, { error: "Project name must be 200 characters or fewer" });
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
    const now = new Date().toISOString();
    const projectId = generateProjectId(trimmedName);
    const project: Project = {
      projectId,
      name: trimmedName,
      standardsDoc: body.standardsDoc,
      brandTokens: body.brandTokens,
      notes: body.notes,
      createdAt: now,
      updatedAt: now,
    };
    await saveProject(projectId, project);
    return jsonResponse(201, { project });
  } catch (err) {
    logError("[projects]", err);
    return jsonResponse(500, { error: sanitizeError(err, "Failed to create project.") });
  }
}
