import { NextRequest } from "next/server";
import path from "node:path";
import os from "node:os";
import {
  crawlAndScreenshot,
  type Cookie,
  type CrawlResult,
  type ViewportName,
  type AxeFinding,
  type DriftFinding,
  VIEWPORTS,
  launchHeadedPersistentBrowser,
  launchRealChromeSession,
  extractCookiesAndClose,
  checkSSOReturn,
  waitForReadySignal,
} from "@/lib/crawler";
import { validateAnalysisResult, type UXIssue } from "@/lib/analyzer";
import { analyzeScreenshots } from "@/lib/analyzer/run";
import { checkClaudeClientHealth } from "@/lib/claude-client";
import { saveAuditToCache } from "@/lib/cache";
import { runLighthouse, type LighthouseFinding } from "@/lib/deterministic/lighthouse";
import { mergeFindings } from "@/lib/deterministic/merge";
import { saveRun, summarize, isValidRunId } from "@/lib/persistence/runs";
import { resolveProjectPrdContext } from "@/lib/persistence/projects";
import {
  requireApiAuth,
  sanitizeError,
  logError,
  validatePublicUrl,
  validateLocalUrl,
} from "@/lib/security";

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
  /** Use the user's real Google Chrome install + profile for interactive login. */
  useRealChrome?: boolean;
  /** When useRealChrome is true, run headless. Default: false (headed). */
  realChromeHeadless?: boolean;
  /** Optional credentials for automated headless login (never logged/persisted). */
  credentials?: { email: string; password: string };
  /** Skip axe + Lighthouse runs. Useful during development to keep audits fast. */
  skipDeterministic?: boolean;
  /** Auto-capture tab switchers / interactions on the target page. Default: true. */
  captureInteractions?: boolean;
  /** Optional CSS selectors the crawler clicks on the target page. */
  clickSelectors?: string[];
  /**
   * Reuse the persisted browser profile from a previous interactive login
   * instead of starting from a clean slate. Default: false (fresh every run).
   *
   * Fresh-by-default fixes the "second run doesn't work" SSO bug — stale
   * cookies in the reused profile would silently land us on a partial auth
   * state whose cookies weren't usable. Users who genuinely want session
   * reuse across runs can opt in with this flag.
   */
  reuseSession?: boolean;
  /**
   * Optional persisted project id. When provided, the project's
   * `standardsDoc` is loaded server-side and prepended to `prdContext`
   * before being forwarded into the analyzer's existing prdContext slot.
   */
  projectId?: string;
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
  sendPageResult: (page: PageResult, pageIndex: number, totalPages: number) => void;
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
    sendPageResult(page: PageResult, pageIndex: number, totalPages: number) {
      send("page_result", { page, pageIndex, totalPages });
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

/**
 * Validate an input URL against our SSRF rules. Returns the canonicalised URL
 * on success. In development we additionally allow loopback targets so devs
 * can audit their own `npm run dev`. Everywhere else (including staging/prod)
 * only public hosts are accepted.
 */
function validateAuditUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const publicCheck = validatePublicUrl(input);
  if (publicCheck.ok) return { ok: true, url: publicCheck.url! };
  if (process.env.NODE_ENV !== "production") {
    const localCheck = validateLocalUrl(input);
    if (localCheck.ok) return { ok: true, url: localCheck.url! };
  }
  return { ok: false, error: publicCheck.error ?? "Invalid URL" };
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
export const maxDuration = 900; // Allow up to 15 minutes for large sites

export async function POST(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

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

  const validation = validateAuditUrl(body.url);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  body.url = validation.url;

  // --- Optional project merge --------------------------------------------
  // If a projectId is supplied, load the persisted project and prepend its
  // standardsDoc to any per-run prdContext. Project standards come FIRST so
  // the stable portion benefits from Anthropic prompt cache hits; per-run
  // context varies and sits at the end of the merged block. Validation is
  // strict: invalid-format ids never touch the filesystem, unknown ids
  // return 400 without leaking server paths.
  //
  // The merge is shared with the MCP tool layer via resolveProjectPrdContext
  // so cache keys stay byte-identical across transports.
  const resolved = await resolveProjectPrdContext(body.projectId, body.prdContext);
  if (!resolved.ok) {
    const errMsg = resolved.reason === "invalid_id" ? "Invalid projectId" : "Unknown projectId";
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const effectivePrdContext = resolved.prdContext;

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
        await runAudit(body.url, sse, effectivePrdContext, body.repoContext, body.cookies, body.usePersistedSession, body.interactiveLogin, body.credentials, body.skipDeterministic, body.useRealChrome, body.realChromeHeadless, body.captureInteractions, body.clickSelectors, body.reuseSession);
      } catch (err) {
        logError("[audit]", err);
        sse.sendError(sanitizeError(err, "Audit failed."));
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
  credentials?: { email: string; password: string },
  skipDeterministic?: boolean,
  useRealChrome?: boolean,
  realChromeHeadless?: boolean,
  captureInteractions?: boolean,
  clickSelectors?: string[],
  reuseSession?: boolean,
): Promise<void> {
  // Fresh profile by default — only reuse if explicitly asked. Prevents stale
  // SSO state from the previous run from silently breaking this one.
  const freshProfile = !reuseSession;

  // --- Interactive login: open headed browser, wait for user ---------------
  if (interactiveLogin) {
    sse.sendProgress(
      useRealChrome
        ? `Launching your Google Chrome (${realChromeHeadless ? "headless" : "headed"}) for interactive login...`
        : `Launching browser for interactive login${freshProfile ? " (fresh profile)" : " (reusing session)"}...`,
    );

    const { sessionId: loginSessionId } = useRealChrome
      ? await launchRealChromeSession(url, { headless: !!realChromeHeadless })
      : await launchHeadedPersistentBrowser(url, { freshProfile });

    // Tell the frontend the browser is open — it shows "I'm logged in" button
    sse.sendInteractiveLoginReady(loginSessionId);

    // Block until user clicks "I'm logged in, start crawling"
    await waitForReadySignal(loginSessionId);

    sse.sendProgress("Login confirmed — extracting session...");
    // When freshProfile is true, also wipe the profile afterwards so the next
    // run is equally clean. When the user opted into reuse, keep the profile.
    const loginCookies = await extractCookiesAndClose(loginSessionId, {
      wipeProfileAfter: freshProfile,
    });
    cookies = loginCookies;
  }

  // --- Pre-flight: verify Claude transport is available --------------------
  sse.sendProgress("Checking Claude availability...");
  const health = await checkClaudeClientHealth();
  if (!health.ok) {
    throw new Error(
      `Claude (${health.transport}) is not responding: ${health.error}. ` +
      (health.transport === "sdk"
        ? "Check ANTHROPIC_API_KEY."
        : "Make sure the 'claude' command is in your PATH and your session is active."),
    );
  }

  // --- Step 1: Crawl and screenshot ----------------------------------------
  sse.sendProgress(
    credentials
      ? "Crawling site (auto-login enabled)..."
      : "Crawling site and discovering pages...",
  );

  const outputDir = path.join(os.tmpdir(), `ux-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const outcome = await crawlAndScreenshot(url, outputDir, cookies, usePersistedSession, {
    credentials,
    skipAxe: skipDeterministic,
    onAxeProgress: (route, vp) => sse.sendProgress(`Running axe on ${route} @ ${vp}`),
    captureInteractions: captureInteractions ?? true,
    clickSelectors,
    onInteractionProgress: (label) => sse.sendProgress(label),
  });

  // --- Handle SSO redirect (persistent session detected origin mismatch) ---
  if ("needsSSOLogin" in outcome && outcome.needsSSOLogin) {
    sse.sendProgress("SSO redirect detected — launching browser for login...");

    const { sessionId: ssoSessionId } =
      await launchHeadedPersistentBrowser(url, { freshProfile });

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
      try { await extractCookiesAndClose(ssoSessionId, { wipeProfileAfter: freshProfile }); } catch { /* ignore */ }
      return;
    }

    sse.sendProgress("SSO login complete — extracting session...");
    const ssoCookies = await extractCookiesAndClose(ssoSessionId, {
      wipeProfileAfter: freshProfile,
    });

    // Re-crawl with the authenticated cookies + persisted profile
    sse.sendProgress("Resuming crawl with authenticated session...");
    const retryOutcome = await crawlAndScreenshot(url, outputDir, ssoCookies, usePersistedSession, {
      skipAxe: skipDeterministic,
      onAxeProgress: (route, vp) => sse.sendProgress(`Running axe on ${route} @ ${vp}`),
      captureInteractions: captureInteractions ?? true,
      clickSelectors,
      onInteractionProgress: (label) => sse.sendProgress(label),
    });

    if ("needsAuth" in retryOutcome && retryOutcome.needsAuth) {
      sse.sendAuthRequired(retryOutcome.authUrl, retryOutcome.screenshot);
      return;
    }
    if ("needsSSOLogin" in retryOutcome && retryOutcome.needsSSOLogin) {
      sse.sendError("SSO login did not resolve — cookies may not have been captured.");
      return;
    }

    const retryManifest = (retryOutcome as CrawlResult).manifest;
    return analyzeAndEmit(retryManifest, outputDir, sse, prdContext, repoContext, skipDeterministic);
  }

  // If auth is required (legacy heuristic detection), send the event and stop
  if ("needsAuth" in outcome && outcome.needsAuth) {
    sse.sendAuthRequired(outcome.authUrl, outcome.screenshot);
    return;
  }

  const manifest = (outcome as CrawlResult).manifest;
  return analyzeAndEmit(manifest, outputDir, sse, prdContext, repoContext, skipDeterministic);
}

// ---------------------------------------------------------------------------
// Analysis pipeline — progressive page-by-page
//
// Strategy:
//  1. Analyze the TARGET page first (the exact URL the user asked for) and
//     emit its results immediately so the user sees value within ~60 s.
//  2. Fan-out the remaining pages with bounded concurrency, emitting each
//     page_result as soon as it completes.
//  3. Emit the combined final `result` event for cache/backward compat.
// ---------------------------------------------------------------------------

/** Maximum pages analyzed concurrently (after the first). */
const PAGE_CONCURRENCY = 2;

async function analyzeAndEmit(
  manifest: { baseUrl: string; timestamp: string; sessionId: string; routes: Array<{ route: string; url: string; screenshots: Record<ViewportName, string>; axeFindings?: AxeFinding[]; tokenFindings?: DriftFinding[] }> },
  outputDir: string,
  sse: SSEWriter,
  prdContext?: string,
  repoContext?: string,
  skipDeterministic?: boolean,
): Promise<void> {
  const sessionId = manifest.sessionId;
  const totalRoutes = manifest.routes.length;

  if (totalRoutes === 0) {
    sse.sendProgress("No pages discovered.");
    sse.sendResult({ baseUrl: manifest.baseUrl, timestamp: manifest.timestamp, pages: [] });
    return;
  }

  sse.sendProgress(
    totalRoutes === 1
      ? "Analyzing page…"
      : `Discovered ${totalRoutes} page(s). Analyzing the target page first…`,
  );

  const allPages: PageResult[] = [];
  // Per-route Lighthouse promise map — populated up-front by a serial
  // background task so concurrency stays at 1 (Lighthouse is heavy) while
  // LLM analysis still fans out. Each analyzePage() awaits its entry.
  const lighthousePromiseByRoute = new Map<string, Promise<LighthouseFinding[]>>();

  // --- Helper: analyze one route's screenshots and return a PageResult ----
  async function analyzePage(
    routeEntry: (typeof manifest.routes)[number],
    pageIdx: number,
  ): Promise<PageResult> {
    const pngs: string[] = [];
    for (const vpName of VIEWPORT_NAMES) {
      const filename = routeEntry.screenshots[vpName];
      if (filename) {
        pngs.push(path.join(outputDir, filename));
      }
    }

    // Group axe findings by screenshot basename so the prompt can inject them
    // as CONFIRMED_ISSUES per screenshot — lets the LLM skip what axe caught.
    const axeFindingsByScreenshot: Record<string, AxeFinding[]> = {};
    for (const finding of routeEntry.axeFindings ?? []) {
      const filename = routeEntry.screenshots[finding.viewport];
      if (!filename) continue;
      (axeFindingsByScreenshot[filename] ??= []).push(finding);
    }

    // Run analysis for this page's screenshots
    const result = pngs.length > 0
      ? await analyzeScreenshots(pngs, {
          prdContext,
          repoContext,
          label: `page-${pageIdx + 1}`,
          axeFindingsByScreenshot,
          onProgress: (msg) =>
            sse.sendProgress(`[${routeEntry.route}] ${msg}`, pageIdx, totalRoutes),
        })
      : { screenshots: {} as Record<string, { issues: unknown[] }>, totalBatches: 0, failedBatches: 0, errors: [] as { batchIndex: number; reason: string }[] };

    if (result.failedBatches > 0) {
      sse.sendProgress(`Warning: analysis failed for ${routeEntry.route}: ${result.errors[0]?.reason}`);
    }

    // Map to PageResult — per-viewport LLM issues first
    const viewports = {} as Record<ViewportName, ViewportAnalysis>;
    const llmIssuesByViewport = {} as Record<ViewportName, UXIssue[]>;
    for (const vpName of VIEWPORT_NAMES) {
      const filename = routeEntry.screenshots[vpName] || "";
      const fileAnalysis = filename
        ? (result.screenshots[filename] as { issues: unknown[] } | undefined)
        : undefined;

      let issues: UXIssue[] = [];
      if (fileAnalysis) {
        try {
          const validated = validateAnalysisResult(fileAnalysis);
          issues = validated.issues;
        } catch (err) {
          sse.sendProgress(
            `Warning: validation failed for ${filename}: ${(err as Error).message}`,
          );
        }
      }

      llmIssuesByViewport[vpName] = issues;
      viewports[vpName] = {
        screenshotPath: screenshotUrl(sessionId, filename),
        issues,
      };
    }

    // --- Merge deterministic findings onto the desktop viewport bucket ---
    // Design decision: axe + Lighthouse findings don't have pixel bounding
    // boxes and aren't naturally per-viewport (axe re-runs per viewport but
    // the merge layer collapses duplicates). We attach the merged list to
    // the desktop viewport — the canonical view — and keep per-viewport LLM
    // issues intact on mobile/tablet. The merge itself still dedupes LLM vs
    // axe across all viewports.
    if (!skipDeterministic) {
      const axeFindings = routeEntry.axeFindings ?? [];
      const lhPromise = lighthousePromiseByRoute.get(routeEntry.route);
      let lhFindings: LighthouseFinding[] = [];
      if (lhPromise) {
        try {
          lhFindings = await lhPromise;
        } catch (err) {
          sse.sendProgress(
            `Warning: Lighthouse failed for ${routeEntry.route}: ${(err as Error).message}`,
          );
        }
      }
      const allLlmIssues = [
        ...llmIssuesByViewport.mobile,
        ...llmIssuesByViewport.tablet,
        ...llmIssuesByViewport.desktop,
      ];
      const tokenFindings = routeEntry.tokenFindings ?? [];
      const merged = mergeFindings(allLlmIssues, axeFindings, lhFindings, tokenFindings, {
        evidenceScreenshot: routeEntry.screenshots.desktop || undefined,
      });
      // Replace all three viewport buckets with the merged result on desktop,
      // and strip LLM issues from mobile/tablet that survived the merge (they
      // now appear under desktop). This avoids surfacing the same LLM issue
      // multiple times in the UI.
      viewports.desktop = {
        screenshotPath: screenshotUrl(sessionId, routeEntry.screenshots.desktop || ""),
        issues: merged,
      };
      // Preserve viewport-specific LLM issues on mobile/tablet only if they
      // didn't get consumed by the merge — since mergeFindings returns all
      // kept LLM issues without viewport attribution, we move per-viewport
      // LLM issues exclusively to desktop to keep a single source of truth.
      viewports.mobile = {
        screenshotPath: screenshotUrl(sessionId, routeEntry.screenshots.mobile || ""),
        issues: [],
      };
      viewports.tablet = {
        screenshotPath: screenshotUrl(sessionId, routeEntry.screenshots.tablet || ""),
        issues: [],
      };
    }

    return { route: routeEntry.route, url: routeEntry.url, viewports };
  }

  // --- Lighthouse serial background chain (concurrency=1) -----------------
  // Kick off a chain that runs Lighthouse for every route sequentially. Each
  // analyzePage() awaits the promise for its route before merging — so the
  // LLM fan-out stays parallel while Lighthouse itself is never parallel.
  if (!skipDeterministic) {
    let chain: Promise<void> = Promise.resolve();
    for (const routeEntry of manifest.routes) {
      const promise = chain.then(async () => {
        const collected: LighthouseFinding[] = [];
        for (const vp of ["mobile", "desktop"] as const) {
          sse.sendProgress(`Running Lighthouse on ${routeEntry.route} @ ${vp}`);
          const lh = await runLighthouse(routeEntry.url, { viewport: vp });
          if (lh.skipped) {
            sse.sendProgress(
              `Lighthouse skipped for ${routeEntry.route} @ ${vp}: ${lh.skipReason ?? "unknown"}`,
            );
          }
          collected.push(...lh.findings);
        }
        return collected;
      });
      lighthousePromiseByRoute.set(routeEntry.route, promise);
      // Silence unhandled-rejection warnings on the background chain —
      // analyzePage() awaits and handles failures via try/catch on merge.
      chain = promise.then(() => undefined, () => undefined);
    }
  }

  // --- Step 1: Analyze the target page first (immediate value) -----------
  const [firstRoute, ...remainingRoutes] = manifest.routes;
  const firstPage = await analyzePage(firstRoute, 0);
  allPages.push(firstPage);
  sse.sendPageResult(firstPage, 0, totalRoutes);

  // --- Step 2: Fan-out remaining pages with bounded concurrency ----------
  if (remainingRoutes.length > 0) {
    sse.sendProgress(
      `Target page done — analyzing ${remainingRoutes.length} more page(s)…`,
    );

    let nextIdx = 0;
    const pump = async (): Promise<void> => {
      while (true) {
        const i = nextIdx++;
        if (i >= remainingRoutes.length) return;
        const page = await analyzePage(remainingRoutes[i], i + 1);
        allPages.push(page);
        sse.sendPageResult(page, i + 1, totalRoutes);
      }
    };

    const workers = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, remainingRoutes.length) },
      () => pump(),
    );
    await Promise.all(workers);
  }

  // --- Step 3: Final combined result (for cache + backward compat) -------
  const result: AuditResult = {
    baseUrl: manifest.baseUrl,
    timestamp: manifest.timestamp,
    pages: allPages,
  };

  try {
    saveAuditToCache(result, outputDir);
  } catch (err) {
    sse.sendProgress(`Warning: failed to cache results: ${(err as Error).message}`);
  }

  // Persist a flat findings report for the shareable /report/<runId> viewer.
  // The crawler's sessionId (e.g. "ux-audit-1712345678901") doubles as the runId.
  try {
    const runId = manifest.sessionId;
    if (isValidRunId(runId)) {
      const allFindings: UXIssue[] = [];
      for (const page of allPages) {
        for (const viewport of Object.values(page.viewports)) {
          for (const issue of viewport.issues) {
            // dedupe by id so merged findings aren't written 3x (one per viewport slot)
            if (!allFindings.some((f) => f.id === issue.id)) allFindings.push(issue);
          }
        }
      }
      await saveRun(runId, {
        runId,
        url: manifest.baseUrl,
        timestamp: manifest.timestamp,
        findings: allFindings,
        summary: summarize(allFindings),
      });
      sse.sendProgress(`Report saved to /report/${runId}`);
    }
  } catch (err) {
    sse.sendProgress(`Warning: failed to save report: ${(err as Error).message}`);
  }

  sse.sendProgress("Audit complete.", totalRoutes, totalRoutes);
  sse.sendResult(result);
}
