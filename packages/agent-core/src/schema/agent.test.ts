import { afterEach, describe, expect, test } from 'vitest';
import {
  getDefaultRuntimeType,
  isAgentCoreRuntimeAvailable,
  resolveRuntimeType,
  resolveRuntimeTypeForNewSession,
} from './agent';

const originalArn = process.env.AGENT_RUNTIME_ARN;

afterEach(() => {
  if (originalArn === undefined) {
    delete process.env.AGENT_RUNTIME_ARN;
  } else {
    process.env.AGENT_RUNTIME_ARN = originalArn;
  }
});

describe('isAgentCoreRuntimeAvailable', () => {
  test('false when AGENT_RUNTIME_ARN is unset or blank', () => {
    delete process.env.AGENT_RUNTIME_ARN;
    expect(isAgentCoreRuntimeAvailable()).toBe(false);
    process.env.AGENT_RUNTIME_ARN = '   ';
    expect(isAgentCoreRuntimeAvailable()).toBe(false);
  });

  test('true when AGENT_RUNTIME_ARN is set', () => {
    process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc';
    expect(isAgentCoreRuntimeAvailable()).toBe(true);
  });
});

describe('getDefaultRuntimeType', () => {
  test('ec2 when Agent Core is not deployed', () => {
    delete process.env.AGENT_RUNTIME_ARN;
    expect(getDefaultRuntimeType()).toBe('ec2');
  });

  test('agent-core when Agent Core is deployed', () => {
    process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc';
    expect(getDefaultRuntimeType()).toBe('agent-core');
  });
});

describe('resolveRuntimeType', () => {
  test('missing type is treated as EC2 (legacy sessions)', () => {
    process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc';
    expect(resolveRuntimeType(undefined)).toBe('ec2');
    delete process.env.AGENT_RUNTIME_ARN;
    expect(resolveRuntimeType(undefined)).toBe('ec2');
  });

  test('falls back from agent-core to EC2 when runtime is not deployed', () => {
    delete process.env.AGENT_RUNTIME_ARN;
    expect(resolveRuntimeType('agent-core')).toBe('ec2');
  });

  test('keeps agent-core when runtime is deployed', () => {
    process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc';
    expect(resolveRuntimeType('agent-core')).toBe('agent-core');
  });

  test('keeps EC2 regardless of Agent Core availability', () => {
    delete process.env.AGENT_RUNTIME_ARN;
    expect(resolveRuntimeType('ec2')).toBe('ec2');
    process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc';
    expect(resolveRuntimeType('ec2')).toBe('ec2');
  });
});

describe('resolveRuntimeTypeForNewSession', () => {
  test('prefers agent-core when the runtime is deployed and nothing was requested', () => {
    process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc';
    expect(resolveRuntimeTypeForNewSession(undefined)).toBe('agent-core');
  });

  test('falls back to EC2 when Agent Core is not deployed', () => {
    delete process.env.AGENT_RUNTIME_ARN;
    expect(resolveRuntimeTypeForNewSession(undefined)).toBe('ec2');
  });

  test('honors an explicit requested runtime when it can actually run', () => {
    process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc';
    expect(resolveRuntimeTypeForNewSession('ec2')).toBe('ec2');
    expect(resolveRuntimeTypeForNewSession('agent-core')).toBe('agent-core');
  });
});
