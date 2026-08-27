import { afterEach, describe, expect, test } from 'vitest';
import { buildMcpStdioEnv } from './mcp-client';

describe('buildMcpStdioEnv', () => {
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;
  const originalCi = process.env.CI;

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
  });

  test('inherits process.env and lets mcp.json env win', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/ubuntu';
    const env = buildMcpStdioEnv({ FASTMCP_LOG_LEVEL: 'ERROR', PATH: '/custom/bin:/usr/bin' });
    expect(env.FASTMCP_LOG_LEVEL).toBe('ERROR');
    expect(env.PATH).toBe('/custom/bin:/usr/bin');
    expect(env.HOME).toBe('/home/ubuntu');
  });

  test('prepends ~/.local/bin so uvx is on PATH', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/ubuntu';
    const env = buildMcpStdioEnv();
    expect(env.PATH).toBeDefined();
    expect(env.PATH!.split(':')[0]).toBe('/home/ubuntu/.local/bin');
    expect(env.PATH).toContain('/usr/bin');
  });

  test('does not duplicate ~/.local/bin when already present', () => {
    process.env.HOME = '/home/ubuntu';
    process.env.PATH = '/home/ubuntu/.local/bin:/usr/bin';
    const env = buildMcpStdioEnv();
    expect(env.PATH).toBeDefined();
    expect(env.PATH!.split(':').filter((p) => p === '/home/ubuntu/.local/bin')).toHaveLength(1);
  });

  test('sets npm_config_yes so npx does not prompt', () => {
    const env = buildMcpStdioEnv();
    expect(env.npm_config_yes).toBe('true');
  });
});
