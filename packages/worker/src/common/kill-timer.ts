import { sendSystemMessage, updateInstanceStatus } from '@remote-swe-agents/agent-core/lib';
import { refreshSession } from './refresh-session';
import { stopMyself, terminateMyself, getInstanceLifecycle } from './ec2';
import { randomBytes } from 'crypto';

let killTimer: NodeJS.Timeout | undefined = undefined;
let paused = false;

const workerRuntime = process.env.WORKER_RUNTIME ?? 'ec2';
const isAgentCore = workerRuntime === 'agent-core';

const DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60;

export const getIdleTimeoutMs = (): number => {
  const raw = process.env.WORKER_IDLE_TIMEOUT_SECONDS;
  const seconds = raw == null || raw === '' ? DEFAULT_IDLE_TIMEOUT_SECONDS : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 60) {
    return DEFAULT_IDLE_TIMEOUT_SECONDS * 1000;
  }
  return seconds * 1000;
};

// Reset on every user message. After this much idle time the worker stops itself
// so the next message pays a cold start. Default 30 minutes (was 15).

// You can use setKillTimer to kill the process after 30 minutes.
// If setKillTimer is called before 30 minutes elapsed, the timer count is reset and another
// 30 minutes is required to kill the process.
//
// On agent-core runtime, the initial kill timer on startup is skipped. The timer only
// starts when the agent transitions from working to waiting-for-user (via restartKillTimer).
// This ensures agent-core sessions are never killed during active work, while still
// cleaning up sessions that have been idle for 30 minutes after completing a task.
//
// You can pause the timer to avoid process termination when a long-running process is executed
// outside of the control loop (e.g. agent's tool use).
// To avoid race condition, a restart token is issued when you call pauseKillTimer, and the current
// restart token is replaced every time pauseKillTimer is called. The restart token
// is required to match with the latest restart token when you call restartKillTimer.

// This mechanism prevents the following race condition:
// A: call pauseKillTimer
// B: call pauseKillTimer
// A: call restartKillTimer
//  -> process can be killed despite pause request from B.

export const setKillTimer = (workerId: string) => {
  if (paused) return;
  // On agent-core, skip the initial timer set on startup.
  // The timer will be started by restartKillTimer when the agent becomes idle.
  if (isAgentCore && !hasWorkedBefore) return;
  if (killTimer) {
    clearTimeout(killTimer);
  }
  killTimer = setTimeout(async () => {
    await refreshSession(workerId);

    const isEc2 = workerRuntime === 'ec2';
    let isSpot = false;
    if (isEc2) {
      try {
        isSpot = (await getInstanceLifecycle()) === 'spot';
      } catch {
        isSpot = true;
      }
    }

    try {
      await updateInstanceStatus(workerId, isSpot ? 'terminated' : 'stopped');
    } catch (e) {
      console.error('Kill timer: error updating instance status before stop:', e);
    }

    let stopped = false;
    try {
      if (isAgentCore) {
        stopped = await stopMyself(workerId);
      } else if (isSpot) {
        stopped = await terminateMyself();
      } else {
        stopped = await stopMyself();
      }
    } catch (e) {
      console.error('Kill timer: stop/terminate failed:', e);
    }

    if (!stopped) {
      console.error(
        'Kill timer: stop/terminate did not succeed (check AGENT_RUNTIME_ARN, IAM, or EC2 metadata); notifying user and rescheduling timer'
      );
      try {
        await sendSystemMessage(
          workerId,
          'Idle timeout reached but automatic shutdown failed. Please stop the session from the Web UI, or send a message to continue.'
        );
      } catch (e) {
        console.error('Kill timer: sendSystemMessage (shutdown failure notice) failed:', e);
      }
      setKillTimer(workerId);
      return;
    }

    try {
      await sendSystemMessage(workerId, 'Going to sleep mode. You can wake me up at any time.');
    } catch (e) {
      console.error('Kill timer: sendSystemMessage failed:', e);
    }

    if (isAgentCore) {
      process.exit(0);
    }
  }, getIdleTimeoutMs());
};

let restartToken = '';
let hasWorkedBefore = false;

export const pauseKillTimer = () => {
  restartToken = randomBytes(8).toString('hex');
  if (killTimer) {
    clearTimeout(killTimer);
    killTimer = undefined;
    paused = true;
  }
  hasWorkedBefore = true;
  return restartToken;
};

export const restartKillTimer = (workerId: string, token: string) => {
  if (token == restartToken) {
    paused = false;
    setKillTimer(workerId);
  }
};
