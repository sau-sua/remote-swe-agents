import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { WebClient } from '@slack/web-api';
import { saveConversationHistory } from '../util/history';
import { s3, BucketName } from '@remote-swe-agents/agent-core/aws';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { AsyncHandlerEvent } from '../async-handler';
import { sendWorkerEvent } from '../../../agent-core/src/lib';
import {
  findCustomAgentByNameOrId,
  findGitHubAccountByNameOrId,
  getWebappSessionUrl,
  sendWebappEvent,
  updateSessionLastMessage,
} from '@remote-swe-agents/agent-core/lib';
import { saveSessionInfo } from '../util/session';
import { getSessionIdFromSlack } from '../util/session-map';
import { resolveSlackDisplayName } from '../util/slack-user-cache';
import { parseLeadingDirectives } from '../util/agent-directive';
import { ValidationError } from '../util/error';
import { resolveRuntimeTypeForNewSession, RuntimeType } from '@remote-swe-agents/agent-core/schema';

const BotToken = process.env.BOT_TOKEN!;
const lambda = new LambdaClient();
const AsyncLambdaName = process.env.ASYNC_LAMBDA_NAME!;

export async function handleMessage(
  event: {
    text: string;
    user?: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    blocks?: any[];
    files?: any[];
  },
  client: WebClient
): Promise<void> {
  let message = event.text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
  const userId = event.user ?? '';
  const channel = event.channel;
  const isThreadRoot = event.thread_ts == null;

  let customAgentId: string | undefined;
  let selectedAgentName: string | undefined;
  let githubAccountId: string | undefined;
  let customAgentRuntimeType: RuntimeType | undefined;

  if (isThreadRoot) {
    const parsed = parseLeadingDirectives(message);
    if (parsed.agentRef) {
      const resolved = await findCustomAgentByNameOrId(parsed.agentRef);
      if (resolved.candidates?.length) {
        const names = resolved.candidates.map((a) => `• ${a.name} (\`${a.SK}\`)`).join('\n');
        throw new ValidationError(
          `Multiple custom agents match "${parsed.agentRef}". Specify the agent ID instead:\n${names}`
        );
      }
      if (!resolved.agent) {
        throw new ValidationError(
          `Custom agent "${parsed.agentRef}" not found. Send \`list_agents\` to see available agents.`
        );
      }
      if (!parsed.message) {
        throw new ValidationError(`Missing task message. Usage: \`agent:${parsed.agentRef} <your message>\``);
      }
      customAgentId = resolved.agent.SK;
      selectedAgentName = resolved.agent.name;
      customAgentRuntimeType = resolved.agent.runtimeType;
    }
    if (parsed.githubAccountRef) {
      const resolved = await findGitHubAccountByNameOrId(parsed.githubAccountRef);
      if (resolved.candidates?.length) {
        const names = resolved.candidates.map((a) => `• ${a.name} (\`${a.SK}\`)`).join('\n');
        throw new ValidationError(
          `Multiple GitHub accounts match "${parsed.githubAccountRef}". Specify the account ID instead:\n${names}`
        );
      }
      if (!resolved.account) {
        throw new ValidationError(
          `GitHub account "${parsed.githubAccountRef}" not found. Add it in Preferences, or omit the github: directive to use the default PAT.`
        );
      }
      githubAccountId = resolved.account.SK;
    }
    if (parsed.agentRef || parsed.githubAccountRef) {
      if (!parsed.message) {
        throw new ValidationError('Missing task message after session directives.');
      }
      message = parsed.message;
    }
  }

  const workerId = await getSessionIdFromSlack(channel, event.thread_ts ?? event.ts, isThreadRoot);
  // Only pin runtime on new threads. Replies must follow the session's stored runtime
  // (legacy Slack threads may still be EC2).
  const runtimeType = isThreadRoot ? resolveRuntimeTypeForNewSession(customAgentRuntimeType) : undefined;

  // Start the worker before image uploads / Slack UI work. New Slack sessions used to
  // wait on those and then launch EC2 because the Handler Lambda lacked AGENT_RUNTIME_ARN.
  const ensureInstance = lambda.send(
    new InvokeCommand({
      FunctionName: AsyncLambdaName,
      Payload: JSON.stringify({
        type: 'ensureInstance',
        workerId,
        slackChannelId: event.channel,
        slackThreadTs: event.ts,
        runtimeType,
      } satisfies AsyncHandlerEvent),
      InvocationType: 'Event',
    })
  );
  const sessionInfo = isThreadRoot
    ? saveSessionInfo(workerId, message, userId, event.channel, event.ts, {
        customAgentId,
        githubAccountId,
        runtimeType,
      })
    : Promise.resolve();

  const region = process.env.AWS_REGION!;
  const logStreamName = `log-${workerId}`;
  const logGroupName = process.env.LOG_GROUP_NAME!;
  const cloudwatchUrl = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodeURIComponent(logGroupName)}/log-events/${encodeURIComponent(logStreamName)}`;

  // Images, display name, and the webapp URL are independent. Waiting on the
  // SSM origin lookup used to delay onMessageReceived for every new thread.
  const sessionUrlPromise = isThreadRoot ? getWebappSessionUrl(workerId) : Promise.resolve(undefined);
  const slackDisplayNamePromise = userId ? resolveSlackDisplayName(client, userId) : Promise.resolve(undefined);
  const imageKeysPromise = Promise.all(
    event.files
      ?.filter((file: { mimetype?: string }) => file?.mimetype?.startsWith('image/'))
      .map(async (file: { id: string; mimetype?: string }) => {
        const image = await client.files.info({
          file: file.id,
        });

        if (image.file?.url_private_download && image.file.filetype && image.file.mimetype) {
          const fileContent = await fetch(image.file.url_private_download, {
            headers: { Authorization: `Bearer ${BotToken}` },
          }).then((res) => res.arrayBuffer());

          const key = `${workerId}/${file.id}.${image.file.filetype}`;
          await s3.send(
            new PutObjectCommand({
              Bucket: BucketName,
              Key: key,
              Body: Buffer.from(fileContent),
              ContentType: image.file.mimetype,
            })
          );

          return key;
        }
      }) ?? []
  ).then((keys) => keys.filter((key) => key != null));

  const [imageKeys, slackDisplayName] = await Promise.all([imageKeysPromise, slackDisplayNamePromise]);

  const promises = [
    ensureInstance,
    sessionInfo,
    saveConversationHistory(workerId, message, userId, imageKeys, slackDisplayName),
    sendWorkerEvent(workerId, { type: 'onMessageReceived' }),
    sendWebappEvent(workerId, { type: 'message', role: 'user', message }),
    updateSessionLastMessage(workerId, message.slice(0, 500)),
    sendWebappEvent(workerId, { type: 'lastMessageUpdate', lastMessage: message.slice(0, 500) }),
  ];

  const agentTipElements = selectedAgentName
    ? [
        { type: 'text', text: 'Using custom agent: ' },
        { type: 'text', text: selectedAgentName, style: { bold: true } },
      ]
    : [
        { type: 'text', text: 'Start with ' },
        { type: 'text', text: 'agent:<name-or-id> <message>', style: { code: true } },
        { type: 'text', text: ' to use a custom agent. Send ' },
        { type: 'text', text: 'list_agents', style: { code: true } },
        { type: 'text', text: ' to see available agents.' },
      ];

  await Promise.all([
    ...promises,
    // Send initial message only when starting a new thread
    event.thread_ts === undefined
      ? sessionUrlPromise.then((sessionUrl) =>
          client.chat.postMessage({
            channel: channel,
            thread_ts: event.ts,
            text: `Hi, please wait for your agent to launch.`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `${userId ? `Hi <@${userId}>, p` : 'P'}lease wait for your agent to launch.\n\n*Useful Tips:*`,
                },
              },
              {
                type: 'rich_text',
                elements: [
                  {
                    type: 'rich_text_list',
                    style: 'bullet',
                    indent: 0,
                    elements: [
                      {
                        type: 'rich_text_section',
                        elements: agentTipElements,
                      },
                      ...(sessionUrl
                        ? [
                            {
                              type: 'rich_text_section',
                              elements: [
                                {
                                  type: 'text',
                                  text: 'View this session in WebApp: ',
                                },
                                {
                                  type: 'link',
                                  url: sessionUrl,
                                  text: 'Open in Web UI',
                                  style: {
                                    bold: true,
                                  },
                                },
                              ],
                            } as any,
                          ]
                        : [
                            {
                              type: 'rich_text_section',
                              elements: [
                                {
                                  type: 'text',
                                  text: 'You can view ',
                                },
                                {
                                  type: 'link',
                                  url: cloudwatchUrl,
                                  text: 'the execution log here',
                                  style: {
                                    bold: true,
                                  },
                                },
                              ],
                            },
                          ]),
                      {
                        type: 'rich_text_section',
                        elements: [
                          {
                            type: 'text',
                            text: 'Send ',
                          },
                          {
                            type: 'text',
                            text: 'dump_history',
                            style: {
                              code: true,
                            },
                          },
                          {
                            type: 'text',
                            text: ' to get conversation history and token consumption stats.',
                          },
                        ],
                      },
                      {
                        type: 'rich_text_section',
                        elements: [
                          {
                            type: 'text',
                            text: 'You can always interrupt and ask them to stop what they are doing.',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          })
        )
      : client.reactions.add({
          channel: channel,
          name: 'eyes',
          timestamp: event.ts,
        }),
  ]);
}
