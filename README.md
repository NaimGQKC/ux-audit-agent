# UX Audit Agent

Automated UX audit tool that crawls websites, screenshots every page at 3 viewports, analyzes them with Claude Vision against Nielsen heuristics and WCAG guidelines, and lets you generate visual fix mockups with Google Stitch.

Ships two interchangeable fronts:
- **Shield** — local MCP server (stdio) for Claude Code; audits your dev server as you code.
- **Sword** — remote MCP server (Streamable HTTP) deployed to Fly.io; PMs/designers/leadership run audits from claude.ai chat on any URL.

See `docs/mcp-servers.md` for the setup and deployment guide.

## Architecture

```
URL Input
    |
    v
[Crawler] ── Playwright headless browser
    |         Screenshots at mobile (375px), tablet (768px), desktop (1440px)
    v
[Analyzer] ── Claude CLI (claude --print) with Vision
    |          Nielsen heuristics + WCAG 2.1 AA analysis
    v
[Dashboard] ── Next.js App Router
    |           Side-by-side: Original | Annotated Issues | Generated Fix
    |           Review, edit, approve, dismiss issues
    |
    ├──> [Stitch Pipeline] ── Google Stitch MCP (optional)
    |     Generate visual fix mockups, refine, create variants
    |
    └──> [Asana] ── Push approved issues as tickets
```

**Two separate pipelines connected at the issue level:**

1. **Audit pipeline** (crawler → analyzer): Discovers UX issues
2. **Stitch pipeline** (generate → review → refine): Creates visual fix mockups
3. **Dashboard**: Orchestrates both, pushes approved issues to Asana

## Setup

### Prerequisites

- Node.js 18+
- Claude Code CLI installed and authenticated

### Installation

```bash
npm install
npx playwright install chromium
```

### Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Required for Asana integration:
```
ASANA_ACCESS_TOKEN=your-token
ASANA_PROJECT_ID=your-project-gid
```

Optional for Stitch fix generation:
```
STITCH_API_KEY=your-stitch-api-key
STITCH_DESIGN_SYSTEM_ID=optional-existing-id
```

### Stitch MCP Setup (Optional)

To enable visual fix generation, add Google Stitch to Claude Code:

```bash
claude mcp add stitch --transport http https://stitch.googleapis.com/mcp \
  --header "X-Goog-Api-Key: YOUR-STITCH-KEY" -s user
```

Verify with `claude mcp list`. See `src/lib/stitch/mcp-setup.md` for details.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Run audit** — Paste a URL and click "Run Audit". The tool crawls the site, captures screenshots, and analyzes with Claude Vision.
2. **Review issues** — Each issue shows severity, category, description, and recommendation. Use the side-by-side view to see original vs annotated screenshots.
3. **Generate fixes** (requires Stitch) — Click "Generate Fix" on any issue to produce a visual mockup of the recommended fix.
4. **Refine fixes** — Use the "Refine" button to iterate on generated fixes with natural language instructions.
5. **View variants** — Click "Show Variants" to see 3 alternative fix approaches.
6. **Approve/dismiss** — Mark issues as approved or dismissed.
7. **Push to Asana** — Click "Push to Asana" to create tickets for all approved issues (includes fix mockup links if available).

## Authenticated audits & SSO

The audit agent ships as two MCP servers with different auth capabilities. Pick the one that matches how you're running Claude:

| Mode | Transport | Runs on | SSO support |
|---|---|---|---|
| **Local stdio** (shield) | stdio, spawned by Claude Code | Your laptop | Full — real headed Chrome handshake via `auth_session` |
| **Remote HTTP** (sword) | HTTP, claude.ai custom connector | Fly.io container | Cookie paste via `cookies_json` (no browser surface) |

The local server can open a real Chrome window on your screen to complete an SSO flow; the remote server cannot. If you need to audit anything behind Okta / Google Workspace / Microsoft Entra / a corporate IdP, use the local stdio server.

### Local stdio — recommended for SSO

The local server exposes an `auth_session` tool that opens a headed Chrome window against a persistent profile at `~/.ux-audit-agent/browser-profile/`. Complete the SSO flow once; every subsequent audit reuses the profile in headless mode automatically.

**1. Authenticate once** — from any Claude Code chat with the local MCP attached:

```
auth_session({ url: "https://app.example.com" })
```

A Chrome window opens at that URL. Complete Okta / Google / Microsoft / whatever your IdP is. The tool polls internally via `checkSSOReturn()` — as soon as the browser lands back on the original origin, it closes cleanly and the profile is flushed to disk.

**2. Audit normally** — no cookies, credentials, or config needed:

```
audit_page({ url: "https://app.example.com/dashboard" })
audit_site({ url: "https://app.example.com", max_pages: 10 })
audit_local({ path: "/dashboard" })
```

The crawler detects the persisted profile (`hasPersistedSession()`) and reuses it headlessly via `headlessPersistentNavigate()`. If the IdP expired your session, the audit surfaces a precise error pointing you back at `auth_session` to refresh.

**3. Done.** Profiles persist across runs (`freshProfile: false`, `wipeProfileAfter: false`) so the same session backs every future audit call until the IdP invalidates it.

### Remote HTTP — `cookies_json` escape hatch

The Fly-hosted server has no way to pop a browser on your machine, so SSO has to be bridged manually. The remote `audit_page` and `audit_site` tools accept an optional `cookies_json` parameter — paste cookies exported from DevTools:

1. Log into the target app in your normal browser
2. Open DevTools → **Application** → **Cookies** → select the origin
3. Copy the cookies as JSON and pass the stringified array:

```
audit_page({
  url: "https://app.example.com/dashboard",
  cookies_json: "[{\"name\":\"session\",\"value\":\"...\",\"domain\":\".example.com\",\"path\":\"/\"}]"
})
```

Each entry must have `name`, `value`, `domain`, `path` as strings. Optional: `expires` (number), `httpOnly` (bool), `secure` (bool), `sameSite` (`"Strict"` / `"Lax"` / `"None"`). Cookies live only for that single request — nothing is persisted server-side.

For anything requiring frequent re-auth, prefer the local stdio server.

### Troubleshooting auth

- **"SSO redirect triggered… run auth_session again"** — the IdP expired your session on disk. Re-run `auth_session({ url })` against the same origin; the profile is updated in place.
- **Session looks wedged / wrong user** — run `clear_auth_session({})` to wipe `~/.ux-audit-agent/browser-profile/`, then `auth_session` to establish a fresh one.
- **Multiple different SSO tenants** — the profile is shared across origins, so logging into a second tenant just adds to it. If two tenants conflict (e.g. two Google Workspace accounts fighting for the active session), clear the profile and re-auth against the one you need.
- **Remote cookies rejected** — the parser requires `name`, `value`, `domain`, `path` on every entry. Export from DevTools' Application → Cookies panel, not just the document.cookie string from the console.
- **Chromium won't launch after a crash** — stale lock files in the profile dir. `clear_auth_session` or delete `~/.ux-audit-agent/browser-profile/SingletonLock` and retry.

## Tech Stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** Tailwind CSS + shadcn/ui
- **Crawling:** Playwright (headless Chromium)
- **Analysis:** Claude CLI (`claude --print`) — zero API cost
- **Fix Generation:** Google Stitch MCP (optional)
- **Ticketing:** Asana REST API

## Project Structure

```
src/
├── app/
│   ├── page.tsx                          # Dashboard UI
│   └── api/
│       ├── audit/route.ts                # Audit pipeline (SSE)
│       ├── rewrite/route.ts              # AI issue rewriting
│       ├── asana/route.ts                # Asana ticket creation
│       ├── parse-document/route.ts       # PRD file parsing
│       └── stitch/
│           ├── generate-fix/route.ts     # Generate fix mockup
│           ├── edit-screen/route.ts      # Refine a fix
│           ├── generate-variants/route.ts # Multiple fix options
│           ├── design-system/route.ts    # Brand design system
│           └── setup/route.ts            # Connection check
├── lib/
│   ├── crawler/                          # Playwright screenshotting
│   ├── analyzer/                         # UX analysis types + prompts
│   ├── asana/                            # Asana API client
│   ├── stitch/                           # Stitch MCP client
│   │   ├── types.ts                      # Shared types
│   │   ├── index.ts                      # MCP call wrappers
│   │   └── design-system-defaults.ts     # Default design tokens
│   ├── claude.ts                         # Claude CLI helper
│   └── utils.ts                          # shadcn/ui utilities
└── components/ui/                        # shadcn/ui components
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Playwright not installed | Run `npx playwright install chromium` |
| `claude` CLI not found | Install Claude Code and ensure it's on PATH |
| `claude --print` timeout | Analysis can take 2-4 minutes for large sites — increase `maxDuration` if needed |
| Stitch buttons not visible | Set `STITCH_API_KEY` in `.env.local` and restart dev server |
| Stitch fix generation fails | Run `claude mcp list` and verify `stitch` is connected |
| Stitch timeout | Generation can take up to 2 minutes — retry the request |
| Asana push fails | Verify `ASANA_ACCESS_TOKEN` and `ASANA_PROJECT_ID` in `.env.local` |

## Commands

```bash
npm run dev     # Start dev server
npm run build   # Production build
npm run lint    # ESLint
```
