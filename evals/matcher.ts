/**
 * Matcher utility for the evals harness.
 *
 * Pure functions — no file I/O, no global state. The regression runner loads
 * `expected.json` files and calls these to score analyzer output. Keeping this
 * separate makes it straightforward to unit-test the matching logic without
 * invoking Playwright or Claude.
 */

import type { UXIssue } from "../src/lib/analyzer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "minor" | "major" | "critical";
export type Category = UXIssue["category"];

/** A single expectation — the analyzer must emit at least one matching issue. */
export interface Expectation {
  /** Optional category filter ("accessibility" | "usability" | "visual" | "responsive"). */
  category?: Category;
  /**
   * Case-insensitive substrings. A finding matches if ANY keyword is a
   * substring of the concatenated haystack (title + description + principle +
   * suggested_fix).
   */
  keyword_any: string[];
  /** Optional minimum severity threshold. Default: "minor" (no threshold). */
  min_severity?: Severity;
}

/** False-positive guard — findings that should NOT appear. */
export interface AntiExpectation {
  keyword_any: string[];
  category?: Category;
}

/** Shape of each golden case's expected.json. */
export interface ExpectedCase {
  url_or_file: string;
  description?: string;
  must_match: Expectation[];
  must_not_match?: AntiExpectation[];
}

/** Per-case scoring result. */
export interface CaseResult {
  passed: boolean;
  matched: Array<{ expectation: Expectation; finding: UXIssue }>;
  missing: Expectation[];
  falsePositives: Array<{ rule: AntiExpectation; finding: UXIssue }>;
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  minor: 1,
  major: 2,
  critical: 3,
};

function meetsSeverity(findingSev: UXIssue["severity"], min?: Severity): boolean {
  if (!min) return true;
  return SEVERITY_RANK[findingSev] >= SEVERITY_RANK[min];
}

// ---------------------------------------------------------------------------
// Core matcher
// ---------------------------------------------------------------------------

/**
 * Concatenate the fields a keyword match may hit, lowercased once.
 * Stable ordering so snapshots / debugging behave predictably.
 */
function buildHaystack(finding: UXIssue): string {
  return [
    finding.title,
    finding.description,
    finding.principle,
    finding.suggested_fix,
    // Optional fields — tolerate missing values by coercing to "".
    finding.recommendation ?? "",
    finding.affected_element ?? "",
    Array.isArray(finding.wcag_ref) ? finding.wcag_ref.join(" ") : "",
  ]
    .join(" \u0001 ") // rare separator, prevents words bleeding across fields
    .toLowerCase();
}

/**
 * Does any keyword in `keywords` appear as a case-insensitive substring of
 * the finding's searchable text?
 */
function keywordHit(finding: UXIssue, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const hay = buildHaystack(finding);
  return keywords.some((kw) => kw.trim().length > 0 && hay.includes(kw.trim().toLowerCase()));
}

/**
 * Does a single finding satisfy an expectation?
 * Exported for testability and for the runner's per-case reporting.
 */
export function matchesExpectation(finding: UXIssue, expectation: Expectation): boolean {
  if (expectation.category && finding.category !== expectation.category) return false;
  if (!meetsSeverity(finding.severity, expectation.min_severity)) return false;
  return keywordHit(finding, expectation.keyword_any);
}

function matchesAntiExpectation(finding: UXIssue, rule: AntiExpectation): boolean {
  if (rule.category && finding.category !== rule.category) return false;
  return keywordHit(finding, rule.keyword_any);
}

/**
 * Score a set of findings against a golden case's expectations.
 *
 * Rules:
 *  - A case `passed` iff every `must_match` is satisfied by at least one
 *    finding AND no `must_not_match` rule is triggered.
 *  - The same finding may satisfy multiple expectations (we don't need
 *    one-to-one coverage).
 */
export function scoreCase(findings: UXIssue[], expected: ExpectedCase): CaseResult {
  const matched: CaseResult["matched"] = [];
  const missing: Expectation[] = [];

  for (const expectation of expected.must_match) {
    const hit = findings.find((f) => matchesExpectation(f, expectation));
    if (hit) {
      matched.push({ expectation, finding: hit });
    } else {
      missing.push(expectation);
    }
  }

  const falsePositives: CaseResult["falsePositives"] = [];
  for (const rule of expected.must_not_match ?? []) {
    for (const f of findings) {
      if (matchesAntiExpectation(f, rule)) {
        falsePositives.push({ rule, finding: f });
      }
    }
  }

  return {
    passed: missing.length === 0 && falsePositives.length === 0,
    matched,
    missing,
    falsePositives,
  };
}
