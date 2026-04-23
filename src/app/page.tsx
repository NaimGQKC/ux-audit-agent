"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Search,
  Loader2,
  ArrowUpToLine,
  Globe,
  AlertTriangle,
  X,
  Download,
  RefreshCw,
} from "lucide-react";
import type { ViewportName } from "@/lib/crawler";
import type { AuditIssue } from "@/types/audit";
import { useAudit } from "@/hooks/useAudit";
import { AuditForm } from "@/components/AuditForm";
import { IssueCard } from "@/components/IssueCard";
import { ScreenshotViewer, ViewportToggle } from "@/components/ScreenshotViewer";
import { AuditProgressBar, AuthRequiredPanel, InteractiveLoginPanel } from "@/components/AuditProgress";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { StatusBar } from "@/components/StatusBar";

export default function DashboardPage() {
  const audit = useAudit();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null);
  // When revealIssue triggers a scroll we briefly flash the target
  // (pin or card) by piggy-backing on hoveredIssueId. A ref tracks the
  // active timer so rapid clicks don't clobber each other.
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Zen Mode" collapses the input header once the audit starts or completes,
  // giving the main area (screenshots + issues) the full viewport width.
  const collapsed = audit.phase !== "idle";

  // Reset the audit to idle so the user can start a new run.
  const handleReset = () => {
    audit.resetAudit();
    setSettingsOpen(false);
    setHoveredIssueId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Scroll to the pin or card DOM node for a given issue and briefly
  // highlight it (pulse via hoveredIssueId). Using data-* selectors keeps
  // this decoupled from the IssueCard/AnnotatedScreenshot components.
  //
  // Pins center in the viewport (so the surrounding screenshot stays in
  // context); cards snap to the top so the Asana link, fix panel, and
  // approve/edit buttons sit above the fold for one-glance action.
  // scroll-margin-top on the Card offsets the 48 px sticky StatusBar.
  const revealIssue = useCallback(
    (issueId: string, target: "pin" | "card") => {
      const selector =
        target === "pin"
          ? `[data-pin="${CSS.escape(issueId)}"]`
          : `[data-issue-card="${CSS.escape(issueId)}"]`;
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: target === "card" ? "start" : "center",
        });
      }
      setHoveredIssueId(issueId);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      revealTimerRef.current = setTimeout(() => {
        setHoveredIssueId((prev) => (prev === issueId ? null : prev));
        revealTimerRef.current = null;
      }, 2200);
    },
    [],
  );

  // Clicking a pin always routes to the card: the card already surfaces the
  // Asana "Open" button, the Stitch fix, and the approve/edit controls, so
  // one click lands the user on every action they might take.
  const handlePinClick = useCallback(
    (issue: AuditIssue) => revealIssue(issue.id, "card"),
    [revealIssue],
  );

  const handleRevealPin = useCallback(
    (issueId: string) => revealIssue(issueId, "pin"),
    [revealIssue],
  );

  const auditForm = (
    <AuditForm
      url={audit.url}
      setUrl={audit.setUrl}
      phase={audit.phase}
      onRunAudit={() => audit.handleRunAudit()}
      pages={audit.pages}
      totalIssues={audit.totalIssues}
      totalApproved={audit.totalApproved}
      totalDismissed={audit.totalDismissed}
      prdText={audit.prdText}
      setPrdText={audit.setPrdText}
      prdFileName={audit.prdFileName}
      setPrdFileName={audit.setPrdFileName}
      onFileUpload={audit.handleFileUpload}
      onFileDrop={audit.handleFileDrop}
      repoUrl={audit.repoUrl}
      setRepoUrl={audit.setRepoUrl}
      repoContext={audit.repoContext}
      repoLoading={audit.repoLoading}
      repoError={audit.repoError}
      setRepoError={audit.setRepoError}
      repoFileCount={audit.repoFileCount}
      onFetchRepoContext={audit.handleFetchRepoContext}
      onClearRepoContext={audit.clearRepoContext}
      cookieText={audit.cookieText}
      setCookieText={audit.setCookieText}
      cookieError={audit.cookieError}
      setCookieError={audit.setCookieError}
      parseCookieText={audit.parseCookieText}
      autoLoginEnabled={audit.autoLoginEnabled}
      setAutoLoginEnabled={audit.setAutoLoginEnabled}
      loginEmail={audit.loginEmail}
      setLoginEmail={audit.setLoginEmail}
      loginPassword={audit.loginPassword}
      setLoginPassword={audit.setLoginPassword}
      uploadedScreenshots={audit.uploadedScreenshots}
      setUploadedScreenshots={audit.setUploadedScreenshots}
      onScreenshotFiles={audit.handleScreenshotFiles}
      onRemoveScreenshot={audit.handleRemoveScreenshot}
      onAnalyzeScreenshots={audit.handleAnalyzeScreenshots}
      usePersistedSession={audit.usePersistedSession}
      setUsePersistedSession={audit.setUsePersistedSession}
      interactiveLogin={audit.interactiveLogin}
      setInteractiveLogin={audit.setInteractiveLogin}
      useRealChrome={audit.useRealChrome}
      setUseRealChrome={audit.setUseRealChrome}
      realChromeHeadless={audit.realChromeHeadless}
      setRealChromeHeadless={audit.setRealChromeHeadless}
      hasPersistedSession={audit.hasPersistedSession}
      onClearSession={audit.handleClearSession}
      captureInteractions={audit.captureInteractions}
      setCaptureInteractions={audit.setCaptureInteractions}
      clickSelectorsText={audit.clickSelectorsText}
      setClickSelectorsText={audit.setClickSelectorsText}
      stitchConnected={audit.stitchConnected}
      brandConfig={audit.brandConfig}
      setBrandConfig={audit.setBrandConfig}
      brandSaved={audit.brandSaved}
      onSaveBrand={audit.handleSaveBrand}
      projects={audit.projects}
      selectedProjectId={audit.selectedProjectId}
      selectedProject={audit.selectedProject}
      projectMode={audit.projectMode}
      newProjectName={audit.newProjectName}
      setNewProjectName={audit.setNewProjectName}
      newProjectStandardsDoc={audit.newProjectStandardsDoc}
      setNewProjectStandardsDoc={audit.setNewProjectStandardsDoc}
      editStandardsDoc={audit.editStandardsDoc}
      setEditStandardsDoc={audit.setEditStandardsDoc}
      projectError={audit.projectError}
      projectSaving={audit.projectSaving}
      onProjectSelectChange={audit.handleProjectSelectChange}
      onCreateProject={audit.handleCreateProject}
      onCancelNewProject={audit.handleCancelNewProject}
      onStartEditProject={audit.handleStartEditProject}
      onSaveEditProject={audit.handleSaveEditProject}
      onCancelEditProject={audit.handleCancelEditProject}
    />
  );

  return (
    <div className="min-h-screen bg-background font-[family-name:var(--font-geist-sans)]">
      {/* Skip to main content — WCAG 2.4.1 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-foreground focus:text-background focus:rounded-md"
      >
        Skip to main content
      </a>

      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* Idle   : full hero w/ AuditForm                                  */}
      {/* Active : compact 48 px StatusBar + slide-over settings           */}
      {/* ================================================================ */}
      {collapsed ? (
        <StatusBar
          url={audit.url}
          phase={audit.phase}
          progressDetail={audit.progressDetail}
          totalPages={audit.pages.length}
          totalIssues={audit.totalIssues}
          totalApproved={audit.totalApproved}
          totalDismissed={audit.totalDismissed}
          onOpenSettings={() => setSettingsOpen(true)}
          onReset={handleReset}
        />
      ) : (
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-4xl mx-auto px-6 py-4 space-y-4">
            {auditForm}

            {/* Error banner (idle-only: error surfaces elsewhere when collapsed) */}
            {audit.auditError && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Audit failed: {audit.auditError}</span>
                <button
                  onClick={() => audit.setAuditError(null)}
                  aria-label="Dismiss error"
                  className="ml-auto text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Cached audits notice */}
            {audit.cachedAudits.length > 0 && audit.phase === "idle" && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
                <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
                  {audit.cachedAudits.length} previous audit{audit.cachedAudits.length > 1 ? "s" : ""} found for this URL
                </p>
                <div className="flex flex-wrap gap-2">
                  {audit.cachedAudits.slice(0, 3).map((ca) => (
                    <Button
                      key={ca.id}
                      variant="outline"
                      size="sm"
                      disabled={audit.cacheLoading}
                      onClick={() => audit.loadFromCache(ca.id)}
                      className="text-xs border-blue-300 dark:border-blue-700"
                    >
                      {audit.cacheLoading ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      {new Date(ca.timestamp).toLocaleDateString()}{" "}
                      {new Date(ca.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      <span className="ml-1 text-muted-foreground">
                        ({ca.pageCount} pg, {ca.issueCount} issues)
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>
      )}

      {/* Auth / Interactive login panels — floating below header in either mode */}
      {(audit.authState && audit.phase === "auth_required") ||
      audit.phase === "interactive_login" ||
      audit.phase === "sso_redirect" ? (
        <div className="max-w-5xl mx-auto px-6 pt-4 space-y-4">
          {audit.authState && audit.phase === "auth_required" && (
            <AuthRequiredPanel
              authState={audit.authState}
              onStartLogin={audit.handleStartInteractiveLogin}
            />
          )}
          <InteractiveLoginPanel
            browserSession={audit.browserSession}
            phase={audit.phase}
            onProceed={audit.handleProceedAfterLogin}
          />
        </div>
      ) : null}

      {/* Collapsed-mode inline error banner */}
      {collapsed && audit.auditError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-2 mx-4 sm:mx-6 mt-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Audit failed: {audit.auditError}</span>
          <button
            onClick={() => audit.setAuditError(null)}
            aria-label="Dismiss error"
            className="ml-auto text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Progress (detailed) — only in expanded idle mode; StatusBar covers collapsed */}
      {!collapsed && (
        <div className="max-w-4xl mx-auto px-6">
          <AuditProgressBar phase={audit.phase} detail={audit.progressDetail} />
        </div>
      )}

      {/* ================================================================ */}
      {/* MAIN — page-by-page review                                       */}
      {/* ================================================================ */}
      <main
        id="main-content"
        className={
          collapsed
            ? "w-full px-4 sm:px-6 py-6 space-y-12 min-h-[70vh]"
            : "max-w-6xl mx-auto px-6 py-8 space-y-12"
        }
      >
        {/* Empty state */}
        {audit.phase === "idle" && (
          <div className="text-center py-24 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <Search className="w-7 h-7 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold">Enter a URL to get started</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              We&apos;ll crawl every page, capture screenshots at three viewports, and analyze them against Nielsen heuristics and WCAG guidelines.
            </p>
          </div>
        )}

        {/* Loading state */}
        {audit.phase !== "idle" &&
          audit.phase !== "done" &&
          audit.phase !== "auth_required" &&
          audit.phase !== "interactive_login" &&
          audit.phase !== "sso_redirect" &&
          audit.pages.length === 0 && (
            <div className="text-center py-24 space-y-3">
              <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground">
                Analyzing <span className="text-foreground font-medium">{audit.url}</span>&hellip;
              </p>
            </div>
          )}

        {/* Page sections */}
        {audit.pages.map((page) => {
          const viewport = (audit.activeViewports[page.url] ?? "desktop") as ViewportName;
          const screenshotView = audit.activeScreenshotView[page.url] ?? "original";

          // Pin numbers are assigned across ALL issues with a bounding_box,
          // including dismissed ones, so dismissing a pin in the middle of
          // the list doesn't silently renumber the rest (pin #3 should stay
          // pin #3 — gaps are preferable to shifts). Dismissed issues still
          // receive a number so the card label stays referenceable, but
          // AnnotatedScreenshot filters them out of the rendered pins.
          const pinNumberById = new Map<string, number>();
          let nextPin = 0;
          for (const issue of page.issues) {
            if (issue.bounding_box) {
              pinNumberById.set(issue.id, ++nextPin);
            }
          }

          return (
            <section key={page.url} className="space-y-6">
              {/* Page header */}
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    {page.title}
                  </h2>
                  <p className="text-sm text-muted-foreground font-mono">{page.url}</p>
                </div>
                <ViewportToggle
                  active={viewport}
                  onChange={(v) => audit.setActiveViewports((prev) => ({ ...prev, [page.url]: v }))}
                />
              </div>

              {/* Screenshots */}
              <ScreenshotViewer
                page={page}
                viewport={viewport}
                activeView={screenshotView}
                onViewChange={(view) => audit.setActiveScreenshotView((prev) => ({ ...prev, [page.url]: view }))}
                hoveredIssueId={hoveredIssueId}
                onPinClick={handlePinClick}
                fullHeight={collapsed}
              />

              {/* Issue cards */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Issues ({page.issues.length})
                </h3>
                <div className="grid gap-3">
                  {page.issues.map((issue) => (
                    <div
                      key={issue.id}
                      onMouseEnter={() => setHoveredIssueId(issue.id)}
                      onMouseLeave={() =>
                        setHoveredIssueId((prev) => (prev === issue.id ? null : prev))
                      }
                      onFocus={() => setHoveredIssueId(issue.id)}
                      onBlur={() =>
                        setHoveredIssueId((prev) => (prev === issue.id ? null : prev))
                      }
                    >
                      <IssueCard
                        issue={issue}
                        pinNumber={pinNumberById.get(issue.id)}
                        onRevealPin={handleRevealPin}
                        onUpdate={(id, patch) => audit.handleUpdateIssue(page.url, id, patch)}
                        onRewrite={audit.handleRewriteIssue}
                        prdContext={audit.prdText}
                        onGenerateFix={audit.handleGenerateFix}
                        onRefineFix={audit.handleRefineFix}
                        onGenerateVariants={audit.handleGenerateVariants}
                        stitchConnected={audit.stitchConnected}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border" />
            </section>
          );
        })}
      </main>

      {/* ================================================================ */}
      {/* FOOTER — Push to Asana                                           */}
      {/* ================================================================ */}
      {audit.phase === "done" && (
        <footer className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-20">
          <div className={collapsed ? "w-full px-4 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-3" : "max-w-6xl mx-auto px-6 py-4 flex items-center justify-between"}>
            <p className="text-sm text-muted-foreground">
              {audit.totalApproved > 0 ? (
                <>
                  <span className="text-green-600 font-medium">{audit.totalApproved}</span>{" "}
                  issue{audit.totalApproved !== 1 ? "s" : ""} approved and ready to push
                </>
              ) : (
                "Approve at least one issue to push to Asana"
              )}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={audit.handleExportReport}
                className="h-10 px-5"
              >
                <Download className="w-4 h-4 mr-2" />
                Export Report
              </Button>
              <Button
                onClick={audit.handlePushToAsana}
                disabled={audit.totalApproved === 0 || audit.isPushingAsana}
                className="h-10 px-6"
              >
                {audit.isPushingAsana ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ArrowUpToLine className="w-4 h-4 mr-2" />
                )}
                {audit.isPushingAsana
                  ? "Pushing..."
                  : `Push ${audit.totalApproved > 0 ? `${audit.totalApproved} ` : ""}approved to Asana`}
              </Button>
            </div>
          </div>
        </footer>
      )}

      {/* Zen-Mode settings drawer */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        {auditForm}
      </SettingsDrawer>
    </div>
  );
}
