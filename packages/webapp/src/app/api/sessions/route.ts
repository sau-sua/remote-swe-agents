import { validateApiKeyMiddleware } from '../auth/api-key';
import { NextRequest, NextResponse } from 'next/server';
import { createSession, getCustomAgent, getGitHubAccount } from '@remote-swe-agents/agent-core/lib';
import { z } from 'zod';
import { modelTypeSchema } from '@remote-swe-agents/agent-core/schema';

// Schema for request validation
const createSessionSchema = z.object({
  message: z.string().min(1),
  modelOverride: modelTypeSchema.optional(),
  customAgentId: z.string().min(1).optional(),
  githubAccountId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  if (process.env.SLACK_ONLY_SESSION_CREATION === 'true') {
    return NextResponse.json({ error: 'Session creation is only allowed from Slack.' }, { status: 403 });
  }

  // Validate API key
  const apiKeyValidation = await validateApiKeyMiddleware(request);
  if (apiKeyValidation) {
    return apiKeyValidation;
  }

  // Parse and validate request body
  const body = await request.json();
  const parsedBody = createSessionSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid request data', details: parsedBody.error.format() }, { status: 400 });
  }

  const { message, modelOverride, customAgentId, githubAccountId } = parsedBody.data;

  if (customAgentId) {
    const agent = await getCustomAgent(customAgentId);
    if (!agent) {
      return NextResponse.json({ error: `Custom agent "${customAgentId}" not found` }, { status: 400 });
    }
  }

  if (githubAccountId && githubAccountId !== 'DEFAULT') {
    const account = await getGitHubAccount(githubAccountId);
    if (!account) {
      return NextResponse.json({ error: `GitHub account "${githubAccountId}" not found` }, { status: 400 });
    }
  }

  const workerId = await createSession({
    message,
    initiator: `rest#`,
    modelOverride,
    customAgentId,
    githubAccountId,
  });

  return NextResponse.json({ sessionId: workerId }, { status: 201 });
}
