/**
 * Deterministic + LLM finding merge.
 *
 * Produces a single unified `UXIssue[]` the UI can render. Strategy:
 *  1. Convert axe + Lighthouse findings into UXIssue shape with `source`.
 *  2. Dedupe against LLM issues: when an LLM issue shares a selector AND a
 *     WCAG reference with an axe finding, we keep the axe one (authoritative)
 *     and fold the LLM's suggested_fix/recommendation into it so the
 *     LLM's prose enrichment isn't lost.
 *  3. Stable IDs are prefixed (`axe-*`, `lh-*`) by the source modules.
 */

import type { UXIssue, ViewportLabel } from "../analyzer";
import type { AxeFinding } from "./axe";
import type { LighthouseFinding } from "./lighthouse";
import type { DriftFinding } from "../tokens/compare";

// ---------------------------------------------------------------------------
// axe → UXIssue
// ---------------------------------------------------------------------------

/**
 * Collapse findings that repeat across viewports (same ruleId + selector).
 * axe runs per-viewport; most violations are viewport-independent (missing
 * alt text, bad contrast on desktop probably fails on mobile too). Instead
 * of emitting 3 identical tickets, we merge them and concatenate
 * affected_viewports. Keeps the highest severity.
 */
function dedupeAxeAcrossViewports(findings: AxeFinding[]): Array<AxeFinding & { viewports: ViewportLabel[] }> {
  const buckets = new Map<string, AxeFinding & { viewports: ViewportLabel[] }>();
  const severityRank: Record<AxeFinding["severity"], number> = { critical: 3, major: 2, minor: 1 };

  for (const f of findings) {
    const key = `${f.ruleId}::${f.selector}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...f, viewports: [f.viewport] });
    } else {
      if (!existing.viewports.includes(f.viewport)) existing.viewports.push(f.viewport);
      if (severityRank[f.severity] > severityRank[existing.severity]) {
        existing.severity = f.severity;
      }
      // accumulate affected node count across viewports for signal
      existing.affectedNodes = Math.max(existing.affectedNodes, f.affectedNodes);
    }
  }
  return Array.from(buckets.values());
}

function axeToUxIssue(finding: AxeFinding & { viewports: ViewportLabel[] }): UXIssue {
  return {
    id: finding.id,
    title: `[a11y] ${finding.help}`,
    severity: finding.severity,
    category: "accessibility",
    principle: finding.wcagRefs[0] ?? `axe-core: ${finding.ruleId}`,
    description: finding.description,
    affected_element: finding.snippet || finding.selector || "(unknown element)",
    steps_to_reproduce:
      `Open the page in the affected viewport(s) and inspect the element at \`${finding.selector}\`. ` +
      `axe-core flags ${finding.affectedNodes} node(s) violating rule "${finding.ruleId}".`,
    suggested_fix: finding.help,
    acceptance_criteria:
      `axe-core rule "${finding.ruleId}" passes on the affected element. ` +
      (finding.wcagRefs.length > 0 ? `Satisfies ${finding.wcagRefs.join(", ")}.` : ""),
    affected_viewports: finding.viewports,
    recommendation: `${finding.help} See ${finding.helpUrl}`,
    bounding_box: { x: 0, y: 0, width: 0, height: 0 },
    source: "axe",
    rule_id: finding.ruleId,
    element_selector: finding.selector,
    wcag_ref: finding.wcagRefs,
  };
}

// ---------------------------------------------------------------------------
// Lighthouse → UXIssue
// ---------------------------------------------------------------------------

function lighthouseCategoryToUxCategory(category: LighthouseFinding["category"]): UXIssue["category"] {
  if (category === "accessibility") return "accessibility";
  // perf / best-practices / seo all surface as usability for now — they
  // aren't "visual" or "responsive" in the UX audit framework sense.
  return "usability";
}

function viewportForLighthouse(v: LighthouseFinding["viewport"]): ViewportLabel {
  // Lighthouse only has mobile + desktop form factors; map 1:1 to our labels.
  return v === "mobile" ? "mobile" : "desktop";
}

function dedupeLighthouseAcrossViewports(
  findings: LighthouseFinding[],
): Array<LighthouseFinding & { viewports: ViewportLabel[] }> {
  const buckets = new Map<string, LighthouseFinding & { viewports: ViewportLabel[] }>();
  const severityRank: Record<LighthouseFinding["severity"], number> = { critical: 3, major: 2, minor: 1 };

  for (const f of findings) {
    const key = f.auditId;
    const mapped = viewportForLighthouse(f.viewport);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...f, viewports: [mapped] });
    } else {
      if (!existing.viewports.includes(mapped)) existing.viewports.push(mapped);
      if (severityRank[f.severity] > severityRank[existing.severity]) {
        existing.severity = f.severity;
        existing.score = f.score;
      }
    }
  }
  return Array.from(buckets.values());
}

function lighthouseToUxIssue(finding: LighthouseFinding & { viewports: ViewportLabel[] }): UXIssue {
  const category = lighthouseCategoryToUxCategory(finding.category);
  const principle = finding.wcagRefs[0]
    ?? (finding.category === "performance" ? "Lighthouse — Core Web Vitals"
      : finding.category === "best-practices" ? "Lighthouse — Best Practices"
        : finding.category === "seo" ? "Lighthouse — SEO"
          : "Lighthouse — Accessibility");

  return {
    id: `lh-${finding.auditId}`,
    title: `[${finding.category}] ${finding.title}`,
    severity: finding.severity,
    category,
    principle,
    description: finding.description,
    affected_element: "(page-level — see Lighthouse report)",
    steps_to_reproduce:
      `Run Lighthouse on the page at ${finding.viewports.join(" + ")} form factor; audit "${finding.auditId}" scores ${finding.score.toFixed(2)} (threshold: 0.9).`,
    suggested_fix: finding.title,
    acceptance_criteria: `Lighthouse audit "${finding.auditId}" scores ≥ 0.9.`,
    affected_viewports: finding.viewports,
    recommendation: finding.description,
    bounding_box: { x: 0, y: 0, width: 0, height: 0 },
    source: "lighthouse",
    rule_id: finding.auditId,
    ...(finding.wcagRefs.length > 0 && { wcag_ref: finding.wcagRefs }),
  };
}

// ---------------------------------------------------------------------------
// Dedup: drop LLM issues superseded by axe findings
// ---------------------------------------------------------------------------

function llmIssueMatchesAxe(llm: UXIssue, axe: UXIssue): boolean {
  if (axe.source !== "axe") return false;
  const selector = axe.element_selector;
  if (!selector) return false;
  // Selector overlap: LLM affected_element often contains HTML or selector text
  const selectorMatch =
    llm.affected_element?.toLowerCase().includes(selector.toLowerCase())
    || (llm as { element_selector?: string }).element_selector === selector;

  // WCAG overlap: either side references the same WCAG criterion
  const llmWcag = Array.from(
    new Set(
      [
        ...(llm.wcag_ref ?? []),
        ...(llm.principle ? [llm.principle] : []),
      ].map((s) => s.toLowerCase()),
    ),
  );
  const axeWcag = (axe.wcag_ref ?? []).map((s) => s.toLowerCase());
  const wcagMatch = axeWcag.some((w) => llmWcag.some((candidate) => candidate.includes(w)));

  return selectorMatch && wcagMatch;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MergeOptions {
  /** Screenshot filename to attach as `evidence_screenshot` on deterministic findings. */
  evidenceScreenshot?: string;
}

export function mergeFindings(
  llmIssues: UXIssue[],
  axeFindings: AxeFinding[],
  lighthouseFindings: LighthouseFinding[],
  tokenFindings: DriftFinding[] = [],
  opts: MergeOptions = {},
): UXIssue[] {
  const axeDedup = dedupeAxeAcrossViewports(axeFindings);
  const lhDedup = dedupeLighthouseAcrossViewports(lighthouseFindings);

  const axeIssues = axeDedup.map(axeToUxIssue).map((issue) => ({
    ...issue,
    ...(opts.evidenceScreenshot && { evidence_screenshot: opts.evidenceScreenshot }),
  }));
  const lhIssues = lhDedup.map(lighthouseToUxIssue).map((issue) => ({
    ...issue,
    ...(opts.evidenceScreenshot && { evidence_screenshot: opts.evidenceScreenshot }),
  }));
  // DriftFinding is shape-compatible with UXIssue — cast + attach evidence.
  const tokenIssues: UXIssue[] = tokenFindings.map((finding) => ({
    ...(finding as unknown as UXIssue),
    ...(opts.evidenceScreenshot && { evidence_screenshot: opts.evidenceScreenshot }),
  }));

  // Keep LLM issues that aren't superseded by an axe finding; merge the
  // LLM's recommendation into the matching axe finding as enrichment.
  const keptLlm: UXIssue[] = [];
  for (const llm of llmIssues) {
    const supersededBy = axeIssues.find((a) => llmIssueMatchesAxe(llm, a));
    if (supersededBy) {
      const merged = [supersededBy.recommendation, llm.recommendation].filter(Boolean).join("\n\n");
      supersededBy.recommendation = merged;
      if (llm.suggested_fix) {
        supersededBy.suggested_fix = [supersededBy.suggested_fix, llm.suggested_fix].filter(Boolean).join("\n\n");
      }
      continue;
    }
    keptLlm.push({ ...llm, source: llm.source ?? "llm" });
  }

  return [...axeIssues, ...lhIssues, ...tokenIssues, ...keptLlm];
}
