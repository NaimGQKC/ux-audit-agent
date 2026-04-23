/**
 * Design-token extractor — walks the DOM of an audited page inside Playwright
 * and collects the set of computed style primitives actually being used
 * (fonts, colors, spacing, radius, shadow). The output feeds the drift
 * detector (`./compare.ts`), which compares these values against a reference
 * design-system config.
 *
 * Runs entirely in-page via `page.evaluate` — no network calls, no mutations.
 */
import type { Page } from "playwright";

/** A single observed value with the number of elements that use it. */
export interface TokenCount {
  value: string;
  count: number;
}

export interface ExtractedTokens {
  typography: {
    fontFamilies: TokenCount[];
    fontSizes: TokenCount[];
    lineHeights: TokenCount[];
  };
  color: {
    foreground: TokenCount[];
    background: TokenCount[];
  };
  spacing: TokenCount[];
  radius: TokenCount[];
  shadow: TokenCount[];
  /** Number of elements actually walked (capped). */
  sampled: number;
}

/** Hard cap on elements walked — keeps extraction under ~100ms on real sites. */
const MAX_ELEMENTS = 2000;

export async function extractTokens(page: Page): Promise<ExtractedTokens> {
  return await page.evaluate((maxElements: number) => {
    // ---- helpers (all defined in page context) ----------------------------
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "NOSCRIPT"]);

    const bump = (map: Map<string, number>, key: string | null | undefined) => {
      if (!key) return;
      const trimmed = key.trim();
      if (!trimmed) return;
      map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
    };

    /**
     * Convert rgb()/rgba() → #rrggbb (ignoring alpha for the comparison —
     * we only care about the base color). Returns the raw string on any
     * other format (hex, named color, gradient, etc.).
     */
    const toHex = (raw: string): string => {
      if (!raw) return raw;
      const s = raw.trim();
      const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (!m) return s.toLowerCase();
      const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
      const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
      const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
      const hex = (n: number) => n.toString(16).padStart(2, "0");
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    };

    /** Normalize a font-size (e.g. "16px", "1rem") to a px string like "16px". */
    const toPx = (raw: string, rootFontPx: number): string => {
      if (!raw) return raw;
      const s = raw.trim();
      if (s.endsWith("px")) {
        const n = parseFloat(s);
        if (Number.isFinite(n)) return `${Math.round(n * 100) / 100}px`;
        return s;
      }
      if (s.endsWith("rem")) {
        const n = parseFloat(s);
        if (Number.isFinite(n)) return `${Math.round(n * rootFontPx * 100) / 100}px`;
      }
      if (s.endsWith("em")) {
        // em is relative to parent font-size — we don't have it here, so skip
        return "";
      }
      return s;
    };

    /** Push each unique spacing side (top/right/bottom/left) separately. */
    const collectSides = (raw: string, target: Map<string, number>) => {
      if (!raw) return;
      raw
        .split(/\s+/)
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => bump(target, v));
    };

    // ---- maps --------------------------------------------------------------
    const fontFamilies = new Map<string, number>();
    const fontSizes = new Map<string, number>();
    const lineHeights = new Map<string, number>();
    const fg = new Map<string, number>();
    const bg = new Map<string, number>();
    const spacing = new Map<string, number>();
    const radius = new Map<string, number>();
    const shadow = new Map<string, number>();

    // Root font-size for rem normalization
    const rootFontPx = parseFloat(
      getComputedStyle(document.documentElement).fontSize || "16"
    ) || 16;

    // ---- walk --------------------------------------------------------------
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    let sampled = 0;
    let node: Node | null = walker.currentNode;
    // TreeWalker starts at the root; iterate all descendants including root.
    while (node && sampled < maxElements) {
      const el = node as Element;
      const tag = el.tagName;
      if (!SKIP_TAGS.has(tag)) {
        const cs = getComputedStyle(el);

        // Typography
        bump(fontFamilies, cs.fontFamily);
        const fsPx = toPx(cs.fontSize, rootFontPx);
        if (fsPx) bump(fontSizes, fsPx);
        // line-height can be "normal" — keep as-is; numeric lh → "1.5"
        bump(lineHeights, cs.lineHeight);

        // Colors
        // Only count "visible" text-color cells (elements with actual text)
        const hasText = el.childNodes && Array.from(el.childNodes).some(
          (c) => c.nodeType === 3 && (c.textContent?.trim().length ?? 0) > 0
        );
        if (hasText) bump(fg, toHex(cs.color));

        // Ignore fully-transparent backgrounds
        const bgRaw = cs.backgroundColor;
        if (bgRaw && !/rgba\(0,\s*0,\s*0,\s*0\)/i.test(bgRaw) && bgRaw !== "transparent") {
          bump(bg, toHex(bgRaw));
        }

        // Spacing (4 sides × margin + padding, plus gap)
        collectSides(cs.marginTop, spacing);
        collectSides(cs.marginRight, spacing);
        collectSides(cs.marginBottom, spacing);
        collectSides(cs.marginLeft, spacing);
        collectSides(cs.paddingTop, spacing);
        collectSides(cs.paddingRight, spacing);
        collectSides(cs.paddingBottom, spacing);
        collectSides(cs.paddingLeft, spacing);
        if (cs.gap) collectSides(cs.gap, spacing);
        if (cs.rowGap) collectSides(cs.rowGap, spacing);
        if (cs.columnGap) collectSides(cs.columnGap, spacing);

        // Radius (per-corner, since shorthand is expanded in computed style)
        bump(radius, cs.borderTopLeftRadius);
        bump(radius, cs.borderTopRightRadius);
        bump(radius, cs.borderBottomLeftRadius);
        bump(radius, cs.borderBottomRightRadius);

        // Shadow (only non-"none")
        if (cs.boxShadow && cs.boxShadow !== "none") bump(shadow, cs.boxShadow);

        sampled++;
      }
      node = walker.nextNode();
    }

    // ---- sort + shape output ----------------------------------------------
    const toList = (m: Map<string, number>): TokenCount[] =>
      Array.from(m.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);

    // Type definition has to be re-declared here (page-context eval can't see
    // the outer TS types). It's structurally identical to TokenCount.
    type TokenCount = { value: string; count: number };

    return {
      typography: {
        fontFamilies: toList(fontFamilies),
        fontSizes: toList(fontSizes),
        lineHeights: toList(lineHeights),
      },
      color: {
        foreground: toList(fg),
        background: toList(bg),
      },
      spacing: toList(spacing),
      radius: toList(radius),
      shadow: toList(shadow),
      sampled,
    };
  }, MAX_ELEMENTS);
}

/**
 * Parse a normalized "16px" string to a number. Returns NaN for non-px values
 * (e.g. "normal" line-height) — callers should filter.
 */
export function pxValue(s: string): number {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(s.trim());
  return m ? parseFloat(m[1]) : NaN;
}
