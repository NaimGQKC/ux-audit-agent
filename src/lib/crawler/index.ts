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
import { runAxe, type AxeFinding } from "../deterministic/axe";
import { runTokenAudit, type DriftFinding, type DesignSystemName } from "../tokens";
import { captureTabsAndInteractions } from "./interactions";

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
  /**
   * Optional — axe-core findings collected per viewport during the crawl.
   * Missing when axe was skipped (skipDeterministic) or crashed.
   */
  axeFindings?: AxeFinding[];
  /**
   * Optional — design-token drift findings collected once per route on the
   * desktop viewport. Site-wide, not viewport-specific.
   */
  tokenFindings?: DriftFinding[];
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
export type { AxeFinding };
export type { DriftFinding };

/**
 * Default per-page navigation timeout. Bumped from 30s to 45s in 2026-04
 * after observing real-world JS-heavy SPAs (Stripe, Vercel) timing out at
 * 30s on `domcontentloaded`. Override via `crawlAndScreenshot(..., { pageTimeout })`.
 */
const DEFAULT_PAGE_TIMEOUT = 45_000;
const SETTLE_DELAY = 500;
const MAX_ROUTES = 30;
const MAX_SCREENSHOT_HEIGHT = 8000;

export interface CrawlOptions {
  /** Pre-injected cookies (interactive login, cookie import). */
  cookies?: Cookie[];
  /** Use the persistent browser profile (SSO passthrough). */
  usePersistedSession?: boolean;
  /** Per-page navigation timeout in ms. Default: 45_000. */
  pageTimeout?: number;
  /** Max routes to crawl. Default: 30. */
  maxRoutes?: number;
  /** Credentials for automated headless login. Never logged or persisted. */
  credentials?: Credentials;
  /** Skip axe-core runs per viewport (part of the deterministic layer). */
  skipAxe?: boolean;
  /** Progress callback for deterministic-layer events (axe per route). */
  onAxeProgress?: (route: string, viewport: ViewportName) => void;
  /** Skip design-token drift detection per route. */
  skipTokens?: boolean;
  /** Reference design system for token drift. Default: "material3". */
  tokensSystem?: "material3" | "uswds" | "govuk" | "carbon";
  /** Progress callback for tokens events. */
  onTokensProgress?: (route: string) => void;
  /**
   * Auto-capture tab switchers and other same-page interactions on the target
   * route. Surfaces each as an additional virtual route in the manifest.
   * Default: true — huge SPAs benefit, simple marketing sites get a no-op.
   */
  captureInteractions?: boolean;
  /** Optional CSS selectors the crawler clicks (in order) on the target page. */
  clickSelectors?: string[];
  /** Progress callback fired when an interaction is captured. */
  onInteractionProgress?: (label: string) => void;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface LoginFailureResult {
  needsAuth: true;
  loginFailed: true;
  authUrl: string;
  screenshot: string; // base64 PNG
  reason: string;
}

/**
 * Navigate with a graceful fallback: try `domcontentloaded` first; if that
 * times out (heavy SPA), retry with `commit` (just the navigation request)
 * which gives us a chance to screenshot the partially-rendered page rather
 * than losing the viewport entirely.
 */
async function gotoWithFallback(
  page: Page,
  url: string,
  pageTimeout: number,
): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: pageTimeout });
  } catch (err) {
    const msg = (err as Error).message;
    // Only fall back on timeout — let other errors (DNS, cert, etc.) propagate.
    if (!msg.includes("Timeout")) throw err;
    console.warn(
      `  ↻ ${url} — domcontentloaded timed out at ${Math.round(pageTimeout / 1000)}s, retrying with 'commit'`,
    );
    // Half timeout for the fallback — at this point we just want any screenshot.
    await page.goto(url, { waitUntil: "commit", timeout: Math.round(pageTimeout / 2) });
  }
}

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
 * Attempt automated login using email + password credentials.
 *
 * Supports two common form patterns:
 *  1. Single-step: email + password both visible — fill both, submit.
 *  2. Two-step  : email first, "Continue/Next" click reveals password — fill,
 *                 click next, wait, fill password, submit.
 *
 * Returns `true` on suspected success (no password field visible + URL left
 * the auth wall), `false` otherwise. Credentials are never logged.
 */
async function attemptLogin(
  page: Page,
  credentials: Credentials,
  pageTimeout: number,
): Promise<{ ok: boolean; reason?: string }> {
  // Email selectors — ordered by specificity
  const emailSelectors = [
    'input[type="email"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[id*="email" i]',
    'input[id*="user" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[name="password"]',
  ];
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[name*="login" i]',
    'button[name*="signin" i]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
  ];

  // Find first visible match for a selector list
  const firstVisible = async (selectors: string[]) => {
    for (const sel of selectors) {
      const locator = page.locator(sel).first();
      try {
        if (await locator.isVisible({ timeout: 500 })) return locator;
      } catch {
        // not present — skip
      }
    }
    return null;
  };

  // --- Step 1: fill email -----------------------------------------------
  const emailField = await firstVisible(emailSelectors);
  if (!emailField) {
    return { ok: false, reason: "Could not locate an email/username field on the page." };
  }
  await emailField.fill(credentials.email, { timeout: 5_000 }).catch(() => {});

  // --- Step 2: is password already visible? ------------------------------
  let passwordField = await firstVisible(passwordSelectors);

  if (!passwordField) {
    // Two-step flow — click Continue/Next to reveal password
    const continueBtn = await firstVisible(submitSelectors);
    if (continueBtn) {
      await Promise.allSettled([
        page
          .waitForLoadState("domcontentloaded", { timeout: pageTimeout })
          .catch(() => {}),
        continueBtn.click({ timeout: 5_000 }).catch(() => {}),
      ]);
      // Password fields often fade in — poll briefly
      for (let i = 0; i < 10 && !passwordField; i++) {
        await page.waitForTimeout(500);
        passwordField = await firstVisible(passwordSelectors);
      }
    }
  }

  if (!passwordField) {
    return { ok: false, reason: "Password field did not appear after submitting email." };
  }

  // --- Step 3: fill password --------------------------------------------
  await passwordField.fill(credentials.password, { timeout: 5_000 }).catch(() => {});

  // --- Step 4: submit ----------------------------------------------------
  const submitBtn = await firstVisible(submitSelectors);
  const navigationPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: pageTimeout })
    .catch(() => null);

  if (submitBtn) {
    await submitBtn.click({ timeout: 5_000 }).catch(() => {});
  } else {
    // Fallback: press Enter in the password field
    await passwordField.press("Enter", { timeout: 5_000 }).catch(() => {});
  }

  await navigationPromise;
  // Extra settle for JS-heavy auth flows
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_DELAY);

  // --- Step 5: verify ----------------------------------------------------
  const stillAtAuthWall = await detectAuthWall(page);
  if (stillAtAuthWall) {
    return { ok: false, reason: "Still at auth wall after submit — credentials may be incorrect." };
  }

  return { ok: true };
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
  usePersistedSession?: boolean,
  options: Pick<
    CrawlOptions,
    | "pageTimeout"
    | "maxRoutes"
    | "credentials"
    | "skipAxe"
    | "onAxeProgress"
    | "skipTokens"
    | "tokensSystem"
    | "onTokensProgress"
    | "captureInteractions"
    | "clickSelectors"
    | "onInteractionProgress"
  > = {},
): Promise<CrawlOutcome> {
  const pageTimeout = options.pageTimeout ?? DEFAULT_PAGE_TIMEOUT;
  const maxRoutes = options.maxRoutes ?? MAX_ROUTES;
  const credentials = options.credentials;
  const skipAxe = options.skipAxe ?? false;
  const onAxeProgress = options.onAxeProgress;
  const skipTokens = options.skipTokens ?? false;
  const tokensSystem: DesignSystemName = options.tokensSystem ?? "material3";
  const onTokensProgress = options.onTokensProgress;
  const captureInteractions = options.captureInteractions ?? true;
  const clickSelectors = options.clickSelectors;
  const onInteractionProgress = options.onInteractionProgress;
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
      await gotoWithFallback(discoveryPage, url, pageTimeout);
      await discoveryPage.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
    } catch (err) {
      console.error(`Failed to load base URL ${url}: ${(err as Error).message}`);
      throw err;
    }

    // --- Auth detection (only when no cookies were pre-injected) ---------
    if (!cookies || cookies.length === 0) {
      const isAuthWall = await detectAuthWall(discoveryPage);
      if (isAuthWall) {
        // Auto-login path: try credentials before surfacing to the user.
        if (credentials) {
          console.log("Auth wall detected — attempting automated login...");
          const loginResult = await attemptLogin(discoveryPage, credentials, pageTimeout);
          if (loginResult.ok) {
            console.log("✓ Automated login succeeded");
            // Capture session cookies from the discovery context so every
            // viewport reuses the authenticated session.
            const freshCookies = await discoveryCtx.cookies();
            if (freshCookies.length > 0) {
              cookies = freshCookies;
            }
          } else {
            console.warn(`✗ Automated login failed: ${loginResult.reason}`);
            const screenshotBuffer = await discoveryPage.screenshot({ fullPage: true });
            const screenshot = screenshotBuffer.toString("base64");
            const authUrl = discoveryPage.url();
            await discoveryCtx.close();
            await browser.close();
            return { needsAuth: true, authUrl, screenshot };
          }
        } else {
          const screenshotBuffer = await discoveryPage.screenshot({ fullPage: true });
          const screenshot = screenshotBuffer.toString("base64");
          const authUrl = discoveryPage.url();
          await discoveryCtx.close();
          await browser.close();
          return { needsAuth: true, authUrl, screenshot };
        }
      }
    }

    const discoveredRoutes = await discoverLinks(discoveryPage, origin);
    await discoveryCtx.close();

    // Ensure the base route is included and comes first
    const baseRoute = baseUrl.pathname.replace(/\/+$/, "") || "/";
    const allRoutes = [baseRoute, ...discoveredRoutes.filter((r) => r !== baseRoute)];

    // Limit routes to prevent timeout on large sites
    const routes = allRoutes.slice(0, maxRoutes);
    if (allRoutes.length > maxRoutes) {
      console.log(`Discovered ${allRoutes.length} route(s), limiting to first ${maxRoutes}`);
    } else {
      console.log(`Discovered ${routes.length} route(s):`);
    }
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
            await gotoWithFallback(page, fullUrl, pageTimeout);
            // Wait for load state and fonts, but don't block on networkidle
            await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
            await page.evaluate(() => document.fonts.ready).catch(() => {});
            await page.waitForTimeout(SETTLE_DELAY);

            // Cap screenshot height to prevent memory issues
            const bodyHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
            const filename = `${slug}_${vpName}.png`;
            const screenshotOpts: { path: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {
              path: path.join(outputDir, filename),
            };
            if (bodyHeight > MAX_SCREENSHOT_HEIGHT) {
              const vpSize = VIEWPORTS[vpName];
              screenshotOpts.clip = { x: 0, y: 0, width: vpSize.width, height: MAX_SCREENSHOT_HEIGHT };
            } else {
              screenshotOpts.fullPage = true;
            }
            await page.screenshot(screenshotOpts);

            // --- Deterministic a11y scan (axe-core) per viewport -----------
            // Runs AFTER the screenshot so any axe-induced DOM tweaks (none
            // expected, but defensive) can't corrupt the captured image.
            // Guarded — never let an axe failure lose the screenshot.
            let axeFindings: AxeFinding[] = [];
            if (!skipAxe) {
              try {
                onAxeProgress?.(route, vpName);
                axeFindings = await runAxe(page, vpName);
              } catch (err) {
                console.warn(`  ⚠ axe crashed on ${route} @ ${vpName}: ${(err as Error).message}`);
                axeFindings = [];
              }
            }

            console.log(`  ✓ ${route} @ ${vpName}${axeFindings.length ? ` — ${axeFindings.length} axe finding(s)` : ""}`);
            return { vpName, filename, axeFindings };
          } catch (err) {
            console.error(`  ✗ ${route} @ ${vpName}: ${(err as Error).message}`);
            return { vpName, filename: "", axeFindings: [] as AxeFinding[] };
          }
        })
      );

      const aggregatedAxe: AxeFinding[] = [];
      for (const { vpName, filename, axeFindings } of results) {
        routeEntry.screenshots[vpName] = filename;
        if (axeFindings && axeFindings.length > 0) aggregatedAxe.push(...axeFindings);
      }
      if (!skipAxe) routeEntry.axeFindings = aggregatedAxe;

      // --- Design-token drift (site-wide, run once on desktop) -------------
      // Runs after all 3 viewports are captured so tokens reflect the primary
      // layout users see. Guarded — a tokens crash must never fail the route.
      if (!skipTokens) {
        try {
          onTokensProgress?.(route);
          const tokens = await runTokenAudit(vpState.desktop.page, tokensSystem);
          if (tokens.length > 0) {
            // Re-scope IDs with the route so merged findings stay unique
            // across a multi-route crawl.
            routeEntry.tokenFindings = tokens.map((f) => ({
              ...f,
              id: `${f.id}-${slugify(route)}`,
            }));
            console.log(`  ✓ tokens: ${tokens.length} drift finding(s) on ${route}`);
          }
        } catch (err) {
          console.warn(`  ⚠ tokens crashed on ${route}: ${(err as Error).message}`);
        }
      }

      manifest.routes.push(routeEntry);

      // --- Step 3b: Interaction capture (target route only) ---------------
      // Only runs on the very first route (the URL the user asked for). We
      // scope this tight because the combinatorial cost would explode if we
      // ran it on every discovered sub-page. Desktop only for the same reason.
      const isTargetRoute = route === baseRoute;
      if (
        isTargetRoute &&
        captureInteractions &&
        routeEntry.screenshots.desktop
      ) {
        try {
          const interactionResults = await captureTabsAndInteractions(
            vpState.desktop.page,
            route,
            outputDir,
            {
              viewport: VIEWPORTS.desktop,
              maxScreenshotHeight: MAX_SCREENSHOT_HEIGHT,
              clickSelectors,
              onProgress: onInteractionProgress,
            },
          );
          for (const interaction of interactionResults) {
            // Register each captured interaction as a virtual route. Only the
            // desktop slot is populated — mobile/tablet stay empty strings so
            // the analyzer simply skips them.
            manifest.routes.push({
              route: interaction.route,
              url: `${fullUrl}#${slugify(interaction.label)}`,
              screenshots: {
                mobile: "",
                tablet: "",
                desktop: interaction.filename,
              },
            });
            console.log(`  ✓ interaction: ${interaction.label}`);
          }
        } catch (err) {
          console.warn(
            `  ⚠ interaction capture failed on ${route}: ${(err as Error).message}`,
          );
        }
      }
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
  launchRealChromeSession,
  getRealChromeUserDataDir,
  isRealChromeRunning,
  extractCookiesAndClose,
  checkSSOReturn,
  setReadySignal,
  waitForReadySignal,
  generateSessionId,
} from "./persistent-session";
