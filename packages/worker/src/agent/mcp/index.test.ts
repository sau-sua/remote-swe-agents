import { afterEach, describe, expect, test, vi } from 'vitest';

const mockSendSystemMessage = vi.fn().mockResolvedValue(undefined);
const mockFromCommand = vi.fn();
const mockFromUrl = vi.fn();

vi.mock('@remote-swe-agents/agent-core/lib', () => ({
  sendSystemMessage: (...args: unknown[]) => mockSendSystemMessage(...args),
}));

vi.mock('./mcp-client', () => ({
  MCPClient: {
    fromCommand: (...args: unknown[]) => mockFromCommand(...args),
    fromUrl: (...args: unknown[]) => mockFromUrl(...args),
  },
  buildMcpStdioEnv: vi.fn(),
}));

import { closeMcpServers, getMcpToolSpecs, resetMcpClients, tryExecuteMcpTool } from './index';
import type { McpConfig } from '@remote-swe-agents/agent-core/schema';

const fetchConfig: McpConfig = {
  mcpServers: {
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    DeepWiki: { url: 'https://mcp.deepwiki.com/sse', enabled: false },
  },
};

afterEach(async () => {
  await closeMcpServers();
  resetMcpClients();
  mockSendSystemMessage.mockClear();
  mockFromCommand.mockReset();
  mockFromUrl.mockReset();
});

describe('getMcpToolSpecs', () => {
  test('returns no tools when no servers are enabled', async () => {
    const tools = await getMcpToolSpecs('w1', { mcpServers: {} });
    expect(tools).toEqual([]);
    expect(mockFromCommand).not.toHaveBeenCalled();
  });

  test('skips servers with enabled: false', async () => {
    mockFromCommand.mockResolvedValue({
      tools: [{ toolSpec: { name: 'fetch', description: 'Fetch a URL' } }],
      cleanup: vi.fn(),
      callTool: vi.fn(),
    });

    const tools = await getMcpToolSpecs('w1', fetchConfig);
    expect(mockFromCommand).toHaveBeenCalledOnce();
    expect(mockFromUrl).not.toHaveBeenCalled();
    expect(tools.map((t) => t.toolSpec?.name)).toEqual(['fetch']);
  });

  test('reports start failures without dropping servers that did start', async () => {
    mockFromCommand.mockRejectedValueOnce(new Error('uvx: command not found')).mockResolvedValueOnce({
      tools: [{ toolSpec: { name: 'browser_navigate' } }],
      cleanup: vi.fn(),
      callTool: vi.fn(),
    });

    const tools = await getMcpToolSpecs('w1', {
      mcpServers: {
        fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      },
    });

    expect(tools.map((t) => t.toolSpec?.name)).toEqual(['browser_navigate']);
    expect(mockSendSystemMessage).toHaveBeenCalledWith(
      'w1',
      expect.stringContaining('MCP server fetch failed to start')
    );
  });

  test('tryExecuteMcpTool routes to the client that owns the tool', async () => {
    const callTool = vi.fn().mockResolvedValue([{ type: 'text', text: 'ok' }]);
    mockFromCommand.mockResolvedValue({
      tools: [{ toolSpec: { name: 'fetch' } }],
      callTool,
      cleanup: vi.fn(),
    });

    await getMcpToolSpecs('w1', fetchConfig);
    const result = await tryExecuteMcpTool('w1', 'fetch', { url: 'https://example.com' });
    expect(result.found).toBe(true);
    expect(callTool).toHaveBeenCalledWith('fetch', { url: 'https://example.com' });
  });
});
