/** The HTTP MCP tools/call boundary, shared with transport integration tests. */
import { catalogAuditInput, safeCatalogError } from '../skills/catalog/tool.js';

export interface McpCallDeps {
  execute: (actor: string, name: string, input: Record<string, unknown>) => Promise<unknown>;
  audit: (row: {
    userId: string;
    tool: string;
    input: unknown;
    success: boolean;
    duration: number;
    error?: string;
  }) => Promise<unknown>;
}
export async function handleMcpToolCall(
  actor: string,
  name: string,
  args: unknown,
  deps: McpCallDeps
) {
  const start = Date.now();
  const input = name === 'org_skills' ? catalogAuditInput(args) : args || {};
  try {
    const value = await deps.execute(actor, name, (args || {}) as Record<string, unknown>);
    await deps.audit({
      userId: actor,
      tool: name,
      input,
      success: true,
      duration: Date.now() - start,
    });
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    const message =
      name === 'org_skills'
        ? safeCatalogError(error).message
        : error instanceof Error
          ? error.message
          : 'Unknown error';
    await deps.audit({
      userId: actor,
      tool: name,
      input,
      success: false,
      error: message,
      duration: Date.now() - start,
    });
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}
