import { describe, expect, test } from 'vitest';
import { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { anthropicStreamTimeoutMs, convertToAnthropicFormat } from './anthropic-client';

const baseInput = (userText = 'hello'): Omit<ConverseCommandInput, 'modelId'> => ({
  messages: [{ role: 'user', content: [{ text: userText }] }],
});

describe('convertToAnthropicFormat thinking', () => {
  test('sonnet5 uses adaptive thinking and output_config.effort', () => {
    const result = convertToAnthropicFormat(baseInput(), 'sonnet5');
    expect(result.thinking).toEqual({ type: 'adaptive' });
    expect(result.output_config).toEqual({ effort: 'xhigh' });
    expect(result.max_tokens).toBe(64_000);
    expect(result.thinkingBudget).toBeUndefined();
  });

  test('sonnet5 ultrathink uses effort max', () => {
    const result = convertToAnthropicFormat(baseInput('please ultrathink this'), 'sonnet5');
    expect(result.thinking).toEqual({ type: 'adaptive' });
    expect(result.output_config).toEqual({ effort: 'max' });
    expect(result.thinkingBudget).toBeGreaterThan(2000);
  });

  test('opus5 also uses adaptive thinking', () => {
    const result = convertToAnthropicFormat(baseInput(), 'opus5');
    expect(result.thinking).toEqual({ type: 'adaptive' });
    expect(result.output_config).toEqual({ effort: 'xhigh' });
  });

  test('sonnet4.5 still uses enabled thinking with budget_tokens', () => {
    const result = convertToAnthropicFormat(baseInput(), 'sonnet4.5');
    expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
    expect(result.output_config).toBeUndefined();
  });
});

describe('anthropicStreamTimeoutMs', () => {
  test('floors at 10 minutes for small max_tokens', () => {
    expect(anthropicStreamTimeoutMs(8192)).toBe(10 * 60 * 1000);
  });

  test('scales to 30 minutes for sonnet5 64k max_tokens', () => {
    expect(anthropicStreamTimeoutMs(64_000)).toBe(30 * 60 * 1000);
  });

  test('caps at 60 minutes for 128k max_tokens', () => {
    expect(anthropicStreamTimeoutMs(128_000)).toBe(60 * 60 * 1000);
  });
});
