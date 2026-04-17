/**
 * Design-token drift detector — public module entry point.
 *
 * Pipeline:
 *   Playwright page → extractTokens() → detectDrift(refSystem) → DriftFinding[]
 *
 * The findings are shape-compatible with `UXIssue` (src/lib/analyzer/index.ts)
 * so they can be merged into the same audit result once the analyzer's
 * `source` union is widened to include `"tokens"`. Until then, consumers can
 * cast or treat them as `source?: string`.
 *
 * Intentionally does NOT touch the crawler / analyzer / audit route — this
 * module is importable but integration is a separate task.
 */
import type { Page } from "playwright";

import { extractTokens, type ExtractedTokens, type TokenCount, pxValue } from "./extract";
import { detectDrift, type DriftFinding, type DetectDriftOptions } from "./compare";
import { loadSystem, listSystems, type DesignSystemName, type DesignSystemRef } from "./systems";

export {
  extractTokens,
  detectDrift,
  loadSystem,
  listSystems,
  pxValue,
};
export type {
  ExtractedTokens,
  TokenCount,
  DriftFinding,
  DetectDriftOptions,
  DesignSystemName,
  DesignSystemRef,
};

export interface RunTokenAuditOptions extends DetectDriftOptions {
  /** Pass an already-extracted token set (skip the page walk). */
  extracted?: ExtractedTokens;
}

/**
 * Extract tokens from a live page and compare against the named reference
 * design system. Safe to call even if the page hasn't fully settled — the
 * walker only reads computed styles and never mutates the DOM.
 */
export async function runTokenAudit(
  page: Page,
  systemName: DesignSystemName,
  opts: RunTokenAuditOptions = {}
): Promise<DriftFinding[]> {
  const system = loadSystem(systemName);
  const extracted = opts.extracted ?? (await extractTokens(page));
  return detectDrift(extracted, system, { tolerancePx: opts.tolerancePx });
}
