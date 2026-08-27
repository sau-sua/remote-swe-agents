import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TableName } from '@remote-swe-agents/agent-core/aws';
import { getCustomAgent } from '@remote-swe-agents/agent-core/lib';
import {
  getDefaultRuntimeType,
  resolveRuntimeType,
  RuntimeType,
  SessionItem,
} from '@remote-swe-agents/agent-core/schema';

export type SaveSessionInfoOptions = {
  customAgentId?: string;
  runtimeType?: RuntimeType;
};

export const saveSessionInfo = async (
  workerId: string,
  initialMessage: string,
  initiatorSlackUserId: string,
  slackChannelId: string,
  slackThreadTs: string,
  options: SaveSessionInfoOptions = {}
) => {
  const now = Date.now();
  const timestamp = String(now).padStart(15, '0');
  const agent = options.customAgentId ? await getCustomAgent(options.customAgentId) : undefined;
  const runtimeType = resolveRuntimeType(options.runtimeType ?? agent?.runtimeType ?? getDefaultRuntimeType());

  await ddb.send(
    new PutCommand({
      TableName,
      Item: {
        PK: 'sessions',
        SK: workerId,
        workerId,
        createdAt: now,
        updatedAt: now,
        LSI1: timestamp,
        initialMessage,
        instanceStatus: 'terminated',
        sessionCost: 0,
        agentStatus: 'pending',
        initiator: `slack#${initiatorSlackUserId}`,
        slackChannelId,
        slackThreadTs,
        runtimeType,
        ...(agent?.SK ? { customAgentId: agent.SK } : {}),
      } satisfies SessionItem,
    })
  );
};
