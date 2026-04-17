"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ViewportName } from "@/lib/crawler";
import type { UXIssue } from "@/lib/analyzer";
import type { FixStatus } from "@/lib/stitch/types";
import {
  type AuditIssue,
  type PageAudit,
  type AuditPhase,
  type AuthState,
  type BrowserSessionState,
  type UploadedScreenshot,
  toAuditIssue,
  sortBySeverity,
} from "@/types/audit";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAudit() {
  // Core state
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<AuditPhase>("idle");
  const [pages, setPages] = useState<PageAudit[]>([]);
  const [activeViewports, setActiveViewports] = useState<Record<string, ViewportName>>({});
  const [progressDetail, setProgressDetail] = useState("");
  const [auditError, setAuditError] = useState<string | null>(null);

  // Auth
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Browser session (persistent profile)
  const [usePersistedSession, setUsePersistedSession] = useState(false);
  const [interactiveLogin, setInteractiveLogin] = useState(false);
  const [useRealChrome, setUseRealChrome] = useState(false);
  const [realChromeHeadless, setRealChromeHeadless] = useState(false);

  // Interaction capture (tab switchers, custom click selectors)
  const [captureInteractions, setCaptureInteractions] = useState(true);
  const [clickSelectorsText, setClickSelectorsText] = useState("");
  const [browserSession, setBrowserSession] = useState<BrowserSessionState>({
    sessionId: null,
    status: "idle",
  });
  const [hasPersistedSession, setHasPersistedSession] = useState(false);

  // Context: PRD
  const [prdText, setPrdText] = useState("");
  const [prdFileName, setPrdFileName] = useState<string | null>(null);

  // Context: GitHub repo
  const [repoUrl, setRepoUrl] = useState("");
  const [repoContext, setRepoContext] = useState("");
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoFileCount, setRepoFileCount] = useState(0);

  // Cookies
  const [cookieText, setCookieText] = useState("");
  const [cookieError, setCookieError] = useState<string | null>(null);

  // Automated login credentials — kept in memory only, never persisted
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [autoLoginEnabled, setAutoLoginEnabled] = useState(false);

  // Screenshot upload
  const [uploadedScreenshots, setUploadedScreenshots] = useState<UploadedScreenshot[]>([]);

  // Stitch
  const [stitchConnected, setStitchConnected] = useState(false);
  const [stitchProjectId, setStitchProjectId] = useState<string | null>(null);
  const [brandConfig, setBrandConfig] = useState({
    primaryColor: "#2563eb",
    secondaryColor: "#64748b",
    fontFamily: "Inter, system-ui, sans-serif",
    accentColor: "#8b5cf6",
  });
  const [brandSaved, setBrandSaved] = useState(false);
  const [activeScreenshotView, setActiveScreenshotView] = useState<Record<string, "original" | "annotated" | "fix">>({});

  // Asana
  const [isPushingAsana, setIsPushingAsana] = useState(false);

  // Cache
  const [cachedAudits, setCachedAudits] = useState<
    Array<{ id: string; url: string; timestamp: string; pageCount: number; issueCount: number }>
  >([]);
  const [cacheLoading, setCacheLoading] = useState(false);

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------

  useEffect(() => {
    fetch("/api/stitch/setup")
      .then((res) => res.json())
      .then((data) => setStitchConnected(data.connected))
      .catch(() => setStitchConnected(false));

    // Check if a persisted browser session exists on disk
    fetch("/api/auth-session")
      .then((res) => res.json())
      .then((data) => setHasPersistedSession(data.hasSession))
      .catch(() => setHasPersistedSession(false));
  }, []);

  // Check for cached audits when URL changes (debounced)
  useEffect(() => {
    if (!url.trim()) {
      setCachedAudits([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cache?url=${encodeURIComponent(url.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setCachedAudits(data.audits || []);
        }
      } catch {
        // Ignore cache lookup failures
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [url]);

  // Cleanup auth polling on unmount
  useEffect(() => {
    return () => {
      if (authPollRef.current) clearInterval(authPollRef.current);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Computed
  // -----------------------------------------------------------------------

  const totalApproved = pages.reduce(
    (acc, p) => acc + p.issues.filter((i) => i.status === "approved").length,
    0,
  );
  const totalIssues = pages.reduce((acc, p) => acc + p.issues.length, 0);
  const totalDismissed = pages.reduce(
    (acc, p) => acc + p.issues.filter((i) => i.status === "dismissed").length,
    0,
  );

  // -----------------------------------------------------------------------
  // PRD file upload
  // -----------------------------------------------------------------------

  const parseFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "txt" || ext === "md") {
      const text = await file.text();
      setPrdText(text);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/parse-document", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) {
      console.error("Parse error:", json.error);
      setPrdText(`[Error parsing ${file.name}: ${json.error}]`);
      return;
    }
    setPrdText(json.text);
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setPrdFileName(file.name);
      parseFile(file);
      e.target.value = "";
    },
    [parseFile],
  );

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["txt", "md", "pdf", "docx"].includes(ext ?? "")) return;
      setPrdFileName(file.name);
      parseFile(file);
    },
    [parseFile],
  );

  // -----------------------------------------------------------------------
  // GitHub repo context
  // -----------------------------------------------------------------------

  const handleFetchRepoContext = useCallback(async () => {
    if (!repoUrl.trim()) return;
    setRepoLoading(true);
    setRepoError(null);
    setRepoContext("");
    setRepoFileCount(0);
    try {
      const res = await fetch("/api/fetch-repo-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRepoError(data.error ?? "Failed to fetch repository");
        return;
      }
      const files = data.files as { path: string; content: string }[];
      setRepoFileCount(files.length);
      if (files.length === 0) {
        setRepoError("No relevant files found in this repository.");
        return;
      }
      const context = files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
      setRepoContext(context);
    } catch (err) {
      setRepoError((err as Error).message);
    } finally {
      setRepoLoading(false);
    }
  }, [repoUrl]);

  const clearRepoContext = useCallback(() => {
    setRepoContext("");
    setRepoUrl("");
    setRepoFileCount(0);
  }, []);

  // -----------------------------------------------------------------------
  // Cookie parsing
  // -----------------------------------------------------------------------

  const parseCookieText = useCallback((text: string): Record<string, unknown>[] | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((c: Record<string, unknown>) => {
          const cookie: Record<string, unknown> = {
            name: String(c.name || ""),
            value: String(c.value || ""),
            domain: String(c.domain || ""),
            path: String(c.path || "/"),
          };
          if (c.httpOnly != null) cookie.httpOnly = Boolean(c.httpOnly);
          if (c.secure != null) cookie.secure = Boolean(c.secure);
          if (c.sameSite) cookie.sameSite = String(c.sameSite);
          return cookie;
        });
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // SSE stream parser (shared between URL audit and screenshot audit)
  // -----------------------------------------------------------------------

  function parseSSEResult(parsed: {
    pages: Array<{
      route: string;
      url: string;
      viewports: Record<string, { screenshotPath: string; issues: UXIssue[] }>;
    }>;
  }): PageAudit[] {
    return parsed.pages.map((pg) => {
      const allIssues: AuditIssue[] = [];
      const seenIds = new Set<string>();

      for (const vpName of ["desktop", "tablet", "mobile"] as const) {
        const vp = pg.viewports[vpName];
        if (vp?.issues) {
          for (const issue of vp.issues) {
            if (!seenIds.has(issue.id)) {
              seenIds.add(issue.id);
              allIssues.push(toAuditIssue(issue));
            }
          }
        }
      }

      const screenshots = {} as Record<ViewportName, string>;
      for (const vpName of ["mobile", "tablet", "desktop"] as const) {
        screenshots[vpName] = pg.viewports[vpName]?.screenshotPath || "";
      }

      const title =
        pg.route === "/"
          ? "Homepage"
          : pg.route
              .replace(/^\//, "")
              .replace(/-/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase()) || "Uploaded Page";

      return {
        url: pg.url,
        title,
        issues: sortBySeverity(allIssues),
        screenshots,
      };
    });
  }

  // Wrapped in useCallback so handleRunAudit/handleAnalyzeScreenshots
  // can list it as a dependency without triggering re-renders.
  // All state setters used inside are stable React references.
  const processSSEStream = useCallback(async function processSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    opts?: { onAuthRequired?: (authUrl: string, screenshot: string) => void },
  ) {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7);
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "") {
          if (currentEvent && currentData) {
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(currentData);
            } catch {
              // Malformed SSE data — skip this event and continue
              currentEvent = "";
              currentData = "";
              continue;
            }

            if (currentEvent === "auth_required") {
              opts?.onAuthRequired?.(parsed.authUrl as string, parsed.screenshot as string);
              return; // Stop processing
            } else if (currentEvent === "interactive_login_ready") {
              // Headed browser is open — show "I'm logged in" button
              setPhase("interactive_login");
              setProgressDetail("Browser opened — log in, then click the button below.");
              setBrowserSession({
                sessionId: parsed.sessionId as string,
                status: "ready",
              });
            } else if (currentEvent === "sso_redirect") {
              // SSO redirect detected — browser opened automatically
              setPhase("sso_redirect");
              setProgressDetail("SSO redirect detected — complete login in the browser.");
              setBrowserSession({
                sessionId: parsed.sessionId as string,
                status: "sso_polling",
                redirectUrl: parsed.redirectUrl as string,
              });
            } else if (currentEvent === "progress") {
              const detail = String(parsed.detail ?? "");
              setProgressDetail(detail);
              if (detail.includes("Crawling") || detail.includes("Resuming")) setPhase("crawling");
              else if (detail.includes("Discovered") || detail.includes("Target page")) setPhase("screenshotting");
              else if (detail.includes("Analyz") || detail.includes("Reading")) setPhase("analyzing");
              else if (detail.includes("complete")) setPhase("done");
              else if (detail.includes("Login confirmed") || detail.includes("SSO login complete")) {
                setBrowserSession({ sessionId: null, status: "idle" });
              }
            } else if (currentEvent === "page_result") {
              // Progressive scan: a single page just finished analysis.
              // Append it to the existing pages rather than replacing.
              setPhase("analyzing");
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pageData = (parsed as any).page as {
                route: string;
                url: string;
                viewports: Record<string, { screenshotPath: string; issues: UXIssue[] }>;
              };
              const pageAudit = parseSSEResult({ pages: [pageData] })[0];
              if (pageAudit) {
                setPages((prev) => {
                  // Avoid duplicates if the final result re-sends
                  if (prev.some((p) => p.url === pageAudit.url)) return prev;
                  return [...prev, pageAudit];
                });
                setActiveViewports((prev) => ({ ...prev, [pageAudit.url]: "desktop" }));
              }
            } else if (currentEvent === "result") {
              // Final combined result — reconcile with progressively-added pages
              // and mark the audit as done.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pageAudits = parseSSEResult(parsed as any);
              setPages(pageAudits);
              const viewportMap: Record<string, ViewportName> = {};
              pageAudits.forEach((p) => { viewportMap[p.url] = "desktop"; });
              setActiveViewports((prev) => ({ ...prev, ...viewportMap }));
              setPhase("done");
              setBrowserSession({ sessionId: null, status: "idle" });
              // Refresh persisted session status
              fetch("/api/auth-session")
                .then((r) => r.json())
                .then((d) => setHasPersistedSession(d.hasSession))
                .catch(() => {});
            } else if (currentEvent === "error") {
              setBrowserSession({ sessionId: null, status: "idle" });
              throw new Error(String(parsed.message ?? "Unknown error"));
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  }, []);

  // -----------------------------------------------------------------------
  // Run audit (URL-based)
  // -----------------------------------------------------------------------

  const handleRunAudit = useCallback(
    async (resumeCookies?: Record<string, unknown>[]) => {
      if (!url.trim()) return;

      setPhase(interactiveLogin ? "interactive_login" : "crawling");
      setPages([]);
      setAuditError(null);
      setAuthState(null);
      setBrowserSession({ sessionId: null, status: "idle" });
      setProgressDetail(interactiveLogin ? "Launching browser..." : "Starting audit...");

      let cookies = resumeCookies;
      if (!cookies && cookieText.trim()) {
        const parsed = parseCookieText(cookieText);
        if (!parsed) {
          setCookieError("Invalid cookie format. Paste a JSON array from EditThisCookie or similar.");
          setPhase("idle");
          return;
        }
        cookies = parsed;
        setCookieError(null);
      }

      const credentials =
        autoLoginEnabled && loginEmail.trim() && loginPassword
          ? { email: loginEmail.trim(), password: loginPassword }
          : undefined;

      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            prdContext: prdText || undefined,
            repoContext: repoContext || undefined,
            ...(cookies && { cookies }),
            ...(usePersistedSession && { usePersistedSession: true }),
            ...(interactiveLogin && { interactiveLogin: true }),
            ...(useRealChrome && { useRealChrome: true, realChromeHeadless }),
            ...(credentials && { credentials }),
            captureInteractions,
            ...(clickSelectorsText.trim() && {
              clickSelectors: clickSelectorsText
                .split(/\r?\n|,/)
                .map((s) => s.trim())
                .filter(Boolean),
            }),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        await processSSEStream(res.body!.getReader(), {
          onAuthRequired: (authUrl, screenshot) => {
            setPhase("auth_required");
            setProgressDetail("Authentication required");
            setAuthState({ authUrl, screenshot, sessionId: null, status: "waiting" });
          },
        });
      } catch (err) {
        setAuditError((err as Error).message);
        setPhase("idle");
      }
    },
    [url, prdText, repoContext, cookieText, parseCookieText, usePersistedSession, interactiveLogin, useRealChrome, realChromeHeadless, captureInteractions, clickSelectorsText, autoLoginEnabled, loginEmail, loginPassword, processSSEStream],
  );

  // -----------------------------------------------------------------------
  // "I'm logged in, start crawling" — signals the backend to proceed
  // -----------------------------------------------------------------------

  const handleProceedAfterLogin = useCallback(async () => {
    if (!browserSession.sessionId) return;
    setBrowserSession((prev) => ({ ...prev, status: "proceeding" }));
    try {
      await fetch("/api/auth-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "proceed", sessionId: browserSession.sessionId }),
      });
    } catch (err) {
      setAuditError((err as Error).message);
    }
  }, [browserSession.sessionId]);

  // -----------------------------------------------------------------------
  // Clear saved browser session
  // -----------------------------------------------------------------------

  const handleClearSession = useCallback(async () => {
    try {
      await fetch("/api/auth-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-profile" }),
      });
      setHasPersistedSession(false);
    } catch (err) {
      setAuditError((err as Error).message);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Interactive login (legacy auth-wall flow)
  // -----------------------------------------------------------------------

  const handleStartInteractiveLogin = useCallback(async () => {
    if (!authState) return;
    setAuthState((prev) => (prev ? { ...prev, status: "browser_open" } : prev));

    try {
      const res = await fetch("/api/auth-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", url: authState.authUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const { sessionId } = await res.json();
      setAuthState((prev) => (prev ? { ...prev, sessionId, status: "polling" } : prev));

      const poll = setInterval(async () => {
        try {
          const checkRes = await fetch("/api/auth-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "check-sso", sessionId }),
          });
          if (!checkRes.ok) return;
          const { returned } = await checkRes.json();

          if (returned) {
            clearInterval(poll);
            authPollRef.current = null;
            setAuthState((prev) => (prev ? { ...prev, status: "authenticated" } : prev));

            const completeRes = await fetch("/api/auth-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "complete", sessionId }),
            });
            if (!completeRes.ok) throw new Error("Failed to complete auth session");
            const { cookies } = await completeRes.json();
            setAuthState(null);
            setHasPersistedSession(true);
            handleRunAudit(cookies);
          }
        } catch {
          // Polling error — continue trying
        }
      }, 2000);

      authPollRef.current = poll;
    } catch (err) {
      setAuthState((prev) =>
        prev ? { ...prev, status: "error", error: (err as Error).message } : prev,
      );
    }
  }, [authState, handleRunAudit]);

  // -----------------------------------------------------------------------
  // Screenshot upload
  // -----------------------------------------------------------------------

  const handleScreenshotFiles = useCallback((files: FileList | File[]) => {
    const newScreenshots: UploadedScreenshot[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      newScreenshots.push({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        preview: URL.createObjectURL(file),
        label: file.name.replace(/\.[^.]+$/, ""),
      });
    }
    setUploadedScreenshots((prev) => [...prev, ...newScreenshots]);
  }, []);

  const handleRemoveScreenshot = useCallback((id: string) => {
    setUploadedScreenshots((prev) => {
      const item = prev.find((s) => s.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const handleAnalyzeScreenshots = useCallback(async () => {
    if (uploadedScreenshots.length === 0) return;
    setPhase("analyzing");
    setPages([]);
    setAuditError(null);
    setProgressDetail("Uploading and analyzing screenshots...");

    try {
      const formData = new FormData();
      for (const ss of uploadedScreenshots) {
        formData.append("images", ss.file);
        formData.append("labels", ss.label);
      }
      if (prdText) formData.append("prdContext", prdText);
      if (repoContext) formData.append("repoContext", repoContext);

      const res = await fetch("/api/audit-screenshots", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      await processSSEStream(res.body!.getReader());
    } catch (err) {
      setAuditError((err as Error).message);
      setPhase("idle");
    }
  }, [uploadedScreenshots, prdText, repoContext, processSSEStream]);

  // -----------------------------------------------------------------------
  // Issue CRUD
  // -----------------------------------------------------------------------

  const handleUpdateIssue = useCallback(
    (pageUrl: string, issueId: string, patch: Partial<AuditIssue>) => {
      setPages((prev) =>
        prev.map((p) => {
          if (p.url !== pageUrl) return p;
          return { ...p, issues: p.issues.map((i) => (i.id === issueId ? { ...i, ...patch } : i)) };
        }),
      );
    },
    [],
  );

  const handleRewriteIssue = useCallback(
    async (issue: AuditIssue, instruction: string, prdCtx: string) => {
      const ownerPage = pages.find((p) => p.issues.some((i) => i.id === issue.id));
      if (!ownerPage) return;
      handleUpdateIssue(ownerPage.url, issue.id, { isRewriting: true });

      try {
        const res = await fetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issue: {
              id: issue.id,
              title: issue.title,
              severity: issue.severity,
              category: issue.category,
              description: issue.description,
              affected_element: issue.affected_element,
              steps_to_reproduce: issue.steps_to_reproduce,
              suggested_fix: issue.suggested_fix,
              acceptance_criteria: issue.acceptance_criteria,
              affected_viewports: issue.affected_viewports,
              recommendation: issue.recommendation,
              bounding_box: issue.bounding_box,
            },
            instruction,
            ...(prdCtx ? { prdContext: prdCtx } : {}),
            ...(repoContext ? { repoContext } : {}),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        const rewritten = data.issue as UXIssue;

        handleUpdateIssue(ownerPage.url, issue.id, {
          title: rewritten.title,
          severity: rewritten.severity,
          category: rewritten.category,
          heuristic: rewritten.principle || rewritten.category,
          description: rewritten.description,
          affected_element: rewritten.affected_element,
          steps_to_reproduce: rewritten.steps_to_reproduce,
          suggested_fix: rewritten.suggested_fix,
          acceptance_criteria: rewritten.acceptance_criteria,
          affected_viewports: rewritten.affected_viewports,
          recommendation: rewritten.recommendation,
          bounding_box: rewritten.bounding_box,
          previousVersion: {
            title: issue.title,
            description: issue.description,
            recommendation: issue.recommendation,
          },
          isRewriting: false,
          editPromptOpen: false,
          editPrompt: "",
        });
      } catch (err) {
        handleUpdateIssue(ownerPage.url, issue.id, { isRewriting: false });
        alert(`Rewrite failed: ${(err as Error).message}`);
      }
    },
    [pages, handleUpdateIssue, repoContext],
  );

  // -----------------------------------------------------------------------
  // Stitch handlers
  // -----------------------------------------------------------------------

  const handleGenerateFix = useCallback(
    async (issue: AuditIssue) => {
      const ownerPage = pages.find((p) => p.issues.some((i) => i.id === issue.id));
      if (!ownerPage) return;
      handleUpdateIssue(ownerPage.url, issue.id, { fixStatus: "generating" as FixStatus, fixError: undefined });

      try {
        const res = await fetch("/api/stitch/generate-fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueId: issue.id,
            issueTitle: issue.title,
            issueDescription: issue.description,
            recommendation: issue.recommendation,
            severity: issue.severity,
            category: issue.category,
            projectId: stitchProjectId,
            auditUrl: url,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!stitchProjectId && data.projectId) setStitchProjectId(data.projectId);

        handleUpdateIssue(ownerPage.url, issue.id, {
          fix: { screenId: data.screenId, imageUrl: data.imageUrl, prompt: "" },
          fixStatus: "generated" as FixStatus,
        });
      } catch (err) {
        handleUpdateIssue(ownerPage.url, issue.id, {
          fixStatus: "error" as FixStatus,
          fixError: (err as Error).message,
        });
      }
    },
    [pages, handleUpdateIssue, stitchProjectId, url],
  );

  const handleRefineFix = useCallback(
    async (issue: AuditIssue, instruction: string) => {
      if (!issue.fix || !stitchProjectId) return;
      const ownerPage = pages.find((p) => p.issues.some((i) => i.id === issue.id));
      if (!ownerPage) return;
      handleUpdateIssue(ownerPage.url, issue.id, { fixStatus: "generating" as FixStatus });

      try {
        const res = await fetch("/api/stitch/edit-screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: stitchProjectId,
            screenIds: [issue.fix.screenId],
            prompt: instruction,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        handleUpdateIssue(ownerPage.url, issue.id, {
          fix: { screenId: data.screenId, imageUrl: data.imageUrl, prompt: instruction },
          fixStatus: "refined" as FixStatus,
          refinePromptOpen: false,
          refinePrompt: "",
        });
      } catch (err) {
        handleUpdateIssue(ownerPage.url, issue.id, {
          fixStatus: "error" as FixStatus,
          fixError: (err as Error).message,
        });
      }
    },
    [pages, handleUpdateIssue, stitchProjectId],
  );

  const handleGenerateVariants = useCallback(
    async (issue: AuditIssue) => {
      if (!issue.fix || !stitchProjectId) return;
      const ownerPage = pages.find((p) => p.issues.some((i) => i.id === issue.id));
      if (!ownerPage) return;

      try {
        const res = await fetch("/api/stitch/generate-variants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: stitchProjectId,
            screenIds: [issue.fix.screenId],
            prompt: `Generate variants fixing: ${issue.title}`,
            count: 3,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        handleUpdateIssue(ownerPage.url, issue.id, { variants: data.variants });
      } catch (err) {
        alert(`Variant generation failed: ${(err as Error).message}`);
      }
    },
    [pages, handleUpdateIssue, stitchProjectId],
  );

  const handleSaveBrand = useCallback(async () => {
    try {
      let projId = stitchProjectId;
      if (!projId) {
        const initRes = await fetch("/api/stitch/generate-fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueId: "brand-init",
            issueTitle: "Brand initialization",
            issueDescription: "N/A",
            recommendation: "N/A",
            severity: "minor",
            category: "visual",
            auditUrl: url || "https://brand-setup.local",
          }),
        });
        const initData = await initRes.json();
        projId = initData.projectId;
        if (projId) setStitchProjectId(projId);
      }
      if (!projId) return;

      const res = await fetch("/api/stitch/design-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...brandConfig, projectId: projId }),
      });
      if (res.ok) {
        setBrandSaved(true);
        setTimeout(() => setBrandSaved(false), 3000);
      }
    } catch {
      alert("Failed to save brand settings");
    }
  }, [brandConfig, stitchProjectId, url]);

  // -----------------------------------------------------------------------
  // Reset — return the dashboard to idle so the user can start a new audit
  // -----------------------------------------------------------------------

  const resetAudit = useCallback(() => {
    setPhase("idle");
    setPages([]);
    setActiveViewports({});
    setActiveScreenshotView({});
    setAuditError(null);
    setAuthState(null);
    setProgressDetail("");
    setBrowserSession({ sessionId: null, status: "idle" });
    setUrl("");
  }, []);

  // -----------------------------------------------------------------------
  // Cache — load previous audit
  // -----------------------------------------------------------------------

  const loadFromCache = useCallback(async (cacheId: string) => {
    setCacheLoading(true);
    try {
      const res = await fetch(`/api/cache?id=${encodeURIComponent(cacheId)}`);
      if (!res.ok) throw new Error("Cache entry not found");
      const data = await res.json();
      const pageAudits = parseSSEResult(data.result);
      setPages(pageAudits);
      const viewportMap: Record<string, ViewportName> = {};
      pageAudits.forEach((p) => { viewportMap[p.url] = "desktop"; });
      setActiveViewports(viewportMap);
      setPhase("done");
      setCachedAudits([]);
    } catch (err) {
      setAuditError(`Failed to load cached audit: ${(err as Error).message}`);
    } finally {
      setCacheLoading(false);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Export report
  // -----------------------------------------------------------------------

  const handleExportReport = useCallback(async () => {
    if (pages.length === 0) return;
    try {
      const res = await fetch("/api/export-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auditUrl: url || "Unknown URL",
          pages: pages.map((p) => ({
            url: p.url,
            title: p.title,
            screenshots: p.screenshots,
            issues: p.issues.map((i) => ({
              id: i.id,
              title: i.title,
              severity: i.severity,
              category: i.category,
              principle: i.heuristic,
              description: i.description,
              affected_element: i.affected_element,
              recommendation: i.recommendation,
              suggested_fix: i.suggested_fix,
              acceptance_criteria: i.acceptance_criteria,
              affected_viewports: i.affected_viewports,
              status: i.status,
            })),
          })),
        }),
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `ux-audit-report-${Date.now()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
    }
  }, [pages, url]);

  // -----------------------------------------------------------------------
  // Asana
  // -----------------------------------------------------------------------

  const handlePushToAsana = useCallback(async () => {
    const approvedIssues = pages.flatMap((p) => p.issues.filter((i) => i.status === "approved"));
    if (approvedIssues.length === 0) return;

    setIsPushingAsana(true);
    try {
      const res = await fetch("/api/asana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issues: approvedIssues.map((i) => ({
            id: i.id,
            title: i.title,
            description: i.description,
            severity: i.severity,
            category: i.category,
            principle: i.heuristic,
            affected_element: i.affected_element,
            steps_to_reproduce: i.steps_to_reproduce,
            suggested_fix: i.suggested_fix,
            acceptance_criteria: i.acceptance_criteria,
            affected_viewports: i.affected_viewports,
            recommendation: i.recommendation,
            ...(i.assignee ? { assignee: i.assignee } : {}),
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        created: { issueId: string | null; taskId: string; url: string }[];
        summary: { created: number; failed: number };
      };

      // Stamp the returned Asana permalink + task id onto each matching
      // issue so the UI can link the pin ↔ ticket in both directions.
      const urlByIssue = new Map<string, { url: string; taskId: string }>();
      for (const c of data.created) {
        if (c.issueId) urlByIssue.set(c.issueId, { url: c.url, taskId: c.taskId });
      }
      if (urlByIssue.size > 0) {
        setPages((prev) =>
          prev.map((p) => ({
            ...p,
            issues: p.issues.map((i) => {
              const m = urlByIssue.get(i.id);
              return m ? { ...i, asanaUrl: m.url, asanaTaskId: m.taskId } : i;
            }),
          })),
        );
      }

      alert(
        `Created ${data.summary.created} Asana ticket(s).` +
          (data.summary.failed > 0 ? ` ${data.summary.failed} failed.` : ""),
      );
    } catch (err) {
      alert(`Failed to push to Asana: ${(err as Error).message}`);
    } finally {
      setIsPushingAsana(false);
    }
  }, [pages]);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    // Core state
    url, setUrl,
    phase,
    pages,
    activeViewports, setActiveViewports,
    progressDetail,
    auditError, setAuditError,

    // Auth
    authState,
    handleStartInteractiveLogin,

    // Browser session (persistent profile)
    usePersistedSession, setUsePersistedSession,
    interactiveLogin, setInteractiveLogin,
    useRealChrome, setUseRealChrome,
    realChromeHeadless, setRealChromeHeadless,
    captureInteractions, setCaptureInteractions,
    clickSelectorsText, setClickSelectorsText,
    browserSession,
    hasPersistedSession,
    handleProceedAfterLogin,
    handleClearSession,

    // PRD context
    prdText, setPrdText,
    prdFileName, setPrdFileName,
    handleFileUpload, handleFileDrop,

    // Repo context
    repoUrl, setRepoUrl,
    repoContext,
    repoLoading,
    repoError, setRepoError,
    repoFileCount,
    handleFetchRepoContext,
    clearRepoContext,

    // Cookies
    cookieText, setCookieText,
    cookieError, setCookieError,
    parseCookieText,

    // Automated login credentials
    autoLoginEnabled, setAutoLoginEnabled,
    loginEmail, setLoginEmail,
    loginPassword, setLoginPassword,

    // Screenshot upload
    uploadedScreenshots, setUploadedScreenshots,
    handleScreenshotFiles,
    handleRemoveScreenshot,
    handleAnalyzeScreenshots,

    // Stitch
    stitchConnected,
    brandConfig, setBrandConfig,
    brandSaved,
    handleSaveBrand,
    activeScreenshotView, setActiveScreenshotView,

    // Issue CRUD
    handleUpdateIssue,
    handleRewriteIssue,
    handleGenerateFix,
    handleRefineFix,
    handleGenerateVariants,

    // Asana
    isPushingAsana,
    handlePushToAsana,

    // Audit
    handleRunAudit,
    resetAudit,

    // Cache
    cachedAudits,
    cacheLoading,
    loadFromCache,

    // Export
    handleExportReport,

    // Computed
    totalApproved,
    totalIssues,
    totalDismissed,
  };
}
