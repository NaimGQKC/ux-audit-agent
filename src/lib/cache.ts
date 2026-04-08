/**
 * Lightweight persistence layer for audit results.
 *
 * Saves audit results + screenshots to `.ux-audit-cache/` in the project root,
 * keyed by a slug of the URL + timestamp. Provides lookup by URL to find recent audits.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(process.cwd(), ".ux-audit-cache");

export interface CachedAuditMeta {
  id: string;
  url: string;
  timestamp: string;
  pageCount: number;
  issueCount: number;
}

export interface CachedAuditResult {
  meta: CachedAuditMeta;
  /** Full audit result payload (same shape as SSE result event) */
  result: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureCacheDir(): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return CACHE_DIR;
}

function urlSlug(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/\./g, "-");
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40);
  }
}

function auditId(url: string, timestamp: string): string {
  const hash = crypto.createHash("md5").update(`${url}|${timestamp}`).digest("hex").slice(0, 8);
  return `${urlSlug(url)}_${hash}`;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Persist an audit result to the cache directory.
 * Copies screenshots from the tmp source dir into the cache entry folder.
 */
export function saveAuditToCache(
  auditResult: {
    baseUrl: string;
    timestamp: string;
    pages: Array<{
      route: string;
      url: string;
      viewports: Record<string, { screenshotPath: string; issues: unknown[] }>;
    }>;
  },
  sourceTmpDir: string,
): CachedAuditMeta {
  const dir = ensureCacheDir();
  const id = auditId(auditResult.baseUrl, auditResult.timestamp);
  const entryDir = path.join(dir, id);
  const screenshotsDir = path.join(entryDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // Copy screenshots and rewrite paths
  let totalIssues = 0;
  const rewritten = {
    ...auditResult,
    pages: auditResult.pages.map((page) => {
      const viewports: Record<string, { screenshotPath: string; issues: unknown[] }> = {};

      for (const [vpName, vp] of Object.entries(page.viewports)) {
        let newPath = "";
        if (vp.screenshotPath) {
          // screenshotPath is a URL like /api/screenshot?s=xxx&f=yyy.png
          // Extract the filename from the URL 'f' param, or fall back to basename
          let basename: string;
          try {
            const url = new URL(vp.screenshotPath, "http://localhost");
            basename = url.searchParams.get("f") || path.basename(vp.screenshotPath);
          } catch {
            basename = path.basename(vp.screenshotPath);
          }
          const src = path.join(sourceTmpDir, basename);
          const dest = path.join(screenshotsDir, basename);
          try {
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, dest);
            }
          } catch {
            // Screenshot may already be gone from tmp — best effort
          }
          newPath = dest;
        }
        totalIssues += (vp.issues?.length || 0);
        viewports[vpName] = { screenshotPath: newPath, issues: vp.issues };
      }

      return { ...page, viewports };
    }),
  };

  // Write result JSON
  const meta: CachedAuditMeta = {
    id,
    url: auditResult.baseUrl,
    timestamp: auditResult.timestamp,
    pageCount: auditResult.pages.length,
    issueCount: totalIssues,
  };

  fs.writeFileSync(path.join(entryDir, "meta.json"), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(entryDir, "result.json"), JSON.stringify(rewritten, null, 2));

  return meta;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Find cached audits for a given URL (or all if no URL provided).
 * Returns most recent first.
 */
export function findCachedAudits(url?: string): CachedAuditMeta[] {
  const dir = ensureCacheDir();

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const results: CachedAuditMeta[] = [];

  for (const entry of entries) {
    const metaPath = path.join(dir, entry.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta: CachedAuditMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      if (!url || normalizeUrl(meta.url) === normalizeUrl(url)) {
        results.push(meta);
      }
    } catch {
      // Corrupted entry — skip
    }
  }

  // Most recent first
  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return results;
}

/**
 * Load a full cached audit result by ID.
 */
export function loadCachedAudit(id: string): CachedAuditResult | null {
  const resultPath = path.join(CACHE_DIR, id, "result.json");
  const metaPath = path.join(CACHE_DIR, id, "meta.json");

  if (!fs.existsSync(resultPath) || !fs.existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    return { meta, result };
  } catch {
    return null;
  }
}

/**
 * Delete a cached audit entry.
 */
export function deleteCachedAudit(id: string): boolean {
  const entryDir = path.join(CACHE_DIR, id);
  if (!fs.existsSync(entryDir)) return false;

  fs.rmSync(entryDir, { recursive: true, force: true });
  return true;
}

/** Returns the cache directory path (for screenshot serving) */
export function getCacheDir(): string {
  return CACHE_DIR;
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // Strip trailing slash, lowercase host
    return `${u.protocol}//${u.hostname}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return raw.toLowerCase().trim();
  }
}
