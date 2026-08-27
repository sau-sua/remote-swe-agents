import { MCPClient } from './mcp-client';
import { Tool } from '@aws-sdk/client-bedrock-runtime';
import { McpConfig } from '@remote-swe-agents/agent-core/schema';
import { sendSystemMessage } from '@remote-swe-agents/agent-core/lib';

let clientsMap: { [key: string]: { name: string; client: MCPClient }[] } = {};

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
              client = await MCPClient.fromCommand(serverConfig.command, serverConfig.args, serverConfig.env);
            } else {
              client = await MCPClient.fromUrl(serverConfig.url);
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
