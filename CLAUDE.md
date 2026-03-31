# UX Audit Agent

Internal UX audit agent — paste a URL, crawl and screenshot every page at 3 viewports (mobile 375px, tablet 768px, desktop 1440px), analyze screenshots with Claude Vision against Nielsen heuristics and WCAG guidelines, show side-by-side comparison with annotated recommendations, let users edit/approve/dismiss each issue, then push approved issues to Asana as tickets.

## Tech Stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** Tailwind CSS + shadcn/ui
- **Crawling:** Playwright (headless browser screenshotting)
- **Analysis:** Claude CLI (`claude --print`) for vision-based UX/WCAG analysis — zero API cost
- **Ticketing:** Asana API integration

## Project Structure

```
src/
├── app/              # Next.js App Router pages and layouts (dashboard UI)
├── components/ui/    # shadcn/ui components
├── lib/
│   ├── crawler/      # Playwright-based page crawling and screenshotting
│   ├── analyzer/     # Claude Vision analysis against heuristics/WCAG
│   ├── asana/        # Asana ticket creation from approved issues
│   └── utils.ts      # Shared utilities (shadcn/ui)
```

## Commands

- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint

## Stitch Integration

Google Stitch is a remote MCP-based UI generation service used to produce visual fix mockups.

**Architecture — two separate pipelines connected at the issue level:**

1. **Audit pipeline** (crawler → analyzer): Discovers UX issues via Playwright screenshots + Claude Vision analysis
2. **Stitch pipeline** (generate → review → refine): Creates visual fix mockups for discovered issues
3. **Dashboard**: Orchestrates both pipelines — shows issues, generates fixes, supports refinement, pushes to Asana

**Key modules:**

- `src/lib/stitch/types.ts` — Shared types (`StitchProject`, `GenerateFixRequest`, `UXIssueWithFix`, etc.)
- `src/lib/stitch/index.ts` — MCP client wrapping `claude --print` calls to Stitch tools
- `src/lib/stitch/design-system-defaults.ts` — Default design tokens + brand config helpers
- `src/app/api/stitch/` — API routes for generate-fix, edit-screen, generate-variants, design-system, setup

**Setup:** See `src/lib/stitch/mcp-setup.md` for Stitch API key + Claude Code MCP configuration.
