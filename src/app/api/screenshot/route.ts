import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getCacheDir } from "@/lib/cache";

/**
 * Serves screenshot images using a session ID + filename lookup.
 *
 * URL formats:
 *   /api/screenshot?s=<sessionId>&f=<filename>     — from tmp dir (live audit)
 *   /api/screenshot?c=<cacheId>&f=<filename>       — from .ux-audit-cache (persisted)
 *
 * Security: IDs and filenames are validated against strict patterns
 * and the full path is always constructed server-side.
 */

/** Session IDs produced by the crawler / upload routes (includes random suffix). */
const SESSION_PATTERN = /^ux-audit-(?:upload-)?\d+-[a-z0-9]+$/;

/** Cache IDs: hostname-slug_hexhash */
const CACHE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Only safe filenames: alphanumeric, hyphens, underscores, single dot before extension. */
const FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/;

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("s");
  const cacheId = request.nextUrl.searchParams.get("c");
  const filename = request.nextUrl.searchParams.get("f");

  if (!filename) {
    return new Response("Missing required parameter: f (filename)", { status: 400 });
  }

  if (!sessionId && !cacheId) {
    return new Response("Missing required parameter: s (session) or c (cache)", { status: 400 });
  }

  // Validate filename against strict pattern
  if (!FILENAME_PATTERN.test(filename)) {
    return new Response("Invalid filename", { status: 400 });
  }

  let resolved: string;

  if (cacheId) {
    // Serve from cache directory
    if (!CACHE_ID_PATTERN.test(cacheId)) {
      return new Response("Invalid cache ID", { status: 400 });
    }
    const filepath = path.join(getCacheDir(), cacheId, "screenshots", filename);
    resolved = path.resolve(filepath);
    if (!resolved.startsWith(path.resolve(getCacheDir()))) {
      return new Response("Access denied", { status: 403 });
    }
  } else {
    // Serve from tmp directory
    if (!SESSION_PATTERN.test(sessionId!)) {
      return new Response("Invalid session ID", { status: 400 });
    }
    const filepath = path.join(os.tmpdir(), sessionId!, filename);
    resolved = path.resolve(filepath);
    if (!resolved.startsWith(path.resolve(os.tmpdir()))) {
      return new Response("Access denied", { status: 403 });
    }
  }

  if (!fs.existsSync(resolved)) {
    return new Response("File not found", { status: 404 });
  }

  const buffer = fs.readFileSync(resolved);
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return new Response(buffer, {
    headers: {
      "Content-Type": mimeTypes[ext] || "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
