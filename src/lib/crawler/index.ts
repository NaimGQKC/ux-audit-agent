/**
 * Crawler module — Playwright-based screenshotting at multiple viewports.
 *
 * Responsibilities:
 *  - Accept a URL and crawl all linked pages within the same origin
 *  - Capture screenshots at 3 viewports: mobile (375px), tablet (768px), desktop (1440px)
 *  - Return structured screenshot data for downstream analysis
 */

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;
