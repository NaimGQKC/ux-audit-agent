/**
 * axe-core accessibility scanning wrapped around Playwright pages.
 *
 * Runs on the already-navigated page (crawler integration) and produces a
 * normalized finding shape the merge layer can unify with Lighthouse + LLM
 * results. Failures are non-fatal to the caller — the returned array is
 * simply empty if axe can't run.
 */

import type { Page } from "playwright";
import type { ViewportName } from "../crawler";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AxeSeverity = "critical" | "major" | "minor";

export interface AxeFinding {
  /** Stable per-finding ID (prefixed `axe-`). */
  id: string;
  /** Rule identifier from axe (e.g. "color-contrast"). */
  ruleId: string;
  /** WCAG references extracted from axe tags (e.g. ["WCAG 1.4.3"]). */
  wcagRefs: string[];
  severity: AxeSeverity;
  /** CSS selector for the first affected node. */
  selector: string;
  /** HTML snippet for the first affected node. */
  snippet: string;
  /** Axe docs URL for the rule. */
  helpUrl: string;
  /** Human-readable rule description. */
  description: string;
  /** "help" text — short recommendation from axe. */
  help: string;
  /** Number of nodes impacted by this violation on this viewport. */
  affectedNodes: number;
  viewport: ViewportName;
}

// ---------------------------------------------------------------------------
// Impact → severity mapping
// ---------------------------------------------------------------------------

type AxeImpact = "critical" | "serious" | "moderate" | "minor" | null | undefined;

function mapImpactToSeverity(impact: AxeImpact): AxeSeverity {
  switch (impact) {
    case "critical":
      return "critical";
    case "serious":
    case "moderate":
      return "major";
    case "minor":
    default:
      return "minor";
  }
}

// ---------------------------------------------------------------------------
// Tag → WCAG reference extraction
// ---------------------------------------------------------------------------

/**
 * axe tags look like `wcag2aa`, `wcag143`, `wcag412`, etc. The `wcag\d+`
 * tags encode a success criterion (e.g. `wcag143` = 1.4.3). Convert those
 * into `WCAG X.Y.Z` display refs.
 */
function extractWcagRefs(tags: string[]): string[] {
  const refs = new Set<string>();
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (m) {
      refs.add(`WCAG ${m[1]}.${m[2]}.${m[3]}`);
    }
  }
  return Array.from(refs);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run axe-core against the current page, scoped to the given viewport.
 *
 * Never throws — returns `[]` if axe fails to inject or analyse so a crawler
 * slot never loses its screenshot over an a11y scan error.
 */
export async function runAxe(page: Page, viewport: ViewportName): Promise<AxeFinding[]> {
  try {
    // Dynamic import so environments without the dep installed (e.g. CI that
    // skipped dev deps) don't break module load.
    const { default: AxeBuilder } = await import("@axe-core/playwright");

    const results = await new AxeBuilder({ page })
      .withTags([
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa",
        "best-practice",
      ])
      .analyze();

    const findings: AxeFinding[] = [];
    for (const violation of results.violations) {
      const firstNode = violation.nodes[0];
      const selector = firstNode
        ? (Array.isArray(firstNode.target) ? firstNode.target.join(" ") : String(firstNode.target))
        : "";
      const snippet = firstNode?.html ?? "";
      const wcagRefs = extractWcagRefs(violation.tags ?? []);
      findings.push({
        id: `axe-${viewport}-${violation.id}-${findings.length}`,
        ruleId: violation.id,
        wcagRefs,
        severity: mapImpactToSeverity(violation.impact as AxeImpact),
        selector,
        snippet,
        helpUrl: violation.helpUrl,
        description: violation.description,
        help: violation.help,
        affectedNodes: violation.nodes.length,
        viewport,
      });
    }
    return findings;
  } catch (err) {
    console.warn(`  ⚠ axe failed on ${viewport}: ${(err as Error).message}`);
    return [];
  }
}
