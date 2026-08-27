import { z } from 'zod';
import { ModelType, modelTypeSchema } from './model';

export const agentStatusSchema = z.union([z.literal('working'), z.literal('pending'), z.literal('completed')]);
export const runtimeTypeSchema = z.union([z.literal('ec2'), z.literal('agent-core')]);
export const defaultRuntimeType: RuntimeType = 'agent-core';

export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type RuntimeType = z.infer<typeof runtimeTypeSchema>;

export const isAgentCoreRuntimeAvailable = (): boolean => Boolean(process.env.AGENT_RUNTIME_ARN?.trim());

/**
 * Runtime for a new session when the agent does not specify one.
 * Agent Core is preferred when it is deployed; otherwise EC2.
 */
export const getDefaultRuntimeType = (): RuntimeType => (isAgentCoreRuntimeAvailable() ? 'agent-core' : 'ec2');

/**
 * Coerce a requested/stored runtime type to one that can actually run.
 * Missing type is treated as EC2 (legacy sessions). Agent Core falls back to EC2
 * when AGENT_RUNTIME_ARN is unset (DEPLOY_BEDROCK_RUNTIME=false).
 */
export const resolveRuntimeType = (requested?: RuntimeType): RuntimeType => {
  const runtimeType = requested ?? 'ec2';
  if (runtimeType === 'agent-core' && !isAgentCoreRuntimeAvailable()) {
    return 'ec2';
  }
  return runtimeType;
};

/**
 * Default agent configuration values.
 * Used by createSession (when no custom agent is specified) and by the worker's DefaultAgent definition.
 * Preferred runtime is Agent Core; getDefaultRuntimeType() falls back to EC2 when it is not deployed.
 */
export const defaultAgentConfig: { runtimeType: RuntimeType; defaultModel: ModelType } = {
  runtimeType: 'agent-core',
  defaultModel: 'opus5',
};

export const customAgentSchema = z.object({
  PK: z.literal('custom-agent'),
  SK: z.string(),
  name: z.string(),
  description: z.string(),
  defaultModel: modelTypeSchema,
  systemPrompt: z.string(),
  tools: z.array(z.string()),
  useAllTools: z.boolean().optional(),
  mcpConfig: z.string(),
  runtimeType: runtimeTypeSchema,
  iconKey: z.string().optional(),
  includeDefaultKnowledge: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type CustomAgent = z.infer<typeof customAgentSchema>;
