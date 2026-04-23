#!/usr/bin/env node
/**
 * Back-compat alias for the local stdio server.
 *
 * The server has been split into server-stdio.ts (local) and server-http.ts
 * (remote). Existing .claude/settings.json configs that reference
 * src/mcp/server.ts keep working via this re-export. New setups should point
 * directly at server-stdio.ts for clarity.
 */

import "./server-stdio";
