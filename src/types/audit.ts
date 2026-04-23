import type { ViewportName } from "@/lib/crawler";
import type { UXIssue } from "@/lib/analyzer";
import type { FixStatus, GenerateFixResult } from "@/lib/stitch/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueStatus = "pending" | "approved" | "dismissed";

export interface PreviousVersion {
  title: string;
  description: string;
  recommendation: string;
}

export interface AuditIssue extends UXIssue {
  heuristic: string;
  assignee: string;
  status: IssueStatus;
  editPromptOpen: boolean;
  editPrompt: string;
  isRewriting: boolean;
  previousVersion: PreviousVersion | null;
  fix?: GenerateFixResult;
  variants?: GenerateFixResult[];
  fixStatus: FixStatus;
  fixError?: string;
  refinePrompt: string;
  refinePromptOpen: boolean;
  asanaUrl?: string;
  asanaTaskId?: string;
}

export interface PageAudit {
  url: string;
  title: string;
  issues: AuditIssue[];
  screenshots: Record<ViewportName, string>;
}

export type AuditPhase =
  | "idle"
  | "crawling"
  | "screenshotting"
  | "analyzing"
  | "done"
  | "auth_required"
  | "interactive_login"  // headed browser open, waiting for user
  | "sso_redirect";      // SSO redirect detected, browser open for login

export interface AuthState {
  authUrl: string;
  screenshot: string; // base64 PNG
  sessionId: string | null;
  status: "waiting" | "browser_open" | "polling" | "authenticated" | "error";
  error?: string;
}

/** State for the "Use my browser session" / interactive login flow. */
export interface BrowserSessionState {
  sessionId: string | null;
  status: "idle" | "browser_open" | "ready" | "proceeding" | "sso_polling";
  redirectUrl?: string;
}

export interface UploadedScreenshot {
  id: string;
  file: File;
  preview: string; // object URL for preview
  label: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toAuditIssue(issue: UXIssue): AuditIssue {
  return {
    ...issue,
    heuristic: issue.principle || issue.category,
    assignee: "",
    status: "pending",
    editPromptOpen: false,
    editPrompt: "",
    isRewriting: false,
    previousVersion: null,
    fix: undefined,
    variants: undefined,
    fixStatus: "none" as FixStatus,
    fixError: undefined,
    refinePrompt: "",
    refinePromptOpen: false,
  };
}

// Severity rank — lower = more severe. Used to order issues + number pins
// so the user sees critical findings first and pin #1 is the worst offender.
const SEVERITY_RANK: Record<UXIssue["severity"], number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

export function sortBySeverity<T extends { severity: UXIssue["severity"] }>(
  issues: T[],
): T[] {
  return [...issues].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

// ---------------------------------------------------------------------------
// Severity style maps
// ---------------------------------------------------------------------------

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  major: "bg-orange-500",
  minor: "bg-yellow-400",
};

export const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-red-500",
  major: "border-orange-500",
  minor: "border-yellow-500",
};

export const SEVERITY_OVERLAY: Record<string, string> = {
  critical: "border-red-500 bg-red-500/15",
  major: "border-orange-500 bg-orange-500/15",
  minor: "border-yellow-400 bg-yellow-400/15",
};

export const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  major: "bg-orange-100 text-orange-800 border-orange-200",
  minor: "bg-yellow-100 text-yellow-800 border-yellow-200",
};

// ---------------------------------------------------------------------------
// Viewport dimensions
// ---------------------------------------------------------------------------

export const VIEWPORT_DIMENSIONS: Record<ViewportName, { w: number; h: number }> = {
  mobile: { w: 375, h: 812 },
  tablet: { w: 768, h: 1024 },
  desktop: { w: 1440, h: 900 },
};
