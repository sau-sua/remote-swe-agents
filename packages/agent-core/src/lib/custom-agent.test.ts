import { describe, expect, test, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('./aws', () => ({
  ddb: { send: (...args: any[]) => mockSend(...args) },
  TableName: 'TestTable',
}));

import { findCustomAgentByNameOrId } from './custom-agent';
import type { CustomAgent } from '../schema';

const makeAgent = (sk: string, name: string): CustomAgent =>
  ({
    PK: 'custom-agent',
    SK: sk,
    name,
    description: '',
    defaultModel: 'sonnet5',
    systemPrompt: '',
    tools: [],
    mcpConfig: '{"mcpServers":{}}',
    runtimeType: 'ec2',
    createdAt: 1,
    updatedAt: 1,
  }) as CustomAgent;

describe('findCustomAgentByNameOrId', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  test('returns agent when SK matches', async () => {
    const agent = makeAgent('abc123', 'Reviewer');
    mockSend.mockResolvedValueOnce({ Item: agent });

    const result = await findCustomAgentByNameOrId('abc123');
    expect(result.agent).toEqual(agent);
    expect(result.candidates).toBeUndefined();
  });

  test('falls back to case-insensitive exact name match', async () => {
    const agent = makeAgent('id1', 'Code Reviewer');
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [agent, makeAgent('id2', 'Bug Hunter')] });

    const result = await findCustomAgentByNameOrId('code reviewer');
    expect(result.agent?.SK).toBe('id1');
  });

  test('returns candidates when multiple agents share the same name', async () => {
    const a = makeAgent('id1', 'Reviewer');
    const b = makeAgent('id2', 'reviewer');
    mockSend.mockResolvedValueOnce({ Item: undefined }).mockResolvedValueOnce({ Items: [a, b] });

    const result = await findCustomAgentByNameOrId('Reviewer');
    expect(result.agent).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });

  test('returns empty result when nothing matches', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }).mockResolvedValueOnce({ Items: [makeAgent('id1', 'Other')] });

    const result = await findCustomAgentByNameOrId('missing');
    expect(result).toEqual({});
  });

  test('returns empty result for blank input', async () => {
    const result = await findCustomAgentByNameOrId('   ');
    expect(result).toEqual({});
    expect(mockSend).not.toHaveBeenCalled();
  });
});
