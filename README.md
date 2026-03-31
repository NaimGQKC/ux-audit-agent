# UX Audit Agent

Automated UX audit tool that crawls websites, screenshots every page at 3 viewports, analyzes them with Claude Vision against Nielsen heuristics and WCAG guidelines, and lets you generate visual fix mockups with Google Stitch.

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
