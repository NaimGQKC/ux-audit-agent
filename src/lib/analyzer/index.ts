/**
 * Analyzer module — Claude Vision analysis of screenshots.
 *
 * Responsibilities:
 *  - Send screenshots to Claude Vision API
 *  - Evaluate against Nielsen's 10 usability heuristics
 *  - Evaluate against WCAG 2.1 AA guidelines
 *  - Return structured issue reports with severity, location, and recommendations
 */

export interface UXIssue {
  id: string;
  heuristic: string;
  severity: "critical" | "major" | "minor" | "suggestion";
  description: string;
  recommendation: string;
  viewport: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}
