/**
 * MCP tools: auth_session + clear_auth_session — LOCAL-ONLY.
 *
 * The bridge between MCP (stdio, no UI channel) and interactive browser
 * login. Opens a real headed Chrome window on the developer's machine at
 * the given URL, lets them complete whatever SSO / MFA / device-flow their
 * IdP demands, then persists the session under
 * ~/.ux-audit-agent/browser-profile/ for subsequent headless audits.
 *
 * This works because the local stdio server is a Node subprocess that
 * Claude Code spawned on the user's laptop — it shares the screen with the
 * human. The remote HTTP server (Fly.io) cannot, which is why this tool is
 * gated behind includeLocal in src/mcp/tools/index.ts.
 *
 * Flow:
 *   1. Launch headed persistent context at `url` (freshProfile: false so
 *      any existing session is preserved on re-auth).
 *   2. Short settle delay — if the profile already had a valid session,
 *      the IdP bounce happens silently and we skip straight to "done".
 *   3. Poll checkSSOReturn — as soon as the browser lands back on the
 *      requested origin (or never left), close cleanly. Chromium flushes
 *      the profile to disk on clean close.
 *   4. extractCookiesAndClose with wipeProfileAfter: false — the only way
 *      to close the context without nuking the freshly-saved state.
 *
 * The crawler picks up the persisted profile automatically on the next
 * audit call (see src/lib/pipelines/shared.ts).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  launchHeadedPersistentBrowser,
  checkSSOReturn,
  extractCookiesAndClose,
  clearBrowserProfile,
  hasPersistedSession,
  BROWSER_PROFILE_DIR,
} from "@/lib/crawler";
import { validatePublicUrl, sanitizeError, logError } from "@/lib/security";

const DEFAULT_TIMEOUT_SEC = 900; // 15 min — matches waitForReadySignal in the web UI path
const POLL_INTERVAL_MS = 2_000;
// Give an existing session a chance to silently redirect through the IdP
// and land back before we poll. Without this, polls see the pre-redirect
// URL and think login still needs to happen.
const SETTLE_BEFORE_POLL_MS = 3_000;

export function registerAuthSession(server: McpServer): void {
  server.tool(
    "auth_session",
    "Open a headed Chrome window on your machine to complete an interactive or SSO login once, then persist the session so every subsequent audit_page / audit_site / audit_local call reuses it headlessly. Required for Okta, Google Workspace, Microsoft Entra, and any identity provider that needs a human handshake. The tool waits (up to 15 min) until the browser returns to the requested origin — meaning login completed — then closes the window while keeping the profile on disk. Run clear_auth_session to wipe it. LOCAL ONLY — the remote HTTP MCP server cannot pop a browser on your screen; use its cookies_json escape hatch instead.",
    {
      url: z.string().url().describe(
        "URL of the app to log in to — usually the landing page of the site you want to audit (e.g. https://app.example.com). SSO redirects away and back are expected; the tool waits for the bounce-back to the original origin.",
      ),
      timeout_seconds: z
        .number()
        .int()
        .min(30)
        .max(1800)
        .optional()
        .describe("Max wait for login to complete, in seconds. Default 900 (15 min)."),
    },
    async ({ url, timeout_seconds }) => {
      const validation = validatePublicUrl(url);
      if (!validation.ok) {
        return {
          content: [{ type: "text" as const, text: `Rejected: ${validation.error}` }],
          isError: true,
        };
      }

      const timeoutMs = (timeout_seconds ?? DEFAULT_TIMEOUT_SEC) * 1000;
      const origin = new URL(validation.url!).origin;
      const alreadyHadSession = hasPersistedSession();

      let sessionId: string;
      try {
        ({ sessionId } = await launchHeadedPersistentBrowser(validation.url!, {
          freshProfile: false,
        }));
      } catch (err) {
        logError("[mcp/auth_session] launch", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to launch browser: ${sanitizeError(err, "Unknown error.")}. If a Chromium lock file is stuck, run clear_auth_session and try again.`,
            },
          ],
          isError: true,
        };
      }

      // Grace period — gives an existing session a chance to auto-redirect
      // through the IdP and land back on the origin before we start polling.
      await new Promise((r) => setTimeout(r, SETTLE_BEFORE_POLL_MS));

      const deadline = Date.now() + timeoutMs;
      let detectedReturn = false;
      let lastUrl = "";

      while (Date.now() < deadline) {
        try {
          const { returned, currentUrl } = await checkSSOReturn(sessionId);
          lastUrl = currentUrl;
          if (returned) {
            detectedReturn = true;
            break;
          }
        } catch (err) {
          // Session lookup failed — most likely the user closed the window.
          // Bail out of the poll loop and try to close what's left.
          logError("[mcp/auth_session] poll", err);
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      try {
        // wipeProfileAfter: false is the critical flag — otherwise we'd
        // just deleted the session we opened the window to capture.
        await extractCookiesAndClose(sessionId, { wipeProfileAfter: false });
      } catch (err) {
        // If the user closed the window themselves, the session is already
        // gone from activeSessions. Playwright still flushes state to the
        // profile dir on its own context.close(), so we're fine either way.
        logError("[mcp/auth_session] close", err);
      }

      if (!detectedReturn) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Interactive login did not complete within ${Math.round(timeoutMs / 1000)}s. Last seen URL: ${lastUrl || "(unknown)"}. Try auth_session again; if the profile looks stale run clear_auth_session first.`,
            },
          ],
          isError: true,
        };
      }

      const verb = alreadyHadSession ? "Refreshed" : "Captured";
      return {
        content: [
          {
            type: "text" as const,
            text: `${verb} interactive session for ${origin}. Profile saved to ${BROWSER_PROFILE_DIR}. The next audit_page / audit_site / audit_local call against this origin will pick it up automatically — no cookies to paste.`,
          },
        ],
      };
    },
  );

  server.tool(
    "clear_auth_session",
    "Delete the saved interactive-login profile at ~/.ux-audit-agent/browser-profile/. Use this if the saved session is stale, you want to log in as a different user, or SSO started failing. After clearing, run auth_session again to establish a fresh session. LOCAL ONLY.",
    {},
    async () => {
      const cleared = clearBrowserProfile();
      return {
        content: [
          {
            type: "text" as const,
            text: cleared
              ? "Cleared the saved interactive-login profile. Run auth_session to establish a new session."
              : "No saved profile to clear. Run auth_session to establish a session.",
          },
        ],
      };
    },
  );
}
