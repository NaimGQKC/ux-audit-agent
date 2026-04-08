#!/usr/bin/env bash
# -----------------------------------------------------------------------
# analyze.sh — Run UX analysis on screenshots using the Claude CLI.
#
# Usage:  analyze.sh <screenshots-dir> [prd-context-file]
#
# Reads every PNG in <screenshots-dir>, sends them to Claude for
# UX/accessibility analysis, and writes results to:
#   <screenshots-dir>/analysis-results.json
#
# Requires: `claude` CLI (Claude Code) available in PATH.
# -----------------------------------------------------------------------
set -euo pipefail

SCREENSHOTS_DIR="${1:?Usage: analyze.sh <screenshots-dir> [prd-context-file]}"
PRD_CONTEXT_FILE="${2:-}"

# Resolve paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCREENSHOTS_DIR="$(cd "$SCREENSHOTS_DIR" && pwd)"
OUTPUT_FILE="${SCREENSHOTS_DIR}/analysis-results.json"
PROMPT_FILE="${SCRIPT_DIR}/src/lib/analyzer/ux-analysis-prompt.txt"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Error: prompt file not found at ${PROMPT_FILE}" >&2
  exit 1
fi

# Collect PNG files
shopt -s nullglob
PNGS=("${SCREENSHOTS_DIR}"/*.png)
shopt -u nullglob

if [ ${#PNGS[@]} -eq 0 ]; then
  echo '{"screenshots":{}}' > "$OUTPUT_FILE"
  echo "No PNG files found in ${SCREENSHOTS_DIR}" >&2
  exit 0
fi

echo "Found ${#PNGS[@]} screenshot(s) to analyze" >&2

# Build prompt in a temp file to avoid ARG_MAX limits
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1) Optionally prepend PRD context
if [ -n "$PRD_CONTEXT_FILE" ] && [ -f "$PRD_CONTEXT_FILE" ]; then
  {
    echo "PROJECT CONTEXT:"
    cat "$PRD_CONTEXT_FILE"
    echo ""
    echo "Use the project context above to evaluate the UI against actual product requirements and goals. Flag issues where the implementation diverges from stated requirements. Reference PRD requirements in acceptance_criteria where applicable."
    echo ""
    echo "---"
    echo ""
  } > "$TMPFILE"
fi

# 2) Append the UX analysis system prompt
cat "$PROMPT_FILE" >> "$TMPFILE"

# 3) Append batch analysis instructions with file list
cat >> "$TMPFILE" <<'INSTRUCTIONS'

---

Analyze each of the following screenshot image files for UX and accessibility issues. Read each file listed below, then evaluate it against all the criteria described above.

Screenshot files:
INSTRUCTIONS

for png in "${PNGS[@]}"; do
  echo "- ${png}" >> "$TMPFILE"
done

cat >> "$TMPFILE" <<'FORMAT'

Return a single JSON object with results grouped by filename (basename only, not the full path). Each key should be the PNG filename, and each value should be an object with an "issues" array following the schema described above.

Expected structure:
{
  "screenshots": {
    "index_mobile.png": { "issues": [ ... ] },
    "about_desktop.png": { "issues": [ ... ] }
  }
}

Output ONLY valid JSON. No markdown code fences, no explanatory text, no commentary — just the raw JSON object.
FORMAT

# 4) Run Claude in print mode
echo "Running Claude analysis..." >&2
claude -p < "$TMPFILE" > "$OUTPUT_FILE"

echo "Analysis complete: ${OUTPUT_FILE}" >&2
