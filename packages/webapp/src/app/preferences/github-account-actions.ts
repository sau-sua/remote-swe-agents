'use server';

import { authActionClient, MyCustomError } from '@/lib/safe-action';
import {
  createGitHubAccount,
  deleteGitHubAccount,
  updateGitHubAccount,
  updatePreferences,
} from '@remote-swe-agents/agent-core/lib';
import { revalidatePath } from 'next/cache';
import {
  deleteGitHubAccountFormSchema,
  setDefaultGitHubAccountSchema,
  upsertGitHubAccountFormSchema,
} from './github-account-schemas';

export const upsertGitHubAccountAction = authActionClient
  .inputSchema(upsertGitHubAccountFormSchema)
  .action(async ({ parsedInput }) => {
    try {
      const { id, personalAccessToken, isDefault, ...accountData } = parsedInput;

      if (id) {
        const account = await updateGitHubAccount(id, {
          ...accountData,
          personalAccessToken,
          isDefault,
        });
        revalidatePath('/preferences');
        revalidatePath('/sessions/new');
        return { success: true, account };
      }

      if (!personalAccessToken?.trim()) {
        throw new MyCustomError('Personal access token is required');
      }

      const account = await createGitHubAccount({
        ...accountData,
        personalAccessToken,
        isDefault,
      });
      revalidatePath('/preferences');
      revalidatePath('/sessions/new');
      return { success: true, account };
    } catch (error) {
      console.error('Error saving GitHub account:', error);
      throw new MyCustomError(error instanceof Error ? error.message : 'Failed to save GitHub account');
    }
  });

export const deleteGitHubAccountAction = authActionClient
  .inputSchema(deleteGitHubAccountFormSchema)
  .action(async ({ parsedInput }) => {
    try {
      await deleteGitHubAccount(parsedInput.id);
      revalidatePath('/preferences');
      revalidatePath('/sessions/new');
      return { success: true };
    } catch (error) {
      console.error('Error deleting GitHub account:', error);
      throw new MyCustomError(error instanceof Error ? error.message : 'Failed to delete GitHub account');
    }
  });

export const setDefaultGitHubAccountAction = authActionClient
  .inputSchema(setDefaultGitHubAccountSchema)
  .action(async ({ parsedInput }) => {
    await updatePreferences({ defaultGithubAccountId: parsedInput.id });
    revalidatePath('/preferences');
    revalidatePath('/sessions/new');
    return { success: true };
  });
