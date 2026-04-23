/**
 * Opt-in API authentication for the internal Next.js routes.
 *
 * Design:
 *  - When UX_AUDIT_API_TOKEN is NOT set, auth is disabled. This keeps local
 *    dev + Claude Code stdio usage friction-free on a developer's laptop.
 *  - When UX_AUDIT_API_TOKEN IS set (e.g. in a hosted deploy), every
 *    internal route must carry a matching bearer token in either the
 *    `Authorization: Bearer ...` header or the `x-ux-audit-token` header.
 *  - Compared with crypto.timingSafeEqual to defeat timing attacks.
 *  - Returns a NextResponse 401 when auth fails; callers short-circuit on it.
 *
 * The Slack routes and the public MCP HTTP server have their own auth schemes
 * (Slack signature, MCP bearer) and do NOT need to call requireApiAuth.
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";

const TOKEN_HEADER = "x-ux-audit-token";

function configuredToken(): string | null {
  const token = process.env.UX_AUDIT_API_TOKEN;
  if (!token) return null;
  if (token.length < 16) {
    // Treat a too-short token as unset — better to be obvious than to accept
    // a weak value silently.
    if (process.env.NODE_ENV === "production") {
      console.error("[security] UX_AUDIT_API_TOKEN is set but shorter than 16 chars — refusing to use it.");
    }
    return null;
  }
  return token;
}

function extractPresentedToken(request: Request): string | null {
  const headerAuth = request.headers.get("authorization");
  if (headerAuth) {
    const match = /^Bearer\s+(.+)$/i.exec(headerAuth);
    if (match) return match[1].trim();
  }
  const custom = request.headers.get(TOKEN_HEADER);
  if (custom) return custom.trim();
  return null;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * Returns a NextResponse (401) if auth is required and fails.
 * Returns `null` if the request is allowed to proceed.
 *
 * Usage:
 *   const denied = requireApiAuth(request);
 *   if (denied) return denied;
 */
export function requireApiAuth(request: Request): NextResponse | null {
  const token = configuredToken();
  if (!token) return null; // auth disabled in this environment

  const presented = extractPresentedToken(request);
  if (!presented) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="ux-audit"' } },
    );
  }
  if (!timingSafeEqualStrings(presented, token)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="ux-audit"' } },
    );
  }
  return null;
}

export function apiAuthEnabled(): boolean {
  return configuredToken() !== null;
}
