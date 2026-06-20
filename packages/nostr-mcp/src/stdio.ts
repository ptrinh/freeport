#!/usr/bin/env node
/** stdio entry — for `npx freeport-nostr-mcp` and the MCP registry self-host path. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is the MCP channel; logs go to stderr only.
console.error('[freeport-nostr] stdio server ready');
