/**
 * Stitch integration types — shared across API routes and dashboard UI.
 *
 * Google Stitch is a remote MCP-based UI generation service that produces
 * visual fix mockups for UX issues discovered by the audit pipeline.
 */

import type { UXIssue } from "@/lib/analyzer";

// Re-export for convenience
export type { UXIssue };

// ---------------------------------------------------------------------------
// Stitch core types
// ---------------------------------------------------------------------------

export interface StitchProject {
  id: string;
  name: string;
  createdAt: string;
}

export interface StitchScreen {
  id: string;
  name: string;
  imageUrl: string;
  projectId: string;
}

export interface DesignTokens {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  spacing: Record<string, number>;
}

export interface StitchDesignSystem {
  id: string;
  name: string;
  tokens: DesignTokens;
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

export interface GenerateFixRequest {
  projectId: string;
  issueTitle: string;
  issueDescription: string;
  recommendation: string;
  severity: string;
  category: string;
  originalScreenshotContext?: string;
  designSystemId?: string;
}

export interface GenerateFixResult {
  screenId: string;
  imageUrl: string;
  prompt: string;
}

export interface GenerateVariantsRequest {
  projectId: string;
  screenIds: string[];
  prompt: string;
  count: number;
}

export interface EditScreenRequest {
  projectId: string;
  screenIds: string[];
  prompt: string;
}

// ---------------------------------------------------------------------------
// Extended issue type with fix state (used by the dashboard)
// ---------------------------------------------------------------------------

export type FixStatus = "none" | "generating" | "generated" | "refined" | "error";

export interface UXIssueWithFix extends UXIssue {
  fix?: GenerateFixResult;
  variants?: GenerateFixResult[];
  fixStatus: FixStatus;
  fixError?: string;
}
