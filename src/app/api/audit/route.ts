import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  crawlAndScreenshot,
  type Cookie,
  type CrawlResult,
  type ViewportName,
  VIEWPORTS,
  launchHeadedPersistentBrowser,
  extractCookiesAndClose,
  checkSSOReturn,
  waitForReadySignal,
} from "@/lib/crawler";
import { validateAnalysisResult, type UXIssue } from "@/lib/analyzer";
import { runClaudePrint } from "@/lib/claude";
import { saveAuditToCache } from "@/lib/cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditRequestBody {
  url: string;
  prdContext?: string;
  repoContext?: string;
  cookies?: Cookie[];
  usePersistedSession?: boolean;
  interactiveLogin?: boolean;
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
  sendInteractiveLoginReady: (sessionId: string) => void;
  sendSSORedirect: (sessionId: string, redirectUrl: string) => void;
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
    sendInteractiveLoginReady(sessionId: string) {
      send("interactive_login_ready", { sessionId });
    },
    sendSSORedirect(sessionId: string, redirectUrl: string) {
      send("sso_redirect", { sessionId, redirectUrl });
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

/** Build a safe screenshot URL from session ID + filename. */
function screenshotUrl(sessionId: string, filename: string): string {
  if (!filename) return "";
  return `/api/screenshot?s=${encodeURIComponent(sessionId)}&f=${encodeURIComponent(filename)}`;
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
        await runAudit(body.url, sse, body.prdContext, body.repoContext, body.cookies, body.usePersistedSession, body.interactiveLogin);
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

/** Max screenshots per Claude call to stay within context limits. */
const BATCH_SIZE = 6;

/**
 * Build the analysis prompt for a batch of PNG files.
 */
function buildAnalysisPrompt(
  pngs: string[],
  basePrompt: string,
  prdContext?: string,
  repoContext?: string,
): string {
  let prompt = "";

  if (prdContext) {
    prompt += `PROJECT CONTEXT:\n${prdContext}\n\nUse the project context above to evaluate the UI against actual product requirements and goals. Flag issues where the implementation diverges from stated requirements. Reference PRD requirements in acceptance_criteria where applicable.\n\n---\n\n`;
  }

  if (repoContext) {
    prompt += `REPOSITORY CONTEXT:\nThe following files were extracted from the project's GitHub repository. Use them to understand the design system, tech stack, component patterns, and project conventions. Reference specific design tokens, component names, or config values in your recommendations where relevant.\n\n${repoContext}\n\n---\n\n`;
  }

  prompt += basePrompt;

  prompt += `\n\n---\n\nAnalyze each of the following screenshot image files for UX and accessibility issues. Read each file listed below, then evaluate it against all the criteria described above.\n\nScreenshot files:\n`;
  for (const png of pngs) {
    prompt += `- ${png}\n`;
  }

  const exampleFile = path.basename(pngs[0]);
  prompt += `\nReturn a single JSON object with results grouped by filename (basename only, not the full path). Each key should be the PNG filename, and each value should be an object with an "issues" array following the schema described above.\n\nExpected structure:\n{\n  "screenshots": {\n    "${exampleFile}": { "issues": [ ... ] }\n  }\n}\n\nOutput ONLY valid JSON. No markdown code fences, no explanatory text, no commentary — just the raw JSON object.\n`;

  return prompt;
}

/**
 * Parse a raw Claude response into a screenshots record, stripping markdown
 * fences if present.
 */
function parseAnalysisResponse(raw: string): Record<string, unknown> {
  const jsonText = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?\s*```\s*$/, "");

  let data: { screenshots?: Record<string, unknown> };
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse analysis results as JSON");
  }

  if (!data.screenshots || typeof data.screenshots !== "object") {
    throw new Error("Invalid analysis results: missing 'screenshots' object");
  }

  return data.screenshots;
}

async function runAudit(
  url: string,
  sse: SSEWriter,
  prdContext?: string,
  repoContext?: string,
  cookies?: Cookie[],
  usePersistedSession?: boolean,
  interactiveLogin?: boolean,
): Promise<void> {
  // --- Interactive login: open headed browser, wait for user ---------------
  if (interactiveLogin) {
    sse.sendProgress("Launching browser for interactive login...");

    const { sessionId: loginSessionId } =
      await launchHeadedPersistentBrowser(url);

    // Tell the frontend the browser is open — it shows "I'm logged in" button
    sse.sendInteractiveLoginReady(loginSessionId);

    // Block until user clicks "I'm logged in, start crawling"
    await waitForReadySignal(loginSessionId);

    sse.sendProgress("Login confirmed — extracting session...");
    const loginCookies = await extractCookiesAndClose(loginSessionId);
    cookies = loginCookies;
  }

  // --- Step 1: Crawl and screenshot ----------------------------------------
  sse.sendProgress("Crawling site and discovering pages...");

  const outputDir = path.join(os.tmpdir(), `ux-audit-${Date.now()}`);
  const outcome = await crawlAndScreenshot(url, outputDir, cookies, usePersistedSession);

  // --- Handle SSO redirect (persistent session detected origin mismatch) ---
  if ("needsSSOLogin" in outcome && outcome.needsSSOLogin) {
    sse.sendProgress("SSO redirect detected — launching browser for login...");

    const { sessionId: ssoSessionId } =
      await launchHeadedPersistentBrowser(url);

    sse.sendSSORedirect(ssoSessionId, outcome.redirectUrl);

    // Poll until the browser URL returns to the original origin
    const SSO_TIMEOUT = 300_000; // 5 min
    const pollStart = Date.now();
    let ssoResolved = false;

    while (Date.now() - pollStart < SSO_TIMEOUT) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const { returned } = await checkSSOReturn(ssoSessionId);
        if (returned) {
          ssoResolved = true;
          break;
        }
      } catch {
        break; // session gone
      }
    }

    if (!ssoResolved) {
      sse.sendError("SSO login timed out. Please try again.");
      try { await extractCookiesAndClose(ssoSessionId); } catch { /* ignore */ }
      return;
    }

    sse.sendProgress("SSO login complete — extracting session...");
    const ssoCookies = await extractCookiesAndClose(ssoSessionId);

    // Re-crawl with the authenticated cookies + persisted profile
    sse.sendProgress("Resuming crawl with authenticated session...");
    const retryOutcome = await crawlAndScreenshot(url, outputDir, ssoCookies, usePersistedSession);

    if ("needsAuth" in retryOutcome && retryOutcome.needsAuth) {
      sse.sendAuthRequired(retryOutcome.authUrl, retryOutcome.screenshot);
      return;
    }
    if ("needsSSOLogin" in retryOutcome && retryOutcome.needsSSOLogin) {
      sse.sendError("SSO login did not resolve — cookies may not have been captured.");
      return;
    }

    const retryManifest = (retryOutcome as CrawlResult).manifest;
    return analyzeAndEmit(retryManifest, outputDir, sse, prdContext, repoContext);
  }

  // If auth is required (legacy heuristic detection), send the event and stop
  if ("needsAuth" in outcome && outcome.needsAuth) {
    sse.sendAuthRequired(outcome.authUrl, outcome.screenshot);
    return;
  }

  const manifest = (outcome as CrawlResult).manifest;
  return analyzeAndEmit(manifest, outputDir, sse, prdContext, repoContext);
}

// ---------------------------------------------------------------------------
// Analysis pipeline (shared by normal flow and SSO-retry flow)
// ---------------------------------------------------------------------------

async function analyzeAndEmit(
  manifest: { baseUrl: string; timestamp: string; sessionId: string; routes: Array<{ route: string; url: string; screenshots: Record<ViewportName, string> }> },
  outputDir: string,
  sse: SSEWriter,
  prdContext?: string,
  repoContext?: string,
): Promise<void> {
  const sessionId = manifest.sessionId;
  const totalRoutes = manifest.routes.length;

  if (totalRoutes === 0) {
    sse.sendProgress("No pages discovered.");
    sse.sendResult({ baseUrl: manifest.baseUrl, timestamp: manifest.timestamp, pages: [] });
    return;
  }

  sse.sendProgress(`Discovered ${totalRoutes} page(s). Analyzing screenshots with Claude...`);

  // --- Load prompt template ------------------------------------------------
  const promptFile = path.join(process.cwd(), "src", "lib", "analyzer", "ux-analysis-prompt.txt");
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt file not found at ${promptFile}`);
  }
  const basePrompt = fs.readFileSync(promptFile, "utf-8");

  // Collect PNG files
  const pngs = fs.readdirSync(outputDir).filter((f) => f.endsWith(".png")).map((f) => path.join(outputDir, f));

  // --- Analyze in batches --------------------------------------------------
  const mergedScreenshots: Record<string, unknown> = {};

  if (pngs.length === 0) {
    // No screenshots — empty result
  } else {
    const totalBatches = Math.ceil(pngs.length / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchPngs = pngs.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
      const batchLabel = totalBatches > 1
        ? `Analyzing batch ${batchIdx + 1}/${totalBatches} (${batchPngs.length} screenshots)...`
        : `Analyzing ${batchPngs.length} screenshot(s)...`;

      sse.sendProgress(batchLabel, batchIdx, totalBatches);

      const prompt = buildAnalysisPrompt(batchPngs, basePrompt, prdContext, repoContext);

      try {
        const raw = await runClaudePrint(prompt, { label: `audit-batch-${batchIdx + 1}` });
        const batchResults = parseAnalysisResponse(raw);
        Object.assign(mergedScreenshots, batchResults);
      } catch (err) {
        const msg = (err as Error).message;
        sse.sendProgress(`Warning: batch ${batchIdx + 1}/${totalBatches} failed: ${msg}`);
      }
    }
  }

  // --- Map results to page/viewport structure ------------------------------
  sse.sendProgress("Reading analysis results...");

  const pages: PageResult[] = [];

  for (const routeEntry of manifest.routes) {
    const viewports = {} as Record<ViewportName, ViewportAnalysis>;

    for (const vpName of VIEWPORT_NAMES) {
      const filename = routeEntry.screenshots[vpName] || "";
      const fileAnalysis = filename
        ? (mergedScreenshots[filename] as { issues: unknown[] } | undefined)
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
        screenshotPath: screenshotUrl(sessionId, filename),
        issues,
      };
    }

    pages.push({
      route: routeEntry.route,
      url: routeEntry.url,
      viewports,
    });
  }

  // --- Send final result ---------------------------------------------------
  const result: AuditResult = {
    baseUrl: manifest.baseUrl,
    timestamp: manifest.timestamp,
    pages,
  };

  try {
    saveAuditToCache(result, outputDir);
  } catch (err) {
    sse.sendProgress(`Warning: failed to cache results: ${(err as Error).message}`);
  }

  sse.sendProgress("Audit complete.", totalRoutes, totalRoutes);
  sse.sendResult(result);
}
