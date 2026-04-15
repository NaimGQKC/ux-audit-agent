#!/usr/bin/env bash
# -----------------------------------------------------------------------
# analyze.sh — Run UX analysis on screenshots using the shared analyzer.
#
# Usage:  analyze.sh <screenshots-dir> [prd-context-file]
#
# Reads every PNG in <screenshots-dir>, batches them through Claude
# Vision (concurrency 3, batch size 6), and writes results to:
#   <screenshots-dir>/analysis-results.json
#
# This is a thin shell wrapper around lib/analyze-cli.ts so that the
# audit route, the smoke test, and the CLI all share one implementation.
# -----------------------------------------------------------------------
set -euo pipefail

SCREENSHOTS_DIR="${1:?Usage: analyze.sh <screenshots-dir> [prd-context-file]}"
PRD_CONTEXT_FILE="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -n "$PRD_CONTEXT_FILE" ]; then
  npx tsx lib/analyze-cli.ts "$SCREENSHOTS_DIR" "$PRD_CONTEXT_FILE"
else
  npx tsx lib/analyze-cli.ts "$SCREENSHOTS_DIR"
fi
