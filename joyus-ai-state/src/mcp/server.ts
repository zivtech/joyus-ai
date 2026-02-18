/**
 * MCP server — T020
 *
 * Primary interface for Claude to interact with joyus-ai-state.
 * Runs via stdio transport. All logging to stderr.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { getContextToolDef, handleGetContext } from './tools/get-context.js';
import { saveStateToolDef, handleSaveState } from './tools/save-state.js';
import { verifyActionToolDef, handleVerifyAction } from './tools/verify-action.js';

export async function createMcpServer(projectRoot: string): Promise<Server> {
  const server = new Server(
    { name: 'joyus-ai-state', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      getContextToolDef,
      saveStateToolDef,
      verifyActionToolDef,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'get_context':
          return handleGetContext(toolArgs, projectRoot);
        case 'save_state':
          return handleSaveState(toolArgs, projectRoot);
        case 'verify_action':
          return handleVerifyAction(toolArgs, projectRoot);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (err) {
      if (err instanceof McpError) throw err;
      console.error(`[joyus-ai] Tool error in ${name}:`, err);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: (err as Error).message }),
        }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(projectRoot: string): Promise<void> {
  const server = await createMcpServer(projectRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[joyus-ai] MCP server started for:', projectRoot);
}
