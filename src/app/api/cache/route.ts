import { NextRequest } from "next/server";
import { findCachedAudits, loadCachedAudit, deleteCachedAudit } from "@/lib/cache";

/**
 * GET /api/cache?url=...  — list cached audits for a URL (or all if no url)
 * GET /api/cache?id=...   — load a specific cached audit by ID
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const url = request.nextUrl.searchParams.get("url");

  if (id) {
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
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const deleted = deleteCachedAudit(id);
  return Response.json({ deleted });
}
