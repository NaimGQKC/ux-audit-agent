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
