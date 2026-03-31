/**
 * Crawler module — Playwright-based screenshotting at multiple viewports.
 *
 * Responsibilities:
 *  - Accept a URL and crawl all linked pages within the same origin
 *  - Capture screenshots at 3 viewports: mobile (375px), tablet (768px), desktop (1440px)
 *  - Return structured screenshot data for downstream analysis
 *  - Detect auth-gated pages and signal when interactive login is needed
 */

import { chromium, type Page, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

export interface RouteScreenshots {
  route: string;
  url: string;
  screenshots: Record<ViewportName, string>;
}

export interface CrawlManifest {
  baseUrl: string;
  timestamp: string;
  totalRoutes: number;
  routes: RouteScreenshots[];
}

export interface AuthRequiredResult {
  needsAuth: true;
  authUrl: string;
  screenshot: string; // base64 PNG
}

export interface CrawlResult {
  needsAuth: false;
  manifest: CrawlManifest;
}

export type CrawlOutcome = AuthRequiredResult | CrawlResult;

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
 * Screenshots are saved to `./screenshots/` by default.
 */
export async function crawlAndScreenshot(
  url: string,
  outputDir: string = path.resolve("screenshots"),
  cookies?: Cookie[]
): Promise<CrawlOutcome> {
  const baseUrl = new URL(url);
  const origin = baseUrl.origin;

  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();

  const manifest: CrawlManifest = {
    baseUrl: url,
    timestamp: new Date().toISOString(),
    totalRoutes: 0,
    routes: [],
  };

  try {
    // --- Step 1: Discover internal links from the landing page -----------
    const discoveryCtx = await browser.newContext({
      viewport: VIEWPORTS.desktop,
    });

    // Inject cookies if provided (from interactive login or cookie import)
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

    // --- Step 2: Screenshot each route at each viewport -----------------
    for (const route of routes) {
      const fullUrl = `${origin}${route}`;
      const slug = slugify(route);
      const routeEntry: RouteScreenshots = {
        route,
        url: fullUrl,
        screenshots: { mobile: "", tablet: "", desktop: "" },
      };

      for (const [vpName, vpSize] of Object.entries(VIEWPORTS) as [ViewportName, { width: number; height: number }][]) {
        const ctx = await browser.newContext({ viewport: vpSize });

        // Inject cookies into each viewport context too
        if (cookies && cookies.length > 0) {
          await ctx.addCookies(cookies);
        }

        const page = await ctx.newPage();

        try {
          await page.goto(fullUrl, {
            waitUntil: "networkidle",
            timeout: PAGE_TIMEOUT,
          });
          await page.waitForTimeout(SETTLE_DELAY);

          const filename = `${slug}_${vpName}.png`;
          const filepath = path.join(outputDir, filename);

          await page.screenshot({ path: filepath, fullPage: true });
          routeEntry.screenshots[vpName] = filepath;

          console.log(`  ✓ ${route} @ ${vpName}`);
        } catch (err) {
          console.error(`  ✗ ${route} @ ${vpName}: ${(err as Error).message}`);
        } finally {
          await ctx.close();
        }
      }

      manifest.routes.push(routeEntry);
    }

    manifest.totalRoutes = manifest.routes.length;
  } finally {
    await browser.close();
  }

  // --- Step 3: Write manifest -------------------------------------------
  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${manifestPath}`);

  return { needsAuth: false, manifest };
}
