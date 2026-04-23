"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Eye,
  Globe,
  Loader2,
  CheckCircle2,
  Lock,
  Monitor,
  Settings2,
  RotateCcw,
} from "lucide-react";
import type { AuditPhase } from "@/types/audit";

/**
 * 48 px (+ progress rail) compact sticky status bar shown during and after
 * an audit. Replaces the full AuditForm header to reclaim vertical space
 * for the screenshot comparison + issue list.
 *
 * Shows:
 *  - VisiMind-style logo (clickable, routes home — currently resets via onReset)
 *  - The URL being audited
 *  - Live phase label + % progress (keeps SSE stream visible)
 *  - Approve/issue counters when phase === "done"
 *  - Settings trigger (opens SettingsDrawer)
 *  - New audit button (idle reset)
 */
export function StatusBar({
  url,
  phase,
  progressDetail,
  totalPages,
  totalIssues,
  totalApproved,
  totalDismissed,
  onOpenSettings,
  onReset,
}: {
  url: string;
  phase: AuditPhase;
  progressDetail: string;
  totalPages: number;
  totalIssues: number;
  totalApproved: number;
  totalDismissed: number;
  onOpenSettings: () => void;
  onReset: () => void;
}) {
  const phasePct: Record<AuditPhase, number> = {
    idle: 0,
    interactive_login: 10,
    sso_redirect: 15,
    crawling: 25,
    auth_required: 25,
    screenshotting: 55,
    analyzing: 80,
    done: 100,
  };

  const pct = phasePct[phase] ?? 0;
  const isDone = phase === "done";
  const isBlocked = phase === "auth_required" || phase === "sso_redirect";
  const isWorking = phase !== "idle" && phase !== "done" && !isBlocked;

  const statusIcon = isDone ? (
    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden="true" />
  ) : isBlocked ? (
    <Lock className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
  ) : phase === "interactive_login" ? (
    <Monitor className="w-3.5 h-3.5 text-blue-500" aria-hidden="true" />
  ) : (
    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" aria-hidden="true" />
  );

  const phaseLabel =
    progressDetail ||
    (isDone
      ? "Analysis complete"
      : phase === "auth_required"
        ? "Authentication required"
        : phase === "crawling"
          ? "Crawling…"
          : phase === "screenshotting"
            ? "Capturing screenshots…"
            : phase === "analyzing"
              ? "Analyzing…"
              : "Working…");

  return (
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border">
      <div className="h-12 px-4 sm:px-6 flex items-center gap-3">
        {/* Logo — click to reset to idle (acts as "home") */}
        <button
          type="button"
          onClick={onReset}
          aria-label="Start a new audit"
          className="flex items-center gap-2 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1 py-1 -mx-1 hover:opacity-80"
        >
          <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Eye className="w-3.5 h-3.5 text-primary-foreground" aria-hidden="true" />
          </span>
          <span className="hidden sm:inline text-sm font-semibold">UX Audit</span>
        </button>

        {/* URL pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 text-xs font-mono text-muted-foreground truncate min-w-0 max-w-[45%]">
          <Globe className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate" title={url}>{url || "—"}</span>
        </div>

        {/* Phase indicator — live region so SSE updates are announced */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center gap-2 text-xs text-foreground/80 min-w-0 flex-1"
        >
          {statusIcon}
          <span className="truncate">{phaseLabel}</span>
          {isWorking && (
            <span className="text-muted-foreground tabular-nums shrink-0">
              {pct}%
            </span>
          )}
        </div>

        {/* Done-state counters */}
        {isDone && (
          <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            <span>{totalPages} pages</span>
            <span className="text-foreground font-medium">{totalIssues} issues</span>
            <span className="text-green-600">{totalApproved} approved</span>
            <span className="text-gray-400">{totalDismissed} dismissed</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="h-9 px-2.5 text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
            Settings
          </Button>
          {isDone && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              className="h-9 px-2.5"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              New audit
            </Button>
          )}
        </div>
      </div>

      {/* Progress rail — 2px, sits inside the 48px bar visually but doesn't grow height */}
      {isWorking && (
        <div className="h-0.5 -mb-0.5">
          <Progress value={pct} className="h-0.5 rounded-none" />
        </div>
      )}
    </header>
  );
}
