/**
 * Shared cookies_json parser for the remote-MCP escape hatch.
 *
 * The remote HTTP server (Fly.io container) can't drive a headed browser
 * on the user's machine, so SSO has to be bridged manually: the user logs
 * in via their normal browser, exports cookies from DevTools' Application
 * → Cookies panel, and pastes the JSON into audit_page / audit_site.
 *
 * This parser is deliberately strict — malformed cookies from a model
 * confused by escaping would silently be dropped by Playwright, producing
 * a baffling "needs auth" error instead of a clear input validation error.
 */

import type { Cookie } from "@/lib/crawler";

const MAX_COOKIES = 500;
const MAX_COOKIES_JSON_BYTES = 256 * 1024; // 256 KB — plenty for any legit export

export interface CookiesParseError {
  ok: false;
  error: string;
}

export interface CookiesParseOk {
  ok: true;
  cookies: Cookie[];
}

export type CookiesParseResult = CookiesParseOk | CookiesParseError;

export function parseCookiesJson(raw: string | undefined): CookiesParseResult {
  if (!raw) return { ok: true, cookies: [] };
  if (Buffer.byteLength(raw, "utf-8") > MAX_COOKIES_JSON_BYTES) {
    return { ok: false, error: "cookies_json exceeds 256 KB." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "cookies_json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "cookies_json must be a JSON array of cookie objects." };
  }
  if (parsed.length > MAX_COOKIES) {
    return { ok: false, error: `cookies_json has ${parsed.length} entries; max ${MAX_COOKIES}.` };
  }

  const cookies: Cookie[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `cookies_json[${i}] is not an object.` };
    }
    const rec = raw as Record<string, unknown>;
    if (
      typeof rec.name !== "string" ||
      typeof rec.value !== "string" ||
      typeof rec.domain !== "string" ||
      typeof rec.path !== "string"
    ) {
      return {
        ok: false,
        error: `cookies_json[${i}] must have string fields: name, value, domain, path. These are the minimum Playwright requires; the others are optional.`,
      };
    }

    // Playwright's Cookie type requires every field; fill in conservative
    // defaults (session cookie, non-secure, Lax) when the export omits them.
    // These match DevTools' defaults for flags that are implicit in the UI.
    const cookie: Cookie = {
      name: rec.name,
      value: rec.value,
      domain: rec.domain,
      path: rec.path,
      expires: typeof rec.expires === "number" ? rec.expires : -1,
      httpOnly: typeof rec.httpOnly === "boolean" ? rec.httpOnly : false,
      secure: typeof rec.secure === "boolean" ? rec.secure : false,
      sameSite:
        rec.sameSite === "Strict" || rec.sameSite === "Lax" || rec.sameSite === "None"
          ? rec.sameSite
          : "Lax",
    };
    cookies.push(cookie);
  }

  return { ok: true, cookies };
}
