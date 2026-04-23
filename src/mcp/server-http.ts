#!/usr/bin/env node
/**
 * UX Audit Agent — REMOTE MCP server (Streamable HTTP transport).
 *
 * This is the "sword" entrypoint: deployed to Fly.io (or similar) and added
 * as a custom connector in claude.ai. Anyone with the bearer token can run
 * audit_page / audit_site / quick_scan from any claude.ai chat.
 *
 * Intentionally OMITS audit_local — "localhost" has no meaning on a remote
 * host. The local stdio server (server-stdio.ts) ships that tool instead.
 *
 * Hardening:
 *  - Stateless: a fresh McpServer + Transport is created per POST /mcp. No
 *    session tracking needed because each tool call is self-contained.
 *  - Bearer-token auth: MCP_BEARER_TOKEN env var checked on every request
 *    with constant-time comparison. Emits a 401 without it so no tool
 *    metadata leaks to unauthorized callers.
 *  - Per-IP rate limiting: a single bearer token could otherwise fan out
 *    hundreds of concurrent Playwright + Lighthouse runs. The limiter is
 *    in-memory / per-instance (single-instance Fly is fine).
 *  - Content-Length preflight: bodies larger than MAX_BODY_BYTES are
 *    rejected before we even start streaming them into memory.
 *  - Error sanitization: raw Error.message never reaches the wire.
 *  - CORS deny-by-default: the server sets no Access-Control-Allow-Origin
 *    header, so browsers can't invoke it cross-origin. The MCP clients we
 *    target (claude.ai custom connectors) are server-to-server and don't
 *    need CORS.
 *  - SDK-only Claude: enforces ANTHROPIC_API_KEY on boot (the `claude` CLI
 *    is unavailable in the container).
 */

import http from "node:http";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools";
import { requireSDK } from "@/lib/claude-client";
import {
  rateLimitCheck,
  clientIp,
  hashIdentifier,
  sanitizeError,
  logError,
} from "@/lib/security";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const MCP_PATH = process.env.MCP_PATH || "/mcp";
const HEALTH_PATH = "/health";
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

// Per-IP: conservative default. Playwright runs are heavy; 60 per 10 min is
// comfortably more than any legitimate reviewer will need but blocks abuse.
const RATE_LIMIT_PER_IP = {
  limit: Number(process.env.MCP_RATE_LIMIT_PER_IP || 60),
  windowMs: Number(process.env.MCP_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  namespace: "mcp/http/ip",
};

// Global: last line of defense in case many IPs stampede us at once.
const RATE_LIMIT_GLOBAL = {
  limit: Number(process.env.MCP_RATE_LIMIT_GLOBAL || 240),
  windowMs: Number(process.env.MCP_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  namespace: "mcp/http/global",
};

// ---------------------------------------------------------------------------
// Auth — constant-time bearer token comparison
// ---------------------------------------------------------------------------

function loadBearerToken(): string {
  const token = process.env.MCP_BEARER_TOKEN;
  if (!token || token.length < 16) {
    throw new Error(
      "MCP_BEARER_TOKEN must be set (min 16 chars). Generate one with: openssl rand -hex 32",
    );
  }
  return token;
}

function authorize(req: http.IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const presented = match[1].trim();
  if (presented.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Preflight on Content-Length — bail before we stream data at all.
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new Error("Request body too large"));
      req.resume().destroy();
      return;
    }

    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Per-request MCP server factory (stateless)
// ---------------------------------------------------------------------------

function buildRemoteServer(): McpServer {
  const server = new McpServer({ name: "ux-audit-remote", version: "2.0.0" });
  registerTools(server, { includeLocal: false });
  return server;
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const server = buildRemoteServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (err) {
    logError("[mcp/http] readBody", err);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: sanitizeError(err, "Invalid request body.") }));
    return;
  }

  await transport.handleRequest(req, res, body);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  }
  res.end(JSON.stringify(body));
}

function reject429(res: http.ServerResponse, retryAfterMs: number): void {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  sendJson(res, 429, { error: "Rate limit exceeded. Please retry shortly." }, {
    "Retry-After": String(retryAfterSec),
  });
}

async function requestListener(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bearerToken: string,
): Promise<void> {
  const url = req.url || "/";

  // Deny every method other than the ones we actually serve. Also set minimal
  // security headers on every response so even error paths ship them.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    // CORS deny-by-default: no Allow-Origin header, so browsers block the
    // preflight. We answer 204 to avoid hanging clients that probe.
    res.statusCode = 204;
    res.end();
    return;
  }

  // Health endpoint — no auth, used by Fly's healthcheck and ops.
  if (url === HEALTH_PATH && req.method === "GET") {
    sendJson(res, 200, { ok: true, service: "ux-audit-remote", version: "2.0.0" });
    return;
  }

  // Every other route requires bearer auth.
  if (!authorize(req, bearerToken)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="ux-audit"');
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  // Rate limiting — after auth so unauthed probes don't exhaust the budget.
  // Key the per-IP bucket by a hash of the IP so logs stay tidy and we never
  // persist raw client IPs.
  const ip = clientIp(req.headers as Record<string, string | undefined>);
  const ipKey = hashIdentifier(ip);
  const perIp = rateLimitCheck(ipKey, RATE_LIMIT_PER_IP);
  if (!perIp.allowed) return reject429(res, perIp.retryAfterMs);

  const global = rateLimitCheck("all", RATE_LIMIT_GLOBAL);
  if (!global.allowed) return reject429(res, global.retryAfterMs);

  if (url.startsWith(MCP_PATH)) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
      return;
    }
    try {
      await handleMcp(req, res);
    } catch (err) {
      logError("[mcp/http]", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: sanitizeError(err, "Internal server error.") });
      }
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  requireSDK();
  const bearerToken = loadBearerToken();

  const server = http.createServer((req, res) => {
    requestListener(req, res, bearerToken).catch((err) => {
      logError("[mcp/http] requestListener", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error." });
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`ux-audit remote MCP listening on http://${HOST}:${PORT}${MCP_PATH}`);
  });

  const shutdown = () => {
    console.log("Shutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logError("[mcp/http] boot", err);
  process.exit(1);
});
