# UX Audit Agent — QA Guide

Branch: `feat/persistence-and-export` · Generated 2026-04-15

---

## Automated checks — already green

| Check          | Result | Notes                                                      |
| -------------- | ------ | ---------------------------------------------------------- |
| `npm run lint` | ✔      | 0 warnings, 0 errors                                       |
| `npx tsc`      | ✔      | 0 type errors                                              |
| `npm run build`| ✔      | 19 routes compiled                                          |
| `npm run smoke -- --skip-asana` | ✔ | 5/5 stages: pre-flight, crawl, analyze (20 issues), validate schema, export (91 KB HTML) |

A reference artifact from the smoke run is saved at the repo root:
**`qa-smoke-report.html`** — open it in a browser to see what a "healthy" exported report looks like.

---

## 1. Start the app

```bash
npm run dev
```

Open http://localhost:3000.

You should see the dashboard with:
- URL input
- Optional context (PRD upload, GitHub repo URL)
- Auth options (cookie text / interactive login / persisted session)
- "Run audit" button

If `npm run dev` fails — dependencies may be out of sync. Run `npm install` and retry.

---

## 2. Golden-path test (do this first)

**Goal:** confirm the core crawl → analyze → review → export pipeline works end-to-end.

1. Paste `https://example.com` into the URL input.
2. Leave all context fields empty.
3. Click **Run audit**.
4. Watch the progress panel — expect, in order:
   - Crawling 1 route
   - Screenshots at mobile/tablet/desktop
   - "Analyzing screenshots" (takes ~2 min — Claude Vision is slow, this is normal)
5. When it finishes, you should see **~20 issues** grouped by page, each with:
   - Severity badge
   - `principle` citation (Nielsen #N / WCAG X.X.X / UX law)
   - Screenshot preview with viewport toggle (mobile/tablet/desktop)
6. Click **Export HTML report** — a file should download.
7. Open it; layout should match `qa-smoke-report.html`.

**Stop here if this fails.** Everything else depends on this flow.

---

## 3. Targeted scenarios

### 3a. Multi-page site
- URL: `https://news.ycombinator.com` (or any small site)
- Expect: several routes discovered, each with 3 viewports, each with issues.
- **Watch for:** crawler respecting same-origin, screenshots not blank, progress panel updating as pages complete.

### 3b. GitHub repo context
- URL: `https://example.com`
- Repo URL field: `https://github.com/vercel/next.js` (public repo)
- Expect: "Fetched N files" confirmation. Run audit — analysis should reference code-specific patterns.
- **Watch for:** repo fetch doesn't block the audit if it fails; error message is clear.

### 3c. PRD upload
- Upload a `.pdf` or `.docx` file as PRD context.
- Expect: filename shows; text extracted.
- **Watch for:** corrupt/huge files fail gracefully, not crash.

### 3d. Auth — cookie injection
- URL: any site requiring login.
- Paste cookies in cookie text field (format: `name=value; name2=value2`).
- Expect: screenshots of the authenticated pages, not the login screen.

### 3e. Auth — interactive login
- Toggle **Interactive login**, run audit.
- A browser window should open; log in; close or let it time out.
- Expect: audit resumes with the authenticated session.

### 3f. Persisted session
- After a successful interactive login, toggle **Use persisted session** on a second run.
- Expect: no second login prompt; session reused.

### 3g. Issue editing
- On any issue card, click to edit title/description/recommendation.
- Dismiss one issue. Approve another.
- Expect: state persists across viewport toggles; dismissed items hidden but recoverable.

### 3h. Asana push (destructive — real tickets!)
- Approve 2–3 issues.
- Click **Push to Asana**.
- Expect: tickets created in `ASANA_PROJECT_ID` with correctly formatted `html_notes` (no `<p>`/`<br>`).
- **After test:** delete the created tickets manually from Asana.

### 3i. Stitch visual fixes
- On any issue, click **Generate fix** (if Stitch is configured).
- Expect: a mockup image appears; variants can be requested; refinement works.
- **Known dependency:** needs `STITCH_API_KEY` in `.env.local` (already set).

### 3j. Cache / persistence
- Run the same audit URL twice.
- Second run should offer to reuse cached results (faster, no re-analysis).
- Check the cached audits list — expect the new audit to appear.

---

## 4. Edge cases worth poking

- **Invalid URL** — `htp://oops` → clear error, not a crash.
- **Unreachable URL** — `https://example.invalid` → times out cleanly with a message.
- **Mid-audit refresh** — reload the page mid-crawl → state loss is OK, but no zombie processes.
- **Empty export** — export a report with all issues dismissed → either blocked with a message, or exports with zero issues (either is fine, just shouldn't crash).
- **Rapid clicks** — spam **Run audit** → only one concurrent run; no duplicate state.

---

## 5. Known quirks (expected, not bugs)

- **Analysis is slow** — Claude Vision via CLI takes 1–3 minutes per batch. The progress spinner is working; do not reload.
- **JSON repair** — the analyzer occasionally recovers from a truncated JSON response (memory note: `analyzer_json_flake.md`). If you see "Repaired N trailing brace(s)" in the console, that's working-as-intended.
- **LF → CRLF warnings** on `git diff` — Windows line-ending normalization; harmless.

---

## 6. Where to look when something breaks

| Symptom                              | First place to check                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| Nothing happens on "Run audit"       | Browser devtools → Network tab → `/api/audit` response     |
| Screenshots are blank / black        | Playwright — try `npx playwright install chromium`         |
| Analysis never starts or hangs       | `claude --version` in terminal; analyze.sh needs Claude CLI|
| Asana push fails                     | `ASANA_ACCESS_TOKEN` + `ASANA_PROJECT_ID` in `.env.local`  |
| Stitch fix button does nothing       | `STITCH_API_KEY` + MCP config (see `src/lib/stitch/mcp-setup.md`) |
| Export HTML downloads empty          | Compare against `qa-smoke-report.html` in repo root        |

---

## 7. Uncommitted changes on this branch

**21 modified + 3 untracked.** Not yet pushed. High-level summary:

- `src/lib/analyzer/run.ts` (new) — single shared entry point for analysis. Route, smoke test, and `analyze.sh` all delegate to it.
- `lib/smoke-test.ts` (new) — end-to-end pipeline smoke test.
- `lib/analyze-cli.ts` (new) — CLI wrapper for the analyzer.
- `analyze.sh`, `api/audit/route.ts`, `api/audit-screenshots/route.ts` — slimmed significantly (delegating to the new shared module).
- `package.json` — added `smoke` script and `tsx` devDependency (fixed during this QA pass).
- Route hardening across `api/asana`, `api/auth-session`, `api/export-report`, `api/fetch-repo-context`, `api/parse-document`, `api/rewrite`, `api/screenshot`, `api/stitch/*`.
- `useAudit.ts`, `error.tsx`, `global-error.tsx`, `cache.ts`, `crawler/index.ts`, `asana/index.ts` — various fixes.

**Do not push to GitHub until QA passes** — I'll wait for your sign-off.

---

## 8. When you're done

Report back with:
- Which scenarios passed / failed.
- Any screenshots of unexpected UI behavior.
- Console errors (browser devtools + terminal).

Then I'll commit the pile in logical chunks and push.
