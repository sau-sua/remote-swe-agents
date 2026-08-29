import { getSession, hasSlackDestination, setSlackDestination } from '@remote-swe-agents/agent-core/lib';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Set required global variables for the session (this is dirty but at least is working...)
 */
export const refreshSession = async (workerId: string) => {
  const session = await getSession(workerId);
  if (!session) return session;

  if (session.slackChannelId && session.slackThreadTs) {
    setSlackDestination(session.slackChannelId, session.slackThreadTs);
  }
  {
    // For backward compatibility. Will remove this block half year later.
    const SlackChannelId = process.env.SLACK_CHANNEL_ID!;
    const SlackThreadTs = process.env.SLACK_THREAD_TS!;
    if (SlackChannelId && SlackThreadTs) {
      setSlackDestination(SlackChannelId, SlackThreadTs);
    }
  }
  return session;
};

const isSlackInitiator = (initiator?: string): boolean => !initiator || initiator.startsWith('slack#');

/**
 * Agent Core `/invocations` often starts before Slack `saveSessionInfo` writes
 * channel/thread. Without waiting, `disableSlack` stays true for the process
 * lifetime and worker replies never reach the thread.
 *
 * Webapp/API sessions have a non-slack initiator and will never get a Slack
 * dest; return immediately in that case.
 */
export const waitForSlackDestination = async (
  workerId: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<boolean> => {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const intervalMs = options?.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const session = await refreshSession(workerId);
      if (hasSlackDestination()) {
        return true;
      }
      if (session?.initiator && !isSlackInitiator(session.initiator)) {
        return false;
      }
    } catch (e) {
      console.error('refreshSession failed while waiting for Slack destination:', e);
    }

    if (Date.now() >= deadline) {
      break;
    }
    await sleep(intervalMs);
  }

  try {
    await refreshSession(workerId);
  } catch (e) {
    console.error('refreshSession failed after Slack destination wait:', e);
  }
  return hasSlackDestination();
};
