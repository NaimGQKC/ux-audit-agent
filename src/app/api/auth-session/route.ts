import { NextRequest, NextResponse } from "next/server";
import { chromium, type Browser, type BrowserContext, type Cookie } from "playwright";

// ---------------------------------------------------------------------------
// In-memory session store (never persisted to disk)
// ---------------------------------------------------------------------------

interface AuthSession {
  browser: Browser;
  context: BrowserContext;
  authUrl: string;
  createdAt: number;
}

const sessions = new Map<string, AuthSession>();

// Auto-cleanup sessions older than 10 minutes
function cleanupStaleSessions() {
  const now = Date.now();
  const ids = Array.from(sessions.keys());
  for (const id of ids) {
    const session = sessions.get(id)!;
    if (now - session.createdAt > 10 * 60 * 1000) {
      session.browser.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth-session
// Action is determined by the "action" field in the request body:
//   - "start"    → Launch headed browser at auth URL
//   - "check"    → Poll if user has authenticated
//   - "complete" → Extract cookies, close browser, return cookies
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  cleanupStaleSessions();

  let body: { action: string; authUrl?: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = body;

  // -----------------------------------------------------------------------
  // START — Launch headed Playwright browser
  // -----------------------------------------------------------------------
  if (action === "start") {
    const { authUrl } = body;
    if (!authUrl) {
      return NextResponse.json({ error: "Missing authUrl" }, { status: 400 });
    }

    try {
      const browser = await chromium.launch({
        headless: false,
        args: [
          `--window-size=1280,800`,
          `--window-position=100,100`,
        ],
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });

      const page = await context.newPage();
      await page.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

      const sessionId = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(sessionId, {
        browser,
        context,
        authUrl,
        createdAt: Date.now(),
      });

      return NextResponse.json({ sessionId });
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to launch browser: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // CHECK — Poll authentication status
  // -----------------------------------------------------------------------
  if (action === "check") {
    const { sessionId } = body;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
    }

    try {
      const pages = session.context.pages();
      const activePage = pages[pages.length - 1] || pages[0];

      if (!activePage) {
        return NextResponse.json({ authenticated: false });
      }

      const currentUrl = activePage.url();
      const cookies = await session.context.cookies();

      // Heuristics for "user has logged in":
      // 1. URL has navigated away from the auth URL
      const urlChanged = currentUrl !== session.authUrl &&
        !currentUrl.toLowerCase().includes("/login") &&
        !currentUrl.toLowerCase().includes("/signin") &&
        !currentUrl.toLowerCase().includes("/sign-in") &&
        !currentUrl.toLowerCase().includes("/auth/") &&
        !currentUrl.toLowerCase().includes("/sso/");

      // 2. No more password fields visible
      const hasPasswordField = await activePage
        .$$eval('input[type="password"]', (inputs) => inputs.length > 0)
        .catch(() => false);

      // 3. Auth-related cookies appeared (common session cookie names)
      const hasSessionCookies = cookies.some((c) => {
        const name = c.name.toLowerCase();
        return (
          name.includes("session") ||
          name.includes("token") ||
          name.includes("auth") ||
          name.includes("sid") ||
          name.includes("jwt") ||
          name.includes("_identity")
        );
      });

      const authenticated = urlChanged && !hasPasswordField && (hasSessionCookies || cookies.length > 0);

      return NextResponse.json({ authenticated });
    } catch (err) {
      return NextResponse.json(
        { error: `Check failed: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // COMPLETE — Extract cookies and close the headed browser
  // -----------------------------------------------------------------------
  if (action === "complete") {
    const { sessionId } = body;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
    }

    try {
      const cookies: Cookie[] = await session.context.cookies();
      await session.browser.close();
      sessions.delete(sessionId);

      return NextResponse.json({ cookies, cookieCount: cookies.length });
    } catch (err) {
      // Ensure cleanup even on error
      session.browser.close().catch(() => {});
      sessions.delete(sessionId);
      return NextResponse.json(
        { error: `Complete failed: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
