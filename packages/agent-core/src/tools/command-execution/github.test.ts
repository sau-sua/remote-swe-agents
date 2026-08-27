import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyGitHubCredentialsForSession, buildGhLoginEnv, resetGitHubAuthCache } from './github';

const mockGetGitHubAccount = vi.fn();
const mockGetGitHubAccountToken = vi.fn();
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('../../lib/github-account', () => ({
  getGitHubAccount: (...args: any[]) => mockGetGitHubAccount(...args),
  getGitHubAccountToken: (...args: any[]) => mockGetGitHubAccountToken(...args),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const execFile = (file: string, args: string[], cb: (err: Error | null, res: any) => void) => {
    mockExecFile(file, args, cb);
  };
  return {
    ...actual,
    execFile,
  };
});

describe('buildGhLoginEnv', () => {
  it('removes GITHUB_TOKEN and GH_TOKEN from env', () => {
    const env = {
      HOME: '/root',
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghs_secret123',
      GH_TOKEN: 'ghs_another456',
      OTHER_VAR: 'keep',
    } as unknown as NodeJS.ProcessEnv;

    const result = buildGhLoginEnv(env);

    expect(result).not.toHaveProperty('GITHUB_TOKEN');
    expect(result).not.toHaveProperty('GH_TOKEN');
    expect(result).toHaveProperty('HOME', '/root');
    expect(result).toHaveProperty('PATH', '/usr/bin');
    expect(result).toHaveProperty('OTHER_VAR', 'keep');
  });

  it('works when neither token var is present', () => {
    const env = {
      HOME: '/root',
      PATH: '/usr/bin',
    } as unknown as NodeJS.ProcessEnv;

    const result = buildGhLoginEnv(env);

    expect(result).not.toHaveProperty('GITHUB_TOKEN');
    expect(result).not.toHaveProperty('GH_TOKEN');
    expect(result).toHaveProperty('HOME', '/root');
    expect(result).toHaveProperty('PATH', '/usr/bin');
  });
});

describe('applyGitHubCredentialsForSession', () => {
  const originalToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  beforeEach(() => {
    mockGetGitHubAccount.mockReset();
    mockGetGitHubAccountToken.mockReset();
    mockExecFile.mockReset();
    mockExecFile.mockImplementation((_file: string, _args: string[], cb: (err: Error | null, res: any) => void) => {
      cb(null, { stdout: '', stderr: '' });
    });
    resetGitHubAuthCache();
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'default-pat';
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    } else {
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = originalToken;
    }
  });

  it('keeps the default PAT when the session has no githubAccountId', async () => {
    await applyGitHubCredentialsForSession({
      PK: 'sessions',
      SK: 'session-1',
      workerId: 'session-1',
    } as any);

    expect(process.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('default-pat');
    expect(mockGetGitHubAccount).not.toHaveBeenCalled();
  });

  it('switches env token and git identity for a named account', async () => {
    mockGetGitHubAccount.mockResolvedValue({
      SK: 'acc-1',
      name: 'Work',
      gitUserName: 'Work Bot',
      gitUserEmail: 'work@example.com',
    });
    mockGetGitHubAccountToken.mockResolvedValue('ghp_work_token');

    await applyGitHubCredentialsForSession({
      PK: 'sessions',
      SK: 'session-1',
      workerId: 'session-1',
      githubAccountId: 'acc-1',
    } as any);

    expect(process.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_work_token');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['config', '--global', 'user.name', 'Work Bot'],
      expect.any(Function)
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['config', '--global', 'user.email', 'work@example.com'],
      expect.any(Function)
    );
  });

  it('keeps the default PAT when the named account token is missing', async () => {
    mockGetGitHubAccount.mockResolvedValue({
      SK: 'acc-1',
      name: 'Work',
      gitUserName: 'Work Bot',
      gitUserEmail: 'work@example.com',
    });
    mockGetGitHubAccountToken.mockResolvedValue(undefined);

    await applyGitHubCredentialsForSession({
      PK: 'sessions',
      SK: 'session-1',
      workerId: 'session-1',
      githubAccountId: 'acc-1',
    } as any);

    expect(process.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('default-pat');
  });
});

describe('buildGhLoginEnv', () => {
  it('removes GITHUB_TOKEN and GH_TOKEN from env', () => {
    const env = {
      HOME: '/root',
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghs_secret123',
      GH_TOKEN: 'ghs_another456',
      OTHER_VAR: 'keep',
    } as unknown as NodeJS.ProcessEnv;

    const result = buildGhLoginEnv(env);

    expect(result).not.toHaveProperty('GITHUB_TOKEN');
    expect(result).not.toHaveProperty('GH_TOKEN');
    expect(result).toHaveProperty('HOME', '/root');
    expect(result).toHaveProperty('PATH', '/usr/bin');
    expect(result).toHaveProperty('OTHER_VAR', 'keep');
  });

  it('works when neither token var is present', () => {
    const env = {
      HOME: '/root',
      PATH: '/usr/bin',
    } as unknown as NodeJS.ProcessEnv;

    const result = buildGhLoginEnv(env);

    expect(result).not.toHaveProperty('GITHUB_TOKEN');
    expect(result).not.toHaveProperty('GH_TOKEN');
    expect(result).toHaveProperty('HOME', '/root');
    expect(result).toHaveProperty('PATH', '/usr/bin');
  });
});
