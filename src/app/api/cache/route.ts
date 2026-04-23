import { NextRequest } from "next/server";
import { findCachedAudits, loadCachedAudit, deleteCachedAudit } from "@/lib/cache";
import { requireApiAuth } from "@/lib/security";

// Cache IDs are our own SHA-style hashes. Reject anything with a path
// separator, traversal dots, or non-hex-ish content before hitting the FS.
const CACHE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * GET /api/cache?url=...  — list cached audits for a URL (or all if no url)
 * GET /api/cache?id=...   — load a specific cached audit by ID
 */
export async function GET(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  const url = request.nextUrl.searchParams.get("url");

  if (id) {
    if (!CACHE_ID_PATTERN.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    const cached = loadCachedAudit(id);
    if (!cached) {
      return Response.json({ error: "Cached audit not found" }, { status: 404 });
    }
    return Response.json(cached);
  }

  const audits = findCachedAudits(url || undefined);
  return Response.json({ audits });
}

/**
 * DELETE /api/cache?id=... — delete a cached audit
 */
export async function DELETE(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing id parameter" }, { status: 400 });
  }
  if (!CACHE_ID_PATTERN.test(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const deleted = deleteCachedAudit(id);
  return Response.json({ deleted });
}
