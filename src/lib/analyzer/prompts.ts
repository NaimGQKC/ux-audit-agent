/**
 * System prompts for Claude-based UX analysis.
 *
 * Prompt text lives in .txt files alongside this module so that both
 * TypeScript code and the analyze.sh shell script share a single source.
 */

import fs from "node:fs";
import path from "node:path";

const PROMPTS_DIR = path.join(process.cwd(), "src", "lib", "analyzer");

export const UX_ANALYSIS_SYSTEM_PROMPT = fs.readFileSync(
  path.join(PROMPTS_DIR, "ux-analysis-prompt.txt"),
  "utf-8",
);

/**
 * Build the full analysis prompt, optionally prepending PRD context so
 * Claude evaluates the UI against actual product requirements.
 */
export function buildSystemPrompt(prdContext?: string): string {
  if (!prdContext) {
    return UX_ANALYSIS_SYSTEM_PROMPT;
  }

  return [
    "PROJECT CONTEXT:",
    prdContext,
    "",
    "Use the project context above to evaluate the UI against the actual product requirements and goals — not just generic heuristics. Flag issues where the implementation diverges from the stated requirements. When the PRD specifies expected behavior, reference it in your acceptance_criteria.",
    "",
    UX_ANALYSIS_SYSTEM_PROMPT,
  ].join("\n");
}

export const ISSUE_REWRITE_SYSTEM_PROMPT = fs.readFileSync(
  path.join(PROMPTS_DIR, "rewrite-prompt.txt"),
  "utf-8",
);
