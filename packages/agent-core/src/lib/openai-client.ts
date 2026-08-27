import OpenAI from 'openai';
import { ConverseCommandInput, ConverseResponse, ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { ddb, TableName } from './aws';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { isOpenAIModel, modelConfigs, ModelType } from '../schema';
import { getParameter } from './aws/ssm';

const ULTRA_THINKING_KEYWORD = 'ultrathink';

const TEN_MINUTES_MS = 10 * 60 * 1000;
const SIXTY_MINUTES_MS = 60 * 60 * 1000;

type OpenAIReasoningItem = OpenAI.Responses.ResponseReasoningItem;
type OpenAIFunctionCallItem = OpenAI.Responses.ResponseFunctionToolCall;
type OpenAIInputItem = OpenAI.Responses.ResponseInputItem;
type OpenAIAssistantPhase = 'commentary' | 'final_answer';

type ExtraContent = ContentBlock & {
  openaiReasoningItem?: OpenAIReasoningItem;
  openaiFunctionCallItem?: OpenAIFunctionCallItem;
  openaiAssistantPhase?: OpenAIAssistantPhase;
  thinkingSignature?: string;
};

/**
 * Timeout for OpenAI Responses requests. Matches the Anthropic stream formula
 * (scale by max tokens, 10 min floor, 60 min cap) so long Codex reasoning
 * calls are not killed at the SDK default timeout.
 */
export const openaiRequestTimeoutMs = (maxTokens: number): number => {
  const calculated = (SIXTY_MINUTES_MS * maxTokens) / 128_000;
  return Math.min(SIXTY_MINUTES_MS, Math.max(TEN_MINUTES_MS, calculated));
};

let cachedClient: OpenAI | undefined;

const resolveCredential = async (envVar?: string, parameterName?: string): Promise<string | undefined> => {
  if (envVar) {
    return envVar;
  }
  if (parameterName) {
    return getParameter(parameterName);
  }
  return undefined;
};

const getOpenAIClient = async (): Promise<OpenAI> => {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = await resolveCredential(
    process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY,
    process.env.OPENAI_API_KEY_PARAMETER_NAME
  );
  if (!apiKey) {
    throw new Error(
      'OpenAI credentials not found. Set OPENAI_API_KEY (or OPENAPI_KEY) or OPENAI_API_KEY_PARAMETER_NAME.'
    );
  }

  cachedClient = new OpenAI({ apiKey, timeout: SIXTY_MINUTES_MS });
  return cachedClient;
};

const toUint8Array = (bytes: unknown): Uint8Array => {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (Array.isArray(bytes)) {
    return new Uint8Array(bytes);
  }
  return new Uint8Array(Object.values((bytes as Record<string, number>) ?? {}));
};

const imageMediaType = (format?: string): string => {
  const raw = (format || 'png').toLowerCase();
  if (raw.startsWith('image/')) {
    return raw;
  }
  const normalized = raw === 'jpg' ? 'jpeg' : raw;
  return `image/${normalized}`;
};

const parseFunctionArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to empty object so a malformed payload does not abort the turn.
  }
  return {};
};

const shouldUltraThink = (input: Omit<ConverseCommandInput, 'modelId'>): boolean => {
  const messages = input.messages || [];
  const lastUserMessage = messages
    .filter((message) => message.role === 'user' && message.content?.some((c) => 'text' in c && c.text))
    .pop();

  if (!lastUserMessage?.content) {
    return false;
  }

  const messageText = lastUserMessage.content
    .map((content) => ('text' in content && content.text ? content.text : ''))
    .join(' ')
    .toLowerCase();

  return messageText.includes(ULTRA_THINKING_KEYWORD);
};

export const convertToOpenAIFormat = (
  input: Omit<ConverseCommandInput, 'modelId'>,
  modelType: ModelType
): {
  input: OpenAIInputItem[];
  instructions?: string;
  max_output_tokens: number;
  tools?: OpenAI.Responses.Tool[];
  tool_choice?: OpenAI.Responses.ResponseCreateParams['tool_choice'];
  reasoning?: OpenAI.Reasoning;
  thinkingBudget?: number;
} => {
  const modelConfig = modelConfigs[modelType];
  const items: OpenAIInputItem[] = [];

  if (input.messages) {
    for (const msg of input.messages) {
      const userContent: OpenAI.Responses.ResponseInputContent[] = [];
      let assistantText = '';
      let assistantPhase: OpenAIAssistantPhase | undefined;

      if (msg.content) {
        for (const c of msg.content) {
          const extra = c as ExtraContent;
          if ('text' in c && c.text) {
            if (msg.role === 'assistant') {
              assistantText += c.text;
              assistantPhase = extra.openaiAssistantPhase ?? assistantPhase;
            } else {
              userContent.push({ type: 'input_text', text: c.text });
            }
          } else if ('image' in c && c.image && 'bytes' in c.image && c.image.bytes) {
            const base64Data = Buffer.from(toUint8Array(c.image.bytes)).toString('base64');
            userContent.push({
              type: 'input_image',
              detail: 'auto',
              image_url: `data:${imageMediaType(c.image.format)};base64,${base64Data}`,
            });
          } else if ('toolUse' in c && c.toolUse) {
            if (extra.openaiFunctionCallItem) {
              items.push(extra.openaiFunctionCallItem);
            } else {
              items.push({
                type: 'function_call',
                call_id: c.toolUse.toolUseId || '',
                name: c.toolUse.name || '',
                arguments: JSON.stringify(c.toolUse.input ?? {}),
              });
            }
          } else if ('toolResult' in c && c.toolResult) {
            const toolResult = c.toolResult;
            const outputParts: string[] = [];
            if (toolResult.content) {
              for (const rc of toolResult.content) {
                if ('text' in rc && rc.text) {
                  outputParts.push(rc.text);
                } else if ('image' in rc && rc.image) {
                  outputParts.push('[image]');
                }
              }
            }
            items.push({
              type: 'function_call_output',
              call_id: toolResult.toolUseId || '',
              output: outputParts.join('\n') || (toolResult.status === 'error' ? 'error' : ''),
            });
          } else if ('reasoningContent' in c && c.reasoningContent) {
            if (extra.openaiReasoningItem) {
              items.push(extra.openaiReasoningItem);
            }
          }
        }
      }

      if (msg.role === 'assistant' && assistantText) {
        const assistantMessage: OpenAI.Responses.EasyInputMessage = {
          type: 'message',
          role: 'assistant',
          content: assistantText,
        };
        if (assistantPhase) {
          assistantMessage.phase = assistantPhase;
        }
        items.push(assistantMessage);
      } else if (userContent.length > 0) {
        items.push({
          type: 'message',
          role: 'user',
          content: userContent,
        });
      }
    }
  }

  let instructions: string | undefined;
  if (input.system && input.system.length > 0) {
    const parts = input.system.map((s) => ('text' in s && s.text ? s.text : '')).filter((text) => text.length > 0);
    if (parts.length > 0) {
      instructions = parts.join('\n\n');
    }
  }

  let tools: OpenAI.Responses.Tool[] | undefined;
  if (input.toolConfig?.tools && input.toolConfig.tools.length > 0) {
    tools = [];
    for (const tool of input.toolConfig.tools) {
      const spec = (
        tool as {
          toolSpec?: { name?: string; description?: string; inputSchema?: { json?: Record<string, unknown> } };
        }
      ).toolSpec;
      if (spec) {
        const parameters =
          spec.inputSchema?.json && typeof spec.inputSchema.json === 'object'
            ? spec.inputSchema.json
            : { type: 'object', properties: {} };
        tools.push({
          type: 'function',
          name: spec.name || '',
          description: spec.description,
          parameters,
          strict: false,
        });
      }
    }
    if (tools.length === 0) {
      tools = undefined;
    }
  }

  let tool_choice: OpenAI.Responses.ResponseCreateParams['tool_choice'];
  const choice = input.toolConfig?.toolChoice;
  if (choice) {
    if ('auto' in choice) {
      tool_choice = 'auto';
    } else if ('any' in choice) {
      tool_choice = 'required';
    } else if ('tool' in choice && choice.tool?.name) {
      tool_choice = { type: 'function', name: choice.tool.name };
    }
  }

  const maxOutputTokens = input.inferenceConfig?.maxTokens || modelConfig.maxOutputTokens;
  const enableUltraThink = shouldUltraThink(input);
  const reasoning: OpenAI.Reasoning | undefined = modelConfig.reasoningSupport
    ? { effort: enableUltraThink ? 'xhigh' : 'high' }
    : undefined;
  const thinkingBudget = enableUltraThink ? Math.min(Math.floor(modelConfig.maxOutputTokens / 2), 31999) : undefined;

  return {
    input: items,
    instructions,
    max_output_tokens: maxOutputTokens,
    tools,
    tool_choice,
    reasoning,
    thinkingBudget,
  };
};

const convertFromOpenAIResponse = (response: OpenAI.Responses.Response): ConverseResponse => {
  const content: ExtraContent[] = [];
  let hasToolCall = false;

  for (const item of response.output) {
    if (item.type === 'reasoning') {
      const reasoningItem = item as OpenAIReasoningItem;
      const thinkingText =
        reasoningItem.summary?.map((s) => s.text).join('\n') ||
        reasoningItem.content?.map((c) => c.text).join('\n') ||
        '';
      content.push({
        reasoningContent: {
          reasoningText: { text: thinkingText },
        },
        openaiReasoningItem: reasoningItem,
      });
    } else if (item.type === 'function_call') {
      hasToolCall = true;
      const call = item as OpenAIFunctionCallItem;
      content.push({
        toolUse: {
          toolUseId: call.call_id,
          name: call.name,
          input: parseFunctionArguments(call.arguments),
        },
        openaiFunctionCallItem: call,
      } as ExtraContent);
    } else if (item.type === 'message') {
      const message = item as OpenAI.Responses.ResponseOutputMessage;
      const phase = (message as { phase?: OpenAIAssistantPhase }).phase;
      for (const part of message.content) {
        if (part.type === 'output_text') {
          content.push({
            text: part.text,
            openaiAssistantPhase: phase,
          });
        }
      }
    }
  }

  const usage = response.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cacheReadInputTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  const cacheWriteInputTokens = usage?.input_tokens_details?.cache_write_tokens ?? 0;

  let stopReason: ConverseResponse['stopReason'] = 'end_turn';
  if (hasToolCall) {
    stopReason = 'tool_use';
  } else if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
    stopReason = 'max_tokens';
  }

  return {
    output: {
      message: {
        role: 'assistant',
        content,
      },
    },
    stopReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheReadInputTokens,
      cacheWriteInputTokens,
    },
    metrics: undefined,
  };
};

export const openaiConverse = async (
  workerId: string,
  modelTypes: ModelType[],
  input: Omit<ConverseCommandInput, 'modelId'>,
  maxTokensExceededCount = 0
): Promise<{ response: ConverseResponse; thinkingBudget?: number }> => {
  if (maxTokensExceededCount > 5) {
    throw new Error(`Max tokens exceeded too many times (${maxTokensExceededCount})`);
  }

  const modelType = modelTypes[Math.floor(Math.random() * modelTypes.length)];
  if (!isOpenAIModel(modelType)) {
    throw new Error(`Model ${modelType} is not an OpenAI model`);
  }

  const client = await getOpenAIClient();
  const modelName = modelConfigs[modelType].modelId;
  console.log(`Using OpenAI API with model: ${modelName}`);

  const {
    input: items,
    instructions,
    max_output_tokens,
    tools,
    tool_choice,
    reasoning,
    thinkingBudget,
  } = convertToOpenAIFormat(input, modelType);

  const request: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: modelName,
    input: items,
    max_output_tokens,
    store: false,
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: workerId,
    ...(instructions && { instructions }),
    ...(tools && tools.length > 0 && { tools }),
    ...(tool_choice && { tool_choice }),
    ...(reasoning && { reasoning }),
  };

  const timeout = openaiRequestTimeoutMs(max_output_tokens);
  const openaiResponse = await client.responses.create(request, { timeout });
  const response = convertFromOpenAIResponse(openaiResponse);

  await trackTokenUsage(workerId, modelName, response);

  return { response, thinkingBudget };
};

const trackTokenUsage = async (workerId: string, modelId: string, response: ConverseResponse) => {
  if (!TableName) {
    return;
  }
  if (!response.usage) {
    console.warn('No usage information in response');
    return;
  }

  const { inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens } = response.usage;

  try {
    const existingItem = await ddb.send(
      new GetCommand({
        TableName,
        Key: {
          PK: `token-${workerId}`,
          SK: modelId,
        },
      })
    );

    if (existingItem.Item) {
      await ddb.send(
        new UpdateCommand({
          TableName,
          Key: {
            PK: `token-${workerId}`,
            SK: modelId,
          },
          UpdateExpression:
            'ADD inputToken :inputTokens, outputToken :outputTokens, cacheReadInputTokens :cacheReadInputTokens, cacheWriteInputTokens :cacheWriteInputTokens',
          ExpressionAttributeValues: {
            ':inputTokens': inputTokens || 0,
            ':outputTokens': outputTokens || 0,
            ':cacheReadInputTokens': cacheReadInputTokens || 0,
            ':cacheWriteInputTokens': cacheWriteInputTokens || 0,
          },
        })
      );
    } else {
      await ddb.send(
        new PutCommand({
          TableName,
          Item: {
            PK: `token-${workerId}`,
            SK: modelId,
            inputToken: inputTokens || 0,
            outputToken: outputTokens || 0,
            cacheReadInputTokens: cacheReadInputTokens || 0,
            cacheWriteInputTokens: cacheWriteInputTokens || 0,
          },
        })
      );
    }
  } catch (error) {
    console.error('Error tracking token usage:', error);
  }
};
