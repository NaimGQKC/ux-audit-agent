import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Serves screenshot images from the audit temp directory.
 * Only allows serving .png files from the OS temp directory for security.
 */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");

  if (!filePath) {
    return new Response("Missing path parameter", { status: 400 });
  }

  // Security: only allow files within the OS temp directory
  const resolved = path.resolve(filePath);
  const tmpDir = os.tmpdir();
  if (!resolved.startsWith(tmpDir)) {
    return new Response("Access denied", { status: 403 });
  }

  // Only serve PNG files
  if (path.extname(resolved).toLowerCase() !== ".png") {
    return new Response("Only PNG files are allowed", { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return new Response("File not found", { status: 404 });
  }

  const buffer = fs.readFileSync(resolved);
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
