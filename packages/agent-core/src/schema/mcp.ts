import z from 'zod';

export const mcpConfigSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.union([
      z.object({
        command: z.string(),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()).optional(),
        enabled: z.boolean().optional(),
      }),
      z.object({
        url: z.string(),
        enabled: z.boolean().optional(),
      }),
    ])
  ),
});

export type McpConfig = z.infer<typeof mcpConfigSchema>;
export const EmptyMcpConfig: McpConfig = { mcpServers: {} };

/**
 * Parse a raw MCP config JSON string. Invalid input yields {@link EmptyMcpConfig}
 * plus an error message instead of throwing.
 */
export const parseMcpConfig = (raw: string): { data: McpConfig; error?: string } => {
  try {
    const { data, error } = mcpConfigSchema.safeParse(JSON.parse(raw));
    if (error) {
      return { data: EmptyMcpConfig, error: error.message };
    }
    return { data };
  } catch (e) {
    return { data: EmptyMcpConfig, error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Merge MCP configs left-to-right. Later entries override earlier ones
 * when they share a server name (used so custom agents overlay worker mcp.json).
 */
export const mergeMcpConfigs = (...configs: McpConfig[]): McpConfig => {
  const mcpServers: McpConfig['mcpServers'] = {};
  for (const config of configs) {
    Object.assign(mcpServers, config.mcpServers);
  }
  return { mcpServers };
};
