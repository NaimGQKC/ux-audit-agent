/**
 * Programmatic Lighthouse runner — launches Chrome via chrome-launcher and
 * collects perf/a11y/best-practices/SEO category results.
 *
 * Failures are non-fatal: if Chrome can't launch (e.g. in a sandboxed
 * environment without a real Chrome install) the function returns an empty
 * findings list and warns, never throws.
 */

import type { LaunchedChrome } from "chrome-launcher";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LighthouseCategory = "performance" | "accessibility" | "best-practices" | "seo";
export type LighthouseViewport = "mobile" | "desktop";
export type LighthouseSeverity = "critical" | "major" | "minor";

export interface LighthouseFinding {
  /** Stable per-finding ID (prefixed `lh-`). */
  id: string;
  /** Lighthouse audit id (e.g. "color-contrast", "largest-contentful-paint"). */
  auditId: string;
  category: LighthouseCategory;
  title: string;
  description: string;
  /** 0..1 audit score (may be null for informational audits — we skip those). */
  score: number;
  severity: LighthouseSeverity;
  /** WCAG refs extracted from audit metadata (populated for a11y audits). */
  wcagRefs: string[];
  viewport: LighthouseViewport;
}

export interface LighthouseFindings {
  findings: LighthouseFinding[];
  /** Overall category scores (0..100), useful for top-level summary. */
  categoryScores: Partial<Record<LighthouseCategory, number>>;
  /** True if Chrome couldn't launch and the run was skipped. */
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SCORE_THRESHOLD = 0.9;

function mapScoreToSeverity(score: number): LighthouseSeverity {
  if (score < 0.5) return "critical";
  if (score < 0.75) return "major";
  return "minor";
}

/**
 * Lighthouse a11y audits embed WCAG references either as tags on the audit
 * itself or as `wcag2a`-style strings in a dedicated `metricSavings`/`tags`
 * field. Upstream shape is loose, so be defensive.
 */
function extractWcagRefs(audit: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  // Lighthouse a11y audits sometimes carry `relevantAudits`/`tags` arrays
  const tagSources: unknown[] = [];
  if (Array.isArray(audit.tags)) tagSources.push(...audit.tags);
  if (Array.isArray((audit as { wcagTags?: unknown[] }).wcagTags))
    tagSources.push(...((audit as { wcagTags: unknown[] }).wcagTags));

  for (const raw of tagSources) {
    if (typeof raw !== "string") continue;
    const m = /^wcag(\d)(\d)(\d+)$/.exec(raw);
    if (m) refs.add(`WCAG ${m[1]}.${m[2]}.${m[3]}`);
  }
  return Array.from(refs);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunLighthouseOptions {
  viewport: LighthouseViewport;
}

/**
 * Run Lighthouse programmatically for a single URL at a given form factor.
 *
 * Opens its own Chrome instance via chrome-launcher (Lighthouse will not
 * reuse the Playwright browser). Skips gracefully if Chrome is unavailable.
 */
export async function runLighthouse(
  url: string,
  opts: RunLighthouseOptions,
): Promise<LighthouseFindings> {
  const empty = (skipReason: string): LighthouseFindings => ({
    findings: [],
    categoryScores: {},
    skipped: true,
    skipReason,
  });

  let chrome: LaunchedChrome | null = null;
  try {
    const chromeLauncher = await import("chrome-launcher");
    const lighthouseMod = await import("lighthouse");
    // Lighthouse is published as either a default export (ESM) or the module
    // itself (CJS). Resolve both shapes without fighting the type system.
    const lighthouse = (
      (lighthouseMod as unknown as { default?: unknown }).default ?? lighthouseMod
    ) as (
      url: string,
      flags: Record<string, unknown>,
      config?: unknown,
    ) => Promise<{ lhr: Record<string, unknown> } | undefined>;

    try {
      chrome = await chromeLauncher.launch({
        chromeFlags: [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
        ],
      });
    } catch (err) {
      return empty(`chrome-launcher: ${(err as Error).message}`);
    }

    const runnerResult = await lighthouse(
      url,
      {
        logLevel: "error",
        output: "json",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        port: chrome.port,
        formFactor: opts.viewport,
        // Screen emulation must match the form factor or Lighthouse complains
        screenEmulation:
          opts.viewport === "mobile"
            ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
            : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      },
    );

    if (!runnerResult || !runnerResult.lhr) {
      return empty("Lighthouse returned no result");
    }

    const lhr = runnerResult.lhr as {
      audits?: Record<string, Record<string, unknown>>;
      categories?: Record<string, { id?: string; score?: number | null; auditRefs?: Array<{ id: string }> }>;
    };

    const audits = lhr.audits ?? {};
    const categories = lhr.categories ?? {};

    // Build audit-id → category map so we know which finding belongs where
    const auditCategory = new Map<string, LighthouseCategory>();
    for (const cat of Object.values(categories)) {
      const catId = cat.id as LighthouseCategory | undefined;
      if (!catId) continue;
      if (!["performance", "accessibility", "best-practices", "seo"].includes(catId)) continue;
      for (const ref of cat.auditRefs ?? []) {
        auditCategory.set(ref.id, catId);
      }
    }

    const findings: LighthouseFinding[] = [];
    for (const [auditId, audit] of Object.entries(audits)) {
      const scoreRaw = (audit as { score?: number | null }).score;
      if (scoreRaw == null) continue; // informational / manual audits
      if (scoreRaw >= SCORE_THRESHOLD) continue;

      const category = auditCategory.get(auditId);
      if (!category) continue;

      const title = String(audit.title ?? auditId);
      const description = String(audit.description ?? "");
      const wcagRefs = category === "accessibility" ? extractWcagRefs(audit) : [];

      findings.push({
        id: `lh-${opts.viewport}-${auditId}`,
        auditId,
        category,
        title,
        description,
        score: scoreRaw,
        severity: mapScoreToSeverity(scoreRaw),
        wcagRefs,
        viewport: opts.viewport,
      });
    }

    const categoryScores: Partial<Record<LighthouseCategory, number>> = {};
    for (const cat of Object.values(categories)) {
      const catId = cat.id as LighthouseCategory | undefined;
      if (!catId) continue;
      if (typeof cat.score === "number") {
        categoryScores[catId] = Math.round(cat.score * 100);
      }
    }

    return { findings, categoryScores, skipped: false };
  } catch (err) {
    console.warn(`  ⚠ Lighthouse failed for ${url} (${opts.viewport}): ${(err as Error).message}`);
    return empty((err as Error).message);
  } finally {
    if (chrome) {
      try {
        await chrome.kill();
      } catch {
        // best-effort cleanup
      }
    }
  }
}
