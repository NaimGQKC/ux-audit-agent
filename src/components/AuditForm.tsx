"use client";

import { useState, useRef } from "react";
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
  Monitor,
  Trash,
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
  // Screenshots
  uploadedScreenshots, setUploadedScreenshots,
  onScreenshotFiles, onRemoveScreenshot, onAnalyzeScreenshots,
  // Browser session
  usePersistedSession, setUsePersistedSession,
  interactiveLogin, setInteractiveLogin,
  hasPersistedSession,
  onClearSession,
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
  uploadedScreenshots: UploadedScreenshot[];
  setUploadedScreenshots: React.Dispatch<React.SetStateAction<UploadedScreenshot[]>>;
  onScreenshotFiles: (files: FileList | File[]) => void;
  onRemoveScreenshot: (id: string) => void;
  onAnalyzeScreenshots: () => void;
  usePersistedSession: boolean;
  setUsePersistedSession: (v: boolean) => void;
  interactiveLogin: boolean;
  setInteractiveLogin: (v: boolean) => void;
  hasPersistedSession: boolean;
  onClearSession: () => void;
  stitchConnected: boolean;
  brandConfig: { primaryColor: string; secondaryColor: string; fontFamily: string; accentColor: string };
  setBrandConfig: React.Dispatch<React.SetStateAction<{ primaryColor: string; secondaryColor: string; fontFamily: string; accentColor: string }>>;
  brandSaved: boolean;
  onSaveBrand: () => void;
}) {
  // Local UI toggles
  const [prdOpen, setPrdOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const [screenshotUploadOpen, setScreenshotUploadOpen] = useState(false);
  const [brandSettingsOpen, setBrandSettingsOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

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
              id="audit-url"
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

      {/* Browser Session */}
      <div className="border border-border rounded-lg px-4 py-3 space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
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
                onChange={(e) => setInteractiveLogin(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm text-muted-foreground">
                Interactive Login — open a visible browser to log in before crawling
              </span>
            </label>
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
      </div>

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
