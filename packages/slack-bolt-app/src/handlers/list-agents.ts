import { WebClient } from '@slack/web-api';
import { getCustomAgents } from '@remote-swe-agents/agent-core/lib';

export async function handleListAgents(
  event: {
    text: string;
    user?: string;
    channel: string;
    ts: string;
    thread_ts?: string;
  },
  client: WebClient
): Promise<void> {
  const userId = event.user ?? '';
  const agents = await getCustomAgents(50);

  if (agents.length === 0) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: `<@${userId}> No custom agents found. Create one from the Web UI (Custom Agents page).`,
    });
    return;
  }

  const lines = agents.map(
    (agent) =>
      `• *${agent.name}* (id: \`${agent.SK}\`)\n  model: ${agent.defaultModel}, runtime: ${agent.runtimeType}${
        agent.description ? `\n  ${agent.description}` : ''
      }`
  );

  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: `<@${userId}> Available custom agents:\n\n${lines.join(
      '\n'
    )}\n\nStart a new thread with: \`agent:<name-or-id> <your message>\``,
  });
}
