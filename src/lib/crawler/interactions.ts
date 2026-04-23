/**
 * Interaction capture — click tabs/buttons without changing URL, screenshot
 * each resulting view.
 *
 * Why: single-page apps (dashboards, admin panels) commonly swap content via
 * tabs, accordions, or inline navigation that never updates the URL. The base
 * crawler only follows <a href> links, so it misses all of these. This module
 * clicks tab-like controls on the current page, screenshots after each click,
 * and returns one virtual route per click so the analyzer treats them as
 * separate pages.
 *
 * Scope (keep deliberately small):
 *  - Only runs on the page Playwright is already on — caller controls that.
 *  - Screenshots go to the SAME outputDir + same filename convention as the
 *    base crawler, so downstream code doesn't need to know they're special.
 *  - Caps the number of captures to prevent runaway screenshots on pages with
 *    giant tablists.
 */

import type { Page } from "playwright";
import * as path from "path";

export interface CapturedInteraction {
  /** Virtual route label, e.g. "/dashboard#tab:Settings". */
  route: string;
  /** Screenshot filename relative to outputDir. */
  filename: string;
  /** Human-friendly label for the UI ("Settings tab", "Details panel"). */
  label: string;
}

interface CaptureOptions {
  /** Max total captures (across tabs + custom selectors). Default: 10. */
  maxCaptures?: number;
  /** Optional user-supplied CSS selectors to click, in order. */
  clickSelectors?: string[];
  /** Per-screenshot clip height to match the base crawler. */
  maxScreenshotHeight?: number;
  viewport: { width: number; height: number };
  /** Progress callback. */
  onProgress?: (label: string) => void;
}

const DEFAULT_MAX_CAPTURES = 10;
const SETTLE_MS = 400;

/**
 * Text selectors that commonly indicate tab-like controls across React/UI
 * libraries we've seen (Radix, MUI, Ant, Chakra, shadcn, Bootstrap).
 */
const TAB_SELECTORS = [
  '[role="tab"]',
  '[role="tablist"] button',
  '[role="tablist"] a',
  'button[data-state="inactive"][data-radix-collection-item]',
];

/**
 * Sanitize a label into a filesystem-safe slug. Keeps the label short so
 * filenames stay readable.
 */
function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "interaction";
}

/**
 * Click a tab-like control, wait briefly for content to render, screenshot.
 *
 * Returns the captured interaction, or null if the click failed / the tab was
 * already the active one (avoid duplicating the main screenshot).
 */
async function captureOneInteraction(
  page: Page,
  clickFn: () => Promise<void>,
  label: string,
  baseRoute: string,
  outputDir: string,
  viewport: { width: number; height: number },
  maxScreenshotHeight: number,
): Promise<CapturedInteraction | null> {
  try {
    await clickFn();
  } catch {
    return null;
  }

  // Wait for the tab panel to render. A short fixed settle is more reliable
  // than waitForLoadState on SPAs — the network is already idle.
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => document.fonts.ready).catch(() => {});

  const slug = slugifyLabel(label);
  const filename = `${slugifyLabel(baseRoute)}_tab-${slug}_desktop.png`;
  const bodyHeight = await page
    .evaluate(() => document.body.scrollHeight)
    .catch(() => 0);

  const screenshotOpts: {
    path: string;
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  } = { path: path.join(outputDir, filename) };
  if (bodyHeight > maxScreenshotHeight) {
    screenshotOpts.clip = {
      x: 0,
      y: 0,
      width: viewport.width,
      height: maxScreenshotHeight,
    };
  } else {
    screenshotOpts.fullPage = true;
  }

  await page.screenshot(screenshotOpts);

  const route = `${baseRoute}#tab:${label.slice(0, 40)}`;
  return { route, filename, label };
}

/**
 * Discover tab-like controls on the current page and capture each one.
 */
export async function captureTabsAndInteractions(
  page: Page,
  baseRoute: string,
  outputDir: string,
  options: CaptureOptions,
): Promise<CapturedInteraction[]> {
  const maxCaptures = options.maxCaptures ?? DEFAULT_MAX_CAPTURES;
  const maxScreenshotHeight = options.maxScreenshotHeight ?? 8000;
  const captured: CapturedInteraction[] = [];

  // ---- 1. Auto-detect tab-like controls -----------------------------------
  // We collect metadata (label + index within the combined selector match) up
  // front, then click one by one, re-querying each time since the DOM may
  // re-render after a tab switch.
  let tabMeta: { index: number; label: string; initiallySelected: boolean }[] = [];
  try {
    tabMeta = await page.$$eval(
      TAB_SELECTORS.join(","),
      (els) =>
        els.map((el, index) => {
          const label =
            (el.getAttribute("aria-label") ||
              (el as HTMLElement).innerText ||
              el.textContent ||
              "")
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 40) || `tab-${index}`;
          const selected =
            el.getAttribute("aria-selected") === "true" ||
            el.getAttribute("data-state") === "active";
          return { index, label, initiallySelected: selected };
        }),
    );
  } catch {
    tabMeta = [];
  }

  // Skip the tab that's already selected (we already have a screenshot of it
  // from the main crawl) and dedupe labels so we don't click the same tab
  // through multiple nested tablists.
  const seenLabels = new Set<string>();
  const toClick = tabMeta.filter((t) => {
    if (t.initiallySelected) return false;
    if (!t.label) return false;
    const key = t.label.toLowerCase();
    if (seenLabels.has(key)) return false;
    seenLabels.add(key);
    return true;
  });

  for (const tab of toClick) {
    if (captured.length >= maxCaptures) break;
    options.onProgress?.(`Capturing tab: ${tab.label}`);
    const result = await captureOneInteraction(
      page,
      async () => {
        // Re-query by combined selector; the earlier index may be stale after
        // the last click re-rendered the DOM, so match by label if possible.
        const handle = await page.locator(TAB_SELECTORS.join(",")).all();
        for (const el of handle) {
          const text = (await el.innerText().catch(() => "")).trim();
          const aria = (await el.getAttribute("aria-label").catch(() => "")) || "";
          if (
            text.trim() === tab.label ||
            aria.trim() === tab.label
          ) {
            await el.click({ timeout: 2000 }).catch(() => {});
            return;
          }
        }
        // Fallback: click by original index
        const el = handle[tab.index];
        if (el) await el.click({ timeout: 2000 }).catch(() => {});
      },
      tab.label,
      baseRoute,
      outputDir,
      options.viewport,
      maxScreenshotHeight,
    );
    if (result) captured.push(result);
  }

  // ---- 2. User-provided click selectors -----------------------------------
  const userSelectors = (options.clickSelectors ?? []).filter((s) => s.trim());
  for (const selector of userSelectors) {
    if (captured.length >= maxCaptures) break;
    const label = `selector:${selector.slice(0, 30)}`;
    options.onProgress?.(`Capturing custom: ${selector}`);
    const result = await captureOneInteraction(
      page,
      async () => {
        await page
          .locator(selector)
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
      },
      label,
      baseRoute,
      outputDir,
      options.viewport,
      maxScreenshotHeight,
    );
    if (result) captured.push(result);
  }

  return captured;
}
