import { describe, expect, test } from 'vitest';
import { agentCoreLaunchStatus, isUsableWorkerAmiId, PENDING_WORKER_AMI_PLACEHOLDER } from './worker-manager';

describe('isUsableWorkerAmiId', () => {
  test('rejects empty and the Image Builder placeholder', () => {
    expect(isUsableWorkerAmiId(undefined)).toBe(false);
    expect(isUsableWorkerAmiId('')).toBe(false);
    expect(isUsableWorkerAmiId('   ')).toBe(false);
    expect(isUsableWorkerAmiId(PENDING_WORKER_AMI_PLACEHOLDER)).toBe(false);
  });

  test('accepts a real AMI id', () => {
    expect(isUsableWorkerAmiId('ami-0123456789abcdef0')).toBe(true);
  });
});

describe('agentCoreLaunchStatus', () => {
  test('treats a missing status as a new launch, not sleep', () => {
    expect(agentCoreLaunchStatus(undefined)).toBe('terminated');
    expect(agentCoreLaunchStatus('starting')).toBe('terminated');
    expect(agentCoreLaunchStatus('terminated')).toBe('terminated');
  });

  test('maps running and stopped onto Slack ensureInstance notices', () => {
    expect(agentCoreLaunchStatus('running')).toBe('running');
    expect(agentCoreLaunchStatus('stopped')).toBe('stopped');
  });
});
