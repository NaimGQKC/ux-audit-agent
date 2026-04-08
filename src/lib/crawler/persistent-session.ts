/**
 * Persistent browser session management.
 *
 * Uses Playwright's launchPersistentContext() with a shared userDataDir
 * at ~/.ux-audit-agent/browser-profile/ so cookies, localStorage, and
 * SSO tokens survive across audits.
 */

import { chromium, type BrowserContext, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Profile directory
// ---------------------------------------------------------------------------

export const BROWSER_PROFILE_DIR = path.join(
  os.homedir(),
  ".ux-audit-agent",
  "browser-profile"
);

export function hasPersistedSession(): boolean {
  // Chromium stores profile data in a "Default" subfolder
  return (
    fs.existsSync(BROWSER_PROFILE_DIR) &&
    fs.existsSync(path.join(BROWSER_PROFILE_DIR, "Default"))
  );
}

export function clearBrowserProfile(): boolean {
  if (fs.existsSync(BROWSER_PROFILE_DIR)) {
    fs.rmSync(BROWSER_PROFILE_DIR, { recursive: true, force: true });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Ready-signal coordination (interactive login "I'm logged in" button)
// ---------------------------------------------------------------------------

const readySignals = new Map<string, boolean>();

export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Called by the frontend via POST /api/auth-session { action: "proceed" } */
export function setReadySignal(sessionId: string): void {
  readySignals.set(sessionId, true);
}

/** Blocks until the user clicks "I'm logged in, start crawling". */
export function waitForReadySignal(
  sessionId: string,
  timeoutMs = 300_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (readySignals.get(sessionId)) {
        clearInterval(interval);
        readySignals.delete(sessionId);
        resolve();
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        readySignals.delete(sessionId);
        reject(new Error("Interactive login timed out (5 min)"));
      }
    }, 500);
  });
}

// ---------------------------------------------------------------------------
// Active headed-browser sessions
// ---------------------------------------------------------------------------

interface ActiveSession {
  context: BrowserContext;
  createdAt: number;
  requestedOrigin: string;
}

const activeSessions = new Map<string, ActiveSession>();

/** Clean up sessions older than 10 minutes. */
function cleanupStaleSessions() {
  const now = Date.now();
  for (const [id, session] of Array.from(activeSessions.entries())) {
    if (now - session.createdAt > 10 * 60 * 1000) {
      session.context.close().catch(() => {});
      activeSessions.delete(id);
    }
  }
}

/**
 * Launch a headed persistent browser at the given URL.
 * Returns a sessionId the frontend can use to signal "I'm done logging in".
 */
export async function launchHeadedPersistentBrowser(
  url: string
): Promise<{ sessionId: string }> {
  cleanupStaleSessions();

  fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--window-size=1280,800", "--window-position=100,100"],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const origin = new URL(url).origin;
  const sessionId = generateSessionId();
  activeSessions.set(sessionId, {
    context,
    createdAt: Date.now(),
    requestedOrigin: origin,
  });

  return { sessionId };
}

/**
 * Check whether the browser has returned to the original origin
 * (after an SSO redirect the user completed login and got bounced back).
 */
export async function checkSSOReturn(
  sessionId: string
): Promise<{ returned: boolean; currentUrl: string }> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  const pages = session.context.pages();
  const activePage = pages[pages.length - 1] || pages[0];
  if (!activePage) return { returned: false, currentUrl: "" };

  const currentUrl = activePage.url();
  try {
    const currentOrigin = new URL(currentUrl).origin;
    return {
      returned: currentOrigin === session.requestedOrigin,
      currentUrl,
    };
  } catch {
    return { returned: false, currentUrl };
  }
}

/**
 * Extract all cookies from the persistent context and close the browser.
 * The profile on disk retains everything for next time.
 */
export async function extractCookiesAndClose(
  sessionId: string
): Promise<Cookie[]> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  const cookies = await session.context.cookies();
  await session.context.close();
  activeSessions.delete(sessionId);

  return cookies;
}

/**
 * Launch a headless persistent context, navigate, extract cookies, close.
 * Returns the cookies and the final URL (to detect SSO redirects).
 */
export async function headlessPersistentNavigate(
  url: string
): Promise<{ cookies: Cookie[]; finalUrl: string }> {
  fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    // Even on timeout, capture what we have
  }

  const finalUrl = page.url();
  const cookies = await context.cookies();
  await context.close();

  return { cookies, finalUrl };
}
