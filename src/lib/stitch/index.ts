/**
 * Stitch MCP client — wraps Google Stitch calls via `claude --print`.
 *
 * Each function constructs a prompt instructing Claude to use Stitch MCP tools,
 * then shells out to `claude -p` to execute. This keeps the integration at zero
 * additional API cost (uses the user's Claude Code subscription).
 */

import { runClaudePrint } from "@/lib/claude";
import type {
  StitchProject,
  StitchDesignSystem,
  DesignTokens,
  GenerateFixRequest,
  GenerateFixResult,
  GenerateVariantsRequest,
  EditScreenRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runClaude(prompt: string): Promise<string> {
  return runClaudePrint(prompt, { label: "stitch" });
}

/**
 * Parse JSON from Claude's response, stripping markdown code fences if present.
 */
function parseJSON<T>(raw: string): T {
  let cleaned = raw.trim();
  // Strip ```json ... ``` fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  // Also strip any leading non-JSON text (e.g. "Here is the result:")
  const jsonStart = cleaned.search(/[{\[]/);
  if (jsonStart > 0) {
    cleaned = cleaned.slice(jsonStart);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(
      `[stitch] Failed to parse JSON: ${(err as Error).message}\nRaw response (first 500 chars): ${raw.slice(0, 500)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new Stitch project for this audit session.
 */
export async function initProject(auditUrl: string): Promise<StitchProject> {
  const domain = new URL(auditUrl).hostname;
  const timestamp = new Date().toISOString().slice(0, 10);
  const projectName = `UX Audit Fix — ${domain} — ${timestamp}`;

  const prompt = `Use the Stitch MCP tool create_project to create a new project titled "${projectName}". Return only the JSON response with fields: id, name, createdAt.`;

  console.log("[stitch] initProject prompt:", prompt);
  const raw = await runClaude(prompt);
  console.log("[stitch] initProject response:", raw);

  return parseJSON<StitchProject>(raw);
}

/**
 * Create or update the design system in Stitch.
 */
export async function setupDesignSystem(
  projectId: string,
  tokens: DesignTokens
): Promise<StitchDesignSystem> {
  const prompt = `Use the Stitch MCP tool create_design_system to create a design system for project "${projectId}" with the following tokens:

Colors: ${JSON.stringify(tokens.colors)}
Fonts: ${JSON.stringify(tokens.fonts)}
Spacing: ${JSON.stringify(tokens.spacing)}

Return only the JSON response with fields: id, name, tokens.`;

  console.log("[stitch] setupDesignSystem prompt:", prompt);
  const raw = await runClaude(prompt);
  console.log("[stitch] setupDesignSystem response:", raw);

  return parseJSON<StitchDesignSystem>(raw);
}

/**
 * Generate a visual fix mockup for a UX issue.
 */
export async function generateFix(
  req: GenerateFixRequest
): Promise<GenerateFixResult> {
  const prompt = `Generate a UI screen that fixes the following UX issue:

Issue: ${req.issueTitle}
Problem: ${req.issueDescription}
Recommended fix: ${req.recommendation}
Severity: ${req.severity}
Category: ${req.category}
${req.originalScreenshotContext ? `Original context: ${req.originalScreenshotContext}` : ""}
${req.designSystemId ? `Design system ID: ${req.designSystemId}` : ""}

Use the Stitch MCP tool generate_screen_from_text with projectId "${req.projectId}" and modelId "GEMINI_3_1_PRO".
Return the screen details as JSON with fields: screenId, imageUrl, prompt.`;

  console.log("[stitch] generateFix prompt:", prompt);
  const raw = await runClaude(prompt);
  console.log("[stitch] generateFix response:", raw);

  return parseJSON<GenerateFixResult>(raw);
}

/**
 * Refine an existing screen with a follow-up prompt.
 */
export async function editScreen(
  req: EditScreenRequest
): Promise<GenerateFixResult> {
  const prompt = `Use the Stitch MCP tool edit_screens to edit screens [${req.screenIds.map((s) => `"${s}"`).join(", ")}] in project "${req.projectId}" with the following instruction:

"${req.prompt}"

Return the updated screen details as JSON with fields: screenId, imageUrl, prompt.`;

  console.log("[stitch] editScreen prompt:", prompt);
  const raw = await runClaude(prompt);
  console.log("[stitch] editScreen response:", raw);

  return parseJSON<GenerateFixResult>(raw);
}

/**
 * Generate multiple variant fix mockups.
 */
export async function generateVariants(
  req: GenerateVariantsRequest
): Promise<GenerateFixResult[]> {
  const prompt = `Use the Stitch MCP tool generate_variants to create ${req.count} variants of screens [${req.screenIds.map((s) => `"${s}"`).join(", ")}] in project "${req.projectId}" with the following prompt:

"${req.prompt}"

Return an array of screen details, each with fields: screenId, imageUrl, prompt.`;

  console.log("[stitch] generateVariants prompt:", prompt);
  const raw = await runClaude(prompt);
  console.log("[stitch] generateVariants response:", raw);

  return parseJSON<GenerateFixResult[]>(raw);
}

/**
 * Retrieve the image URL for a generated screen.
 */
export async function getScreenImage(screenName: string): Promise<string> {
  const prompt = `Use the Stitch MCP tool get_screen to retrieve the screen named "${screenName}". Return only the image URL as a plain string (no JSON wrapping).`;

  console.log("[stitch] getScreenImage prompt:", prompt);
  const raw = await runClaude(prompt);
  console.log("[stitch] getScreenImage response:", raw);

  // The response should be a plain URL, but strip quotes if wrapped
  return raw.replace(/^["']|["']$/g, "");
}
