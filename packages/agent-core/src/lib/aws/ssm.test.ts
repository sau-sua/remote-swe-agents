import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { getParameter, isKmsCiphertext, resolveCredential, ssm } from './ssm';

const KMS_BLOB = 'AQICAHhcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABtk=';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('isKmsCiphertext', () => {
  test('detects AWS KMS blobs', () => {
    expect(isKmsCiphertext(KMS_BLOB)).toBe(true);
  });

  test('does not flag plaintext API keys', () => {
    expect(isKmsCiphertext('sk-proj-abc')).toBe(false);
    expect(isKmsCiphertext('sk-ant-oat01-abc')).toBe(false);
  });
});

describe('getParameter', () => {
  test('requests decryption and returns plaintext', async () => {
    const send = vi.spyOn(ssm, 'send').mockResolvedValue({
      Parameter: { Value: 'sk-test' },
    } as never);

    await expect(getParameter('/remote-swe/openai/api-key')).resolves.toBe('sk-test');

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as GetParameterCommand;
    expect(command.input).toEqual({
      Name: '/remote-swe/openai/api-key',
      WithDecryption: true,
    });
  });

  test('returns undefined when the value is still ciphertext', async () => {
    vi.spyOn(ssm, 'send').mockResolvedValue({
      Parameter: { Value: KMS_BLOB },
    } as never);

    await expect(getParameter('/remote-swe/openai/api-key')).resolves.toBeUndefined();
  });

  test('returns undefined when SSM fails', async () => {
    vi.spyOn(ssm, 'send').mockRejectedValue(new Error('AccessDenied'));
    await expect(getParameter('/remote-swe/openai/api-key')).resolves.toBeUndefined();
  });
});

describe('resolveCredential', () => {
  test('prefers a plaintext environment variable', async () => {
    const send = vi.spyOn(ssm, 'send');
    await expect(resolveCredential('sk-env', '/remote-swe/openai/api-key')).resolves.toBe('sk-env');
    expect(send).not.toHaveBeenCalled();
  });

  test('ignores ciphertext in the environment and decrypts SSM on resume', async () => {
    vi.spyOn(ssm, 'send').mockResolvedValue({
      Parameter: { Value: 'sk-from-ssm' },
    } as never);

    await expect(resolveCredential(KMS_BLOB, '/remote-swe/openai/api-key')).resolves.toBe('sk-from-ssm');
  });

  test('fetches from SSM when the environment variable is empty', async () => {
    vi.spyOn(ssm, 'send').mockResolvedValue({
      Parameter: { Value: 'sk-from-ssm' },
    } as never);

    await expect(resolveCredential(undefined, '/remote-swe/openai/api-key')).resolves.toBe('sk-from-ssm');
    await expect(resolveCredential('', '/remote-swe/openai/api-key')).resolves.toBe('sk-from-ssm');
  });

  test('returns undefined when neither source is usable', async () => {
    await expect(resolveCredential(undefined, undefined)).resolves.toBeUndefined();
    await expect(resolveCredential(KMS_BLOB, undefined)).resolves.toBeUndefined();
  });
});
