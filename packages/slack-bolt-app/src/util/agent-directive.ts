export type ParsedAgentDirective = {
  /**
   * Agent name or ID extracted from the message, if present.
   */
  agentRef?: string;
  /**
   * Remaining user message after removing the agent directive.
   */
  message: string;
};

/**
 * Parse an optional leading `agent:<name-or-id>` directive from a Slack message.
 *
 * Supported forms:
 * - agent:MyAgent do something
 * - agent:"My Agent" do something
 * - agent:'My Agent' do something
 *
 * The directive is only recognized at the start of the message (after mentions
 * have already been stripped by the caller).
 */
export const parseAgentDirective = (text: string): ParsedAgentDirective => {
  const trimmed = text.trim();
  const match = trimmed.match(/^agent:\s*(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+([\s\S]*))?$/i);

  if (!match) {
    return { message: trimmed };
  }

  const agentRef = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  const message = (match[4] ?? '').trim();

  if (!agentRef) {
    return { message: trimmed };
  }

  return { agentRef, message };
};
