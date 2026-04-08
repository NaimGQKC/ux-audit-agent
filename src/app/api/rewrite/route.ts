import { NextRequest, NextResponse } from "next/server";
import { type UXIssue } from "@/lib/analyzer";
import { ISSUE_REWRITE_SYSTEM_PROMPT } from "@/lib/analyzer/prompts";
import { runClaudePrint } from "@/lib/claude";

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

interface RewriteRequestBody {
  issue: UXIssue;
  instruction: string;
  prdContext?: string;
  repoContext?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(["critical", "major", "minor"]);
const VALID_CATEGORIES = new Set(["accessibility", "usability", "visual", "responsive"]);
const VALID_VIEWPORTS = new Set(["mobile", "tablet", "desktop"]);

function isValidIssue(v: unknown): v is UXIssue {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string") return false;
  if (typeof o.title !== "string") return false;
  if (!VALID_SEVERITIES.has(o.severity as string)) return false;
  if (!VALID_CATEGORIES.has(o.category as string)) return false;
  if (typeof o.description !== "string") return false;
  if (typeof o.affected_element !== "string") return false;
  if (typeof o.steps_to_reproduce !== "string") return false;
  if (typeof o.suggested_fix !== "string") return false;
  if (typeof o.acceptance_criteria !== "string") return false;
  if (!Array.isArray(o.affected_viewports) || !o.affected_viewports.every((v: unknown) => VALID_VIEWPORTS.has(v as string))) return false;
  if (typeof o.recommendation !== "string") return false;
  const bb = o.bounding_box as Record<string, unknown> | undefined;
  if (!bb || typeof bb !== "object") return false;
  if (
    typeof bb.x !== "number" ||
    typeof bb.y !== "number" ||
    typeof bb.width !== "number" ||
    typeof bb.height !== "number"
  )
    return false;
  return true;
}

function validateRewrittenIssue(data: unknown, originalId: string): UXIssue {
  if (typeof data !== "object" || data === null) {
    throw new Error("Response is not a JSON object");
  }

  const o = data as Record<string, unknown>;

  // Enforce the original id so the model can't change it
  o.id = originalId;

  if (!isValidIssue(o)) {
    throw new Error(
      "Rewritten issue has invalid structure. Expected { id, title, severity, category, description, affected_element, steps_to_reproduce, suggested_fix, acceptance_criteria, affected_viewports, recommendation, bounding_box }."
    );
  }

  return {
    id: o.id,
    title: o.title,
    severity: o.severity,
    category: o.category,
    principle: typeof o.principle === "string" ? o.principle : o.category,
    description: o.description,
    affected_element: o.affected_element,
    steps_to_reproduce: o.steps_to_reproduce,
    suggested_fix: o.suggested_fix,
    acceptance_criteria: o.acceptance_criteria,
    affected_viewports: o.affected_viewports,
    recommendation: o.recommendation,
    bounding_box: {
      x: o.bounding_box.x,
      y: o.bounding_box.y,
      width: o.bounding_box.width,
      height: o.bounding_box.height,
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: RewriteRequestBody;
  try {
    body = (await request.json()) as RewriteRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.issue || !isValidIssue(body.issue)) {
    return NextResponse.json(
      {
        error:
          "Invalid or missing 'issue'. Expected { id, title, severity, category, description, affected_element, steps_to_reproduce, suggested_fix, acceptance_criteria, affected_viewports, recommendation, bounding_box }.",
      },
      { status: 400 }
    );
  }

  if (!body.instruction || typeof body.instruction !== "string" || body.instruction.trim() === "") {
    return NextResponse.json(
      { error: "Missing or empty 'instruction' string." },
      { status: 400 }
    );
  }

  if (body.prdContext !== undefined && typeof body.prdContext !== "string") {
    return NextResponse.json(
      { error: "'prdContext' must be a string if provided." },
      { status: 400 }
    );
  }

  // Build prompt: system instructions + issue + user instruction
  let prompt = `${ISSUE_REWRITE_SYSTEM_PROMPT}\n\n---\n\n`;
  prompt += `## Current issue\n\`\`\`json\n${JSON.stringify(body.issue, null, 2)}\n\`\`\`\n\n`;
  prompt += `## Instruction\n${body.instruction}`;

  if (body.prdContext) {
    prompt += `\n\n## Product requirements context\n${body.prdContext}`;
  }

  if (body.repoContext) {
    prompt += `\n\n## Repository context\nThe following files are from the project's GitHub repository. Reference design tokens, component names, or config values in your recommendations where relevant.\n\n${body.repoContext}`;
  }

  // Call Claude CLI
  let rawOutput: string;
  try {
    rawOutput = await runClaudePrint(prompt);
  } catch (err) {
    return NextResponse.json(
      { error: `Claude CLI error: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  // Parse JSON response (strip code fences if present)
  const jsonText = rawOutput
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?\s*```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return NextResponse.json(
      { error: "Claude returned invalid JSON", raw: rawOutput },
      { status: 502 }
    );
  }

  let rewritten: UXIssue;
  try {
    rewritten = validateRewrittenIssue(parsed, body.issue.id);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, raw: parsed },
      { status: 502 }
    );
  }

  return NextResponse.json({ issue: rewritten });
}
