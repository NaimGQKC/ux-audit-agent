"use client";

import { useState, useRef, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Loader2,
  Globe,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Upload,
  FileText,
  RefreshCw,
  ExternalLink,
  Cookie,
  Camera,
  Trash2,
  GitBranch,
  Wand2,
  CheckCircle2,
  Palette,
  Eye,
  EyeOff,
  Monitor,
  Trash,
  KeyRound,
  MousePointerClick,
  SlidersHorizontal,
} from "lucide-react";
import type { AuditPhase, UploadedScreenshot } from "@/types/audit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AuditForm — URL input + all config panels
// ---------------------------------------------------------------------------

export function AuditForm({
  // URL
  url, setUrl,
  phase,
  onRunAudit,
  // Stats
  pages,
  totalIssues,
  totalApproved,
  totalDismissed,
  // PRD
  prdText, setPrdText,
  prdFileName, setPrdFileName,
  onFileUpload, onFileDrop,
  // Repo
  repoUrl, setRepoUrl,
  repoContext,
  repoLoading,
  repoError, setRepoError,
  repoFileCount,
  onFetchRepoContext,
  onClearRepoContext,
  // Cookies
  cookieText, setCookieText,
  cookieError, setCookieError,
  parseCookieText,
  // Auto-login credentials
  autoLoginEnabled, setAutoLoginEnabled,
  loginEmail, setLoginEmail,
  loginPassword, setLoginPassword,
  // Screenshots
  uploadedScreenshots, setUploadedScreenshots,
  onScreenshotFiles, onRemoveScreenshot, onAnalyzeScreenshots,
  // Browser session
  usePersistedSession, setUsePersistedSession,
  interactiveLogin, setInteractiveLogin,
  useRealChrome, setUseRealChrome,
  realChromeHeadless, setRealChromeHeadless,
  hasPersistedSession,
  onClearSession,
  // Interaction capture
  captureInteractions, setCaptureInteractions,
  clickSelectorsText, setClickSelectorsText,
  // Stitch
  stitchConnected,
  brandConfig, setBrandConfig,
  brandSaved,
  onSaveBrand,
}: {
  url: string;
  setUrl: (v: string) => void;
  phase: AuditPhase;
  onRunAudit: () => void;
  pages: { url: string }[];
  totalIssues: number;
  totalApproved: number;
  totalDismissed: number;
  prdText: string;
  setPrdText: (v: string) => void;
  prdFileName: string | null;
  setPrdFileName: (v: string | null) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop: (e: React.DragEvent) => void;
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  repoContext: string;
  repoLoading: boolean;
  repoError: string | null;
  setRepoError: (v: string | null) => void;
  repoFileCount: number;
  onFetchRepoContext: () => void;
  onClearRepoContext: () => void;
  cookieText: string;
  setCookieText: (v: string) => void;
  cookieError: string | null;
  setCookieError: (v: string | null) => void;
  parseCookieText: (text: string) => Record<string, unknown>[] | null;
  autoLoginEnabled: boolean;
  setAutoLoginEnabled: (v: boolean) => void;
  loginEmail: string;
  setLoginEmail: (v: string) => void;
  loginPassword: string;
  setLoginPassword: (v: string) => void;
  uploadedScreenshots: UploadedScreenshot[];
  setUploadedScreenshots: React.Dispatch<React.SetStateAction<UploadedScreenshot[]>>;
  onScreenshotFiles: (files: FileList | File[]) => void;
  onRemoveScreenshot: (id: string) => void;
  onAnalyzeScreenshots: () => void;
  usePersistedSession: boolean;
  setUsePersistedSession: (v: boolean) => void;
  interactiveLogin: boolean;
  setInteractiveLogin: (v: boolean) => void;
  useRealChrome: boolean;
  setUseRealChrome: (v: boolean) => void;
  realChromeHeadless: boolean;
  setRealChromeHeadless: (v: boolean) => void;
  hasPersistedSession: boolean;
  onClearSession: () => void;
  captureInteractions: boolean;
  setCaptureInteractions: (v: boolean) => void;
  clickSelectorsText: string;
  setClickSelectorsText: (v: string) => void;
  stitchConnected: boolean;
  brandConfig: { primaryColor: string; secondaryColor: string; fontFamily: string; accentColor: string };
  setBrandConfig: React.Dispatch<React.SetStateAction<{ primaryColor: string; secondaryColor: string; fontFamily: string; accentColor: string }>>;
  brandSaved: boolean;
  onSaveBrand: () => void;
}) {
  // Local UI toggles
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [browserSessionOpen, setBrowserSessionOpen] = useState(false);
  const [prdOpen, setPrdOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const [autoLoginOpen, setAutoLoginOpen] = useState(false);
  const [screenshotUploadOpen, setScreenshotUploadOpen] = useState(false);
  const [interactionsOpen, setInteractionsOpen] = useState(false);
  const [brandSettingsOpen, setBrandSettingsOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // One-line summary of what's configured — shown on the collapsed "Advanced"
  // toggle so users can see active context at a glance without expanding.
  const activeHints: string[] = [];
  if (usePersistedSession) activeHints.push(interactiveLogin ? "interactive login" : "persistent session");
  if (captureInteractions || clickSelectorsText.trim()) activeHints.push("interactions");
  if (prdText) activeHints.push("PRD");
  if (repoContext) activeHints.push(`${repoFileCount} repo file${repoFileCount === 1 ? "" : "s"}`);
  if (cookieText) activeHints.push("cookies");
  if (autoLoginEnabled && loginEmail && loginPassword) activeHints.push("auto sign-in");
  if (uploadedScreenshots.length > 0) activeHints.push(`${uploadedScreenshots.length} screenshot${uploadedScreenshots.length === 1 ? "" : "s"}`);
  const advancedBadge = activeHints.length > 0 ? activeHints.join(" · ") : undefined;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  // Namespace form IDs so the same AuditForm can mount in the header AND the
  // SettingsDrawer without producing duplicate-ID warnings.
  const ids = useId();
  const urlId = `${ids}-audit-url`;
  const emailId = `${ids}-auto-login-email`;
  const passwordId = `${ids}-auto-login-password`;

  return (
    <>
      {/* Branding */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Eye className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">UX Audit Agent</h1>
            <p className="text-xs text-muted-foreground">Automated usability &amp; accessibility analysis</p>
          </div>
        </div>
        {phase === "done" && (
          <div className="hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
            <span>{pages.length} pages</span>
            <span className="text-foreground font-medium">{totalIssues} issues</span>
            <span className="text-green-600">{totalApproved} approved</span>
            <span className="text-gray-400">{totalDismissed} dismissed</span>
          </div>
        )}
      </div>

      {/* URL input */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 space-y-1">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id={urlId}
              type="url"
              aria-label="Website URL to audit"
              placeholder="Enter a URL to audit (e.g. https://example.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onRunAudit(); }}
              className={`pl-9 h-11 text-sm ${url.trim() && !isValidUrl(url) ? "border-red-500 focus-visible:ring-red-500/50" : ""}`}
            />
          </div>
          {url.trim() && !isValidUrl(url) && (
            <p className="text-xs text-red-600 flex items-center gap-1" role="alert">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              URL must start with https:// or http://
            </p>
          )}
        </div>
        <Button
          onClick={onRunAudit}
          disabled={!url.trim() || (phase !== "idle" && phase !== "done")}
          className="h-11 px-6"
        >
          {phase !== "idle" && phase !== "done" ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Search className="w-4 h-4 mr-2" />
          )}
          Run Audit
        </Button>
      </div>

      {/* Advanced options — single master toggle so the idle screen stays
          focused on the URL input. All config panels nest inside. */}
      <CollapsiblePanel
        open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}
        icon={<SlidersHorizontal className="w-4 h-4" />}
        title="Advanced options"
        badge={advancedBadge}
      >

      {/* Browser Session */}
      <CollapsiblePanel
        open={browserSessionOpen}
        onToggle={() => setBrowserSessionOpen(!browserSessionOpen)}
        icon={<Monitor className="w-4 h-4" />}
        title="Browser session & login"
        badge={usePersistedSession ? (interactiveLogin ? "interactive" : "on") : hasPersistedSession ? "saved" : undefined}
      >
        <label className="flex items-center gap-3 cursor-pointer pt-3">
          <input
            type="checkbox"
            checked={usePersistedSession}
            onChange={(e) => {
              setUsePersistedSession(e.target.checked);
              if (!e.target.checked) setInteractiveLogin(false);
            }}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="flex items-center gap-2 text-sm font-medium">
            <Monitor className="w-4 h-4 text-muted-foreground" />
            Use my browser session
          </span>
          {hasPersistedSession && (
            <Badge variant="secondary" className="text-[10px] text-green-700 border-green-300 bg-green-50">
              session saved
            </Badge>
          )}
        </label>
        {usePersistedSession && (
          <div className="pl-7 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <p className="text-xs text-muted-foreground">
              Preserves cookies, localStorage, and SSO tokens across audits using a persistent browser profile.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={interactiveLogin}
                onChange={(e) => {
                  setInteractiveLogin(e.target.checked);
                  if (!e.target.checked) setUseRealChrome(false);
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm text-muted-foreground">
                Interactive Login — open a visible browser to log in before crawling
              </span>
            </label>
            {interactiveLogin && (
              <div className="pl-7 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useRealChrome}
                    onChange={(e) => setUseRealChrome(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium">
                    Use my real Google Chrome profile
                  </span>
                </label>
                {useRealChrome && (
                  <div className="pl-7 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <p className="text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        Quit Chrome completely before running (check system tray / menu bar).
                        Your existing cookies &amp; SSO sessions will be used.
                      </span>
                    </p>
                    <fieldset className="flex items-center gap-4">
                      <legend className="sr-only">Chrome visibility</legend>
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name={`${ids}-real-chrome-mode`}
                          checked={!realChromeHeadless}
                          onChange={() => setRealChromeHeadless(false)}
                          className="h-3.5 w-3.5 text-primary focus:ring-primary"
                        />
                        <span>Headed (visible window)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name={`${ids}-real-chrome-mode`}
                          checked={realChromeHeadless}
                          onChange={() => setRealChromeHeadless(true)}
                          className="h-3.5 w-3.5 text-primary focus:ring-primary"
                        />
                        <span>Headless (background)</span>
                      </label>
                    </fieldset>
                  </div>
                )}
              </div>
            )}
            {hasPersistedSession && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-700 border-red-300 hover:bg-red-100"
                onClick={onClearSession}
              >
                <Trash className="w-3.5 h-3.5 mr-1.5" />
                Clear saved session
              </Button>
            )}
          </div>
        )}
      </CollapsiblePanel>

      {/* Interaction capture (tabs / clicks) */}
      <CollapsiblePanel
        open={interactionsOpen}
        onToggle={() => setInteractionsOpen(!interactionsOpen)}
        icon={<MousePointerClick className="w-4 h-4" />}
        title="Capture tabs & interactions"
        badge={captureInteractions ? (clickSelectorsText.trim() ? "tabs + custom" : "tabs") : "off"}
      >
        <p className="text-xs text-muted-foreground pt-3">
          For SPAs and dashboards with tab switchers or buttons that swap content without changing the URL. On the target page only, the crawler clicks each tab and captures it as an additional screenshot.
        </p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={captureInteractions}
            onChange={(e) => setCaptureInteractions(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium">
            Auto-detect tab controls (role=&quot;tab&quot;, tablists)
          </span>
        </label>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Extra CSS selectors to click (one per line)
          </label>
          <Textarea
            placeholder={'button:has-text("Settings")\n[data-testid="menu-toggle"]\n.nav-item.billing'}
            value={clickSelectorsText}
            onChange={(e) => setClickSelectorsText(e.target.value)}
            className="min-h-[80px] text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground/80">
            Clicked in order on the target page. Each click produces one extra screenshot. Capped at 10 captures total.
          </p>
        </div>
      </CollapsiblePanel>

      {/* Collapsible PRD section */}
      <CollapsiblePanel
        open={prdOpen}
        onToggle={() => setPrdOpen(!prdOpen)}
        icon={<FileText className="w-4 h-4" />}
        title="Project Context (PRD)"
        badge={prdText ? (prdFileName ?? "pasted") : undefined}
      >
        <p className="text-xs text-muted-foreground pt-3">
          Upload or paste your PRD to give the analysis additional context about product goals, user flows, and requirements.
        </p>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.docx"
            onChange={onFileUpload}
            className="hidden"
          />
          <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
          <p className="text-sm text-muted-foreground">Drop a file here or click to browse</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">.txt, .md, .pdf, or .docx</p>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Or paste PRD text directly</label>
            {prdText && (
              <button onClick={() => { setPrdText(""); setPrdFileName(null); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Clear
              </button>
            )}
          </div>
          <Textarea
            placeholder="Paste product requirements, user stories, acceptance criteria..."
            value={prdText}
            onChange={(e) => { setPrdText(e.target.value); if (!e.target.value) setPrdFileName(null); }}
            className="min-h-[100px] text-sm font-mono"
          />
        </div>
      </CollapsiblePanel>

      {/* GitHub Repository Context */}
      <CollapsiblePanel
        open={repoOpen}
        onToggle={() => setRepoOpen(!repoOpen)}
        icon={<GitBranch className="w-4 h-4" />}
        title="Repository Context (GitHub)"
        badge={repoContext ? `${repoFileCount} file${repoFileCount !== 1 ? "s" : ""} loaded` : undefined}
      >
        <p className="text-xs text-muted-foreground pt-3">
          Provide a GitHub repo URL to extract design system, project config, and CLAUDE.md for more targeted analysis.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => { setRepoUrl(e.target.value); setRepoError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") onFetchRepoContext(); }}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Button size="sm" variant="outline" onClick={onFetchRepoContext} disabled={!repoUrl.trim() || repoLoading}>
            {repoLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            {repoLoading ? "Fetching..." : "Fetch"}
          </Button>
        </div>
        {repoError && (
          <p className="text-xs text-red-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {repoError}
          </p>
        )}
        {repoContext && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-green-600">
                Loaded {repoFileCount} file{repoFileCount !== 1 ? "s" : ""} from repo
              </span>
              <button onClick={onClearRepoContext} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Clear
              </button>
            </div>
            <pre className="text-xs bg-muted/50 rounded p-2 max-h-[120px] overflow-auto font-mono text-muted-foreground whitespace-pre-wrap">
              {repoContext.slice(0, 500)}{repoContext.length > 500 ? "\n..." : ""}
            </pre>
          </div>
        )}
      </CollapsiblePanel>

      {/* Cookie Import */}
      <CollapsiblePanel
        open={cookiesOpen}
        onToggle={() => setCookiesOpen(!cookiesOpen)}
        icon={<Cookie className="w-4 h-4" />}
        title="Advanced: Import Cookies"
        badge={cookieText ? "configured" : undefined}
      >
        <p className="text-xs text-muted-foreground pt-3">
          Export cookies from your browser using EditThisCookie or similar extension, then paste the JSON array here. Cookies are kept in memory only and never saved to disk.
        </p>
        <Textarea
          placeholder='[{"name": "session", "value": "abc123", "domain": ".example.com", "path": "/"}]'
          value={cookieText}
          onChange={(e) => { setCookieText(e.target.value); setCookieError(null); }}
          className="min-h-[80px] text-sm font-mono"
        />
        {cookieError && (
          <p className="text-xs text-red-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {cookieError}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (cookieText.trim()) {
                const parsed = parseCookieText(cookieText);
                if (parsed) setCookieError(null);
                else setCookieError("Invalid cookie format. Paste a JSON array from EditThisCookie or similar.");
              }
            }}
            disabled={!cookieText.trim()}
          >
            <Cookie className="w-3.5 h-3.5 mr-1.5" />
            Validate Cookies
          </Button>
          {cookieText && (
            <button onClick={() => { setCookieText(""); setCookieError(null); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Clear
            </button>
          )}
        </div>
      </CollapsiblePanel>

      {/* Auto-login credentials */}
      <CollapsiblePanel
        open={autoLoginOpen}
        onToggle={() => setAutoLoginOpen(!autoLoginOpen)}
        icon={<KeyRound className="w-4 h-4" />}
        title="Auto Sign-In (email + password)"
        badge={autoLoginEnabled && loginEmail && loginPassword ? "enabled" : undefined}
      >
        <p className="text-xs text-muted-foreground pt-3">
          Optional. Provide test-account credentials and the crawler will try to sign in automatically
          (detects <code className="font-mono">input[type=email]</code> / <code className="font-mono">input[type=password]</code>).
          Credentials stay in memory for this session only — they are never saved to disk or logged.
        </p>
        <label className="flex items-center gap-3 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={autoLoginEnabled}
            onChange={(e) => setAutoLoginEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium">Use these credentials for this audit</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <label htmlFor={emailId} className="text-xs font-medium text-muted-foreground">
              Email / username
            </label>
            <Input
              id={emailId}
              type="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="test-user@example.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              disabled={!autoLoginEnabled}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={passwordId} className="text-xs font-medium text-muted-foreground">
              Password
            </label>
            <div className="relative">
              <Input
                id={passwordId}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                spellCheck={false}
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                disabled={!autoLoginEnabled}
                className="h-9 text-sm pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={!autoLoginEnabled}
                className="absolute right-0 top-0 h-9 w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md disabled:opacity-40"
              >
                {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
        {autoLoginEnabled && loginEmail && !loginPassword && (
          <p role="alert" className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            Password is required when auto sign-in is enabled.
          </p>
        )}
      </CollapsiblePanel>

      {/* Upload Screenshots */}
      <CollapsiblePanel
        open={screenshotUploadOpen}
        onToggle={() => setScreenshotUploadOpen(!screenshotUploadOpen)}
        icon={<Camera className="w-4 h-4" />}
        title="Advanced: Upload Screenshots"
        badge={uploadedScreenshots.length > 0 ? `${uploadedScreenshots.length} file${uploadedScreenshots.length !== 1 ? "s" : ""}` : undefined}
      >
        <p className="text-xs text-muted-foreground pt-3">
          Upload screenshots directly to skip the crawling step. Useful for pages behind VPN, hardware 2FA, or when you already have screenshots.
        </p>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length > 0) onScreenshotFiles(e.dataTransfer.files); }}
          onClick={() => screenshotInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
        >
          <input
            ref={screenshotInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            multiple
            onChange={(e) => { if (e.target.files && e.target.files.length > 0) onScreenshotFiles(e.target.files); e.target.value = ""; }}
            className="hidden"
          />
          <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
          <p className="text-sm text-muted-foreground">Drop screenshots here or click to browse</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">PNG, JPG, or WebP</p>
        </div>
        {uploadedScreenshots.length > 0 && (
          <div className="space-y-2">
            {uploadedScreenshots.map((ss) => (
              <div key={ss.id} className="flex items-center gap-3 p-2 rounded-lg border border-border bg-muted/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ss.preview} alt={ss.label} className="w-16 h-12 object-cover rounded border border-border" />
                <Input
                  placeholder="Page name or URL"
                  value={ss.label}
                  onChange={(e) => {
                    setUploadedScreenshots((prev) => prev.map((s) => (s.id === ss.id ? { ...s, label: e.target.value } : s)));
                  }}
                  className="flex-1 h-8 text-sm"
                />
                <Button size="sm" variant="ghost" onClick={() => onRemoveScreenshot(ss.id)} className="h-8 px-2 text-muted-foreground hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              onClick={onAnalyzeScreenshots}
              disabled={phase !== "idle" && phase !== "done"}
              className="h-9"
            >
              {phase === "analyzing" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1.5" />}
              Analyze {uploadedScreenshots.length} Screenshot{uploadedScreenshots.length !== 1 ? "s" : ""}
            </Button>
          </div>
        )}
      </CollapsiblePanel>

      {/* /Advanced options — close the master panel */}
      </CollapsiblePanel>

      {/* Stitch disconnected banner */}
      {!stitchConnected && phase === "done" && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-50 border border-violet-200 text-sm text-violet-700">
          <Wand2 className="w-4 h-4 shrink-0" />
          <span>Connect Google Stitch to generate visual fixes for issues</span>
          <a href="/stitch-setup" className="ml-auto text-xs font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1">
            Setup Guide
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Brand Settings */}
      {stitchConnected && (
        <div className="border border-violet-200 rounded-lg overflow-hidden bg-violet-50/30">
          <button
            onClick={() => setBrandSettingsOpen(!brandSettingsOpen)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Palette className="w-4 h-4" />
              Brand Settings
              {brandSaved && (
                <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">
                  <CheckCircle2 className="w-3 h-3 mr-0.5" />
                  Saved
                </Badge>
              )}
            </span>
            {brandSettingsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {brandSettingsOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-violet-200 animate-in fade-in slide-in-from-top-1 duration-200">
              <p className="text-xs text-muted-foreground pt-3">
                Configure your brand colors and typography so generated fixes match your design system.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  { key: "primaryColor", label: "Primary Color" },
                  { key: "secondaryColor", label: "Secondary Color" },
                  { key: "accentColor", label: "Accent Color" },
                ] as const).map(({ key, label }) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{label}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandConfig[key]}
                        onChange={(e) => setBrandConfig((c) => ({ ...c, [key]: e.target.value }))}
                        className="w-8 h-8 rounded border border-border cursor-pointer"
                      />
                      <Input
                        value={brandConfig[key]}
                        onChange={(e) => setBrandConfig((c) => ({ ...c, [key]: e.target.value }))}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </div>
                ))}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Font Family</label>
                  <select
                    value={brandConfig.fontFamily}
                    onChange={(e) => setBrandConfig((c) => ({ ...c, fontFamily: e.target.value }))}
                    className="w-full h-8 rounded border border-border bg-background px-2 text-xs"
                  >
                    <option value="Inter, system-ui, sans-serif">Inter</option>
                    <option value="Roboto, sans-serif">Roboto</option>
                    <option value="Open Sans, sans-serif">Open Sans</option>
                    <option value="Lato, sans-serif">Lato</option>
                    <option value="Poppins, sans-serif">Poppins</option>
                    <option value="Montserrat, sans-serif">Montserrat</option>
                    <option value="system-ui, sans-serif">System UI</option>
                    <option value="Georgia, serif">Georgia</option>
                  </select>
                </div>
              </div>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={onSaveBrand}>
                <Palette className="w-3.5 h-3.5 mr-1.5" />
                Save Brand Settings
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reusable collapsible panel
// ---------------------------------------------------------------------------

function CollapsiblePanel({
  open,
  onToggle,
  icon,
  title,
  badge,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
          {badge && (
            <Badge variant="secondary" className="text-[10px]">
              {badge}
            </Badge>
          )}
        </span>
        {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border animate-in fade-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}
