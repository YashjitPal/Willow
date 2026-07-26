import { AgentId, SwarmConfig, SwarmResult } from './types';
import { AgentRunner } from './agent-runner';
import { Chatroom } from './chatroom';
import { streamChat, ChatMessage as AiChatMessage } from '../ai';
import {
  WILLOW_SYSTEM_PROMPT,
  WILLOW_SYNTHESIS_DIRECT_PROMPT,
  WILLOW_SYNTHESIS_DIVIDE_PROMPT,
  WILLOW_SYNTHESIS_CONVERSATION_PROMPT,
  ORION_DIRECT_PROMPT,
  ORION_DIVIDE_PROMPT,
  ORION_CONVERSATION_PROMPT,
  ETHAN_DIRECT_PROMPT,
  ETHAN_DIVIDE_PROMPT,
  ETHAN_CONVERSATION_PROMPT,
  MEREDITH_DIRECT_PROMPT,
  MEREDITH_DIVIDE_PROMPT,
  MEREDITH_CONVERSATION_PROMPT,
} from './prompts';

type SwarmMode = 'direct' | 'divide' | 'conversation';

export class SwarmOrchestrator {
  private chatroom: Chatroom;
  private agents: Map<AgentId, AgentRunner> = new Map();
  private config: SwarmConfig;
  private aborted = false;

  constructor(config: SwarmConfig) {
    this.config = config;
    this.chatroom = new Chatroom();

    this.chatroom.onMessage((msg) => {
      config.onChatroomMessage(msg);
    });
  }

  async execute(userPrompt: string): Promise<SwarmResult> {
    const startTime = Date.now();
    const projectContext = this.buildProjectContext();

    // ───────────────────────────────
    // Step 0: Willow decides — DIRECT or DIVIDE?
    // Fast binary decision, no tool calls needed.
    // ───────────────────────────────
    this.config.onAgentStatusChange('willow', 'assessing', 'Evaluating task...');

    const mode = await this.decideMode(userPrompt);

    // In DIVIDE mode, Willow announces planning. In DIRECT mode, Willow stays silent.
    if (mode === 'divide') {
      this.chatroom.send('willow', 'all',
        `Alright team, this one needs a coordinated approach. Let me break it down and assign parts.`
      );
    }

    if (this.aborted || this.config.abortSignal?.aborted) {
      return this.buildResult(startTime, '', {});
    }

    let willowPlan = '';

    // ───────────────────────────────
    // DIVIDE mode: Willow plans + assigns files
    // ───────────────────────────────
    if (mode === 'divide') {
      this.config.onAgentStatusChange('willow', 'distributing', 'Assigning tasks...');

      const planner = new AgentRunner(
        'willow', 'Willow', WILLOW_SYSTEM_PROMPT,
        this.chatroom, this.config
      );
      this.agents.set('willow', planner);

      willowPlan = await planner.run(
        this.buildDividePlannerPrompt(userPrompt, projectContext)
      );

      if (this.aborted || this.config.abortSignal?.aborted) {
        return this.buildResult(startTime, '', {});
      }
    }

    // ───────────────────────────────
    // Workers: ALL 3 always run in parallel
    // ───────────────────────────────
    this.config.onAgentStatusChange('willow', 'waiting', 'Team is working...');

    const orionPrompt = mode === 'conversation' ? ORION_CONVERSATION_PROMPT
      : mode === 'direct' ? ORION_DIRECT_PROMPT : ORION_DIVIDE_PROMPT;
    const ethanPrompt = mode === 'conversation' ? ETHAN_CONVERSATION_PROMPT
      : mode === 'direct' ? ETHAN_DIRECT_PROMPT : ETHAN_DIVIDE_PROMPT;
    const meredithPrompt = mode === 'conversation' ? MEREDITH_CONVERSATION_PROMPT
      : mode === 'direct' ? MEREDITH_DIRECT_PROMPT : MEREDITH_DIVIDE_PROMPT;

    const orion = new AgentRunner('orion', 'Orion', orionPrompt, this.chatroom, this.config);
    const ethan = new AgentRunner('ethan', 'Ethan', ethanPrompt, this.chatroom, this.config);
    const meredith = new AgentRunner('meredith', 'Meredith', meredithPrompt, this.chatroom, this.config);

    this.agents.set('orion', orion);
    this.agents.set('ethan', ethan);
    this.agents.set('meredith', meredith);

    const workerInput = (mode === 'direct' || mode === 'conversation')
      ? this.buildDirectWorkerPrompt(userPrompt, projectContext)
      : null; // null = each agent gets their own prompt from chatroom

    const [orionOutput, ethanOutput, meredithOutput] = await Promise.all([
      orion.run(workerInput || this.buildDivideWorkerPrompt('orion', userPrompt, projectContext)),
      ethan.run(workerInput || this.buildDivideWorkerPrompt('ethan', userPrompt, projectContext)),
      meredith.run(workerInput || this.buildDivideWorkerPrompt('meredith', userPrompt, projectContext)),
    ]);

    if (this.aborted || this.config.abortSignal?.aborted) {
      return this.buildResult(startTime, '', { orion: orionOutput, ethan: ethanOutput, meredith: meredithOutput });
    }

    // ───────────────────────────────
    // Willow curates the final response
    // Streams tokens live to the UI via onSynthesisToken
    // ───────────────────────────────
    this.config.onAgentStatusChange('willow', 'synthesizing',
      mode === 'conversation' ? 'Composing final answer...'
        : mode === 'direct' ? 'Picking the best response...' : 'Merging results...'
    );

    const synthPrompt = mode === 'conversation'
      ? WILLOW_SYNTHESIS_CONVERSATION_PROMPT
      : mode === 'direct'
        ? WILLOW_SYNTHESIS_DIRECT_PROMPT
        : WILLOW_SYNTHESIS_DIVIDE_PROMPT;

    // Create a config that pipes synthesis tokens to both onToken AND onSynthesisToken
    const synthConfig: SwarmConfig = {
      ...this.config,
      onToken: (agentId, token) => {
        this.config.onToken(agentId, token);
        // Also fire onSynthesisToken so the UI can stream + show file indicators
        if (agentId === 'willow') {
          this.config.onSynthesisToken?.(token);
        }
      },
    };

    const synthesizer = new AgentRunner(
      'willow', 'Willow', synthPrompt,
      this.chatroom, synthConfig
    );
    this.agents.set('willow', synthesizer);

    const finalResponse = await synthesizer.run(
      (mode === 'direct' || mode === 'conversation')
        ? this.buildDirectSynthesisPrompt(userPrompt, orionOutput, ethanOutput, meredithOutput)
        : this.buildDivideSynthesisPrompt(userPrompt, orionOutput, ethanOutput, meredithOutput)
    );

    // ───────────────────────────────
    // Done
    // ───────────────────────────────
    this.config.onAgentStatusChange('willow', 'done', 'Complete!');
    this.config.onComplete(finalResponse);

    for (const [, agent] of this.agents) {
      agent.abort();
    }

    return this.buildResult(startTime, finalResponse, {
      willow: willowPlan,
      orion: orionOutput,
      ethan: ethanOutput,
      meredith: meredithOutput,
    });
  }

  abort(): void {
    this.aborted = true;
    for (const [, agent] of this.agents) {
      agent.abort();
    }
  }

  // ───────────────────────────────
  // Mode Decision — Willow's AI judgment
  // ───────────────────────────────
  private async decideMode(userPrompt: string): Promise<SwarmMode> {
    // Instant override: user explicitly asks to distribute/split work
    const lower = userPrompt.toLowerCase();
    if (/\b(distribute|divide|split)\s+(the\s+)?(work|task|job)/i.test(lower)) return 'divide';
    if (/\b(each agent|each dev|separate tasks?)\b/i.test(lower)) return 'divide';

    const { provider, modelId, apiKey, thinkingLevel } = this.resolveModel();
    if (!apiKey) return 'direct';

    let response = '';
    try {
      await streamChat(
        [{
          role: 'user',
          content: `You are Willow, team lead for 3 developers. Decide how to handle this message from the user.

Reply with ONLY one word: "conversation", "direct", or "divide"

- "conversation" = the user is asking a question, wanting discussion, seeking feedback, or chatting — NOT requesting code changes. The team should discuss and answer conversationally.
- "direct" = the user wants code built. All 3 agents independently build the full solution. Best for simple/medium coding tasks.
- "divide" = the user wants code built AND the task is complex enough to split. You will plan and assign different files to each dev.

User's message:
${userPrompt}`,
        }] as AiChatMessage[],
        { provider, model: modelId, apiKey, thinkingLevel },
        (token) => { response += token; },
        () => {},
      );
    } catch {
      return 'direct';
    }

    const trimmed = response.toLowerCase().trim();
    if (trimmed.includes('conversation')) return 'conversation';
    if (trimmed.includes('divide')) return 'divide';
    return 'direct';
  }

  // ───────────────────────────────
  // Prompt Builders
  // ───────────────────────────────

  /** DIRECT mode: all workers get the exact same prompt */
  private buildDirectWorkerPrompt(userPrompt: string, projectContext: string): string {
    const history = this.buildChatHistory();
    return `${history}## User Request
${userPrompt}

## Current Project Files
${projectContext || '(Empty project — starting from scratch)'}

Respond to the user's request. If they're asking a question or want discussion, answer conversationally — no code needed. If they want code changes, build the complete solution and produce ALL files needed in a single <boltArtifact>.`;
  }

  /** DIVIDE mode: Willow's planning prompt */
  private buildDividePlannerPrompt(userPrompt: string, projectContext: string): string {
    const history = this.buildChatHistory();
    return `${history}## User Request
${userPrompt}

## Current Project Files
${projectContext || '(Empty project — starting from scratch)'}

## Your Task
Break this into tasks for your 3 workers. For EACH agent, send a chatroom_send with:
- Their owned files (exact paths) — NO overlaps between agents
- What to build
- Key interfaces to export/import from teammates

File ownership:
- **Orion**: types, hooks, utils, stores, data logic
- **Ethan**: UI components, pages, layouts, styling
- **Meredith**: App.tsx, main.tsx, routing, providers, config, index.html

Send one message to each (Orion, Ethan, Meredith), then write a 1-line summary and stop.`;
  }

  /** DIVIDE mode: each worker gets their specific task from chatroom */
  private buildDivideWorkerPrompt(agentId: AgentId, userPrompt: string, projectContext: string): string {
    const chatroomMsgs = this.chatroom.getMessagesFor(agentId);
    const taskFromWillow = chatroomMsgs
      .filter((m) => m.from === 'willow')
      .map((m) => m.content)
      .join('\n\n');

    const history = this.buildChatHistory();
    return `${history}## User Request
${userPrompt}

## Your Task from Willow
${taskFromWillow || 'No specific assignment — build your part based on your specialization.'}

## Current Project Files
${projectContext || '(Empty project)'}

Respond to the user's request. If they're asking a question or want discussion, answer conversationally. If they want code changes, only write the files assigned to you in <boltArtifact> format.`;
  }

  /** DIRECT mode synthesis: pick the best */
  private buildDirectSynthesisPrompt(
    userPrompt: string,
    orionOutput: string,
    ethanOutput: string,
    meredithOutput: string,
  ): string {
    const history = this.buildChatHistory();
    return `${history}## Original Request
${userPrompt}

## Three Developer Responses

### Response A (Orion):
${orionOutput || '(No output)'}

### Response B (Ethan):
${ethanOutput || '(No output)'}

### Response C (Meredith):
${meredithOutput || '(No output)'}

## Your Job
Pick the BEST response, or combine the best parts from multiple responses into one.
- If one response is clearly the best and complete, use it (with minor fixes if needed)
- If different responses have different strengths, merge the best parts
- If the responses are conversational (answering a question, discussing), produce the best conversational answer
- If the responses contain code, the result must be a single, complete, working <boltArtifact>
- The final output should feel like one expert wrote it — cohesive, polished, professional

Start with "I'll..." then your response, then "I've..." summary.`;
  }

  /** DIVIDE mode synthesis: merge file outputs */
  private buildDivideSynthesisPrompt(
    userPrompt: string,
    orionOutput: string,
    ethanOutput: string,
    meredithOutput: string,
  ): string {
    const history = this.buildChatHistory();
    return `${history}## Original Request
${userPrompt}

## Team Outputs (each developer owned different files)

### Orion's files:
${orionOutput || '(No output)'}

### Ethan's files:
${ethanOutput || '(No output)'}

### Meredith's files:
${meredithOutput || '(No output)'}

## Your Job
Merge all outputs into one cohesive result.
- If the responses are conversational, combine the best insights into one clear answer
- If they contain code, merge into ONE <boltArtifact>. Since files don't overlap, mostly combine them. Fix:
  - Import/export mismatches between files
  - Missing files — fill them in yourself
  - Type name conflicts
- The final output should feel like one expert wrote it — cohesive and polished

Start with "I'll..." then your response, then "I've..." summary.`;
  }

  // ───────────────────────────────
  // Helpers
  // ───────────────────────────────

  private resolveModel(): {
    provider: 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai' | 'moonshot' | 'spacexai' | 'zhipuai';
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
      const provider = selected.provider as 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai';
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

  private buildChatHistory(): string {
    const history = this.config.chatHistory;
    if (!history || history.length === 0) return '';

    // Include last 20 messages max to keep context manageable
    const recent = history.slice(-20);
    const formatted = recent
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        // Truncate very long assistant messages (code responses) to keep prompt reasonable
        const content = m.content.length > 500
          ? m.content.slice(0, 500) + '\n... (truncated)'
          : m.content;
        return `**${role}:** ${content}`;
      })
      .join('\n\n');

    return `## Conversation History\n${formatted}\n\n`;
  }

  private buildProjectContext(): string {
    const files = this.config.projectFiles;
    if (!files || Object.keys(files).length === 0) return '';

    const MAX_FILE_SIZE = 5000; // Truncate individual files larger than this
    const MAX_TOTAL_SIZE = 50000; // Cap total context size

    let totalSize = 0;
    const parts: string[] = [];

    for (const [path, file] of Object.entries(files)) {
      if (path.includes('node_modules') || path.includes('.git')) continue;

      let content = (file as any).content || '';
      if (content.length > MAX_FILE_SIZE) {
        content = content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)';
      }

      const part = `### ${path}\n\`\`\`\n${content}\n\`\`\``;
      totalSize += part.length;

      if (totalSize > MAX_TOTAL_SIZE) {
        parts.push(`\n... (${Object.keys(files).length - parts.length} more files omitted for brevity)`);
        break;
      }

      parts.push(part);
    }

    return parts.join('\n\n');
  }

  private buildResult(
    startTime: number,
    finalResponse: string,
    outputs: Partial<Record<AgentId, string>>
  ): SwarmResult {
    return {
      finalResponse,
      agentOutputs: {
        willow: outputs.willow || '',
        orion: outputs.orion || '',
        ethan: outputs.ethan || '',
        meredith: outputs.meredith || '',
      },
      chatroomLog: this.chatroom.getFullLog(),
      totalDuration: Date.now() - startTime,
    };
  }
}
