import { streamChat, ChatMessage as AiChatMessage } from '../ai';
import { AgentId, AgentState, AgentStatus, SwarmConfig, ToolCall } from './types';
import { Chatroom } from './chatroom';
import { parseToolCalls } from './tool-parser';

const MAX_TURNS_PER_AGENT = 3;
const GLOBAL_TIMEOUT_MS = 180_000; // 3 minutes per agent
const MAX_MESSAGE_HISTORY = 20; // Cap message history to prevent unbounded growth

export class AgentRunner {
  private state: AgentState;
  private chatroom: Chatroom;
  private config: SwarmConfig;
  private systemPrompt: string;
  private startTime: number;
  private _aborted = false;

  constructor(
    agentId: AgentId,
    displayName: string,
    systemPrompt: string,
    chatroom: Chatroom,
    config: SwarmConfig
  ) {
    this.state = {
      id: agentId,
      displayName,
      status: 'idle',
      statusMessage: '',
      messageHistory: [],
      pendingChatroomMessages: [],
      currentStreamingText: '',
      isComplete: false,
      lastSeenTimestamp: 0,
    };
    this.chatroom = chatroom;
    this.config = config;
    this.systemPrompt = systemPrompt;
    this.startTime = Date.now();
  }

  async run(initialMessage: string): Promise<string> {
    this.updateStatus('thinking', `${this.state.displayName} starting...`);
    this.state.messageHistory.push({ role: 'user', content: initialMessage });

    let fullOutput = '';

    for (let turn = 0; turn < MAX_TURNS_PER_AGENT; turn++) {
      if (this._aborted || this.config.abortSignal?.aborted) break;
      if (Date.now() - this.startTime > GLOBAL_TIMEOUT_MS) {
        this.updateStatus('done', `${this.state.displayName} timed out.`);
        break;
      }

      // Inject chatroom messages received since last check
      const newMessages = this.chatroom.getMessagesSince(
        this.state.id,
        this.state.lastSeenTimestamp
      );
      if (newMessages.length > 0) {
        const context = newMessages
          .map((m) => `[${m.from} → ${m.to === 'all' ? 'everyone' : m.to}]: ${m.content}`)
          .join('\n');
        this.state.messageHistory.push({
          role: 'user',
          content: `<chatroom_messages>\n${context}\n</chatroom_messages>`,
        });
        this.state.lastSeenTimestamp = newMessages[newMessages.length - 1].timestamp;
      }

      const { provider, modelId, apiKey, thinkingLevel } = this.resolveModel();

      if (!apiKey) {
        this.updateStatus('error', `No API key for ${provider}`);
        throw new Error(`Missing API key for ${provider}`);
      }

      let responseText = '';
      let executedToolCount = 0;
      this.updateStatus('coding', `${this.state.displayName} is working...`);

      try {
        await streamChat(
          this.state.messageHistory as AiChatMessage[],
          { provider, model: modelId, apiKey, thinkingLevel },
          (token) => {
            if (this._aborted || this.config.abortSignal?.aborted) return;
            responseText += token;
            this.state.currentStreamingText = responseText;
            this.config.onToken(this.state.id, token);

            // Execute tool calls LIVE as they complete during streaming.
            if (responseText.includes('</tool_call>')) {
              const { toolCalls } = parseToolCalls(responseText);
              while (executedToolCount < toolCalls.length) {
                this.executeTool(toolCalls[executedToolCount]);
                executedToolCount++;
              }
            }
          },
          () => {},
          this.systemPrompt
        );
      } catch (err: any) {
        console.error(`[${this.state.id}] Stream error:`, err.message);
        if (!responseText) {
          this.updateStatus('error', `Stream error`);
          return fullOutput || `Error: ${err.message}`;
        }
      }

      if (!responseText.trim()) {
        break; // Empty response = done
      }

      this.state.messageHistory.push({ role: 'assistant', content: responseText });
      // Trim history to prevent unbounded growth
      if (this.state.messageHistory.length > MAX_MESSAGE_HISTORY) {
        // Keep the first message (initial task) and the most recent messages
        this.state.messageHistory = [
          this.state.messageHistory[0],
          ...this.state.messageHistory.slice(-(MAX_MESSAGE_HISTORY - 1)),
        ];
      }
      fullOutput = responseText;

      // Parse final tool calls — any remaining ones not caught during streaming
      const { toolCalls, cleanText } = parseToolCalls(responseText);

      if (toolCalls.length === 0) {
        this.state.isComplete = true;
        this.updateStatus('done', `${this.state.displayName} finished.`);
        return cleanText || responseText;
      }

      // Execute any tool calls that weren't caught during streaming
      while (executedToolCount < toolCalls.length) {
        if (this._aborted || this.config.abortSignal?.aborted) break;
        this.executeTool(toolCalls[executedToolCount]);
        executedToolCount++;
      }

      // If the response had both tool calls AND substantial code output, treat as done
      if (cleanText.includes('<boltArtifact') || cleanText.includes('<boltAction')) {
        this.state.isComplete = true;
        this.updateStatus('done', `${this.state.displayName} finished.`);
        return cleanText;
      }

      // Otherwise prompt to continue
      this.state.messageHistory.push({
        role: 'user',
        content: '<system>Messages sent. Now produce your code output in <boltArtifact> format.</system>',
      });
    }

    this.state.isComplete = true;
    this.updateStatus('done', `${this.state.displayName} finished.`);
    return fullOutput;
  }

  private executeTool(tc: ToolCall): void {
    if (tc.name === 'chatroom_send') {
      const rawTo = (tc.args.to || 'all').toLowerCase();
      const nameMap: Record<string, AgentId | 'all'> = {
        willow: 'willow', orion: 'orion', ethan: 'ethan', meredith: 'meredith', all: 'all',
      };
      const to = nameMap[rawTo] || 'all';
      const message = tc.args.message || '';
      if (message) {
        this.chatroom.send(this.state.id, to, message);
      }
    }
  }

  private resolveModel(): {
    provider: 'gemini' | 'openai' | 'anthropic';
    modelId: string;
    apiKey: string;
    thinkingLevel: number;
  } {
    const allSavedModels = [
      ...(this.config.modelConfig.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' })),
      ...(this.config.modelConfig.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' })),
      ...(this.config.modelConfig.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' })),
    ];
    const selected = allSavedModels.find((m: any) => m.id === this.config.selectedModelId);

    if (selected) {
      const provider = selected.provider as 'gemini' | 'openai' | 'anthropic';
      return {
        provider,
        modelId: selected.modelId,
        apiKey: this.config.apiKeys[provider]?.[0] || '',
        thinkingLevel: selected.thinkingLevel ?? 2,
      };
    }
    return {
      provider: 'gemini',
      modelId: this.config.modelConfig.gemini?.model || 'gemini-3-flash-preview',
      apiKey: this.config.apiKeys.gemini?.[0] || '',
      thinkingLevel: this.config.modelConfig.gemini?.thinkingLevel ?? 2,
    };
  }

  private updateStatus(status: AgentStatus, message: string): void {
    this.state.status = status;
    this.state.statusMessage = message;
    this.config.onAgentStatusChange(this.state.id, status, message);
  }

  abort(): void {
    this._aborted = true;
    this.state.isComplete = true;
    this.updateStatus('done', `${this.state.displayName} stopped.`);
  }

  getState(): AgentState {
    return { ...this.state };
  }
}
