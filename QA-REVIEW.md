# UX Audit Agent — QA Review

_Generated 2026-04-16. Ship deadline: 2026-04-30._

## Verdict on "too much or actually good"

The core audit pipeline (crawl → axe+Lighthouse+Claude Vision → merge → review → Asana) is solid and differentiated — your moat is the subscription-CLI leverage + pre-prompt axe injection steering the LLM toward the ~43% of issues axe misses. That's the thing to protect.

But you've bolted on three directions of scope creep that each dilute focus: Stitch mockup generation, Slack bot + GitHub Action + hosted report viewer, and a 7-panel AuditForm. With 2 weeks to ship, I'd cut or defer two of the three.

---

## SHIP-BLOCKERS (fix before 2026-04-30)

### Resource leaks — will page you in prod

1. **Browser contexts aren't always closed** on error paths in `src/lib/crawler/index.ts`. Wrap every `newContext()` in try/finally, not just the happy path.
2. **Lighthouse leaks Chrome processes** when `chrome-launcher` spawns die mid-audit. Add `chrome.kill()` in finally block in `src/lib/deterministic/lighthouse.ts`.
3. **Zero-screenshots case leaves orphan directories** on disk under `public/screenshots/<runId>/`. Either skip directory creation until first successful shot, or clean up on abort.
4. **Manifest write is non-atomic** in `.audit-runs/<runId>.json` — a crash mid-write corrupts the run. Write to `.tmp` and rename.

### Data correctness

5. **Session ID weak entropy**: `Date.now() + 6-char random` collides under parallel runs. Use `crypto.randomUUID()`.
6. **Claude JSON truncation silently drops findings** — the 5-brace-repair heuristic works but there's no telemetry when it trips. Log a WARN so you notice when the flake rate rises.
7. **axe cross-viewport dedup bug** in `src/lib/deterministic/merge.ts:40` — takes `Math.max(affectedNodes)` but loses the `nodes` array from the other viewport. If desktop has 5 nodes and mobile has 3 different ones, you report 5 nodes with only desktop's selectors.
8. **Lighthouse and axe aren't deduped against each other** — the same WCAG 1.4.3 contrast issue can be reported by both tools. Merge by `wcag_ref` overlap.

### Security

9. **Slack fails-open on missing `SLACK_SIGNING_SECRET`** — signature verification silently skipped if env var absent. Must hard-fail at startup.
10. **Public APIs are unauthenticated** (`/api/audit`, `/api/stitch/*`). If this is ever exposed beyond localhost, add at minimum a shared-secret header. Document this clearly in the README if it's intentional.
11. **SSRF edge cases** — the URL validator doesn't block IPv6 loopback (`::1`, `fe80::`) or metadata endpoints (`169.254.169.254`). Easy fix, real risk.

### Error surfaces

12. **`alert()` everywhere** in `src/hooks/useAudit.ts` (rewrite, Asana push, export, brand save, variants). Modal-blocking, unthemed, mobile-hostile. Replace with shadcn `Toast` — one afternoon of work.
13. **Asana 403 aborts the entire batch** in `src/lib/asana/index.ts:314` — correct for auth failure, but a single per-task permission issue also trips this and silently drops N tasks. Distinguish token-level vs. task-level 403.

---

## UX POLISH (high-impact, low-effort — do all of these)

14. **`SettingsDrawer` has no focus trap** — comment claims "focus is trapped loosely" but there's no actual trap implementation. Use Radix `Dialog` or `FocusScope`.
15. **"Fix" tab in `ScreenshotViewer` shows blank** when the first issue has no fix generated — it renders `issues[0]` unconditionally. Should show the first issue *with* a fix, or an empty-state.
16. **Dismissed issues at `opacity-50`** likely fail WCAG AA contrast on your slate backgrounds. Verify with contrast checker; if it fails, use muted color tokens instead.
17. **Loading state has zero messaging** during the multi-minute audit — user sees a spinner and wonders if it hung. Add rolling status ("Crawling page 3/7…", "Running axe on desktop viewport…"). You already have the data in the SSE stream — just surface it.
18. **Restore-from-dismissed returns issue to "pending"**, losing the prior approved/edited state. Store prior status on dismissal, restore to it.
19. **Duplicate error banners** on `src/app/page.tsx` — same error shows twice. Consolidate.
20. **No keyboard shortcuts** for approve/dismiss despite this being the app's main repetitive action. `A` / `D` / `J` / `K` would 10x reviewer throughput.

---

## SCOPE-CREEP — consider cutting before ship

21. **Stitch integration is the biggest offender.** API routes exist (`src/app/api/stitch/*`), types are defined, but the dashboard UX around it is rough (`handleSaveBrand` in `useAudit.ts` initializes Stitch by generating a fake issue as a side effect). The value prop is unclear — you're auditing real products; generated mockups compete with the actual codebase. **Recommendation: hide behind a feature flag, ship without it, revisit after V1 lands.**
22. **AuditForm has 7 collapsible panels** (PRD, Repo, Cookies, Auto-login, Screenshot upload, Brand, Browser Session). That's Hick's-Law territory for a "paste a URL and go" tool. Collapse into 3: (1) URL + viewport, (2) Auth (cookies + auto-login + session), (3) Context (PRD + repo + brand).
23. **AuditForm references deprecated EditThisCookie extension** in help copy. Extension was removed from Chrome Web Store. Point to an alternative or drop cookie import.
24. **Session import / browser session panel is deep-config** — ask whether your ICP (design/PM teams at product companies) will ever use it. If it's there for one enterprise lead, gate it behind an "Advanced" toggle.

---

## INTEGRATIONS — reliability gaps

25. **Slack `response_url` is fire-and-forget with no retry** — network blip = user thinks the command died. Add one retry with 2s backoff.
26. **Slack slash-command path does work synchronously** instead of immediately ACK'ing and doing async work, risking 3-second Slack timeout on large audits.
27. **Asana batch doesn't validate `gid` in response** — if Asana returns a 200 with a malformed body, you log success but the task doesn't exist. Check `result.data.gid` is a non-empty string.
28. **GitHub Action PR-comment delta detection is unreliable** — compares by issue ID but IDs aren't stable across runs (`llm-*` IDs regenerate). Either hash `(title, selector, wcag_ref)` or accept that deltas are best-effort and say so.
29. **No rate limit on MCP tool routes** — a runaway client can exhaust Claude CLI quota. Add simple in-memory token bucket.

---

## SECURITY — corrections & hardening

30. **⚠️ Earlier security-agent finding about shell injection via `claude.ts` was wrong — verified.** Claim was that `shell: true` at `src/lib/claude.ts:114` enables prompt-based shell injection. I read the file: the prompt goes via `child.stdin?.write(prompt)`, never touches argv. `shell: true` is only there for Windows PATH resolution of the `claude` binary. **Not a vulnerability.** Don't waste a day "fixing" this.
31. **Slack 5-minute replay window is lenient** — Slack's own guidance is 5 min, but for a slash-command that triggers paid CLI runs, tighten to 60s.
32. **No disk budget on `public/screenshots/`** — a malicious URL that crawls infinitely will fill the disk. Enforce max pages (you have this) + max bytes per run.

---

## DEFER — post-ship

- Consolidated severity scoring across axe/Lighthouse/LLM (currently each source has its own rubric).
- Langfuse tracing (you shipped the URL-template hook already; wiring the actual trace calls can wait).
- Stitch refinement workflow (if kept at all).
- Headless report viewer auth (nice-to-have unless the report ever leaves localhost).

---

## Net recommendation for the 2-week runway

**Week 1 (ship-blockers):** items 1–13. That's all mechanical correctness + the two security must-haves. ~4 days of work.

**Week 2 (polish + cut):** items 14–20 (UX polish), item 21 (flag-gate Stitch), item 22 (collapse AuditForm panels). Ship with integrations as-is, fix 25–29 post-launch.

The product is genuinely differentiated — the pre-prompt axe injection + deterministic-first merge is the right architecture, and the subscription-CLI leverage is a real moat. The risk isn't the core idea; it's that you spread thin across Stitch + Slack + GitHub Action + hosted viewer and none of them is polished. Pick the core flow, ship it clean, come back for the rest.
