'use server';

import { createNewWorkerSchema } from './schemas';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { createSession } from '@remote-swe-agents/agent-core/lib';
import { redirect } from 'next/navigation';

export const createNewWorker = authActionClient
  .inputSchema(createNewWorkerSchema)
  .action(async ({ parsedInput, ctx }) => {
    if (process.env.SLACK_ONLY_SESSION_CREATION === 'true') {
      throw new MyCustomError('Session creation is only allowed from Slack.');
    }
    const { message, imageKeys = [], fileKeys = [], modelOverride, customAgentId = '' } = parsedInput;
    const { userId } = ctx;

    let workerId: string;
    try {
      workerId = await createSession({
        message,
        initiator: `webapp#${userId}`,
        customAgentId: !customAgentId || customAgentId === 'DEFAULT' ? undefined : customAgentId,
        modelOverride,
        imageKeys,
        fileKeys,
      });
    } catch (e) {
      throw new MyCustomError(e instanceof Error ? e.message : 'Failed to create session');
    }

    redirect(`/sessions/${workerId}`);
  });
