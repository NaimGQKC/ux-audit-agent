# UX Audit Agent

Internal UX audit agent — paste a URL, crawl and screenshot every page at 3 viewports (mobile 375px, tablet 768px, desktop 1440px), analyze screenshots with Claude Vision against a comprehensive evaluation framework, show side-by-side comparison with annotated recommendations, let users edit/approve/dismiss each issue, then push approved issues to Asana as tickets.

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

## Analysis Framework

The analyzer evaluates screenshots against 11 criteria lenses (defined in `src/lib/analyzer/ux-analysis-prompt.txt`):

1. **Nielsen's 10 Usability Heuristics** — system status, user control, consistency, error prevention, etc.
2. **UX Laws** — Hick's, Fitts's, Miller's, Jakob's, Von Restorff, Peak-End, Aesthetic-Usability
3. **WCAG 2.1/2.2 AA** — full Perceivable/Operable/Understandable/Robust criteria with specific success criteria
4. **Gestalt Principles** — alignment, proximity, similarity, contrast, spacing, proportion
5. **Cognitive Psychology** — cognitive load, attention, working memory, progressive disclosure
6. **Interactive Affordances** — buttons, links, inputs, state feedback, clickability signals
7. **State Matrix** — loading, empty, error, partial failure states
8. **Typography & Spacing** — type scale, hierarchy, vertical rhythm, readability
9. **Mobile Responsiveness** — overflow, stacking, touch spacing
10. **Navigation & Information Architecture** — wayfinding, labeling, content priority
11. **Microinteractions & Feedback** — loading states, validation, destructive action safety, confirmations

Each issue includes a `principle` field citing the specific heuristic, law, or WCAG criterion violated (e.g., "Nielsen #1 — Visibility of system status", "WCAG 1.4.3 — Contrast minimum", "Fitts's Law").

## Installed Skills

UX/UI skills in `.agents/skills/` provide reference material used by the analysis framework:
- `ui-design-system` — shadcn/ui + Tailwind + Radix patterns, design tokens, WCAG contrast, OKLCH
- `software-ui-ux-design` — Nielsen heuristics, WCAG 2.2, state matrix, design tokens, platform constraints
- `design-critique` — 11-lens evaluation framework, UX laws, Gestalt, cognitive psychology, microinteractions
- `review-ux-ui` — 7-step review procedure, keyboard/screen reader audit, cognitive load, form usability

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
