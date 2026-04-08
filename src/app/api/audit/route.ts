import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { crawlAndScreenshot, type Cookie } from "@/lib/crawler";
import { validateAnalysisResult, type UXIssue } from "@/lib/analyzer";
import { type ViewportName, VIEWPORTS } from "@/lib/crawler";
import { runClaudePrint } from "@/lib/claude";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditRequestBody {
  url: string;
  prdContext?: string;
  repoContext?: string;
  cookies?: Cookie[];
}

interface ViewportAnalysis {
  screenshotPath: string;
  issues: UXIssue[];
}

interface PageResult {
  route: string;
  url: string;
  viewports: Record<ViewportName, ViewportAnalysis>;
}

interface AuditResult {
  baseUrl: string;
  timestamp: string;
  pages: PageResult[];
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

type SSEWriter = {
  sendProgress: (detail: string, current?: number, total?: number) => void;
  sendResult: (data: AuditResult) => void;
  sendError: (message: string) => void;
  sendAuthRequired: (authUrl: string, screenshot: string) => void;
  close: () => void;
};

function createSSEWriter(controller: ReadableStreamDefaultController<Uint8Array>): SSEWriter {
  const encoder = new TextEncoder();

  function send(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(encoder.encode(payload));
  }

  return {
    sendProgress(detail: string, current?: number, total?: number) {
      send("progress", { detail, ...(current != null && { current }), ...(total != null && { total }) });
    },
    sendResult(data: AuditResult) {
      send("result", data);
    },
    sendError(message: string) {
      send("error", { message });
    },
    sendAuthRequired(authUrl: string, screenshot: string) {
      send("auth_required", { authUrl, screenshot });
    },
    close() {
      controller.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const maxDuration = 300; // Allow up to 5 minutes for large sites

export async function POST(request: NextRequest) {
  let body: AuditRequestBody;
  try {
    body = (await request.json()) as AuditRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.url || typeof body.url !== "string") {
    return new Response(JSON.stringify({ error: "Missing required field: url" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isValidUrl(body.url)) {
    return new Response(JSON.stringify({ error: "Invalid URL. Must be an http or https URL." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSSEWriter(controller);

      try {
        await runAudit(body.url, sse, body.prdContext, body.repoContext, body.cookies);
      } catch (err) {
        sse.sendError((err as Error).message);
      } finally {
        sse.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Core audit pipeline
// ---------------------------------------------------------------------------

const VIEWPORT_NAMES: ViewportName[] = Object.keys(VIEWPORTS) as ViewportName[];

async function runAudit(url: string, sse: SSEWriter, prdContext?: string, repoContext?: string, cookies?: Cookie[]): Promise<void> {
  // --- Step 1: Crawl and screenshot ----------------------------------------
  sse.sendProgress("Crawling site and discovering pages...");

  const outputDir = path.join(os.tmpdir(), `ux-audit-${Date.now()}`);
  const outcome = await crawlAndScreenshot(url, outputDir, cookies);

  // If auth is required, send the event and stop
  if (outcome.needsAuth) {
    sse.sendAuthRequired(outcome.authUrl, outcome.screenshot);
    return;
  }

  const manifest = outcome.manifest;
  const totalRoutes = manifest.routes.length;

  if (totalRoutes === 0) {
    sse.sendProgress("No pages discovered.");
    sse.sendResult({ baseUrl: url, timestamp: manifest.timestamp, pages: [] });
    return;
  }

  sse.sendProgress(`Discovered ${totalRoutes} page(s). Analyzing screenshots with Claude...`);

  // --- Step 2: Build prompt and run Claude analysis -------------------------
  const promptFile = path.join(process.cwd(), "src", "lib", "analyzer", "ux-analysis-prompt.txt");
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt file not found at ${promptFile}`);
  }

  // Collect PNG files
  const pngs = fs.readdirSync(outputDir).filter((f) => f.endsWith(".png")).map((f) => path.join(outputDir, f));

  if (pngs.length === 0) {
    const resultsPath = path.join(outputDir, "analysis-results.json");
    fs.writeFileSync(resultsPath, '{"screenshots":{}}');
  } else {
    // Build the prompt
    let prompt = "";

    if (prdContext) {
      prompt += `PROJECT CONTEXT:\n${prdContext}\n\nUse the project context above to evaluate the UI against actual product requirements and goals. Flag issues where the implementation diverges from stated requirements. Reference PRD requirements in acceptance_criteria where applicable.\n\n---\n\n`;
    }

    if (repoContext) {
      prompt += `REPOSITORY CONTEXT:\nThe following files were extracted from the project's GitHub repository. Use them to understand the design system, tech stack, component patterns, and project conventions. Reference specific design tokens, component names, or config values in your recommendations where relevant.\n\n${repoContext}\n\n---\n\n`;
    }

    prompt += fs.readFileSync(promptFile, "utf-8");

    prompt += `\n\n---\n\nAnalyze each of the following screenshot image files for UX and accessibility issues. Read each file listed below, then evaluate it against all the criteria described above.\n\nScreenshot files:\n`;
    for (const png of pngs) {
      prompt += `- ${png}\n`;
    }

    prompt += `\nReturn a single JSON object with results grouped by filename (basename only, not the full path). Each key should be the PNG filename, and each value should be an object with an "issues" array following the schema described above.\n\nExpected structure:\n{\n  "screenshots": {\n    "index_mobile.png": { "issues": [ ... ] },\n    "about_desktop.png": { "issues": [ ... ] }\n  }\n}\n\nOutput ONLY valid JSON. No markdown code fences, no explanatory text, no commentary — just the raw JSON object.\n`;

    try {
      const result = await runClaudePrint(prompt);
      fs.writeFileSync(path.join(outputDir, "analysis-results.json"), result);
    } catch (err) {
      throw new Error(`Screenshot analysis failed: ${(err as Error).message}`);
    }
  }

  // --- Step 4: Read and parse results --------------------------------------
  sse.sendProgress("Reading analysis results...");

  const resultsPath = path.join(outputDir, "analysis-results.json");
  if (!fs.existsSync(resultsPath)) {
    throw new Error("Analysis script completed but no results file was generated");
  }

  const rawResults = fs.readFileSync(resultsPath, "utf-8");

  // Strip markdown code fences if Claude wrapped the JSON
  const jsonText = rawResults
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?\s*```\s*$/, "");

  let analysisData: { screenshots: Record<string, unknown> };
  try {
    analysisData = JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse analysis results as JSON");
  }

  if (!analysisData.screenshots || typeof analysisData.screenshots !== "object") {
    throw new Error("Invalid analysis results: missing 'screenshots' object");
  }

  // --- Step 5: Map results to page/viewport structure ----------------------
  const pages: PageResult[] = [];

  for (const routeEntry of manifest.routes) {
    const viewports = {} as Record<ViewportName, ViewportAnalysis>;

    for (const vpName of VIEWPORT_NAMES) {
      const screenshotPath = routeEntry.screenshots[vpName];
      const filename = screenshotPath ? path.basename(screenshotPath) : "";
      const fileAnalysis = filename
        ? (analysisData.screenshots[filename] as { issues: unknown[] } | undefined)
        : undefined;

      let issues: UXIssue[] = [];
      if (fileAnalysis) {
        try {
          const validated = validateAnalysisResult(fileAnalysis);
          issues = validated.issues;
        } catch (err) {
          sse.sendProgress(
            `Warning: validation failed for ${filename}: ${(err as Error).message}`
          );
        }
      }

      viewports[vpName] = {
        screenshotPath: screenshotPath || "",
        issues,
      };
    }

    pages.push({
      route: routeEntry.route,
      url: routeEntry.url,
      viewports,
    });
  }

  // --- Step 6: Send final result -------------------------------------------
  const result: AuditResult = {
    baseUrl: manifest.baseUrl,
    timestamp: manifest.timestamp,
    pages,
  };

  sse.sendProgress("Audit complete.", totalRoutes, totalRoutes);
  sse.sendResult(result);
}
