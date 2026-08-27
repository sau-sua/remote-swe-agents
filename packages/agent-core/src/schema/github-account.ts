import { z } from 'zod';

export const DEFAULT_GITHUB_ACCOUNT_ID = 'DEFAULT';

export const GITHUB_ACCOUNT_SSM_PREFIX = '/remote-swe/github/accounts';

export const githubAccountParameterName = (accountId: string): string => `${GITHUB_ACCOUNT_SSM_PREFIX}/${accountId}`;

export const githubAccountSchema = z.object({
  PK: z.literal('github-account'),
  SK: z.string(),
  name: z.string().min(1).max(50),
  gitUserName: z.string().min(1).max(100),
  gitUserEmail: z.string().min(1).max(200),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type GitHubAccount = z.infer<typeof githubAccountSchema>;

export const upsertGitHubAccountSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(50),
  gitUserName: z.string().min(1).max(100),
  gitUserEmail: z.string().min(1).max(200),
  personalAccessToken: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
});

export const deleteGitHubAccountSchema = z.object({
  id: z.string().min(1),
});
