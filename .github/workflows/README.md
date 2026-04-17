# UX audit GitHub Action

This repository ships a reusable GitHub Action that audits a PR preview URL
with `ux-audit-agent` and posts a sticky comment with severity-sorted
findings. Copy-paste Lighthouse CI's distribution pattern: one job,
one comment, one artifact.

## What it does

On every pull request (or `workflow_call` invocation):

1. Checks out the repo.
2. Installs Node 20 + `npm ci` dependencies.
3. Installs Playwright's Chromium + system deps.
4. Runs `npm run audit` against `inputs.preview_url` — this crawls the
   site at 3 viewports (mobile, tablet, desktop), analyzes each screenshot
   with Claude Vision, and writes `findings.json`.
5. Uploads `findings.json` as a workflow artifact.
6. Formats the findings into a markdown table and upserts a sticky PR
   comment via `marocchino/sticky-pull-request-comment`.

The comment replaces itself on every push — no history pollution.

## Invoking from another repo

Add a job to your consumer repo's workflow:

```yaml
# .github/workflows/pr-ux.yml
name: PR UX audit

on:
  pull_request:

jobs:
  ux:
    uses: NaimGQKC/ux-audit-agent/.github/workflows/ux-audit.yml@main
    with:
      preview_url: ${{ needs.deploy-preview.outputs.url }}
      fail_on: critical        # optional — critical|major|minor|none (default: none)
    secrets:
      claude_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Required inputs

| Name          | Required | Default | Description                                                                |
| ------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `preview_url` | yes      | —       | Publicly reachable URL of the deployed PR preview (Vercel, Netlify, etc.). |
| `fail_on`     | no       | `none`  | Fails the check when any finding at or above this severity exists.         |

### Required secrets

| Name             | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `claude_api_key` | Anthropic API key used by the Claude CLI. Exposed as `ANTHROPIC_API_KEY` to the runner. |

### Required permissions

The calling workflow needs:

```yaml
permissions:
  contents: read
  pull-requests: write   # so the sticky comment can be posted
```

## Minimal end-to-end example

```yaml
name: PR UX audit

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    outputs:
      url: ${{ steps.vercel.outputs.preview-url }}
    steps:
      - uses: actions/checkout@v4
      - id: vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}

  ux:
    needs: deploy-preview
    uses: NaimGQKC/ux-audit-agent/.github/workflows/ux-audit.yml@main
    with:
      preview_url: ${{ needs.deploy-preview.outputs.url }}
      fail_on: critical
    secrets:
      claude_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Outputs

- **Sticky PR comment** — severity-sorted table (top 20 findings,
  `+N more` footer). Identified by the hidden marker
  `<!-- ux-audit-agent:v1 -->` so future runs replace the same comment.
- **`ux-audit-findings` artifact** — the full `findings.json` for
  downstream tooling (dashboards, tracking, etc.).

## Local reproduction

```bash
npm ci
npx playwright install --with-deps chromium
ANTHROPIC_API_KEY=... npm run audit -- --url https://example.com --out findings.json
npm run audit:comment -- --findings findings.json --pr 1 --repo owner/repo
```
