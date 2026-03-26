/**
 * Analyzer module — types and validation for UX analysis results.
 *
 * Analysis is performed by the Claude CLI (via analyze.sh or the
 * runClaudePrint helper) rather than through the Anthropic API directly.
 */

export type ViewportLabel = "mobile" | "tablet" | "desktop";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UXIssue {
  id: string;
  title: string;
  severity: "critical" | "major" | "minor";
  category: "accessibility" | "usability" | "visual" | "responsive";
  description: string;
  affected_element: string;
  steps_to_reproduce: string;
  suggested_fix: string;
  acceptance_criteria: string;
  affected_viewports: ViewportLabel[];
  recommendation: string;
  bounding_box: BoundingBox;
}

export interface AnalysisResult {
  issues: UXIssue[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(["critical", "major", "minor"]);
const VALID_CATEGORIES = new Set(["accessibility", "usability", "visual", "responsive"]);
const VALID_VIEWPORTS = new Set<string>(["mobile", "tablet", "desktop"]);

/**
 * Validate raw JSON data against the AnalysisResult schema.
 * Accepts either `{ issues: [...] }` (single-screenshot) or a pre-extracted
 * issues array-like object.
 */
export function validateAnalysisResult(data: unknown): AnalysisResult {
  if (typeof data !== "object" || data === null || !Array.isArray((data as Record<string, unknown>).issues)) {
    throw new Error("Invalid response structure: expected { issues: [...] }");
  }

  const { issues } = data as { issues: unknown[] };

  const validated: UXIssue[] = issues.map((issue, i) => {
    const item = issue as Record<string, unknown>;

    if (typeof item.id !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "id"`);
    }
    if (typeof item.title !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "title"`);
    }
    if (!VALID_SEVERITIES.has(item.severity as string)) {
      throw new Error(`Issue ${i}: invalid severity "${item.severity}"`);
    }
    if (!VALID_CATEGORIES.has(item.category as string)) {
      throw new Error(`Issue ${i}: invalid category "${item.category}"`);
    }
    if (typeof item.description !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "description"`);
    }
    if (typeof item.affected_element !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "affected_element"`);
    }
    if (typeof item.steps_to_reproduce !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "steps_to_reproduce"`);
    }
    if (typeof item.suggested_fix !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "suggested_fix"`);
    }
    if (typeof item.acceptance_criteria !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "acceptance_criteria"`);
    }
    if (typeof item.recommendation !== "string") {
      throw new Error(`Issue ${i}: missing or invalid "recommendation"`);
    }

    // affected_viewports: must be a non-empty array of valid viewport labels
    if (!Array.isArray(item.affected_viewports) || item.affected_viewports.length === 0) {
      throw new Error(`Issue ${i}: "affected_viewports" must be a non-empty array`);
    }
    const viewports = (item.affected_viewports as string[]).filter((v) =>
      VALID_VIEWPORTS.has(v)
    ) as ViewportLabel[];
    if (viewports.length === 0) {
      throw new Error(
        `Issue ${i}: "affected_viewports" contains no valid values (expected mobile | tablet | desktop)`
      );
    }

    const bb = item.bounding_box as Record<string, unknown> | undefined;
    if (!bb || typeof bb !== "object") {
      throw new Error(`Issue ${i}: missing or invalid "bounding_box"`);
    }
    if (typeof bb.x !== "number" || typeof bb.y !== "number" || typeof bb.width !== "number" || typeof bb.height !== "number") {
      throw new Error(`Issue ${i}: bounding_box must have numeric x, y, width, height`);
    }

    return {
      id: item.id,
      title: item.title,
      severity: item.severity as UXIssue["severity"],
      category: item.category as UXIssue["category"],
      description: item.description,
      affected_element: item.affected_element,
      steps_to_reproduce: item.steps_to_reproduce,
      suggested_fix: item.suggested_fix,
      acceptance_criteria: item.acceptance_criteria,
      affected_viewports: viewports,
      recommendation: item.recommendation,
      bounding_box: {
        x: bb.x,
        y: bb.y,
        width: bb.width,
        height: bb.height,
      },
    };
  });

  return { issues: validated };
}
