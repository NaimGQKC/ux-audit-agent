/**
 * Persistent browser session management.
 *
 * Uses Playwright's launchPersistentContext() with a shared userDataDir
 * at ~/.ux-audit-agent/browser-profile/ so cookies, localStorage, and
 * SSO tokens survive across audits.
 */

import { chromium, type Browser, type BrowserContext, type Cookie } from "playwright";
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

/**
 * Resolve the user's real Google Chrome user-data directory for the current OS.
 * Returns null if no install is found at the default location.
 */
export function getRealChromeUserDataDir(): string | null {
  const platform = os.platform();
  const home = os.homedir();
  let candidate: string | null = null;
  if (platform === "win32") {
    candidate = path.join(home, "AppData", "Local", "Google", "Chrome", "User Data");
  } else if (platform === "darwin") {
    candidate = path.join(home, "Library", "Application Support", "Google", "Chrome");
  } else if (platform === "linux") {
    candidate = path.join(home, ".config", "google-chrome");
  }
  if (candidate && fs.existsSync(candidate)) return candidate;
  return null;
}

/** True if Chrome appears to be running (SingletonLock present in user data dir). */
export function isRealChromeRunning(): boolean {
  const dir = getRealChromeUserDataDir();
  if (!dir) return false;
  return (
    fs.existsSync(path.join(dir, "SingletonLock")) ||
    fs.existsSync(path.join(dir, "SingletonSocket"))
  );
}

/**
 * Remove stale Chromium Singleton* lock files from the profile directory.
 *
 * Why: on Windows, when Chromium is force-killed (extension crash, OS
 * shutdown, Playwright timeout), it leaves SingletonLock / SingletonCookie /
 * SingletonSocket files behind. The next launchPersistentContext() spawns
 * Chrome, Chrome sees the lock, exits with code 21, and Playwright reports
 * "Target page, context or browser has been closed". Clearing these files
 * before each launch makes the persistent profile robust to unclean shutdowns.
 *
 * Cookies and session state live in Default/ — not touched here.
 */
function clearProfileLocks(): void {
  if (!fs.existsSync(BROWSER_PROFILE_DIR)) return;
  const lockFiles = [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    path.join("Default", "lockfile"),
  ];
  for (const name of lockFiles) {
    const p = path.join(BROWSER_PROFILE_DIR, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      // best-effort — don't block the launch if one lock refuses to unlink
    }
  }
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

/**
 * Blocks until the user clicks "I'm logged in, start crawling".
 *
 * Timeout bumped 5→15 min: an SSO login can sit in the background behind a
 * fullscreen app (movie, game) for several minutes before the user notices.
 * 15 min matches the audit route's maxDuration and leaves plenty of headroom.
 */
export function waitForReadySignal(
  sessionId: string,
  timeoutMs = 900_000
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
        reject(
          new Error(
            "Interactive login timed out (15 min). If the login browser didn't appear, check your taskbar — a fullscreen app may have hidden it.",
          ),
        );
      }
    }, 500);
  });
}

// ---------------------------------------------------------------------------
// Active headed-browser sessions
// ---------------------------------------------------------------------------

interface ActiveSession {
  context: BrowserContext;
  /** Set when the session uses a non-persistent Browser that must be closed alongside the context. */
  browser?: Browser;
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
      session.browser?.close().catch(() => {});
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
  clearProfileLocks();

  const launchOpts = {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      "--window-size=1280,800",
      "--window-position=100,100",
      // Disable extensions so a misbehaving extension (e.g. content.js crash)
      // can't kill the profile on startup.
      "--disable-extensions",
    ],
  };

  let context: BrowserContext;
  let browser: Browser | undefined;
  try {
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, launchOpts);
  } catch (err) {
    // One retry: sometimes a lock file we couldn't remove gets released a
    // moment later (Windows file handle drain).
    clearProfileLocks();
    await new Promise((r) => setTimeout(r, 500));
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, launchOpts);
    } catch (err2) {
      // Fallback: persistent profile won't launch (corrupted profile, AV
      // blocking the remote-debugging-pipe, Windows Credential Manager lock).
      // Spin up a non-persistent headed browser instead — the user still gets
      // the login window, and we still extract cookies at the end. They just
      // won't survive across runs. Nuke the bad profile so next run can retry.
      console.warn(
        `Persistent browser profile failed to launch — falling back to non-persistent. Original error: ${(err as Error).message}. Retry error: ${(err2 as Error).message}`,
      );
      try { clearBrowserProfile(); } catch { /* ignore */ }
      browser = await chromium.launch({
        headless: false,
        args: launchOpts.args,
      });
      context = await browser.newContext({ viewport: launchOpts.viewport });
    }
  }

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Raise the login window so it's visible even when a fullscreen app is in
  // front. Windows focus-stealing protection may still block this, but it
  // generally succeeds via --foreground-burst-on-startup semantics.
  await page.bringToFront().catch(() => {});

  const origin = new URL(url).origin;
  const sessionId = generateSessionId();
  activeSessions.set(sessionId, {
    context,
    browser,
    createdAt: Date.now(),
    requestedOrigin: origin,
  });

  return { sessionId };
}

/**
 * Launch the user's real Google Chrome using their actual user-data directory,
 * so sessions / SSO cookies they already have logged in apply to the audit.
 *
 * ⚠️ Chrome must be fully closed before calling — otherwise the profile is
 * locked and Chromium exits immediately. We detect this via SingletonLock and
 * throw a clear error.
 *
 * Supports headed and headless. Headless mode is useful for CI / background
 * runs, but some sites detect headless and behave differently.
 */
export async function launchRealChromeSession(
  url: string,
  opts: { headless: boolean }
): Promise<{ sessionId: string }> {
  cleanupStaleSessions();

  const userDataDir = getRealChromeUserDataDir();
  if (!userDataDir) {
    throw new Error(
      "Could not find Google Chrome installation. Install Chrome at the default location, or use the default browser profile option instead."
    );
  }
  if (isRealChromeRunning()) {
    throw new Error(
      "Google Chrome is currently running. Quit Chrome completely (check the system tray / menu bar) and try again. Your audit needs exclusive access to the profile."
    );
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: opts.headless,
      viewport: opts.headless ? { width: 1440, height: 900 } : null,
      args: [
        "--disable-blink-features=AutomationControlled",
        ...(opts.headless ? [] : ["--window-size=1280,800", "--window-position=100,100"]),
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });
  } catch (err) {
    throw new Error(
      `Failed to launch Google Chrome with your real profile. Make sure Chrome is fully closed (including background tasks) and try again. Underlying error: ${(err as Error).message}`,
    );
  }

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Raise the login window so it's visible even when a fullscreen app is in
  // front. Windows focus-stealing protection may still block this, but it
  // generally succeeds via --foreground-burst-on-startup semantics.
  await page.bringToFront().catch(() => {});

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
  await session.context.close().catch(() => {});
  await session.browser?.close().catch(() => {});
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
  clearProfileLocks();

  const launchOpts = {
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-extensions"],
  };

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, launchOpts);
  } catch {
    clearProfileLocks();
    await new Promise((r) => setTimeout(r, 500));
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, launchOpts);
  }

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
