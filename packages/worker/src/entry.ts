import { Amplify } from 'aws-amplify';
import { events } from 'aws-amplify/data';
import { onMessageReceived, resume } from './agent';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import './common/signal-handler';
import { setKillTimer, pauseKillTimer, restartKillTimer } from './common/kill-timer';
import { CancellationToken } from './common/cancellation-token';
import { sendSystemMessage, updateInstanceStatus, workerEventSchema } from '@remote-swe-agents/agent-core/lib';
import { updateAgentStatusWithEvent } from './common/status';
import { refreshSession, waitForSlackDestination } from './common/refresh-session';
import { terminateMyself } from './common/ec2';

Object.assign(global, { WebSocket: require('ws') });

const eventHttpEndpoint = process.env.EVENT_HTTP_ENDPOINT!;
const awsRegion = process.env.AWS_REGION!;

Amplify.configure(
  {
    API: {
      Events: {
        endpoint: `${eventHttpEndpoint}/event`,
        region: awsRegion,
        defaultAuthMode: 'iam',
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => {
          const provider = fromNodeProviderChain();
          const credentials = await provider();
          return {
            credentials,
          };
        },
        clearCredentialsAndIdentityId: async () => {},
      },
    },
  }
);

class ConverseSessionTracker {
  private sessions: { promise: Promise<void>; isFinished: boolean; cancellationToken: CancellationToken }[] = [];
  private operationQueue: Promise<void> = Promise.resolve();
  public constructor(private readonly workerId: string) {}

  private enqueue(operation: () => Promise<void>): void {
    this.operationQueue = this.operationQueue.then(operation).catch((e) => {
      console.log('Operation queue error:', e);
    });
  }

  public startOnMessageReceived() {
    this.enqueue(async () => {
      await this.cancelCurrentSessions();
      this._startOnMessageReceived();
    });
  }

  public startResume() {
    this.enqueue(async () => {
      await this.cancelCurrentSessions();
      this._startResume();
    });
  }

  public forceStop(callback?: () => Promise<any>) {
    this.enqueue(async () => {
      await this.cancelCurrentSessions(callback);
    });
  }

  private _startOnMessageReceived() {
    const session = { promise: Promise.resolve(), isFinished: false, cancellationToken: new CancellationToken() };
    this.sessions.push(session);
    // temporarily pause kill timer when an agent loop is running
    const restartToken = pauseKillTimer();
    session.promise = onMessageReceived(this.workerId, session.cancellationToken)
      .catch((e) => {
        sendSystemMessage(this.workerId, `An error occurred: ${e}`).catch((e) => console.log(e));
        console.log(e);
      })
      .finally(() => {
        session.isFinished = true;
        restartKillTimer(this.workerId, restartToken);
      });
  }

  private _startResume() {
    const session = { promise: Promise.resolve(), isFinished: false, cancellationToken: new CancellationToken() };
    this.sessions.push(session);
    const restartToken = pauseKillTimer();
    session.promise = resume(this.workerId, session.cancellationToken)
      .catch((e) => {
        sendSystemMessage(this.workerId, `An error occurred: ${e}`).catch((e) => console.log(e));
        console.log(e);
      })
      .finally(() => {
        session.isFinished = true;
        restartKillTimer(this.workerId, restartToken);
      });
  }

  /**
   *
   * @param callback The callback function that is executed when each session is cancelled.
   */
  private async cancelCurrentSessions(callback?: () => Promise<any>) {
    const runningPromises: Promise<void>[] = [];
    // cancel unfinished sessions
    for (const task of this.sessions) {
      if (task.isFinished) continue;
      task.cancellationToken.cancel(callback);
      runningPromises.push(task.promise);
      console.log(`cancelled an ongoing converse session.`);
    }
    // await all running loops to fully stop before returning
    if (runningPromises.length > 0) {
      console.log(`Awaiting ${runningPromises.length} running session(s) to complete...`);
      await Promise.allSettled(runningPromises);
      console.log(`All sessions settled.`);
    }
    // remove finished sessions
    for (let i = this.sessions.length - 1; i >= 0; i--) {
      if (this.sessions[i]!.isFinished) {
        this.sessions.splice(i, 1);
      }
    }
  }

  /**
   * return true if there is ongoing session.
   */
  public isBusy() {
    return this.sessions.some((session) => !session.isFinished);
  }
}

const isStarted: { [key: string]: boolean } = {};
const trackers: { [key: string]: ConverseSessionTracker } = {};

export const main = async (workerId: string) => {
  if (isStarted[workerId]) {
    console.log(`The worker ${workerId} is already started.`);
    try {
      await refreshSession(workerId);
    } catch (e) {
      console.error('refreshSession on re-invoke failed:', e);
    }
    // A second InvokeAgentRuntime used to return without starting work, so
    // a follow-up Slack ensureInstance could leave the session idle.
    trackers[workerId]?.startOnMessageReceived();
    return trackers[workerId];
  }

  isStarted[workerId] = true;
  try {
    await waitForSlackDestination(workerId);
  } catch (e) {
    console.error('waitForSlackDestination failed; continuing without Slack dest:', e);
  }
  const tracker = new ConverseSessionTracker(workerId);
  trackers[workerId] = tracker;
  // Resume from DynamoDB before AppSync connects. Container cold start is dominated
  // by image pull + process boot; waiting on WebSockets delayed the first agent turn.
  tracker.startResume();
  setKillTimer(workerId);

  const [broadcast, unicast] = await Promise.all([
    events.connect('/event-bus/broadcast'),
    events.connect(`/event-bus/worker/${workerId}`),
  ]);
  broadcast.subscribe({
    next: (data) => {
      console.log('received broadcast', data);
    },
    error: (err) => console.log(err),
  });

  unicast.subscribe({
    next: async (data) => {
      const { data: event, error, success } = workerEventSchema.safeParse(data.event);
      if (!success || error) {
        console.log(`The worker event does not conform to the schema. Ignoring... ${JSON.stringify(data)}`);
        console.log(error);
        return;
      }
      const type = event.type;
      if (type == 'onMessageReceived') {
        tracker.startOnMessageReceived();
      } else if (type == 'forceStop') {
        tracker.forceStop(async () => {
          // Update agent status to pending after force stop
          await updateAgentStatusWithEvent(workerId, 'pending');
          await sendSystemMessage(workerId, 'Agent work was stopped.');
        });
      } else if (type == 'sessionUpdated') {
        await refreshSession(workerId);
      } else if (type == 'requestTerminate') {
        await updateInstanceStatus(workerId, 'terminated');
        await terminateMyself();
      }
    },
    error: (err) => console.log(err),
  });

  // Do not block the Agent Core HTTP response on Slack "launched" notices.
  void Promise.all([
    updateInstanceStatus(workerId, 'running'),
    sendSystemMessage(workerId, 'the instance has successfully launched!'),
  ]).catch((e) => {
    sendSystemMessage(workerId, `An error occurred: ${e}`).catch((err) => console.log(err));
    console.log(e);
  });

  return tracker;
};
