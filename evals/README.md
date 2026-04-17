# UX Audit Agent — Evals Harness

<!--
  First-time setup:
    1. Run `npm run evals` and inspect the output.
    2. Once you're satisfied with the pass/fail breakdown, lock it in:
         cp evals/results.json evals/baseline.json
       (on Windows PowerShell: Copy-Item evals/results.json evals/baseline.json)
    3. From that point on `npm run evals` will flag regressions of more than
       5 percentage points vs the baseline and exit nonzero for CI.
-->

## What this is

A golden-set regression harness for the LLM analyzer. Each case under
`evals/golden/` is a minimal HTML page deliberately designed to trigger a
specific category of finding (contrast failure, missing alt, unlabeled input,
too-small touch target, mobile horizontal overflow). The runner:

1. Starts a tiny local HTTP static server that serves `evals/golden/`.
2. Points the production crawler at `http://127.0.0.1:<port>/<case>/` and
   screenshots 3 viewports (mobile / tablet / desktop).
3. Runs the screenshots through the shared analyzer (`src/lib/analyzer/run.ts`
   — same code the `/api/audit` route uses).
4. Scores the resulting `UXIssue[]` against each case's `expected.json`.
5. Writes `evals/results.json` and, if `evals/baseline.json` holds a real
   `passRate`, compares the two and exits nonzero on a regression of more
   than 5 percentage points.

HTTP (not `file://`) is used so the crawler, viewport-sizing, and any future
deterministic layers run on exactly the same codepath as production audits.

## How to run

```bash
npm run evals
```

Full run targets under 5 minutes on a dev laptop (5 cases x 3 viewports x
1 Claude analysis call each).

## How the matcher works

See `evals/matcher.ts`. For each `must_match` expectation, we look for at
least one finding where ALL of these hold:

- `category` matches (if specified)
- `severity >= min_severity` (if specified)
- at least one `keyword_any` entry is a **case-insensitive substring** of the
  concatenated haystack:
  `title + description + principle + suggested_fix + recommendation + affected_element + wcag_ref`

A case `passed` iff every `must_match` is satisfied **and** no
`must_not_match` rule fires (false-positive guard).

Severity ordering: `minor < major < critical`.

## Adding a new golden case

Three steps:

1. Create `evals/golden/<case-name>/index.html` — minimal HTML targeting the
   specific failure you want to catch.
2. Create `evals/golden/<case-name>/expected.json`:
   ```json
   {
     "url_or_file": "./index.html",
     "description": "One-line human hint of what the page is doing wrong.",
     "must_match": [
       {
         "category": "accessibility",
         "keyword_any": ["your", "keywords", "here"],
         "min_severity": "major"
       }
     ],
     "must_not_match": [
       { "keyword_any": ["phrase that would be a false positive"] }
     ]
   }
   ```
   `category` and `min_severity` are optional. `must_not_match` is optional.
3. Re-run `npm run evals`. If the case passes on a fresh run and you want to
   lock it into the baseline, copy `results.json` over `baseline.json`.

## Current cases

| Case                    | Category       | Triggers                              |
| ----------------------- | -------------- | ------------------------------------- |
| contrast-fail           | accessibility  | WCAG 1.4.3 — `#ccc` text on `#fff`    |
| missing-alt             | accessibility  | WCAG 1.1.1 — `<img>` with no `alt`    |
| unlabeled-input         | accessibility  | WCAG 4.1.2 / 3.3.2 — placeholder only |
| touch-target-too-small  | usability      | Fitts's Law + WCAG 2.5.8 — 20x20 btn  |
| overflow-horizontal     | responsive     | 500px table in 375px viewport         |

## Files

- `evals/runner.ts` — orchestrates the full crawl + analyze + score loop.
- `evals/matcher.ts` — pure scoring functions (`matchesExpectation`, `scoreCase`).
- `evals/golden/<case>/index.html` — HTML under test.
- `evals/golden/<case>/expected.json` — expectations for that case.
- `evals/results.json` — latest run (committed? no — see .gitignore).
- `evals/baseline.json` — locked-in baseline for regression gating.
