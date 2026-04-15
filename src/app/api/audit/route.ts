import { NextRequest } from "next/server";
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
import { analyzeScreenshotsDir } from "@/lib/analyzer/run";
import { checkClaudeHealth } from "@/lib/claude";
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
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    // Block private/internal IPs to prevent SSRF
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.startsWith("169.254.") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }
    return true;
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

export const dynamic = "force-dynamic";
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
      const encoder = new TextEncoder();

      // SSE heartbeat to prevent proxy/CDN idle disconnect
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      try {
        await runAudit(body.url, sse, body.prdContext, body.repoContext, body.cookies, body.usePersistedSession, body.interactiveLogin);
      } catch (err) {
        sse.sendError((err as Error).message);
      } finally {
        clearInterval(heartbeat);
        sse.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Core audit pipeline
// ---------------------------------------------------------------------------

const VIEWPORT_NAMES: ViewportName[] = Object.keys(VIEWPORTS) as ViewportName[];

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

  // --- Pre-flight: verify Claude CLI is available ---------------------------
  sse.sendProgress("Checking Claude CLI availability...");
  const health = await checkClaudeHealth();
  if (!health.ok) {
    throw new Error(
      `Claude CLI is not responding: ${health.error}. ` +
      `Make sure the 'claude' command is in your PATH and your session is active.`
    );
  }

  // --- Step 1: Crawl and screenshot ----------------------------------------
  sse.sendProgress("Crawling site and discovering pages...");

  const outputDir = path.join(os.tmpdir(), `ux-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

  // --- Run batched analyzer (shared with smoke-test) -----------------------
  let mergedScreenshots: Record<string, { issues: unknown[] }> = {};
  let totalBatches = 0;
  let failedBatches = 0;

  try {
    const result = await analyzeScreenshotsDir(outputDir, {
      prdContext,
      repoContext,
      onProgress: (msg, current, total) => sse.sendProgress(msg, current, total),
    });
    mergedScreenshots = result.screenshots;
    totalBatches = result.totalBatches;
    failedBatches = result.failedBatches;
    for (const e of result.errors) {
      sse.sendProgress(`Warning: batch ${e.batchIndex + 1} failed: ${e.reason}`);
    }
  } catch (err) {
    // Only thrown when *every* batch failed — surface as fatal.
    throw err;
  }

  if (totalBatches > 0 && failedBatches > 0) {
    sse.sendProgress(`${failedBatches}/${totalBatches} batch(es) failed — partial results below.`);
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
