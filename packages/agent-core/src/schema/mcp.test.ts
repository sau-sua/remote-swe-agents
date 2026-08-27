import { describe, expect, test } from 'vitest';
import { EmptyMcpConfig, mergeMcpConfigs, parseMcpConfig, type McpConfig } from './mcp';

const fetchServer: McpConfig['mcpServers'][string] = {
  command: 'uvx',
  args: ['mcp-server-fetch'],
};

const playwrightServer: McpConfig['mcpServers'][string] = {
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest'],
};

describe('parseMcpConfig', () => {
  test('parses a valid config', () => {
    const { data, error } = parseMcpConfig(JSON.stringify({ mcpServers: { fetch: fetchServer } } satisfies McpConfig));
    expect(error).toBeUndefined();
    expect(data.mcpServers.fetch).toEqual(fetchServer);
  });

  test('returns empty config for invalid JSON', () => {
    const { data, error } = parseMcpConfig('{not json');
    expect(data).toEqual(EmptyMcpConfig);
    expect(error).toBeTruthy();
  });

  test('returns empty config for schema mismatch', () => {
    const { data, error } = parseMcpConfig(JSON.stringify({ mcpServers: { bad: { url: 1 } } }));
    expect(data).toEqual(EmptyMcpConfig);
    expect(error).toBeTruthy();
  });
});

describe('mergeMcpConfigs', () => {
  test('uses worker mcp.json when the agent config is empty', () => {
    const worker: McpConfig = { mcpServers: { fetch: fetchServer, playwright: playwrightServer } };
    expect(mergeMcpConfigs(worker, EmptyMcpConfig)).toEqual(worker);
  });

  test('lets a custom agent add servers without dropping worker servers', () => {
    const worker: McpConfig = { mcpServers: { fetch: fetchServer } };
    const agent: McpConfig = {
      mcpServers: { DeepWiki: { url: 'https://mcp.deepwiki.com/sse' } },
    };
    expect(mergeMcpConfigs(worker, agent)).toEqual({
      mcpServers: {
        fetch: fetchServer,
        DeepWiki: { url: 'https://mcp.deepwiki.com/sse' },
      },
    });
  });

  test('lets a custom agent override a worker server by name', () => {
    const worker: McpConfig = { mcpServers: { fetch: fetchServer } };
    const agent: McpConfig = {
      mcpServers: { fetch: { command: 'echo', args: ['overridden'] } },
    };
    expect(mergeMcpConfigs(worker, agent).mcpServers.fetch).toEqual({
      command: 'echo',
      args: ['overridden'],
    });
  });

  test('lets a custom agent disable a worker server', () => {
    const worker: McpConfig = { mcpServers: { playwright: playwrightServer } };
    const agent: McpConfig = {
      mcpServers: { playwright: { ...playwrightServer, enabled: false } },
    };
    expect(mergeMcpConfigs(worker, agent).mcpServers.playwright).toMatchObject({ enabled: false });
  });
});
