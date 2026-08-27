export type ParsedAgentDirective = {
  /**
   * Agent name or ID extracted from the message, if present.
   */
  agentRef?: string;
  /**
   * GitHub account name or ID extracted from the message, if present.
   */
  githubAccountRef?: string;
  /**
   * Remaining user message after removing leading directives.
   */
  message: string;
};

const DIRECTIVE_PATTERN = /^(agent|github):\s*(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+([\s\S]*))?$/i;

/**
 * Parse optional leading `agent:<name-or-id>` and `github:<name-or-id>` directives.
 * Directives may appear in either order at the start of the message.
 */
export const parseLeadingDirectives = (text: string): ParsedAgentDirective => {
  let remaining = text.trim();
  let agentRef: string | undefined;
  let githubAccountRef: string | undefined;

  while (true) {
    const match = remaining.match(DIRECTIVE_PATTERN);
    if (!match) break;

    const kind = match[1].toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    const rest = (match[5] ?? '').trim();
    if (!value) break;

    if (kind === 'agent' && !agentRef) {
      agentRef = value;
      remaining = rest;
      continue;
    }
    if (kind === 'github' && !githubAccountRef) {
      githubAccountRef = value;
      remaining = rest;
      continue;
    }
    break;
  }

  const result: ParsedAgentDirective = { message: remaining };
  if (agentRef) result.agentRef = agentRef;
  if (githubAccountRef) result.githubAccountRef = githubAccountRef;
  return result;
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
