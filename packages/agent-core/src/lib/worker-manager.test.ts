import { describe, expect, test } from 'vitest';
import { isUsableWorkerAmiId, PENDING_WORKER_AMI_PLACEHOLDER } from './worker-manager';

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
