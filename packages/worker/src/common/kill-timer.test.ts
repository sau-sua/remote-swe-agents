import { afterEach, describe, expect, test } from 'vitest';
import { getIdleTimeoutMs } from './kill-timer';

describe('getIdleTimeoutMs', () => {
  const original = process.env.WORKER_IDLE_TIMEOUT_SECONDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.WORKER_IDLE_TIMEOUT_SECONDS;
    } else {
      process.env.WORKER_IDLE_TIMEOUT_SECONDS = original;
    }
  });

  test('defaults to 30 minutes', () => {
    delete process.env.WORKER_IDLE_TIMEOUT_SECONDS;
    expect(getIdleTimeoutMs()).toBe(30 * 60 * 1000);
  });

  test('reads WORKER_IDLE_TIMEOUT_SECONDS', () => {
    process.env.WORKER_IDLE_TIMEOUT_SECONDS = '1800';
    expect(getIdleTimeoutMs()).toBe(1800 * 1000);
  });

  test('rejects values under 60 seconds', () => {
    process.env.WORKER_IDLE_TIMEOUT_SECONDS = '10';
    expect(getIdleTimeoutMs()).toBe(30 * 60 * 1000);
  });
});
