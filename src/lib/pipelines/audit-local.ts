/**
 * audit-local pipeline — shield during development.
 *
 * Auto-detects a running dev server (npm run dev) on common ports, derives
 * the URL path from a Next.js route file if given, and delegates to the
 * audit-page pipeline. Only usable locally — the remote HTTP MCP server
 * deliberately omits this tool because "localhost" has no meaning there.
 */

import * as path from "node:path";
import { runAuditPage } from "./audit-page";
import type { AuditLocalOptions, PipelineResult } from "./types";

const DEFAULT_DEV_PORTS = [3000, 3001, 5173, 5174, 4200, 8080, 8000, 4321];

export async function detectDevServer(preferredPort?: number): Promise<string | null> {
  const ports = preferredPort ? [preferredPort] : DEFAULT_DEV_PORTS;
  for (const port of ports) {
    const url = `http://localhost:${port}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
      clearTimeout(timer);
      if (res.status < 600) return url;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Map a Next.js route file to its URL path. Returns null for dynamic segments
 * or unrecognized files — caller must supply `routePath` explicitly in that case.
 */
export function routeFromFile(file: string, cwd: string): string | null {
  const abs = path.resolve(cwd, file);
  const rel = path.relative(cwd, abs).replace(/\\/g, "/");

  const appMatch = rel.match(/^(?:src\/)?app\/(.+?)\/page\.(?:tsx|jsx|ts|js)$/);
  if (appMatch) {
    const segments = appMatch[1]
      .split("/")
      .filter((s) => !s.startsWith("(") && !s.startsWith("@"))
      .filter((s) => !s.startsWith("_"));
    if (segments.length === 0) return "/";
    if (segments.some((s) => s.includes("["))) return null;
    return "/" + segments.join("/");
  }

  if (rel === "app/page.tsx" || rel === "src/app/page.tsx") return "/";

  const pagesMatch = rel.match(/^(?:src\/)?pages\/(.+)\.(?:tsx|jsx|ts|js)$/);
  if (pagesMatch) {
    const p = pagesMatch[1];
    if (p === "_app" || p === "_document" || p === "_error") return null;
    if (p === "api" || p.startsWith("api/")) return null;
    if (p.includes("[")) return null;
    if (p === "index") return "/";
    return "/" + p.replace(/\/index$/, "");
  }

  return null;
}

export class DevServerNotFoundError extends Error {
  constructor(public readonly portHint: number | undefined) {
    super(
      portHint
        ? `No dev server detected on :${portHint}.`
        : `No dev server detected on common ports (${DEFAULT_DEV_PORTS.join(", ")}).`,
    );
    this.name = "DevServerNotFoundError";
  }
}

export class AmbiguousRouteFileError extends Error {
  constructor(public readonly file: string) {
    super(
      `Could not derive a route from "${file}". Either not a recognized Next.js route file, or contains a dynamic segment. Pass \`routePath\` explicitly.`,
    );
    this.name = "AmbiguousRouteFileError";
  }
}

export async function runAuditLocal(opts: AuditLocalOptions): Promise<PipelineResult> {
  const base = await detectDevServer(opts.port);
  if (!base) throw new DevServerNotFoundError(opts.port);

  let route = opts.routePath ?? null;
  if (!route && opts.file) {
    const inferred = routeFromFile(opts.file, process.cwd());
    if (!inferred) throw new AmbiguousRouteFileError(opts.file);
    route = inferred;
  }
  if (!route) route = "/";
  if (!route.startsWith("/")) route = "/" + route;

  const url = `${base}${route}`;

  return runAuditPage({
    url,
    prdContext: opts.prdContext,
    onProgress: opts.onProgress,
    // Shield-mode defaults: keep it fast. The remote sword runs the full kit.
    skipDeterministic: false,
  });
}

export { DEFAULT_DEV_PORTS };
