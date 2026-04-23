/**
 * Drift detector — compares extracted page tokens (`./extract.ts`) against a
 * reference design system (`./systems`) and emits findings shaped like
 * `UXIssue` (see src/lib/analyzer/index.ts) so the viewer / exporter can
 * render them alongside LLM and axe findings.
 *
 * Findings are site-wide rather than per-element: the detector doesn't know
 * which DOM node produced each outlier. `affected_element` is set to
 * "Site-wide" and `bounding_box` is zeroed — consumers can special-case.
 *
 * Contrast is intentionally out of scope — axe owns color-contrast checks.
 */
import type { ExtractedTokens, TokenCount } from "./extract";
import { pxValue } from "./extract";
import type { DesignSystemRef } from "./systems";

export type DriftSeverity = "critical" | "major" | "minor";

export interface DriftFinding {
  id: string;
  ruleId: string;
  title: string;
  severity: DriftSeverity;
  category: "visual";
  principle: string;
  description: string;
  suggested_fix: string;
  recommendation: string;
  affected_element: string;
  steps_to_reproduce: string;
  acceptance_criteria: string;
  affected_viewports: ["desktop"];
  bounding_box: { x: 0; y: 0; width: 0; height: 0 };
  source: "tokens";
  rule_id: string;
}

export interface DetectDriftOptions {
  /** Allowed px delta when matching extracted values to system values. */
  tolerancePx?: number;
}

/** Caps to keep the findings panel readable. */
const MAX_SPACING_FINDINGS = 5;
const MAX_RADIUS_FINDINGS = 5;
const DEFAULT_TOLERANCE_PX = 1;
/** Type-scale discipline: >8 distinct sizes on one screen is excessive. */
const TYPE_SCALE_LIMIT = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO_BOX = { x: 0 as const, y: 0 as const, width: 0 as const, height: 0 as const };

function nearestPx(values: number[], target: number): number {
  let best = Infinity;
  for (const v of values) {
    const d = Math.abs(v - target);
    if (d < best) best = d;
  }
  return best;
}

function numericPxList(tokens: TokenCount[]): { value: string; px: number; count: number }[] {
  return tokens
    .map((t) => ({ value: t.value, px: pxValue(t.value), count: t.count }))
    .filter((t) => Number.isFinite(t.px));
}

let idCounter = 0;
function finding(partial: {
  ruleId: string;
  title: string;
  severity: DriftSeverity;
  principle: string;
  description: string;
  suggested_fix: string;
  recommendation: string;
  acceptance_criteria: string;
}): DriftFinding {
  idCounter += 1;
  return {
    id: `tokens-${partial.ruleId}-${idCounter}`,
    ruleId: partial.ruleId,
    rule_id: partial.ruleId,
    title: partial.title,
    severity: partial.severity,
    category: "visual",
    principle: partial.principle,
    description: partial.description,
    suggested_fix: partial.suggested_fix,
    recommendation: partial.recommendation,
    affected_element: "Site-wide",
    steps_to_reproduce:
      "Open the audited page in a browser, inspect computed styles across components, and review the set of distinct design-token values in use.",
    acceptance_criteria: partial.acceptance_criteria,
    affected_viewports: ["desktop"],
    bounding_box: ZERO_BOX,
    source: "tokens",
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function detectDrift(
  extracted: ExtractedTokens,
  system: DesignSystemRef,
  opts: DetectDriftOptions = {}
): DriftFinding[] {
  const tolerance = opts.tolerancePx ?? DEFAULT_TOLERANCE_PX;
  idCounter = 0;
  const findings: DriftFinding[] = [];

  // -------------------------------------------------------------------------
  // Rule: orphan font-sizes
  // (used exactly once AND not within tolerance of any system font-size)
  // -------------------------------------------------------------------------
  const fontSizes = numericPxList(extracted.typography.fontSizes);
  for (const fs of fontSizes) {
    if (fs.count !== 1) continue;
    if (nearestPx(system.tokens.fontSizes, fs.px) <= tolerance) continue;
    findings.push(
      finding({
        ruleId: "orphan-font-size",
        title: `Orphan font-size: ${fs.value}`,
        severity: "minor",
        principle: "Typography & Spacing — type scale discipline",
        description: `Font-size ${fs.value} is used on exactly one element and does not match any ${system.name} type-scale step (closest is ${Math.round(
          nearestPx(system.tokens.fontSizes, fs.px)
        )}px away). One-off sizes erode the type scale and accrue as visual debt.`,
        suggested_fix: `Snap this element to the nearest ${system.name} size (options: ${system.tokens.fontSizes
          .slice(0, 8)
          .map((n) => `${n}px`)
          .join(", ")}…) or justify it as a documented exception.`,
        recommendation: `Replace ${fs.value} with the nearest token from the ${system.name} type scale.`,
        acceptance_criteria: `No font-size value appears on only a single element unless it maps to a ${system.name} type-scale token.`,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Rule: excessive type scale (> TYPE_SCALE_LIMIT unique sizes)
  // -------------------------------------------------------------------------
  if (fontSizes.length > TYPE_SCALE_LIMIT) {
    findings.push(
      finding({
        ruleId: "excessive-type-scale",
        title: `Excessive type scale: ${fontSizes.length} distinct font-sizes`,
        severity: "major",
        principle: "Typography & Spacing — type scale discipline",
        description: `The page uses ${fontSizes.length} distinct font-sizes. A disciplined type scale should fit within ~${TYPE_SCALE_LIMIT} steps (${system.name} defines ${system.tokens.fontSizes.length}). Too many sizes fragment hierarchy and force the reader to re-assess importance on every block.`,
        suggested_fix: `Consolidate onto the ${system.name} scale (${system.tokens.fontSizes
          .map((n) => `${n}px`)
          .join(", ")}). Audit headings, body, captions, and UI labels to reuse the same tokens.`,
        recommendation: `Reduce to ${TYPE_SCALE_LIMIT} or fewer font-sizes drawn from a single scale.`,
        acceptance_criteria: `The rendered page uses no more than ${TYPE_SCALE_LIMIT} distinct font-sizes, all drawn from the ${system.name} type scale.`,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Rule: non-standard spacing
  // (value that isn't a multiple of the system's base unit), capped at 5.
  // -------------------------------------------------------------------------
  const spacing = numericPxList(extracted.spacing);
  const base = system.baseUnit;
  const offGrid = spacing.filter((s) => {
    if (s.px === 0) return false;
    // Exact system value — always fine (covers fractional cases like GOV.UK's 5).
    if (system.tokens.spacing.includes(s.px)) return false;
    // Off-grid if not divisible by the base unit (tolerance ≤ 0.5px rounding).
    const mod = Math.abs(s.px) % base;
    return !(mod < 0.5 || mod > base - 0.5);
  });
  // Largest unique values surface first (they're the most visually disruptive).
  offGrid.sort((a, b) => b.count - a.count || a.px - b.px);
  for (const s of offGrid.slice(0, MAX_SPACING_FINDINGS)) {
    findings.push(
      finding({
        ruleId: "off-grid-spacing",
        title: `Off-grid spacing: ${s.value}`,
        severity: "minor",
        principle: "Gestalt — alignment & proximity (spacing rhythm)",
        description: `Spacing value ${s.value} is not a multiple of the ${system.name} ${base}px base unit. Used on ${s.count} element(s). Off-grid spacing breaks vertical rhythm and makes layouts feel inconsistent, even when each individual value looks fine.`,
        suggested_fix: `Round to the nearest ${base}px step (${system.name} scale: ${system.tokens.spacing
          .slice(0, 10)
          .map((n) => `${n}px`)
          .join(", ")}…).`,
        recommendation: `Replace ${s.value} with the nearest ${base}px multiple.`,
        acceptance_criteria: `All margin/padding/gap values are multiples of ${base}px (the ${system.name} base unit) or an explicit documented exception.`,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Rule: radius drift
  // (radius not within 2px of any system radius), capped at 5.
  // -------------------------------------------------------------------------
  const RADIUS_TOLERANCE = 2;
  const radii = numericPxList(extracted.radius).filter((r) => r.px > 0);
  const radiusDrift = radii.filter(
    (r) => nearestPx(system.tokens.radius, r.px) > RADIUS_TOLERANCE
  );
  radiusDrift.sort((a, b) => b.count - a.count || a.px - b.px);
  for (const r of radiusDrift.slice(0, MAX_RADIUS_FINDINGS)) {
    findings.push(
      finding({
        ruleId: "radius-drift",
        title: `Non-standard border-radius: ${r.value}`,
        severity: "minor",
        principle: "Visual consistency — shape scale",
        description: `Border-radius ${r.value} (used on ${r.count} element(s)) is more than ${RADIUS_TOLERANCE}px away from any ${system.name} shape-scale value. Inconsistent corner radii make components feel authored by different designers.`,
        suggested_fix: `Snap to the nearest ${system.name} radius (${system.tokens.radius
          .map((n) => `${n}px`)
          .join(", ")}).`,
        recommendation: `Replace ${r.value} with the nearest ${system.name} shape-scale token.`,
        acceptance_criteria: `Every non-zero border-radius matches a ${system.name} shape-scale token within ${RADIUS_TOLERANCE}px.`,
      })
    );
  }

  // -------------------------------------------------------------------------
  // NOTE: Contrast-fail colors are NOT checked here. axe-core's
  // `color-contrast` rule already runs per viewport in the crawler and emits
  // proper WCAG 1.4.3 findings with element selectors. Duplicating it here
  // would produce site-wide, non-actionable dupes.
  // -------------------------------------------------------------------------

  return findings;
}
