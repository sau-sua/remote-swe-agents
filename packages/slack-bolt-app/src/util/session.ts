import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TableName } from '@remote-swe-agents/agent-core/aws';
import { getCustomAgent, resolveGitHubAccountId } from '@remote-swe-agents/agent-core/lib';
import { resolveRuntimeTypeForNewSession, RuntimeType } from '@remote-swe-agents/agent-core/schema';

export type SaveSessionInfoOptions = {
  customAgentId?: string;
  githubAccountId?: string;
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
  const runtimeType = resolveRuntimeTypeForNewSession(options.runtimeType ?? agent?.runtimeType);
  const githubAccountId = await resolveGitHubAccountId(options.githubAccountId);

  // UpdateItem instead of Put: ensureInstance runs in parallel and may already
  // have written instanceStatus=starting/running. A Put would clobber that.
  const names: Record<string, string> = {
    '#workerId': 'workerId',
    '#createdAt': 'createdAt',
    '#updatedAt': 'updatedAt',
    '#lsi1': 'LSI1',
    '#initialMessage': 'initialMessage',
    '#instanceStatus': 'instanceStatus',
    '#sessionCost': 'sessionCost',
    '#agentStatus': 'agentStatus',
    '#initiator': 'initiator',
    '#slackChannelId': 'slackChannelId',
    '#slackThreadTs': 'slackThreadTs',
    '#runtimeType': 'runtimeType',
  };
  const values: Record<string, unknown> = {
    ':workerId': workerId,
    ':now': now,
    ':timestamp': timestamp,
    ':initialMessage': initialMessage,
    ':starting': 'starting',
    ':sessionCost': 0,
    ':agentStatus': 'pending',
    ':initiator': `slack#${initiatorSlackUserId}`,
    ':slackChannelId': slackChannelId,
    ':slackThreadTs': slackThreadTs,
    ':runtimeType': runtimeType,
  };
  const extraSets: string[] = [];
  if (agent?.SK) {
    names['#customAgentId'] = 'customAgentId';
    values[':customAgentId'] = agent.SK;
    extraSets.push('#customAgentId = if_not_exists(#customAgentId, :customAgentId)');
  }
  if (githubAccountId) {
    names['#githubAccountId'] = 'githubAccountId';
    values[':githubAccountId'] = githubAccountId;
    extraSets.push('#githubAccountId = if_not_exists(#githubAccountId, :githubAccountId)');
  }

  await ddb.send(
    new UpdateCommand({
      TableName,
      Key: {
        PK: 'sessions',
        SK: workerId,
      },
      UpdateExpression: `SET #workerId = :workerId,
        #createdAt = if_not_exists(#createdAt, :now),
        #updatedAt = :now,
        #lsi1 = if_not_exists(#lsi1, :timestamp),
        #initialMessage = if_not_exists(#initialMessage, :initialMessage),
        #instanceStatus = if_not_exists(#instanceStatus, :starting),
        #sessionCost = if_not_exists(#sessionCost, :sessionCost),
        #agentStatus = if_not_exists(#agentStatus, :agentStatus),
        #initiator = if_not_exists(#initiator, :initiator),
        #slackChannelId = :slackChannelId,
        #slackThreadTs = :slackThreadTs,
        #runtimeType = if_not_exists(#runtimeType, :runtimeType)${extraSets.length ? `, ${extraSets.join(', ')}` : ''}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
};
