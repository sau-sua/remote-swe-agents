import { describe, expect, test } from 'vitest';
import { slackEnsureInstanceNotice } from './ensure-instance-notice';

describe('slackEnsureInstanceNotice', () => {
  test('does not post Waking up for a brand-new Agent Core launch', () => {
    expect(slackEnsureInstanceNotice('terminated', 'agent-core')).toBe('Starting the agent runtime...');
    expect(slackEnsureInstanceNotice('terminated', 'agent-core')).not.toContain('Waking up');
  });

  test('posts Waking up only when the session was actually stopped', () => {
    expect(slackEnsureInstanceNotice('stopped', 'agent-core')).toBe('Waking up from sleep mode...');
    expect(slackEnsureInstanceNotice('stopped', 'ec2')).toBe('Waking up from sleep mode...');
  });

  test('posts the EC2 new-instance notice with optional AMI cache', () => {
    expect(slackEnsureInstanceNotice('terminated', 'ec2')).toBe('Preparing for a new instance...');
    expect(slackEnsureInstanceNotice('terminated', 'ec2', true)).toBe(
      'Preparing for a new instance (using a cached AMI)...'
    );
  });

  test('is silent when the worker is already running', () => {
    expect(slackEnsureInstanceNotice('running', 'agent-core')).toBeUndefined();
    expect(slackEnsureInstanceNotice('running', 'ec2')).toBeUndefined();
  });
});
