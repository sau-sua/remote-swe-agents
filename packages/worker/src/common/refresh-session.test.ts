import { afterEach, describe, expect, test, vi } from 'vitest';

const slackState = vi.hoisted(() => ({ destSet: false }));
const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock('@remote-swe-agents/agent-core/lib', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  setSlackDestination: () => {
    slackState.destSet = true;
  },
  hasSlackDestination: () => slackState.destSet,
}));

import { refreshSession, waitForSlackDestination } from './refresh-session';

afterEach(() => {
  mockGetSession.mockReset();
  slackState.destSet = false;
  delete process.env.SLACK_CHANNEL_ID;
  delete process.env.SLACK_THREAD_TS;
});

describe('refreshSession', () => {
  test('sets Slack dest from the session record', async () => {
    mockGetSession.mockResolvedValue({
      slackChannelId: 'C1',
      slackThreadTs: '123.456',
      initiator: 'slack#U1',
    });

    await refreshSession('w1');
    expect(slackState.destSet).toBe(true);
  });

  test('leaves Slack disabled when the session has no thread', async () => {
    mockGetSession.mockResolvedValue({ initiator: 'webapp#user@example.com' });
    await refreshSession('w1');
    expect(slackState.destSet).toBe(false);
  });
});

describe('waitForSlackDestination', () => {
  test('retries until Slack channel/thread appear', async () => {
    mockGetSession
      .mockResolvedValueOnce({ initiator: undefined })
      .mockResolvedValueOnce({ initiator: 'slack#U1' })
      .mockResolvedValue({
        slackChannelId: 'C9',
        slackThreadTs: '9.9',
        initiator: 'slack#U1',
      });

    const ok = await waitForSlackDestination('w1', { timeoutMs: 1000, intervalMs: 1 });
    expect(ok).toBe(true);
    expect(slackState.destSet).toBe(true);
    expect(mockGetSession.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('does not stall webapp sessions that will never get a Slack dest', async () => {
    mockGetSession.mockResolvedValue({ initiator: 'webapp#alice' });
    const started = Date.now();
    const ok = await waitForSlackDestination('w1', { timeoutMs: 5000, intervalMs: 50 });
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('keeps going when getSession throws, then succeeds', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('ddb down')).mockResolvedValue({
      slackChannelId: 'C2',
      slackThreadTs: '1.2',
      initiator: 'slack#U2',
    });

    const ok = await waitForSlackDestination('w1', { timeoutMs: 1000, intervalMs: 1 });
    expect(ok).toBe(true);
  });
});
