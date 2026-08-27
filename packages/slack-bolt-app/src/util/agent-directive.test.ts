import { describe, expect, test } from 'vitest';
import { parseAgentDirective } from './agent-directive';

describe('parseAgentDirective', () => {
  test('returns original message when no directive is present', () => {
    expect(parseAgentDirective('Please fix the bug')).toEqual({
      message: 'Please fix the bug',
    });
  });

  test('parses unquoted agent name', () => {
    expect(parseAgentDirective('agent:Reviewer Please review this PR')).toEqual({
      agentRef: 'Reviewer',
      message: 'Please review this PR',
    });
  });

  test('parses double-quoted agent name with spaces', () => {
    expect(parseAgentDirective('agent:"Code Reviewer" Please review')).toEqual({
      agentRef: 'Code Reviewer',
      message: 'Please review',
    });
  });

  test('parses single-quoted agent name with spaces', () => {
    expect(parseAgentDirective("agent:'Bug Hunter' find bugs")).toEqual({
      agentRef: 'Bug Hunter',
      message: 'find bugs',
    });
  });

  test('is case-insensitive on the agent: prefix', () => {
    expect(parseAgentDirective('AGENT:abc123 do work')).toEqual({
      agentRef: 'abc123',
      message: 'do work',
    });
  });

  test('allows multiline remaining message', () => {
    expect(parseAgentDirective('agent:Reviewer\nline1\nline2')).toEqual({
      agentRef: 'Reviewer',
      message: 'line1\nline2',
    });
  });

  test('returns empty message when only the directive is present', () => {
    expect(parseAgentDirective('agent:Reviewer')).toEqual({
      agentRef: 'Reviewer',
      message: '',
    });
  });

  test('does not treat agent: in the middle of a message as a directive', () => {
    expect(parseAgentDirective('please use agent:Reviewer somehow')).toEqual({
      message: 'please use agent:Reviewer somehow',
    });
  });
});
