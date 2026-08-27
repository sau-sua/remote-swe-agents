import { QueryCommand, PutCommand, UpdateCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';
import { DEFAULT_GITHUB_ACCOUNT_ID, GitHubAccount, githubAccountParameterName, githubAccountSchema } from '../schema';
import { ddb, TableName, deleteParameter, getParameter, putParameter } from './aws';
import { getPreferences, updatePreferences } from './preferences';

export const getGitHubAccount = async (accountId: string | undefined): Promise<GitHubAccount | undefined> => {
  if (!accountId || accountId === DEFAULT_GITHUB_ACCOUNT_ID) return undefined;
  const res = await ddb.send(
    new GetCommand({
      TableName,
      Key: {
        PK: 'github-account',
        SK: accountId,
      },
    })
  );
  if (!res.Item) return undefined;
  const parsed = githubAccountSchema.safeParse(res.Item);
  return parsed.success ? parsed.data : undefined;
};

export const getGitHubAccounts = async (limit: number = 50): Promise<GitHubAccount[]> => {
  const res = await ddb.send(
    new QueryCommand({
      TableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'github-account',
      },
      ScanIndexForward: true,
      Limit: limit,
    })
  );
  return ((res.Items as GitHubAccount[]) ?? []).flatMap((item) => {
    const parsed = githubAccountSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
};

export const findGitHubAccountByNameOrId = async (
  nameOrId: string
): Promise<{ account?: GitHubAccount; candidates?: GitHubAccount[] }> => {
  const trimmed = nameOrId.trim();
  if (!trimmed) return {};

  const byId = await getGitHubAccount(trimmed);
  if (byId) return { account: byId };

  const accounts = await getGitHubAccounts(100);
  const normalized = trimmed.toLowerCase();
  const matches = accounts.filter((account) => account.name.trim().toLowerCase() === normalized);

  if (matches.length === 1) return { account: matches[0] };
  if (matches.length > 1) return { candidates: matches };
  return {};
};

export const getGitHubAccountToken = async (accountId: string): Promise<string | undefined> => {
  return getParameter(githubAccountParameterName(accountId));
};

const assertUniqueName = async (name: string, excludeId?: string): Promise<void> => {
  const accounts = await getGitHubAccounts(100);
  const normalized = name.trim().toLowerCase();
  const duplicate = accounts.find(
    (account) => account.SK !== excludeId && account.name.trim().toLowerCase() === normalized
  );
  if (duplicate) {
    throw new Error(`A GitHub account named "${name}" already exists`);
  }
};

export const createGitHubAccount = async (params: {
  name: string;
  gitUserName: string;
  gitUserEmail: string;
  personalAccessToken: string;
  isDefault?: boolean;
}): Promise<GitHubAccount> => {
  if (!params.personalAccessToken.trim()) {
    throw new Error('Personal access token is required');
  }
  await assertUniqueName(params.name);

  const now = Date.now();
  const id = randomBytes(6).toString('base64url');
  const account: GitHubAccount = {
    PK: 'github-account',
    SK: id,
    name: params.name.trim(),
    gitUserName: params.gitUserName.trim(),
    gitUserEmail: params.gitUserEmail.trim(),
    createdAt: now,
    updatedAt: now,
  };

  await putParameter(githubAccountParameterName(id), params.personalAccessToken.trim());
  await ddb.send(
    new PutCommand({
      TableName,
      Item: account,
    })
  );

  if (params.isDefault) {
    await updatePreferences({ defaultGithubAccountId: id });
  }

  return account;
};

export const updateGitHubAccount = async (
  id: string,
  params: {
    name: string;
    gitUserName: string;
    gitUserEmail: string;
    personalAccessToken?: string;
    isDefault?: boolean;
  }
): Promise<GitHubAccount> => {
  const existing = await getGitHubAccount(id);
  if (!existing) {
    throw new Error('GitHub account not found');
  }
  await assertUniqueName(params.name, id);

  if (params.personalAccessToken?.trim()) {
    await putParameter(githubAccountParameterName(id), params.personalAccessToken.trim());
  }

  const now = Date.now();
  const result = await ddb.send(
    new UpdateCommand({
      TableName,
      Key: {
        PK: 'github-account',
        SK: id,
      },
      UpdateExpression:
        'SET #name = :name, #gitUserName = :gitUserName, #gitUserEmail = :gitUserEmail, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#name': 'name',
        '#gitUserName': 'gitUserName',
        '#gitUserEmail': 'gitUserEmail',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':name': params.name.trim(),
        ':gitUserName': params.gitUserName.trim(),
        ':gitUserEmail': params.gitUserEmail.trim(),
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  if (params.isDefault) {
    await updatePreferences({ defaultGithubAccountId: id });
  }

  return result.Attributes as GitHubAccount;
};

export const deleteGitHubAccount = async (id: string): Promise<void> => {
  await deleteParameter(githubAccountParameterName(id));
  await ddb.send(
    new DeleteCommand({
      TableName,
      Key: {
        PK: 'github-account',
        SK: id,
      },
    })
  );

  const preferences = await getPreferences();
  if (preferences.defaultGithubAccountId === id) {
    await updatePreferences({ defaultGithubAccountId: '' });
  }
};

/**
 * Resolve which named GitHub account a new session should use.
 * `DEFAULT` (or empty) forces the CDK-configured env PAT.
 * When the caller omits the field, the global default account is used if set.
 */
export const resolveGitHubAccountId = async (requested?: string): Promise<string | undefined> => {
  if (requested === DEFAULT_GITHUB_ACCOUNT_ID) {
    return undefined;
  }
  if (requested) {
    const account = await getGitHubAccount(requested);
    if (!account) {
      throw new Error(`GitHub account "${requested}" not found`);
    }
    return account.SK;
  }

  const preferences = await getPreferences();
  if (!preferences.defaultGithubAccountId) {
    return undefined;
  }
  const account = await getGitHubAccount(preferences.defaultGithubAccountId);
  return account?.SK;
};
