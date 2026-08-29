import { MCPClient } from './mcp-client';
import { Tool } from '@aws-sdk/client-bedrock-runtime';
import { McpConfig } from '@remote-swe-agents/agent-core/schema';
import { sendSystemMessage } from '@remote-swe-agents/agent-core/lib';

let clientsMap: { [key: string]: { name: string; client: MCPClient }[] } = {};

/** Per-server cap so a hung playwright/npx start cannot stall the first agent turn. */
export const MCP_START_TIMEOUT_MS = 30_000;

export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

const initMcp = async (workerId: string, config: McpConfig) => {
  const failures: string[] = [];
  clientsMap[workerId] = (
    await Promise.all(
      Object.entries(config.mcpServers)
        .filter(([, serverConfig]) => serverConfig.enabled !== false)
        .map(async ([name, serverConfig]) => {
          try {
            let client: MCPClient;
            if ('command' in serverConfig) {
              client = await withTimeout(
                MCPClient.fromCommand(serverConfig.command, serverConfig.args, serverConfig.env),
                MCP_START_TIMEOUT_MS,
                `MCP server ${name}`
              );
            } else {
              client = await withTimeout(
                MCPClient.fromUrl(serverConfig.url),
                MCP_START_TIMEOUT_MS,
                `MCP server ${name}`
              );
            }
            return { name, client };
          } catch (e) {
            const message = `MCP server ${name} failed to start: ${e}`;
            console.error(message);
            failures.push(message);
          }
        })
    )
  ).filter((c) => c != null);

  if (failures.length > 0) {
    await sendSystemMessage(
      workerId,
      `Some MCP servers could not be started:\n${failures.join('\n')}\nOther tools remain available.`
    );
  }
};

export const getMcpToolSpecs = async (workerId: string, config: McpConfig): Promise<Tool[]> => {
  const enabledServers = Object.entries(config.mcpServers).filter(([, serverConfig]) => serverConfig.enabled !== false);
  if (enabledServers.length == 0) return [];
  if (!clientsMap[workerId]) {
    await initMcp(workerId, config);
  }
  return (
    clientsMap[workerId]?.flatMap(({ client }) => {
      return client.tools;
    }) ?? []
  );
};

export const tryExecuteMcpTool = async (workerId: string, toolName: string, input: any) => {
  const client = clientsMap[workerId]?.find(({ client }) =>
    client.tools.find((tool) => tool.toolSpec?.name == toolName)
  );
  if (client == null) {
    return { found: false };
  }
  const res = await client.client.callTool(toolName, input);
  return { found: true, content: res };
};

export const closeMcpServers = async () => {
  await Promise.all(
    Object.values(clientsMap).flatMap(async (clients) =>
      clients.map(async (client) => {
        await client.client.cleanup();
      })
    )
  );
  clientsMap = {};
};

/** @internal test helper */
export const resetMcpClients = () => {
  clientsMap = {};
};
