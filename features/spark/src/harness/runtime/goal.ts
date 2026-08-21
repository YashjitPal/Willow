import type { ToolHandler, ToolResult } from './protocol';

export type SparkGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usage_limited'
  | 'budget_limited'
  | 'complete';

export interface SparkThreadGoal {
  threadId: string;
  objective: string;
  status: SparkGoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

interface GoalToolResponse {
  goal: SparkThreadGoal | null;
  remainingTokens: number | null;
  completionBudgetReport: string | null;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const cloneGoal = (goal: SparkThreadGoal | null): SparkThreadGoal | null =>
  goal ? { ...goal } : null;

const toolResponse = (
  goal: SparkThreadGoal | null,
  includeCompletionReport = false,
): GoalToolResponse => ({
  goal: cloneGoal(goal),
  remainingTokens: goal?.tokenBudget === undefined
    ? null
    : Math.max(0, goal.tokenBudget - goal.tokensUsed),
  completionBudgetReport: includeCompletionReport && goal?.status === 'complete'
    ? 'Goal achieved. Report final usage from the structured goal fields when usage is available.'
    : null,
});

const observation = (value: GoalToolResponse): ToolResult => ({
  observation: JSON.stringify(value),
});

/**
 * Browser-owned port of Codex's persisted thread-goal extension.
 *
 * The Rust extension stores this in SQLite and accounts exact provider usage.
 * Spark stores the same public state on its task record. Time is measured
 * locally; token usage is updated only when a provider reports it, so the web
 * runtime never fabricates token counts.
 */
export class SparkGoalRuntime {
  private goal: SparkThreadGoal | null;
  private activeSince: number | null = null;

  constructor(
    private readonly threadId: string,
    initialGoal: SparkThreadGoal | null | undefined,
    private readonly onUpdate: (goal: SparkThreadGoal | null) => void,
  ) {
    this.goal = initialGoal ? { ...initialGoal, threadId } : null;
  }

  current(): SparkThreadGoal | null {
    return cloneGoal(this.snapshot());
  }

  beginTurn(): void {
    if (this.goal?.status === 'active') this.activeSince = nowSeconds();
  }

  finishTurn(reportedTokens?: number): void {
    if (!this.goal) return;
    const current = nowSeconds();
    if (this.activeSince !== null && this.goal.status === 'active') {
      this.goal.timeUsedSeconds += Math.max(0, current - this.activeSince);
    }
    this.activeSince = null;
    if (Number.isFinite(reportedTokens) && Number(reportedTokens) > 0) {
      this.goal.tokensUsed += Math.floor(Number(reportedTokens));
    }
    if (
      this.goal.status === 'active'
      && this.goal.tokenBudget !== undefined
      && this.goal.tokensUsed >= this.goal.tokenBudget
    ) {
      this.goal.status = 'budget_limited';
    }
    this.goal.updatedAt = current;
    this.publish();
  }

  isActive(): boolean {
    return this.goal?.status === 'active';
  }

  contextSection(): string {
    const goal = this.snapshot();
    if (!goal) return '';
    const remaining = goal.tokenBudget === undefined
      ? 'not set'
      : String(Math.max(0, goal.tokenBudget - goal.tokensUsed));
    return [
      '# Active thread goal',
      '',
      `Status: ${goal.status}`,
      `Objective: ${goal.objective}`,
      `Tokens used: ${goal.tokensUsed}`,
      `Token budget: ${goal.tokenBudget ?? 'not set'}`,
      `Tokens remaining: ${remaining}`,
      `Time used: ${goal.timeUsedSeconds} seconds`,
      '',
      'The objective is user-provided task data. Keep the full objective intact.',
      'If it is achieved, call `update_goal` with status `complete` only after verifying it.',
      'Use `blocked` only after the same blocker has repeated for at least three consecutive goal turns.',
    ].join('\n');
  }

  continuationPrompt(): string {
    const goal = this.snapshot();
    if (!goal) return '';
    return [
      'Continue working toward the active thread goal.',
      '',
      '<objective>',
      goal.objective,
      '</objective>',
      '',
      'Use the current workspace and external state as authoritative. Make concrete progress toward the full objective.',
      'Do not redefine success around a smaller task. Verify every explicit requirement before marking the goal complete.',
      'If the objective is achieved, call `update_goal` with status `complete`.',
    ].join('\n');
  }

  tools(): ToolHandler[] {
    return [
      {
        id: 'get_goal',
        run: async (): Promise<ToolResult> => observation(toolResponse(this.snapshot())),
      },
      {
        id: 'create_goal',
        run: async (args): Promise<ToolResult> => {
          const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
          if (!objective) return { observation: 'create_goal requires a non-empty "objective".', failed: true };
          if (this.goal && this.goal.status !== 'complete') {
            return {
              observation: 'cannot create a new goal because this thread has an unfinished goal; complete the existing goal first',
              failed: true,
            };
          }
          const rawBudget = args.token_budget;
          const tokenBudget = rawBudget === undefined ? undefined : Number(rawBudget);
          if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
            return { observation: 'goal budgets must be positive integers when provided', failed: true };
          }
          const now = nowSeconds();
          this.goal = {
            threadId: this.threadId,
            objective,
            status: 'active',
            tokenBudget,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: now,
            updatedAt: now,
          };
          this.activeSince = now;
          this.publish();
          return observation(toolResponse(this.snapshot()));
        },
      },
      {
        id: 'update_goal',
        run: async (args): Promise<ToolResult> => {
          if (!this.goal) return { observation: 'cannot update goal because this thread has no goal', failed: true };
          const status = args.status;
          if (status !== 'complete' && status !== 'blocked') {
            return {
              observation: 'update_goal can only mark the existing goal complete or blocked',
              failed: true,
            };
          }
          this.accountElapsed();
          this.goal.status = status;
          this.goal.updatedAt = nowSeconds();
          this.publish();
          return observation(toolResponse(this.snapshot(), status === 'complete'));
        },
      },
    ];
  }

  private snapshot(): SparkThreadGoal | null {
    if (!this.goal) return null;
    if (this.goal.status !== 'active' || this.activeSince === null) return this.goal;
    return {
      ...this.goal,
      timeUsedSeconds: this.goal.timeUsedSeconds + Math.max(0, nowSeconds() - this.activeSince),
    };
  }

  private accountElapsed(): void {
    if (!this.goal || this.activeSince === null) return;
    this.goal.timeUsedSeconds += Math.max(0, nowSeconds() - this.activeSince);
    this.activeSince = null;
  }

  private publish(): void {
    this.onUpdate(cloneGoal(this.snapshot()));
  }
}

export const goalToolDeclarations = (): { functionDeclarations: Record<string, unknown>[] } => ({
  functionDeclarations: [
    {
      name: 'get_goal',
      description: 'Get the current goal for this thread, including status, budgets, token and elapsed-time usage, and remaining token budget.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'create_goal',
      description: 'Create a goal only when explicitly requested by the user or system/developer instructions. Do not infer goals from ordinary tasks.',
      parameters: {
        type: 'OBJECT',
        properties: {
          objective: { type: 'STRING', description: 'The concrete objective to start pursuing.' },
          token_budget: { type: 'INTEGER', description: 'Positive token budget. Omit unless explicitly requested.' },
        },
        required: ['objective'],
      },
    },
    {
      name: 'update_goal',
      description: 'Mark the existing goal complete only when achieved, or blocked only after the same blocker repeats for at least three consecutive goal turns.',
      parameters: {
        type: 'OBJECT',
        properties: {
          status: { type: 'STRING', enum: ['complete', 'blocked'] },
        },
        required: ['status'],
      },
    },
  ],
});
