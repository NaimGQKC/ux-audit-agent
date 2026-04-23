# syntax=docker/dockerfile:1
#
# UX Audit Agent — REMOTE MCP server container.
#
# This image runs src/mcp/server-http.ts on Fly.io (or similar). It ships the
# sword half of the product — audit_page, audit_site, quick_scan exposed over
# Streamable HTTP with bearer-token auth.
#
# The LOCAL stdio server (server-stdio.ts) is NOT meant to run in a container.
# It lives on developer laptops.

# The official Playwright image ships Chromium plus every OS-level dep
# Playwright needs — saves us the apt-get dance and keeps the image working
# across Playwright version bumps.
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Cache deps layer. Install production deps only — Playwright-browsers are
# already on the base image, so we use the ignore flag to skip downloading
# them again at npm install time.
COPY package.json package-lock.json* ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save --no-audit --no-fund tsx@^4.21.0

# Copy the rest of the app
COPY tsconfig.json ./
COPY src ./src

# Ops hardening — run as a non-root user (the Playwright image provides `pwuser`).
USER pwuser

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# Health endpoint lives at /health (no auth required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npx", "tsx", "src/mcp/server-http.ts"]
