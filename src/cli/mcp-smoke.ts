/**
 * MCP smoke test — spawn the local stdio server, exercise the project tools,
 * print raw outputs. Proves the MCP surface works end-to-end without needing
 * Claude Code to restart or a claude.ai connector.
 *
 * Run: npx tsx src/cli/mcp-smoke.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/server-stdio.ts"],
  });

  const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
  await client.connect(transport);

  const section = (label: string) => {
    console.log("\n" + "=".repeat(60));
    console.log(label);
    console.log("=".repeat(60));
  };

  // 1. List tools
  section("1. Registered tools");
  const { tools } = await client.listTools();
  for (const t of tools) {
    console.log(`  - ${t.name}`);
  }

  // 2. list_projects (empty or existing)
  section("2. list_projects (before)");
  const before = await client.callTool({ name: "list_projects", arguments: {} });
  console.log(textOf(before));

  // 3. create_project
  section("3. create_project");
  const created = await client.callTool({
    name: "create_project",
    arguments: {
      name: "MCP Smoke Test",
      standards_doc:
        "# Smoke test standards\n\n- Pills are for multi-value only.\n- Icons must add information.\n- Include the year in every user-facing date.",
    },
  });
  console.log(textOf(created));

  // Grab the projectId out of the response for the update step.
  const projectId = extractProjectId(textOf(created));

  // 4. list_projects (after create)
  section("4. list_projects (after create)");
  const after = await client.callTool({ name: "list_projects", arguments: {} });
  console.log(textOf(after));

  // 5. update_project
  if (projectId) {
    section("5. update_project");
    const updated = await client.callTool({
      name: "update_project",
      arguments: {
        project_id: projectId,
        notes: "Updated via MCP smoke test.",
      },
    });
    console.log(textOf(updated));
  } else {
    section("5. update_project — SKIPPED (couldn't parse projectId)");
  }

  // 6. Invalid id sanity check
  section("6. audit_page with invalid project_id (expect friendly rejection)");
  const bad = await client.callTool({
    name: "audit_page",
    arguments: { url: "https://example.com", project_id: "../etc" },
  });
  console.log(textOf(bad));

  await client.close();
  console.log("\nAll MCP calls completed.");
}

function textOf(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (!r?.content) return JSON.stringify(result, null, 2);
  return r.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function extractProjectId(text: string): string | null {
  const m = /project_id:\s*([a-zA-Z0-9_-]{1,64})/.exec(text);
  return m ? m[1] : null;
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
