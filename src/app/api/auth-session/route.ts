import { NextRequest, NextResponse } from "next/server";
import {
  launchHeadedPersistentBrowser,
  extractCookiesAndClose,
  checkSSOReturn,
  setReadySignal,
  clearBrowserProfile,
  hasPersistedSession,
} from "@/lib/crawler";

// ---------------------------------------------------------------------------
// GET /api/auth-session  — check if a persisted session exists on disk
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({ hasSession: hasPersistedSession() });
}

// ---------------------------------------------------------------------------
// POST /api/auth-session
// Actions:
//   "start"         → Launch headed persistent browser at URL
//   "check-sso"     → Poll: has user returned to the original origin?
//   "complete"       → Extract cookies and close the headed browser
//   "proceed"        → Signal "I'm logged in" (unblocks the audit SSE stream)
//   "clear-profile"  → Delete the persisted browser profile from disk
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: {
    action: string;
    url?: string;
    sessionId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = body;

  // -----------------------------------------------------------------------
  // START — Launch headed persistent browser
  // -----------------------------------------------------------------------
  if (action === "start") {
    const { url } = body;
    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    // Validate URL is http(s) — prevent launching browser to arbitrary protocols
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json({ error: "URL must use http or https protocol" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    try {
      const { sessionId } = await launchHeadedPersistentBrowser(url);
      return NextResponse.json({ sessionId });
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to launch browser: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // CHECK-SSO — Poll: has the user navigated back to the original origin?
  // -----------------------------------------------------------------------
  if (action === "check-sso") {
    const { sessionId } = body;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    try {
      const result = await checkSSOReturn(sessionId);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 404 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // COMPLETE — Extract cookies from persistent context and close browser
  // -----------------------------------------------------------------------
  if (action === "complete") {
    const { sessionId } = body;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    try {
      const cookies = await extractCookiesAndClose(sessionId);
      return NextResponse.json({ cookies, cookieCount: cookies.length });
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 404 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // PROCEED — Signal that user has finished logging in (interactive mode)
  // -----------------------------------------------------------------------
  if (action === "proceed") {
    const { sessionId } = body;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    setReadySignal(sessionId);
    return NextResponse.json({ ok: true });
  }

  // -----------------------------------------------------------------------
  // CLEAR-PROFILE — Delete the persisted browser profile from disk
  // -----------------------------------------------------------------------
  if (action === "clear-profile") {
    const cleared = clearBrowserProfile();
    return NextResponse.json({ cleared });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
