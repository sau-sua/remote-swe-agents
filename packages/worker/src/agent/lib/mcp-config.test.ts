import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { mcpConfigSchema } from '@remote-swe-agents/agent-core/schema';
import { loadWorkerMcpConfig, resolveWorkerMcpJsonPath } from './mcp-config';

describe('loadWorkerMcpConfig', () => {
  test('resolves packages/worker/mcp.json', () => {
    const path = resolveWorkerMcpJsonPath();
    expect(path).toBeTruthy();
    expect(path?.endsWith('mcp.json')).toBe(true);
  });

  test('loads the checked-in mcp.json against the schema', () => {
    const { config, error, path } = loadWorkerMcpConfig();
    expect(error).toBeUndefined();
    expect(path).toBeTruthy();
    expect(Object.keys(config.mcpServers).length).toBeGreaterThan(0);
    expect(config.mcpServers.fetch).toMatchObject({ command: 'uvx' });
    expect(config.mcpServers.playwright).toMatchObject({ command: 'npx' });
  });

  test('checked-in mcp.json itself is schema-valid', () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'mcp.json'), 'utf8'));
    expect(() => mcpConfigSchema.parse(raw)).not.toThrow();
  });
});
