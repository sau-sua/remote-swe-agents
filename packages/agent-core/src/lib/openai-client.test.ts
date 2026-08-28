import { describe, expect, test } from 'vitest';
import { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { convertToOpenAIFormat, openaiRequestTimeoutMs } from './openai-client';

const baseInput = (userText = 'hello'): Omit<ConverseCommandInput, 'modelId'> => ({
  messages: [{ role: 'user', content: [{ text: userText }] }],
});

describe('convertToOpenAIFormat', () => {
  test.each(['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex'] as const)(
    'maps user text and system prompt for %s',
    (modelType) => {
      const result = convertToOpenAIFormat(
        {
          ...baseInput(),
          system: [{ text: 'You are an agent.' }],
        },
        modelType
      );

      expect(result.instructions).toBe('You are an agent.');
      expect(result.input).toEqual([
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ]);
      expect(result.reasoning).toEqual({ effort: 'high' });
    }
  );

  test('uses xhigh effort for ultrathink', () => {
    const result = convertToOpenAIFormat(baseInput('please ultrathink this'), 'gpt-5.3-codex');
    expect(result.reasoning).toEqual({ effort: 'xhigh' });
    expect(result.thinkingBudget).toBeGreaterThan(2000);
  });

  test('converts tool specs and tool_choice any to required', () => {
    const result = convertToOpenAIFormat(
      {
        ...baseInput(),
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: 'read_file',
                description: 'Read a file',
                inputSchema: { json: { type: 'object', properties: { path: { type: 'string' } } } },
              },
            },
          ],
          toolChoice: { any: {} },
        },
      },
      'gpt-5.3-codex'
    );

    expect(result.tool_choice).toBe('required');
    expect(result.tools).toEqual([
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        strict: false,
      },
    ]);
  });

  test('round-trips function calls and outputs', () => {
    const result = convertToOpenAIFormat(
      {
        messages: [
          { role: 'user', content: [{ text: 'read it' }] },
          {
            role: 'assistant',
            content: [
              {
                toolUse: { toolUseId: 'call_1', name: 'read_file', input: { path: 'a.ts' } },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                toolResult: {
                  toolUseId: 'call_1',
                  content: [{ text: 'export const a = 1;' }],
                  status: 'success',
                },
              },
            ],
          },
        ],
      },
      'gpt-5.3-codex'
    );

    expect(result.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'read it' }] },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'a.ts' }),
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'export const a = 1;',
      },
    ]);
  });
});

describe('openaiRequestTimeoutMs', () => {
  test('floors at 10 minutes for small max_tokens', () => {
    expect(openaiRequestTimeoutMs(8192)).toBe(10 * 60 * 1000);
  });

  test('caps at 60 minutes for 128k max_tokens', () => {
    expect(openaiRequestTimeoutMs(128_000)).toBe(60 * 60 * 1000);
  });
});
