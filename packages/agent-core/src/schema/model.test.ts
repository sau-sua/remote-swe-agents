import { describe, expect, test } from 'vitest';
import { getAvailableModelTypes, isOpenAIModel } from './model';

describe('isOpenAIModel', () => {
  test('true for Codex, false for Claude', () => {
    expect(isOpenAIModel('gpt-5.3-codex')).toBe(true);
    expect(isOpenAIModel('opus5')).toBe(false);
  });
});

describe('getAvailableModelTypes', () => {
  test('includes Codex regardless of OpenAI env', () => {
    delete process.env.NEXT_PUBLIC_OPENAI_ENABLED;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAPI_KEY;
    delete process.env.OPENAI_API_KEY_PARAMETER_NAME;
    expect(getAvailableModelTypes()).toContain('gpt-5.3-codex');
  });
});
