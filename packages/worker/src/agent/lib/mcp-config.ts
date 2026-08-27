import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EmptyMcpConfig, mcpConfigSchema, type McpConfig } from '@remote-swe-agents/agent-core/schema';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve packages/worker/mcp.json regardless of process cwd.
 * DefaultAgent used to read './mcp.json', which silently broke when the worker
 * was started from anywhere other than packages/worker.
 */
export const resolveWorkerMcpJsonPath = (): string | undefined => {
  const candidates = [
    join(process.cwd(), 'mcp.json'),
    join(process.cwd(), 'packages/worker/mcp.json'),
    // src/agent/lib -> packages/worker/mcp.json
    join(moduleDir, '../../../mcp.json'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
};

export const loadWorkerMcpConfig = (): { config: McpConfig; error?: string; path?: string } => {
  const path = resolveWorkerMcpJsonPath();
  if (!path) {
    return {
      config: EmptyMcpConfig,
      error: 'packages/worker/mcp.json was not found. MCP servers from that file will not be available.',
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const { data, error } = mcpConfigSchema.safeParse(parsed);
    if (error) {
      return { config: EmptyMcpConfig, error: `Invalid mcp.json at ${path}: ${error.message}`, path };
    }
    return { config: data, path };
  } catch (e) {
    return {
      config: EmptyMcpConfig,
      error: `Failed to read mcp.json at ${path}: ${e instanceof Error ? e.message : String(e)}`,
      path,
    };
  }
};
