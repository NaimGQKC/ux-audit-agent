#!/usr/bin/env node
/**
 * UX Audit Agent — MCP Server
 *
 * Exposes the audit pipeline as MCP tools so PMs and engineers can run audits
 * directly from Claude Code (or any MCP-compatible client).
 *
 * Usage from Claude Code:
 *   "Audit https://staging.example.com/signin for UX issues"
 *   "Quick scan the homepage at http://localhost:3000"
 *
 * Setup — add to .claude/settings.json → mcpServers:
 *   {
 *     "ux-audit": {
 *       "command": "npx",
 *       "args": ["tsx", "src/mcp/server.ts"],
 *       "cwd": "/path/to/ux-audit-agent"
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "node:path";
import * as os from "node:os";

// Import the audit pipeline modules
import { crawlAndScreenshot, type Cookie, type CrawlResult, VIEWPORTS, type ViewportName } from "../lib/crawler/index.js";
import { validateAnalysisResult, type UXIssue } from "../lib/analyzer/index.js";
import { analyzeScreenshots } from "../lib/analyzer/run.js";
import { checkClaudeHealth } from "../lib/claude.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VIEWPORT_NAMES: ViewportName[] = Object.keys(VIEWPORTS) as ViewportName[];

interface PageIssuesSummary {
  route: string;
  url: string;
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
  }>;
  screenshotPaths: Record<string, string>;
}

async function runAuditPipeline(
  url: string,
  opts: {
    maxPages?: number;
    viewports?: ViewportName[];
    cookies?: Cookie[];
    prdContext?: string;
    credentials?: { email: string; password: string };
  } = {},
): Promise<PageIssuesSummary[]> {
  const maxPages = opts.maxPages ?? 1;
  const viewportsToUse = opts.viewports ?? VIEWPORT_NAMES;

  // Health check
  const health = await checkClaudeHealth();
  if (!health.ok) {
    throw new Error(`Claude CLI not available: ${health.error}`);
  }

  // Crawl
  const outputDir = path.join(
    os.tmpdir(),
    `ux-audit-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );

  const outcome = await crawlAndScreenshot(url, outputDir, opts.cookies, false, {
    maxRoutes: maxPages,
    credentials: opts.credentials,
  });

  if ("needsAuth" in outcome && outcome.needsAuth) {
    throw new Error(
      `The page at ${url} requires authentication. Provide credentials or cookies to proceed.`,
    );
  }
  if ("needsSSOLogin" in outcome && outcome.needsSSOLogin) {
    throw new Error(
      `The page at ${url} triggered an SSO redirect. Use the dashboard UI for interactive login.`,
    );
  }

  const manifest = (outcome as CrawlResult).manifest;
  const results: PageIssuesSummary[] = [];

  // Analyze each page
  for (const routeEntry of manifest.routes) {
    const pngs: string[] = [];
    for (const vp of viewportsToUse) {
      const filename = routeEntry.screenshots[vp];
      if (filename) {
        pngs.push(path.join(outputDir, filename));
      }
    }

    if (pngs.length === 0) continue;

    const analysis = await analyzeScreenshots(pngs, {
      prdContext: opts.prdContext,
      label: `mcp-${routeEntry.route}`,
    });

    // Collect issues from all viewport screenshots
    const allIssues: UXIssue[] = [];
    const seenIds = new Set<string>();

    for (const vp of viewportsToUse) {
      const filename = routeEntry.screenshots[vp];
      if (!filename) continue;
      const fileResult = analysis.screenshots[filename] as { issues: unknown[] } | undefined;
      if (!fileResult) continue;

      try {
        const validated = validateAnalysisResult(fileResult);
        for (const issue of validated.issues) {
          if (!seenIds.has(issue.id)) {
            seenIds.add(issue.id);
            allIssues.push(issue);
          }
        }
      } catch {
        // skip malformed results
      }
    }

    // Screenshot paths (for reference)
    const screenshotPaths: Record<string, string> = {};
    for (const vp of viewportsToUse) {
      const filename = routeEntry.screenshots[vp];
      if (filename) {
        screenshotPaths[vp] = path.join(outputDir, filename);
      }
    }

    results.push({
      route: routeEntry.route,
      url: routeEntry.url,
      issues: allIssues.map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        category: i.category,
        principle: i.principle,
        description: i.description,
        affected_element: i.affected_element,
        recommendation: i.recommendation,
        suggested_fix: i.suggested_fix,
        acceptance_criteria: i.acceptance_criteria,
        affected_viewports: i.affected_viewports,
      })),
      screenshotPaths,
    });
  }

  return results;
}

function formatIssuesForChat(pages: PageIssuesSummary[]): string {
  if (pages.length === 0) return "No pages were analyzed.";

  const lines: string[] = [];
  let totalIssues = 0;

  for (const page of pages) {
    lines.push(`## ${page.url}`);
    if (page.issues.length === 0) {
      lines.push("No issues found.\n");
      continue;
    }

    const sorted = [...page.issues].sort((a, b) => {
      const order = { critical: 0, major: 1, minor: 2 };
      return (order[a.severity as keyof typeof order] ?? 3) - (order[b.severity as keyof typeof order] ?? 3);
    });

    for (const issue of sorted) {
      totalIssues++;
      const sev = issue.severity.toUpperCase();
      lines.push(`### [${sev}] ${issue.title}`);
      lines.push(`- **Principle:** ${issue.principle}`);
      lines.push(`- **Element:** \`${issue.affected_element}\``);
      lines.push(`- **Description:** ${issue.description}`);
      lines.push(`- **Fix:** ${issue.recommendation}`);
      lines.push(`- **Acceptance criteria:** ${issue.acceptance_criteria}`);
      lines.push("");
    }
  }

  const summary = `Found **${totalIssues} issue(s)** across ${pages.length} page(s).`;
  return `${summary}\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Local dev-server helpers (for audit_local)
// ---------------------------------------------------------------------------

// Ports probed in order when the user doesn't specify one. Covers the common
// JS/TS frameworks: Next (3000), Vite (5173), Angular (4200), generic (8080,
// 8000), Astro (4321). First response wins.
const DEFAULT_DEV_PORTS = [3000, 3001, 5173, 5174, 4200, 8080, 8000, 4321];

async function detectDevServer(preferredPort?: number): Promise<string | null> {
  const ports = preferredPort ? [preferredPort] : DEFAULT_DEV_PORTS;
  for (const port of ports) {
    const url = `http://localhost:${port}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
      clearTimeout(timer);
      // Any HTTP response — even 3xx/4xx — means something is listening.
      if (res.status < 600) return url;
    } catch {
      // fetch threw (ECONNREFUSED / timeout) — try next port
    }
  }
  return null;
}

/**
 * Map a Next.js route file to its URL path.
 *
 * Supports:
 *  - App Router:   src/app/**\/page.tsx           → /**
 *  - App Router:   src/app/(group)/**\/page.tsx   → /**        (route groups stripped)
 *  - Pages Router: src/pages/**\/*.tsx            → /**
 *
 * Returns null if the file isn't a recognizable route or contains dynamic
 * segments (`[id]`) — the caller should ask for an explicit `path`.
 */
function routeFromFile(file: string, cwd: string): string | null {
  const abs = path.resolve(cwd, file);
  const rel = path.relative(cwd, abs).replace(/\\/g, "/");

  // App Router: (src/)?app/.../page.(tsx|jsx|ts|js)
  const appMatch = rel.match(/^(?:src\/)?app\/(.+?)\/page\.(?:tsx|jsx|ts|js)$/);
  if (appMatch) {
    const segments = appMatch[1]
      .split("/")
      // Strip route groups (parentheses) and parallel routes (@slot).
      .filter((s) => !s.startsWith("(") && !s.startsWith("@"))
      // Strip private folders (_foo).
      .filter((s) => !s.startsWith("_"));

    if (segments.length === 0) return "/";
    // Bail on dynamic segments — caller needs to supply a concrete path.
    if (segments.some((s) => s.includes("["))) return null;
    return "/" + segments.join("/");
  }

  // Bare app/page.tsx at repo root
  if (rel === "app/page.tsx" || rel === "src/app/page.tsx") return "/";

  // Pages Router: (src/)?pages/....(tsx|jsx|ts|js)
  const pagesMatch = rel.match(/^(?:src\/)?pages\/(.+)\.(?:tsx|jsx|ts|js)$/);
  if (pagesMatch) {
    const p = pagesMatch[1];
    // Skip Next internals.
    if (p === "_app" || p === "_document" || p === "_error") return null;
    // Dynamic segment → bail.
    if (p.includes("[")) return null;
    if (p === "index") return "/";
    return "/" + p.replace(/\/index$/, "");
  }

  return null;
}

// ---------------------------------------------------------------------------
// MCP Server definition
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "ux-audit",
  version: "1.0.0",
});

// --- Tool: audit_page ---
server.tool(
  "audit_page",
  "Run a UX/accessibility audit on a single page. Crawls the URL, screenshots at mobile/tablet/desktop viewports, and analyzes against Nielsen heuristics, WCAG 2.1/2.2, Gestalt principles, UX laws, and more. Returns structured issues with severity, principle citations, and fix recommendations.",
  {
    url: z.string().url().describe("The full URL to audit (must be http or https)"),
    prd_context: z.string().optional().describe("Optional product requirements or context to evaluate against"),
    email: z.string().optional().describe("Email/username for auto-login if the page requires authentication"),
    password: z.string().optional().describe("Password for auto-login (never logged or persisted)"),
  },
  async ({ url, prd_context, email, password }) => {
    try {
      const credentials = email && password ? { email, password } : undefined;
      const pages = await runAuditPipeline(url, {
        maxPages: 1,
        prdContext: prd_context,
        credentials,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: formatIssuesForChat(pages),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Audit failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- Tool: audit_site ---
server.tool(
  "audit_site",
  "Run a full-site UX audit. Crawls the URL, discovers all same-origin pages (up to max_pages), screenshots each at 3 viewports, and runs the full 11-lens analysis. Returns structured issues per page. Use audit_page for a single page — this is for comprehensive site-wide audits.",
  {
    url: z.string().url().describe("The entry URL to start crawling from"),
    max_pages: z.number().int().min(1).max(30).default(10).describe("Maximum pages to audit (default: 10)"),
    prd_context: z.string().optional().describe("Optional product requirements to evaluate against"),
    email: z.string().optional().describe("Email/username for auto-login"),
    password: z.string().optional().describe("Password for auto-login"),
  },
  async ({ url, max_pages, prd_context, email, password }) => {
    try {
      const credentials = email && password ? { email, password } : undefined;
      const pages = await runAuditPipeline(url, {
        maxPages: max_pages,
        prdContext: prd_context,
        credentials,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: formatIssuesForChat(pages),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Audit failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- Tool: quick_scan ---
server.tool(
  "quick_scan",
  "Fast UX scan — audits a single page at desktop viewport only. Returns the top issues in ~60 seconds. Great for quick checks during development or PR reviews.",
  {
    url: z.string().url().describe("The URL to scan"),
    prd_context: z.string().optional().describe("Optional product requirements"),
  },
  async ({ url, prd_context }) => {
    try {
      const pages = await runAuditPipeline(url, {
        maxPages: 1,
        viewports: ["desktop"],
        prdContext: prd_context,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: formatIssuesForChat(pages),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Scan failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- Tool: audit_local ---
server.tool(
  "audit_local",
  "Run a UX/accessibility audit against a running local dev server (npm run dev). Auto-detects the port (3000/5173/4200/...) and can derive the route from a Next.js route file path. Use this as a shield while coding: call it right after editing a page or component to catch issues before they ship, instead of waiting for a post-release audit. Returns issues sorted by severity with principle citations and suggested fixes.",
  {
    path: z
      .string()
      .optional()
      .describe("Route path to audit, e.g. '/signup'. Defaults to '/' if neither `path` nor `file` is given."),
    file: z
      .string()
      .optional()
      .describe(
        "Repo-relative path to a Next.js route file (e.g. 'src/app/signup/page.tsx' or 'pages/signup.tsx'). The tool derives the URL path from it. If `path` is also supplied, `path` wins.",
      ),
    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe("Dev-server port. Auto-detected across common ports if omitted."),
    prd_context: z
      .string()
      .optional()
      .describe("Optional product requirements or context to evaluate against"),
  },
  async ({ path: routePath, file, port, prd_context }) => {
    try {
      const base = await detectDevServer(port);
      if (!base) {
        const probed = port ? `:${port}` : ` on common ports (${DEFAULT_DEV_PORTS.join(", ")})`;
        return {
          content: [
            {
              type: "text" as const,
              text: `No local dev server detected${probed}. Start one with \`npm run dev\` (or similar) and try again.`,
            },
          ],
          isError: true,
        };
      }

      // Resolve the route — explicit `path` wins, otherwise infer from `file`,
      // otherwise default to homepage.
      let route = routePath ?? null;
      if (!route && file) {
        const inferred = routeFromFile(file, process.cwd());
        if (!inferred) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Could not derive a route from \`${file}\`. This usually means the path isn't a recognized Next.js route file, or it has a dynamic segment like \`[id]\`. Pass \`path\` explicitly (e.g. \`/products/42\`).`,
              },
            ],
            isError: true,
          };
        }
        route = inferred;
      }
      if (!route) route = "/";
      if (!route.startsWith("/")) route = "/" + route;

      const url = `${base}${route}`;
      const pages = await runAuditPipeline(url, {
        maxPages: 1,
        prdContext: prd_context,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Audited **${url}**\n\n${formatIssuesForChat(pages)}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Audit failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now running on stdio — Claude Code will communicate via stdin/stdout.
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
