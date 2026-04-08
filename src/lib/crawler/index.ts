/**
 * Crawler module — Playwright-based screenshotting at multiple viewports.
 *
 * Responsibilities:
 *  - Accept a URL and crawl all linked pages within the same origin
 *  - Capture screenshots at 3 viewports: mobile (375px), tablet (768px), desktop (1440px)
 *  - Return structured screenshot data for downstream analysis
 *  - Detect auth-gated pages and signal when interactive login is needed
 *
 * Performance: creates one browser context per viewport upfront and reuses
 * them across all routes. Viewports are screenshotted in parallel per route.
 */

import { chromium, type BrowserContext, type Page, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import {
  headlessPersistentNavigate,
} from "./persistent-session";

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

const VIEWPORT_ENTRIES = Object.entries(VIEWPORTS) as [ViewportName, { width: number; height: number }][];

export interface RouteScreenshots {
  route: string;
  url: string;
  /** Maps viewport name → screenshot filename (not full path). */
  screenshots: Record<ViewportName, string>;
}

export interface CrawlManifest {
  baseUrl: string;
  timestamp: string;
  /** Temp directory name (e.g. "ux-audit-1712345678901"), used to locate screenshots. */
  sessionId: string;
  totalRoutes: number;
  routes: RouteScreenshots[];
}

export interface AuthRequiredResult {
  needsAuth: true;
  authUrl: string;
  screenshot: string; // base64 PNG
}

export interface SSORedirectResult {
  needsSSOLogin: true;
  redirectUrl: string;
  requestedOrigin: string;
}

export interface CrawlResult {
  needsAuth: false;
  manifest: CrawlManifest;
}

export type CrawlOutcome = AuthRequiredResult | SSORedirectResult | CrawlResult;

// Re-export Cookie type for consumers
export type { Cookie };

const PAGE_TIMEOUT = 30_000;
const SETTLE_DELAY = 500;

/**
 * Turn a pathname into a filesystem-safe slug.
 *  "/"           → "index"
 *  "/about"      → "about"
 *  "/blog/post-1" → "blog-post-1"
 */
function slugify(route: string): string {
  if (route === "/") return "index";
  return route
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Detect if the current page is an auth wall.
 * Conservative — only triggers on clearly login-like pages.
 */
async function detectAuthWall(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();

  // Check URL patterns for common auth/SSO providers
  const authUrlPatterns = [
    /\/login/,
    /\/signin/,
    /\/sign-in/,
    /\/sign_in/,
    /\/auth\//,
    /\/sso\//,
    /\/oauth/,
    /okta\./,
    /auth0\./,
    /accounts\.google\./,
    /login\.microsoftonline\./,
    /\/cas\/login/,
  ];

  const urlIsAuth = authUrlPatterns.some((p) => p.test(url));

  // Check for password input fields (strongest signal)
  const hasPasswordField = await page.$$eval(
    'input[type="password"]',
    (inputs) => inputs.length > 0
  );

  // Check page title / h1 for login-related text
  const titleText = await page.title();
  const h1Text = await page
    .$$eval("h1", (els) => els.map((e) => e.textContent || "").join(" "))
    .catch(() => "");

  const combinedText = `${titleText} ${h1Text}`.toLowerCase();
  const loginTextPatterns = [
    /sign\s*in/,
    /log\s*in/,
    /authenticate/,
    /enter your (password|credentials)/,
  ];
  const hasLoginText = loginTextPatterns.some((p) => p.test(combinedText));

  // Check for common SSO / OAuth buttons
  const hasSSOButtons = await page
    .$$eval("button, a[role='button'], a.btn, [class*='btn']", (els) => {
      const text = els.map((e) => (e.textContent || "").toLowerCase()).join(" ");
      return (
        /sign in with/i.test(text) ||
        /log in with/i.test(text) ||
        /continue with (google|microsoft|okta|saml|sso)/i.test(text) ||
        /sso login/i.test(text)
      );
    })
    .catch(() => false);

  // Conservative: require password field OR (auth URL + login text) OR SSO buttons with login text
  if (hasPasswordField && (urlIsAuth || hasLoginText)) return true;
  if (hasPasswordField && hasSSOButtons) return true;
  if (urlIsAuth && hasLoginText) return true;
  if (hasSSOButtons && hasLoginText) return true;

  return false;
}

/**
 * Extract all same-origin links from the current page.
 */
async function discoverLinks(page: Page, origin: string): Promise<string[]> {
  const hrefs: string[] = await page.$$eval("a[href]", (anchors) =>
    anchors.map((a) => a.getAttribute("href")).filter(Boolean) as string[]
  );

  const uniqueRoutes = new Set<string>();

  for (const href of hrefs) {
    try {
      const resolved = new URL(href, page.url());
      if (resolved.origin === origin) {
        // Normalise: keep pathname only, strip trailing slash (except root)
        const route = resolved.pathname.replace(/\/+$/, "") || "/";
        // Skip common non-page resources
        if (/\.(png|jpe?g|gif|svg|css|js|ico|woff2?|ttf|eot|pdf|zip)$/i.test(route)) continue;
        uniqueRoutes.add(route);
      }
    } catch {
      // skip malformed URLs
    }
  }

  return Array.from(uniqueRoutes);
}

/**
 * Crawl a site starting from `url`, discover same-origin links,
 * screenshot every route at 3 viewports, and return a manifest.
 *
 * If auth is detected on the landing page, returns an AuthRequiredResult
 * instead of continuing the crawl.
 *
 * Performance: creates 3 browser contexts upfront (one per viewport) and
 * reuses them for all routes. Viewports are captured in parallel per route.
 */
export async function crawlAndScreenshot(
  url: string,
  outputDir: string = path.resolve("screenshots"),
  cookies?: Cookie[],
  usePersistedSession?: boolean
): Promise<CrawlOutcome> {
  const baseUrl = new URL(url);
  const origin = baseUrl.origin;

  fs.mkdirSync(outputDir, { recursive: true });

  // Session ID is the directory basename (e.g. "ux-audit-1712345678901")
  const sessionId = path.basename(outputDir);

  // --- Persistent session: use saved profile for cookie/SSO passthrough --
  if (usePersistedSession && (!cookies || cookies.length === 0)) {
    console.log("Using persistent browser profile for session passthrough...");
    const { cookies: profileCookies, finalUrl } =
      await headlessPersistentNavigate(url);

    // Check for SSO redirect: final URL origin differs from requested origin
    try {
      const finalOrigin = new URL(finalUrl).origin;
      if (finalOrigin !== origin) {
        console.log(
          `SSO redirect detected: ${origin} → ${finalOrigin} (${finalUrl})`
        );
        return {
          needsSSOLogin: true,
          redirectUrl: finalUrl,
          requestedOrigin: origin,
        };
      }
    } catch {
      // malformed finalUrl — continue without profile cookies
    }

    // Profile had valid session — use its cookies for the crawl
    if (profileCookies.length > 0) {
      console.log(
        `Persistent profile provided ${profileCookies.length} cookie(s)`
      );
      cookies = profileCookies;
    }
  }

  const browser = await chromium.launch();

  const manifest: CrawlManifest = {
    baseUrl: url,
    timestamp: new Date().toISOString(),
    sessionId,
    totalRoutes: 0,
    routes: [],
  };

  try {
    // --- Step 1: Discover internal links from the landing page -----------
    const discoveryCtx = await browser.newContext({
      viewport: VIEWPORTS.desktop,
    });

    // Inject cookies if provided (from interactive login, cookie import, or persistent profile)
    if (cookies && cookies.length > 0) {
      await discoveryCtx.addCookies(cookies);
    }

    const discoveryPage = await discoveryCtx.newPage();

    try {
      await discoveryPage.goto(url, {
        waitUntil: "networkidle",
        timeout: PAGE_TIMEOUT,
      });
    } catch (err) {
      console.error(`Failed to load base URL ${url}: ${(err as Error).message}`);
      throw err;
    }

    // --- Auth detection (only when no cookies were pre-injected) ---------
    if (!cookies || cookies.length === 0) {
      const isAuthWall = await detectAuthWall(discoveryPage);
      if (isAuthWall) {
        const screenshotBuffer = await discoveryPage.screenshot({ fullPage: true });
        const screenshot = screenshotBuffer.toString("base64");
        const authUrl = discoveryPage.url();
        await discoveryCtx.close();
        await browser.close();
        return { needsAuth: true, authUrl, screenshot };
      }
    }

    const discoveredRoutes = await discoverLinks(discoveryPage, origin);
    await discoveryCtx.close();

    // Ensure the base route is included and comes first
    const baseRoute = baseUrl.pathname.replace(/\/+$/, "") || "/";
    const routes = [baseRoute, ...discoveredRoutes.filter((r) => r !== baseRoute)];

    console.log(`Discovered ${routes.length} route(s):`);
    routes.forEach((r) => console.log(`  ${r}`));

    // --- Step 2: Create one context + page per viewport (reused across routes)
    const vpState: Record<ViewportName, { ctx: BrowserContext; page: Page }> = {} as never;

    for (const [vpName, vpSize] of VIEWPORT_ENTRIES) {
      const ctx = await browser.newContext({ viewport: vpSize });
      if (cookies && cookies.length > 0) {
        await ctx.addCookies(cookies);
      }
      vpState[vpName] = { ctx, page: await ctx.newPage() };
    }

    // --- Step 3: Screenshot each route — all viewports in parallel ------
    for (const route of routes) {
      const fullUrl = `${origin}${route}`;
      const slug = slugify(route);
      const routeEntry: RouteScreenshots = {
        route,
        url: fullUrl,
        screenshots: { mobile: "", tablet: "", desktop: "" },
      };

      const results = await Promise.all(
        VIEWPORT_ENTRIES.map(async ([vpName]) => {
          const { page } = vpState[vpName];
          try {
            await page.goto(fullUrl, {
              waitUntil: "networkidle",
              timeout: PAGE_TIMEOUT,
            });
            await page.waitForTimeout(SETTLE_DELAY);

            const filename = `${slug}_${vpName}.png`;
            await page.screenshot({
              path: path.join(outputDir, filename),
              fullPage: true,
            });

            console.log(`  ✓ ${route} @ ${vpName}`);
            return { vpName, filename };
          } catch (err) {
            console.error(`  ✗ ${route} @ ${vpName}: ${(err as Error).message}`);
            return { vpName, filename: "" };
          }
        })
      );

      for (const { vpName, filename } of results) {
        routeEntry.screenshots[vpName] = filename;
      }

      manifest.routes.push(routeEntry);
    }

    // Cleanup viewport contexts
    for (const { ctx } of Object.values(vpState)) {
      await ctx.close();
    }

    manifest.totalRoutes = manifest.routes.length;
  } finally {
    await browser.close();
  }

  // --- Step 4: Write manifest -------------------------------------------
  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${manifestPath}`);

  return { needsAuth: false, manifest };
}

// Re-export persistent-session utilities for consumers
export {
  hasPersistedSession,
  clearBrowserProfile,
  BROWSER_PROFILE_DIR,
  launchHeadedPersistentBrowser,
  extractCookiesAndClose,
  checkSSOReturn,
  setReadySignal,
  waitForReadySignal,
  generateSessionId,
} from "./persistent-session";
