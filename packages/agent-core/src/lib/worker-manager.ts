import {
  DescribeInstancesCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import { GetParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  StopRuntimeSessionCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { ec2, ssm } from './aws';
import { sendWebappEvent } from './events';
import { getSession, updateSession } from './sessions';
import { InstanceStatus, RuntimeType } from '../schema';

const agentCore = new BedrockAgentCoreClient();

const LaunchTemplateId = process.env.WORKER_LAUNCH_TEMPLATE_ID!;
const WorkerAmiParameterName = process.env.WORKER_AMI_PARAMETER_NAME ?? '';
const SubnetIdList = process.env.SUBNET_ID_LIST?.split(',') ?? [];

/** Image Builder writes this until the first AMI is published. It is not a bootable AMI id. */
export const PENDING_WORKER_AMI_PLACEHOLDER = 'pending-initial-build';

export const isUsableWorkerAmiId = (value: string | undefined): value is string => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 && trimmed !== PENDING_WORKER_AMI_PLACEHOLDER;
};

/**
 * Updates the instance status in DynamoDB and sends a webapp event
 */
export async function updateInstanceStatus(workerId: string, status: InstanceStatus) {
  try {
    // Update the instanceStatus using the generic updateSession function
    await updateSession(workerId, { instanceStatus: status });

    // Send event to webapp
    await sendWebappEvent(workerId, {
      type: 'instanceStatusChanged',
      status,
    });

    console.log(`Instance status updated to ${status}`);
  } catch (error) {
    console.error(`Error updating instance status for workerId ${workerId}:`, error);
  }
}

async function findWorkerInstance(workerId: string): Promise<{ instanceId: string; state: string } | null> {
  const describeCommand = new DescribeInstancesCommand({
    Filters: [
      {
        Name: 'tag:RemoteSweWorkerId',
        Values: [workerId],
      },
      {
        Name: 'instance-state-name',
        Values: ['running', 'pending', 'stopped'],
      },
    ],
  });

  try {
    const response = await ec2.send(describeCommand);
    const instances = response.Reservations?.flatMap((reservation) => reservation.Instances ?? []) ?? [];
    const preferred =
      instances.find((instance) => instance.State?.Name === 'running' || instance.State?.Name === 'pending') ??
      instances[0];
    if (!preferred?.InstanceId) {
      return null;
    }
    return { instanceId: preferred.InstanceId, state: preferred.State?.Name ?? 'stopped' };
  } catch (error) {
    console.error('Error finding worker instance', error);
    throw error;
  }
}

async function findWorkerInstanceWithStatus(workerId: string, statuses: string[]): Promise<string | null> {
  const found = await findWorkerInstance(workerId);
  if (!found || !statuses.includes(found.state)) {
    return null;
  }
  return found.instanceId;
}

async function restartWorkerInstance(instanceId: string) {
  const startCommand = new StartInstancesCommand({
    InstanceIds: [instanceId],
  });

  try {
    await ec2.send(startCommand);
  } catch (error) {
    console.error('Error starting stopped instance:', error);
    throw error;
  }
}

async function fetchWorkerAmiId(workerAmiParameterName: string): Promise<string | undefined> {
  try {
    const result = await ssm.send(
      new GetParameterCommand({
        Name: workerAmiParameterName,
      })
    );
    const value = result.Parameter?.Value;
    return isUsableWorkerAmiId(value) ? value : undefined;
  } catch (e) {
    if (e instanceof ParameterNotFound) {
      return;
    }
    throw e;
  }
}

const useSpotInstances = process.env.WORKER_USE_SPOT === 'true';

/** Matches IAM ec2:ResourceTag for worker stop/terminate + event-trigger StartInstances */
const remoteSweStackName = process.env.REMOTE_SWE_STACK_NAME?.trim() ?? '';

function buildRunInstancesInput(
  workerId: string,
  launchTemplateId: string,
  imageId: string | undefined,
  subnetId: string,
  useSpot: boolean
): RunInstancesCommand['input'] {
  const instanceTags = [
    {
      Key: 'RemoteSweWorkerId',
      Value: workerId,
    },
    ...(remoteSweStackName ? [{ Key: 'RemoteSweStackName' as const, Value: remoteSweStackName }] : []),
  ];

  return {
    LaunchTemplate: {
      LaunchTemplateId: launchTemplateId,
      Version: '$Latest',
    },
    ImageId: imageId,
    MinCount: 1,
    MaxCount: 1,
    SubnetId: subnetId,
    // Remove UserData if launching from our AMI, where all the dependencies are already installed.
    UserData: imageId
      ? Buffer.from(
          `
#!/bin/bash
    `.trim()
        ).toString('base64')
      : undefined,
    TagSpecifications: [
      {
        ResourceType: 'instance',
        Tags: instanceTags,
      },
    ],
    ...(useSpot && {
      InstanceMarketOptions: {
        MarketType: 'spot',
        SpotOptions: {
          SpotInstanceType: 'one-time',
        },
      },
    }),
  };
}

async function createWorkerInstance(
  workerId: string,
  launchTemplateId: string,
  workerAmiParameterName: string,
  subnetId: string,
  prefetchedImageId?: string
): Promise<{ instanceId: string; usedCache: boolean }> {
  const imageId = prefetchedImageId ?? (await fetchWorkerAmiId(workerAmiParameterName));

  const tryLaunch = async (useSpot: boolean) => {
    const input = buildRunInstancesInput(workerId, launchTemplateId, imageId, subnetId, useSpot);
    const response = await ec2.send(new RunInstancesCommand(input));
    if (response.Instances && response.Instances.length > 0 && response.Instances[0].InstanceId) {
      return response.Instances[0].InstanceId;
    }
    throw new Error('Failed to create EC2 instance');
  };

  try {
    const instanceId = await tryLaunch(useSpotInstances);
    return { instanceId, usedCache: !!imageId };
  } catch (error: unknown) {
    const err = error as { name?: string } | undefined;
    const isSpotCapacityError =
      useSpotInstances &&
      err &&
      typeof err === 'object' &&
      (err.name === 'InsufficientInstanceCapacity' ||
        err.name === 'InsufficientCapacity' ||
        err.name === 'CapacityNotAvailable');
    if (isSpotCapacityError) {
      console.warn('Spot capacity unavailable, retrying with On-Demand:', error);
      try {
        const instanceId = await tryLaunch(false);
        return { instanceId, usedCache: !!imageId };
      } catch (fallbackError) {
        console.error('Error creating worker instance (On-Demand fallback):', fallbackError);
        throw fallbackError;
      }
    }
    console.error('Error creating worker instance:', error);
    throw error;
  }
}

/**
 * Map a stored instanceStatus onto Slack's ensureInstance notices.
 * Agent Core used to return `stopped` for every non-running session, which posted
 * "Waking up from sleep mode..." on a brand-new launch.
 */
export const agentCoreLaunchStatus = (
  currentInstanceStatus?: InstanceStatus
): 'running' | 'stopped' | 'terminated' => {
  if (currentInstanceStatus === 'running') return 'running';
  if (currentInstanceStatus === 'stopped') return 'stopped';
  return 'terminated';
};

export async function getOrCreateWorkerInstance(
  workerId: string,
  workerType: 'agent-core' | 'ec2' = 'ec2'
): Promise<{ instanceId: string; oldStatus: 'stopped' | 'terminated' | 'running'; usedCache?: boolean }> {
  if (workerType == 'agent-core') {
    const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN?.trim();
    if (!agentRuntimeArn) {
      throw new Error(
        'Bedrock Agent Core is not deployed (AGENT_RUNTIME_ARN is empty). Set DEPLOY_BEDROCK_RUNTIME=true and redeploy, or use an EC2 worker.'
      );
    }
    // Invoke first — DynamoDB status writes must not delay container wake.
    const invoke = agentCore.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn,
        runtimeSessionId: workerId,
        payload: JSON.stringify({ sessionId: workerId, agentRuntimeArn }),
        contentType: 'application/json',
      })
    );
    const session = await getSession(workerId);
    const currentInstanceStatus = session?.instanceStatus;
    if (currentInstanceStatus !== 'running') {
      void updateInstanceStatus(workerId, 'starting');
    }
    await invoke;
    await updateInstanceStatus(workerId, 'running');
    return { instanceId: 'local', oldStatus: agentCoreLaunchStatus(currentInstanceStatus) };
  }

  // One DescribeInstances call covers running, pending, and stopped.
  // Fetch the AMI id in parallel so a cold launch does not wait on SSM after EC2.
  const [found, imageId] = await Promise.all([findWorkerInstance(workerId), fetchWorkerAmiId(WorkerAmiParameterName)]);
  if (found && (found.state === 'running' || found.state === 'pending')) {
    return { instanceId: found.instanceId, oldStatus: 'running' };
  }
  if (found) {
    await updateInstanceStatus(workerId, 'starting');
    await restartWorkerInstance(found.instanceId);
    return { instanceId: found.instanceId, oldStatus: 'stopped' };
  }

  // choose subnet randomly
  const subnetId = SubnetIdList[Math.floor(Math.random() * SubnetIdList.length)];
  await updateInstanceStatus(workerId, 'starting');
  const { instanceId, usedCache } = await createWorkerInstance(
    workerId,
    LaunchTemplateId,
    WorkerAmiParameterName,
    subnetId,
    imageId
  );
  return { instanceId, oldStatus: 'terminated', usedCache };
}

/**
 * Stop a worker instance (EC2 or agent-core runtime session)
 * @param workerId Worker ID of the session to stop
 * @param runtimeType The runtime type ('ec2' or 'agent-core')
 */
export async function stopWorkerInstance(workerId: string, runtimeType: RuntimeType = 'agent-core'): Promise<void> {
  if (runtimeType === 'agent-core') {
    const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
    if (!agentRuntimeArn) {
      console.error('Cannot stop agent-core session: missing AGENT_RUNTIME_ARN');
      return;
    }
    try {
      await agentCore.send(
        new StopRuntimeSessionCommand({
          agentRuntimeArn,
          runtimeSessionId: workerId,
          qualifier: 'DEFAULT',
        })
      );
      console.log(`Stopped agent-core runtime session: ${workerId}`);
    } catch (error) {
      console.error('Error stopping agent-core runtime session:', error);
      return;
    }
  } else {
    const instanceId = await findWorkerInstanceWithStatus(workerId, ['running', 'pending']);
    if (instanceId) {
      try {
        const desc = await ec2.send(
          new DescribeInstancesCommand({
            InstanceIds: [instanceId],
          })
        );
        const inst = desc.Reservations?.[0]?.Instances?.[0];
        const isSpot = inst?.InstanceLifecycle === 'spot';
        if (isSpot) {
          await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
          console.log(`Terminated spot EC2 instance: ${instanceId}`);
        } else {
          await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
          console.log(`Stopped EC2 instance: ${instanceId}`);
        }
      } catch (error) {
        console.error('Error stopping or terminating EC2 instance:', error);
        return;
      }
    }
  }
  await updateInstanceStatus(workerId, 'stopped');
}
