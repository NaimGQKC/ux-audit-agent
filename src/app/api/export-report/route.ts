import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { requireApiAuth } from "@/lib/security";

// Session / cache IDs and filenames that we trust enough to read from disk.
// Anything containing path separators, traversal, or control chars is rejected.
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_FILENAME = /^[a-zA-Z0-9._-]{1,255}$/;

/**
 * POST /api/export-report
 *
 * Accepts the audit data (pages with issues + screenshot filesystem paths)
 * and generates a self-contained HTML report with embedded base64 screenshots.
 */

interface ExportPage {
  url: string;
  title: string;
  screenshots: Record<string, string>; // viewport -> filesystem path OR empty
  issues: Array<{
    id: string;
    title: string;
    severity: string;
    category: string;
    principle: string;
    description: string;
    affected_element: string;
    recommendation: string;
    suggested_fix: string;
    acceptance_criteria: string;
    affected_viewports: string[];
    status: string;
  }>;
}

interface ExportRequest {
  auditUrl: string;
  pages: ExportPage[];
}

function severityColor(s: string): string {
  switch (s) {
    case "critical": return "#ef4444";
    case "major": return "#f97316";
    case "minor": return "#eab308";
    default: return "#6b7280";
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "approved": return "Approved";
    case "dismissed": return "Dismissed";
    default: return "Pending";
  }
}

function tryReadImageAsBase64(screenshotUrl: string): string {
  // The URL is like /api/screenshot?s=xxx&f=yyy or /api/screenshot?c=xxx&f=yyy
  // We need to resolve it to a filesystem path
  try {
    const parsed = new URL(screenshotUrl, "http://localhost");
    const sessionId = parsed.searchParams.get("s");
    const cacheId = parsed.searchParams.get("c");
    const filename = parsed.searchParams.get("f");
    if (!filename || !SAFE_FILENAME.test(filename)) return "";

    let filepath = "";
    let rootDir = "";
    if (cacheId && SAFE_ID.test(cacheId)) {
      rootDir = path.resolve(path.join(process.cwd(), ".ux-audit-cache", cacheId, "screenshots"));
      filepath = path.join(rootDir, filename);
    } else if (sessionId && SAFE_ID.test(sessionId)) {
      rootDir = path.resolve(path.join(os.tmpdir(), sessionId));
      filepath = path.join(rootDir, filename);
    }

    // Defense in depth: ensure the resolved path never escapes its root dir.
    if (filepath && !path.resolve(filepath).startsWith(rootDir + path.sep)) return "";

    if (filepath && fs.existsSync(filepath)) {
      const buffer = fs.readFileSync(filepath);
      const ext = path.extname(filepath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };
      const mime = mimeTypes[ext] || "image/png";
      return `data:${mime};base64,${buffer.toString("base64")}`;
    }
  } catch {
    // Fall through
  }
  return "";
}

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  let body: ExportRequest;
  try {
    body = (await request.json()) as ExportRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { auditUrl, pages } = body;
  const now = new Date().toLocaleString();

  const totalIssues = pages.reduce((acc, p) => acc + p.issues.length, 0);
  const critical = pages.reduce((acc, p) => acc + p.issues.filter((i) => i.severity === "critical").length, 0);
  const major = pages.reduce((acc, p) => acc + p.issues.filter((i) => i.severity === "major").length, 0);
  const minor = pages.reduce((acc, p) => acc + p.issues.filter((i) => i.severity === "minor").length, 0);

  let pagesHtml = "";

  for (const page of pages) {
    // Embed screenshots
    let screenshotsHtml = "";
    for (const vp of ["desktop", "tablet", "mobile"] as const) {
      const screenshotUrl = page.screenshots[vp];
      if (!screenshotUrl) continue;
      const base64 = tryReadImageAsBase64(screenshotUrl);
      if (base64) {
        const maxW = vp === "mobile" ? "225px" : vp === "tablet" ? "350px" : "500px";
        screenshotsHtml += `
          <div style="text-align:center">
            <div style="font-size:12px;color:#6b7280;margin-bottom:4px;text-transform:capitalize">${vp}</div>
            <img src="${base64}" alt="${page.title} ${vp}" style="max-width:${maxW};border:1px solid #e5e7eb;border-radius:8px" />
          </div>`;
      }
    }

    let issuesHtml = "";
    for (const issue of page.issues) {
      issuesHtml += `
        <div style="border:1px solid #e5e7eb;border-left:4px solid ${severityColor(issue.severity)};border-radius:6px;padding:12px 16px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="background:${severityColor(issue.severity)};color:white;font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:600;text-transform:uppercase">${issue.severity}</span>
            <span style="background:#f3f4f6;color:#374151;font-size:11px;padding:2px 8px;border-radius:9999px">${issue.category}</span>
            <span style="background:#f3f4f6;color:#374151;font-size:11px;padding:2px 8px;border-radius:9999px">${statusLabel(issue.status)}</span>
          </div>
          <h4 style="margin:0 0 4px;font-size:14px;font-weight:600">${escapeHtml(issue.title)}</h4>
          <p style="margin:0 0 4px;font-size:12px;color:#6b7280">${escapeHtml(issue.principle)}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#374151">${escapeHtml(issue.description)}</p>
          <div style="font-size:12px;color:#374151">
            <div style="margin-bottom:4px"><strong>Affected element:</strong> <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px">${escapeHtml(issue.affected_element)}</code></div>
            <div style="margin-bottom:4px"><strong>Recommendation:</strong> ${escapeHtml(issue.recommendation)}</div>
            <div style="margin-bottom:4px"><strong>Suggested fix:</strong> ${escapeHtml(issue.suggested_fix)}</div>
            <div><strong>Acceptance criteria:</strong> ${escapeHtml(issue.acceptance_criteria)}</div>
          </div>
          <div style="margin-top:6px;font-size:11px;color:#9ca3af">Viewports: ${issue.affected_viewports.join(", ")}</div>
        </div>`;
    }

    pagesHtml += `
      <div style="margin-bottom:32px">
        <h2 style="font-size:18px;font-weight:600;margin:0 0 4px">${escapeHtml(page.title)}</h2>
        <p style="font-size:13px;color:#6b7280;margin:0 0 16px">${escapeHtml(page.url)}</p>
        ${screenshotsHtml ? `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-start">${screenshotsHtml}</div>` : ""}
        <h3 style="font-size:15px;font-weight:600;margin:0 0 8px">${page.issues.length} Issue${page.issues.length !== 1 ? "s" : ""}</h3>
        ${issuesHtml}
      </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>UX Audit Report — ${escapeHtml(auditUrl)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 0 auto; padding: 32px 24px; color: #111827; background: #fff; }
  code { font-family: 'SF Mono', 'Fira Code', monospace; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div style="border-bottom:2px solid #e5e7eb;padding-bottom:16px;margin-bottom:24px">
    <h1 style="font-size:24px;font-weight:700;margin:0 0 4px">UX Audit Report</h1>
    <p style="font-size:14px;color:#6b7280;margin:0">${escapeHtml(auditUrl)} &mdash; ${escapeHtml(now)}</p>
  </div>

  <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 20px;text-align:center;min-width:100px">
      <div style="font-size:24px;font-weight:700">${totalIssues}</div>
      <div style="font-size:12px;color:#6b7280">Total Issues</div>
    </div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 20px;text-align:center;min-width:100px">
      <div style="font-size:24px;font-weight:700;color:#ef4444">${critical}</div>
      <div style="font-size:12px;color:#6b7280">Critical</div>
    </div>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 20px;text-align:center;min-width:100px">
      <div style="font-size:24px;font-weight:700;color:#f97316">${major}</div>
      <div style="font-size:12px;color:#6b7280">Major</div>
    </div>
    <div style="background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:12px 20px;text-align:center;min-width:100px">
      <div style="font-size:24px;font-weight:700;color:#eab308">${minor}</div>
      <div style="font-size:12px;color:#6b7280">Minor</div>
    </div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 20px;text-align:center;min-width:100px">
      <div style="font-size:24px;font-weight:700">${pages.length}</div>
      <div style="font-size:12px;color:#6b7280">Pages</div>
    </div>
  </div>

  ${pagesHtml}

  <div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:32px;font-size:11px;color:#9ca3af;text-align:center">
    Generated by UX Audit Agent
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="ux-audit-report-${Date.now()}.html"`,
    },
  });
}

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
