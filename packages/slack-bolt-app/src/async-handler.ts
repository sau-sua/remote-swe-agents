import { Handler } from 'aws-lambda';
import { App, AwsLambdaReceiver, LogLevel } from '@slack/bolt';
import z from 'zod';
import { getOrCreateWorkerInstance, getSession, sendWorkerEvent } from '@remote-swe-agents/agent-core/lib';
import {
  resolveRuntimeType,
  resolveRuntimeTypeForNewSession,
  runtimeTypeSchema,
} from '@remote-swe-agents/agent-core/schema';
import { makeIdempotent } from './util/idempotency';
import { IdempotencyAlreadyInProgressError, IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import { slackEnsureInstanceNotice } from './util/ensure-instance-notice';

const BotToken = process.env.BOT_TOKEN!;

export const receiver = new AwsLambdaReceiver({
  signingSecret: 'dummy',
});

const app = new App({
  token: BotToken,
  receiver,
  logLevel: LogLevel.DEBUG,
  developerMode: true,
  socketMode: false,
});

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ensureInstance'),
    workerId: z.string(),
    slackChannelId: z.string(),
    slackThreadTs: z.string(),
    runtimeType: runtimeTypeSchema.optional(),
  }),
]);

export type AsyncHandlerEvent = z.infer<typeof eventSchema>;

// slack api timeouts in just a 3 seconds so we run actual process asynchronously
// we might not need this because idempotency using dynamodb lock almost resolved the problem.
export const handler: Handler<unknown> = async (rawEvent, context) => {
  const event = eventSchema.parse(rawEvent);
  if (event.type == 'ensureInstance') {
    try {
      // When the handler is invoked more than once in short interval,
      // the second invocation launches another instance because
      // DescribeInstances does not return the instance launched from
      // the first invocation very soon. To avoid it, we use makeIdempotent here.
      await makeIdempotent(
        async (_: string) => {
          let runtimeType;
          if (event.runtimeType) {
            runtimeType = resolveRuntimeType(event.runtimeType);
          } else {
            const session = await getSession(event.workerId);
            runtimeType = session ? resolveRuntimeType(session.runtimeType) : resolveRuntimeTypeForNewSession();
          }
          const res = await getOrCreateWorkerInstance(event.workerId, runtimeType);

          // InvokeAgentRuntime returns after /invocations, so AppSync is subscribed.
          // The Slack Handler's onMessageReceived often fired during container
          // pull and was dropped. Re-send once the worker is actually up.
          // Skip when already running: the Handler event + re-invoke path cover that.
          if (res.oldStatus !== 'running') {
            await sendWorkerEvent(event.workerId, { type: 'onMessageReceived' });
          }

          const notice = slackEnsureInstanceNotice(res.oldStatus, runtimeType, res.usedCache);
          if (notice) {
            await app.client.chat.postMessage({
              channel: event.slackChannelId,
              thread_ts: event.slackThreadTs,
              text: notice,
            });
          }
        },
        { config: new IdempotencyConfig({ expiresAfterSeconds: 30 }) }
      )(`ensureInstance-${event.workerId}`);
    } catch (e) {
      console.error(e);
      if (e instanceof IdempotencyAlreadyInProgressError) return;
      await app.client.chat.postMessage({
        channel: event.slackChannelId,
        thread_ts: event.slackThreadTs,
        text: `An error occurred in worker manager: ${e}`,
      });
    }
  }
};
