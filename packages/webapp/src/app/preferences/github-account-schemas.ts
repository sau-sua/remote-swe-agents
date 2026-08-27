import { deleteGitHubAccountSchema, upsertGitHubAccountSchema } from '@remote-swe-agents/agent-core/schema';
import { z } from 'zod';

export const upsertGitHubAccountFormSchema = upsertGitHubAccountSchema.extend({
  personalAccessToken: z.string().max(500).optional(),
});

export const deleteGitHubAccountFormSchema = deleteGitHubAccountSchema;

export const setDefaultGitHubAccountSchema = z.object({
  id: z.string(),
});
