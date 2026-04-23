import { NextRequest, NextResponse } from "next/server";
import {
  launchHeadedPersistentBrowser,
  extractCookiesAndClose,
  checkSSOReturn,
  setReadySignal,
  clearBrowserProfile,
  hasPersistedSession,
} from "@/lib/crawler";
import {
  requireApiAuth,
  sanitizeError,
  logError,
  validatePublicUrl,
  validateLocalUrl,
} from "@/lib/security";

// Session IDs are UUIDs we generate. Reject anything else before using them.
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

// ---------------------------------------------------------------------------
// GET /api/auth-session  — check if a persisted session exists on disk
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const denied = requireApiAuth(request);
  if (denied) return denied;
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
  const denied = requireApiAuth(request);
  if (denied) return denied;

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

    // Validate URL: block SSRF targets in production; permit loopback in dev so
    // a developer can auth-session their own `npm run dev`.
    let validation = validatePublicUrl(url);
    if (!validation.ok && process.env.NODE_ENV !== "production") {
      // Dev-only fallback: allow loopback dev servers.
      const localCheck = validateLocalUrl(url);
      if (localCheck.ok) validation = localCheck;
    }
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    try {
      const { sessionId } = await launchHeadedPersistentBrowser(validation.url!);
      return NextResponse.json({ sessionId });
    } catch (err) {
      logError("[auth-session/start]", err);
      return NextResponse.json(
        { error: sanitizeError(err, "Failed to launch browser.") },
        { status: 500 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // CHECK-SSO — Poll: has the user navigated back to the original origin?
  // -----------------------------------------------------------------------
  if (action === "check-sso") {
    const { sessionId } = body;
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
      return NextResponse.json({ error: "Missing or invalid sessionId" }, { status: 400 });
    }

    try {
      const result = await checkSSOReturn(sessionId);
      return NextResponse.json(result);
    } catch (err) {
      logError("[auth-session/check-sso]", err);
      return NextResponse.json(
        { error: sanitizeError(err, "Session not found.") },
        { status: 404 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // COMPLETE — Extract cookies from persistent context and close browser
  // -----------------------------------------------------------------------
  if (action === "complete") {
    const { sessionId } = body;
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
      return NextResponse.json({ error: "Missing or invalid sessionId" }, { status: 400 });
    }

    try {
      const cookies = await extractCookiesAndClose(sessionId);
      return NextResponse.json({ cookies, cookieCount: cookies.length });
    } catch (err) {
      logError("[auth-session/complete]", err);
      return NextResponse.json(
        { error: sanitizeError(err, "Session not found.") },
        { status: 404 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // PROCEED — Signal that user has finished logging in (interactive mode)
  // -----------------------------------------------------------------------
  if (action === "proceed") {
    const { sessionId } = body;
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
      return NextResponse.json({ error: "Missing or invalid sessionId" }, { status: 400 });
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
