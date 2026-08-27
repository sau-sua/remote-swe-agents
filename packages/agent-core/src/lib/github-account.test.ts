import { describe, expect, test, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockGetParameter = vi.fn();
const mockPutParameter = vi.fn();
const mockDeleteParameter = vi.fn();
const mockGetPreferences = vi.fn();
const mockUpdatePreferences = vi.fn();

vi.mock('./aws', () => ({
  ddb: { send: (...args: any[]) => mockSend(...args) },
  TableName: 'TestTable',
  getParameter: (...args: any[]) => mockGetParameter(...args),
  putParameter: (...args: any[]) => mockPutParameter(...args),
  deleteParameter: (...args: any[]) => mockDeleteParameter(...args),
}));

vi.mock('./preferences', () => ({
  getPreferences: (...args: any[]) => mockGetPreferences(...args),
  updatePreferences: (...args: any[]) => mockUpdatePreferences(...args),
}));

import {
  createGitHubAccount,
  deleteGitHubAccount,
  findGitHubAccountByNameOrId,
  getGitHubAccount,
  resolveGitHubAccountId,
  updateGitHubAccount,
} from './github-account';
import type { GitHubAccount } from '../schema';

const makeAccount = (sk: string, name: string): GitHubAccount => ({
  PK: 'github-account',
  SK: sk,
  name,
  gitUserName: 'User',
  gitUserEmail: 'user@example.com',
  createdAt: 1,
  updatedAt: 1,
});

describe('github-account', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetParameter.mockReset();
    mockPutParameter.mockReset();
    mockDeleteParameter.mockReset();
    mockGetPreferences.mockReset();
    mockUpdatePreferences.mockReset();
  });

  test('getGitHubAccount returns undefined for DEFAULT and empty ids', async () => {
    expect(await getGitHubAccount(undefined)).toBeUndefined();
    expect(await getGitHubAccount('DEFAULT')).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('findGitHubAccountByNameOrId matches by case-insensitive name', async () => {
    const account = makeAccount('id1', 'Work');
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [account, makeAccount('id2', 'Personal')] });

    const result = await findGitHubAccountByNameOrId('work');
    expect(result.account?.SK).toBe('id1');
  });

  test('createGitHubAccount stores metadata and PAT, and can set default', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({});
    mockPutParameter.mockResolvedValue(undefined);
    mockUpdatePreferences.mockResolvedValue({});

    const account = await createGitHubAccount({
      name: 'Work',
      gitUserName: 'Work Bot',
      gitUserEmail: 'work@example.com',
      personalAccessToken: 'ghp_worktoken_abcdefghijklmnopqrstuvwxyz',
      isDefault: true,
    });

    expect(account.name).toBe('Work');
    expect(account.PK).toBe('github-account');
    expect(mockPutParameter).toHaveBeenCalledTimes(1);
    expect(mockPutParameter.mock.calls[0][0]).toMatch(/^\/remote-swe\/github\/accounts\//);
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ defaultGithubAccountId: account.SK });
  });

  test('createGitHubAccount rejects duplicate names', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeAccount('id1', 'Work')] });

    await expect(
      createGitHubAccount({
        name: 'work',
        gitUserName: 'Other',
        gitUserEmail: 'other@example.com',
        personalAccessToken: 'ghp_other_abcdefghijklmnopqrstuvwxyz',
      })
    ).rejects.toThrow('already exists');
    expect(mockPutParameter).not.toHaveBeenCalled();
  });

  test('updateGitHubAccount keeps existing PAT when token is omitted', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: makeAccount('id1', 'Work') })
      .mockResolvedValueOnce({ Items: [makeAccount('id1', 'Work')] })
      .mockResolvedValueOnce({ Attributes: { ...makeAccount('id1', 'Work Renamed') } });

    await updateGitHubAccount('id1', {
      name: 'Work Renamed',
      gitUserName: 'Work Bot',
      gitUserEmail: 'work@example.com',
    });

    expect(mockPutParameter).not.toHaveBeenCalled();
  });

  test('deleteGitHubAccount clears default preference when deleting the default account', async () => {
    mockDeleteParameter.mockResolvedValue(undefined);
    mockSend.mockResolvedValueOnce({});
    mockGetPreferences.mockResolvedValue({ defaultGithubAccountId: 'id1' });
    mockUpdatePreferences.mockResolvedValue({});

    await deleteGitHubAccount('id1');

    expect(mockDeleteParameter).toHaveBeenCalledWith('/remote-swe/github/accounts/id1');
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ defaultGithubAccountId: '' });
  });

  test('resolveGitHubAccountId uses DEFAULT to force the env PAT', async () => {
    expect(await resolveGitHubAccountId('DEFAULT')).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockGetPreferences).not.toHaveBeenCalled();
  });

  test('resolveGitHubAccountId falls back to the global default when omitted', async () => {
    mockGetPreferences.mockResolvedValue({ defaultGithubAccountId: 'id1' });
    mockSend.mockResolvedValueOnce({ Item: makeAccount('id1', 'Work') });

    expect(await resolveGitHubAccountId(undefined)).toBe('id1');
  });

  test('resolveGitHubAccountId throws when a requested account is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    await expect(resolveGitHubAccountId('missing')).rejects.toThrow('not found');
  });
});
