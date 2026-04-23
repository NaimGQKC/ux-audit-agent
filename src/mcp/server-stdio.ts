#!/usr/bin/env node
/**
 * UX Audit Agent — LOCAL MCP server (stdio transport).
 *
 * This is the "shield" entrypoint: a developer runs it on their own machine
 * via Claude Code so tools like audit_local can see their dev server. Ships
 * the full toolset including audit_local.
 *
 * Setup — add to .claude/settings.json → mcpServers:
 *   {
 *     "ux-audit": {
 *       "command": "npx",
 *       "args": ["tsx", "src/mcp/server-stdio.ts"],
 *       "cwd": "/path/to/ux-audit-agent"
 *     }
 *   }
 *
 * For the remote "sword" version (claude.ai connector), see server-http.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools";

export function buildLocalServer(): McpServer {
  const server = new McpServer({ name: "ux-audit-local", version: "2.0.0" });
  registerTools(server, { includeLocal: true });
  return server;
}

async function main() {
  const server = buildLocalServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Local MCP server failed to start:", err);
  process.exit(1);
});
