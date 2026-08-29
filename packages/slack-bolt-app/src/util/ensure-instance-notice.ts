/** Slack notice for ensureInstance. First Agent Core launch is `terminated`, not `stopped`. */
export const slackEnsureInstanceNotice = (
  oldStatus: 'running' | 'stopped' | 'terminated',
  runtimeType: 'ec2' | 'agent-core',
  usedCache?: boolean
): string | undefined => {
  if (oldStatus === 'stopped') {
    return 'Waking up from sleep mode...';
  }
  if (oldStatus === 'terminated') {
    if (runtimeType === 'agent-core') {
      return 'Starting the agent runtime...';
    }
    return `Preparing for a new instance${usedCache ? ' (using a cached AMI)' : ''}...`;
  }
  return undefined;
};
