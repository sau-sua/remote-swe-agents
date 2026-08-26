import { describe, expect, test } from 'vitest';
import { allTools } from './index';

// Anthropic Messages API rejects tool names that do not match this pattern.
const ANTHROPIC_TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

describe('tool names', () => {
  test('all built-in tool names are valid for Anthropic API', () => {
    for (const tool of allTools) {
      expect(tool.name, `${tool.name} is not a valid Anthropic tool name`).toMatch(ANTHROPIC_TOOL_NAME);
    }
  });
});
