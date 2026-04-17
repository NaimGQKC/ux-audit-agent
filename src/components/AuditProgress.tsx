"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Loader2,
  Lock,
  ExternalLink,
  Monitor,
} from "lucide-react";
import type { AuditPhase, AuthState, BrowserSessionState } from "@/types/audit";

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

export function AuditProgressBar({
  phase,
  detail,
}: {
  phase: AuditPhase;
  detail?: string;
}) {
  const phases: { key: AuditPhase; pct: number }[] = [
    { key: "interactive_login", pct: 10 },
    { key: "sso_redirect", pct: 15 },
    { key: "crawling", pct: 25 },
    { key: "auth_required", pct: 25 },
    { key: "screenshotting", pct: 55 },
    { key: "analyzing", pct: 80 },
    { key: "done", pct: 100 },
  ];

  if (phase === "idle") return null;

  const current = phases.find((p) => p.key === phase) ?? phases[0];
  const label =
    detail ||
    (phase === "done"
      ? "Analysis complete"
      : phase === "auth_required"
        ? "Authentication required"
        : phase === "interactive_login"
          ? "Waiting for login..."
          : phase === "sso_redirect"
            ? "SSO redirect — complete login in the browser"
            : "Working...");

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          {phase === "done" ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : phase === "auth_required" || phase === "sso_redirect" ? (
            <Lock className="w-4 h-4 text-amber-500" />
          ) : phase === "interactive_login" ? (
            <Monitor className="w-4 h-4 text-blue-500" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          )}
          {label}
        </span>
        <span className="text-muted-foreground">{current.pct}%</span>
      </div>
      <Progress value={current.pct} className="h-2" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth required panel
// ---------------------------------------------------------------------------

export function AuthRequiredPanel({
  authState,
  onStartLogin,
}: {
  authState: AuthState;
  onStartLogin: () => void;
}) {
  return (
    <div className="border-2 border-amber-300 rounded-lg bg-amber-50/50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <h3 className="font-semibold text-amber-900">
            This page requires authentication
          </h3>
          <p className="text-sm text-amber-800">
            Click below to open a browser window where you can log in. Once
            authenticated, we&apos;ll continue the audit automatically.
          </p>
        </div>
      </div>

      {authState.screenshot && (
        <div className="rounded-lg border border-amber-200 overflow-hidden max-w-md mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${authState.screenshot}`}
            alt="Login page"
            className="w-full h-auto"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        {authState.status === "waiting" && (
          <Button
            onClick={onStartLogin}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Log In
          </Button>
        )}
        {authState.status === "browser_open" && (
          <Button disabled className="bg-amber-600 text-white">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Opening browser...
          </Button>
        )}
        {authState.status === "polling" && (
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            Browser opened — complete your login there. Waiting for you...
          </div>
        )}
        {authState.status === "authenticated" && (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 className="w-4 h-4" />
            Authenticated! Resuming audit...
          </div>
        )}
        {authState.status === "error" && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-600">
              Error: {authState.error}
            </span>
            <Button size="sm" variant="outline" onClick={onStartLogin}>
              Retry
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-amber-600">
        URL: <span className="font-mono">{authState.authUrl}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interactive login panel — "I'm logged in, start crawling" button
// ---------------------------------------------------------------------------

export function InteractiveLoginPanel({
  browserSession,
  phase,
  onProceed,
}: {
  browserSession: BrowserSessionState;
  phase: AuditPhase;
  onProceed: () => void;
}) {
  if (phase !== "interactive_login" && phase !== "sso_redirect") return null;

  return (
    <div className="border-2 border-blue-300 rounded-lg bg-blue-50/50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start gap-3">
        <Monitor className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <h3 className="font-semibold text-blue-900">
            {phase === "sso_redirect"
              ? "SSO redirect detected"
              : "Browser opened for login"}
          </h3>
          <p className="text-sm text-blue-800">
            {phase === "sso_redirect"
              ? "You were redirected to an SSO provider. Complete your login in the browser window — we\u2019ll detect when you\u2019re back and continue automatically."
              : "A browser window has opened at your target URL. If you can\u2019t see it, check your taskbar (it may be behind a fullscreen app). Log in there, then click the button below. You have up to 15 minutes."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {phase === "interactive_login" && browserSession.status === "ready" && (
          <Button
            onClick={onProceed}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            I&apos;m logged in, start crawling
          </Button>
        )}
        {browserSession.status === "proceeding" && (
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            Extracting session and starting crawl...
          </div>
        )}
        {phase === "sso_redirect" && (
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for you to complete SSO login...
          </div>
        )}
      </div>

      {browserSession.redirectUrl && (
        <p className="text-xs text-blue-600">
          Redirected to: <span className="font-mono">{browserSession.redirectUrl}</span>
        </p>
      )}
    </div>
  );
}
