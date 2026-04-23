# MCP servers — shield and sword

The audit agent ships **two** MCP servers from the same codebase. They share every tool implementation (see `src/mcp/tools/`) but run in different environments and expose a slightly different tool surface.

| | Local (shield) | Remote (sword) |
|---|---|---|
| **Entrypoint** | `src/mcp/server-stdio.ts` | `src/mcp/server-http.ts` |
| **Transport** | stdio | Streamable HTTP |
| **Client** | Claude Code CLI | claude.ai custom connector |
| **Tools** | `audit_page`, `audit_site`, `quick_scan`, `audit_local` | `audit_page`, `audit_site`, `quick_scan` |
| **Claude transport** | CLI by default (zero extra API cost) | Anthropic SDK — Opus 4.7 |
| **Who uses it** | Devs during development | PMs / designers / stakeholders from claude.ai |

---

## Shield — local stdio server

Purpose: catch UX/accessibility issues **before they ship**. Developer edits a page, asks Claude Code to audit their local dev server, fixes, commits.

### Setup

Add to `.claude/settings.json` (user or project scope):

```json
{
  "mcpServers": {
    "ux-audit": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server-stdio.ts"],
      "cwd": "/absolute/path/to/ux-audit-agent"
    }
  }
}
```

Or use the `mcp:stdio` script:

```bash
npm run mcp:stdio
```

### Use

In any Claude Code session with `npm run dev` running in another terminal:

```
Audit my local signup page
```

Claude will call `audit_local` with `path: "/signup"`. It auto-detects the dev server port across `3000 / 3001 / 5173 / 4200 / 8080 / 8000 / 4321`.

If you mention a file — "audit the signup route, it's in `src/app/signup/page.tsx`" — the tool derives the URL path from the file.

---

## Sword — remote HTTP server

Purpose: let anyone with the bearer token run audits from claude.ai chat, without installing anything.

### Prerequisites

1. Anthropic API key (`ANTHROPIC_API_KEY`)
2. Fly.io account + `flyctl` CLI
3. Bearer token (`openssl rand -hex 32`) — used to auth requests

### Deploy (one-time)

```bash
# Create the Fly app (the fly.toml default app name is a placeholder —
# flyctl launch will rewrite it with whatever you pick).
flyctl launch --no-deploy

# Set secrets
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-...
flyctl secrets set MCP_BEARER_TOKEN=$(openssl rand -hex 32)
# Optional — override model
# flyctl secrets set CLAUDE_MODEL=claude-opus-4-7

# Deploy
flyctl deploy
```

Health check: `curl https://<your-app>.fly.dev/health` → `{ "ok": true, ... }`.

### Add as a connector in claude.ai

1. Open **claude.ai → Settings → Connectors → Add custom connector**.
2. **URL:** `https://<your-app>.fly.dev/mcp`
3. **Auth header:** `Authorization: Bearer <MCP_BEARER_TOKEN>`
4. Save.

In any chat:

> Audit https://staging.example.com/signup for UX issues.

Claude picks `audit_page`, streams back a prioritized list of issues with principle citations and fix recommendations.

### What's deliberately missing

`audit_local` is not registered on the remote server. "Localhost" means nothing on Fly — the tool would probe the container's own loopback and find nothing useful. Devs keep `audit_local` via the local stdio server.

---

## Architecture notes

- **Pipelines are transport-agnostic.** `src/lib/pipelines/` holds one module per audit mode (`audit-page`, `audit-site`, `quick-scan`, `audit-local`). Each is a pure function. MCP tools, API routes, and CLI scripts wrap these with the transport glue they need.
- **Claude client is auto-selected.** `src/lib/claude-client.ts` picks the Anthropic SDK when `ANTHROPIC_API_KEY` is set, otherwise the local `claude` CLI. The remote server calls `requireSDK()` on boot to fail fast if the key is missing.
- **Prompt caching.** The SDK path marks the ~12k-token framework prompt with `cache_control: ephemeral`. A 10-page audit (~10 batched calls in a 5-min window) hits the cache from batch #2 onward — ~90% input-token savings, ~30% latency improvement.
- **Stateless HTTP.** Each POST to `/mcp` spins up a fresh `McpServer` + `StreamableHTTPServerTransport`. No session tracking — every tool call is self-contained.
- **SSO determinism.** Interactive-login runs wipe the persisted browser profile before and after by default. Pass `reuseSession: true` to the audit route to opt into persistence across runs.
