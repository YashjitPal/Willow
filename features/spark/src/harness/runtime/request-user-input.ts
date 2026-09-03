/**
 * `request_user_input` — the tool that makes Plan mode conversational.
 *
 * A port of `codex-rs/core/src/tools/handlers/request_user_input.rs` and its
 * spec module.
 *
 * ## Why Plan mode needs it
 *
 * The mode document is emphatic: *"Strongly prefer using the `request_user_input`
 * tool to ask any questions"*, and *"You SHOULD ask many questions"*. Without
 * the tool, that instruction has nowhere to land — a model told to ask many
 * questions and given no way to ask them writes them into its prose and then
 * answers them itself, which is precisely the guessing Plan mode exists to
 * prevent. So the tool is not an extra: it is the half of Plan mode that makes
 * the other half honest.
 *
 * ## The gate
 *
 * `ModeKind::allows_request_user_input` is true for Plan and false for Default,
 * and the call is **blocking** in Plan mode (`is_blocking: mode == ModeKind::Plan`).
 * Blocking is the point — the turn genuinely stops until the user answers,
 * rather than the model asking and then carrying on with its own guess.
 *
 * Sub-agents cannot call it at all (`session_source.is_non_root_agent()`), which
 * is the same reason `task` is not available to sub-agents: a delegated agent
 * has no user to ask.
 */

import {
  allowsRequestUserInput,
  requestUserInputToolDescription,
  requestUserInputUnavailableMessage,
  REQUEST_USER_INPUT_MODES,
  type ModeKind,
} from '../overlay/collaboration-mode';
import type { ToolHandler, ToolResult } from './protocol';

/** One choice. `label` and `description` are both required upstream. */
export interface UserInputOption {
  /** User-facing label (1-5 words). */
  label: string;
  /** One short sentence explaining impact/tradeoff if selected. */
  description: string;
}

export interface UserInputQuestion {
  /** Stable identifier for mapping answers (snake_case). */
  id: string;
  /** Short header label shown in the UI (12 or fewer chars). */
  header: string;
  /** Single-sentence prompt shown to the user. */
  question: string;
  options: UserInputOption[];
  /**
   * Always true. `normalize_request_user_input_tool_args` sets it on every
   * question rather than letting the model choose: the client adds a free-form
   * "Other" choice itself, and the option schema tells the model not to include
   * one. A question the user cannot answer in their own words is a worse
   * question, so this is not the model's call to make.
   */
  isOther: true;
}

export interface UserInputAnswer {
  id: string;
  /** The chosen label, or free text when the user answered "Other". */
  answer: string;
}

/**
 * `RequestUserInputResponse`, exactly as upstream serialises it.
 *
 * Upstream's shape is a **map from question id to `{ answers: [...] }`** —
 * `HashMap<String, RequestUserInputAnswer>` in
 * `codex-rs/protocol/src/request_user_input.rs`, pinned by a round-trip test
 * that expects `{"answers":{"confirm_path":{"answers":["yes"]}}}`.
 *
 * Two details are easy to get wrong and both are load-bearing, because this is
 * the JSON the model actually reads back:
 *
 * - It is keyed by id, not a positional array. The model chose those ids and
 *   the schema calls them "stable identifier for mapping answers", so a flat
 *   list makes the mapping the model was promised its own job again.
 * - Each answer is a **list**, because upstream questions can be multi-select.
 *   Willow's card is single-choice, so the list always holds one entry — but
 *   the shape stays upstream's, so a model that iterates it works either way.
 */
const responsePayload = (answers: UserInputAnswer[]): string =>
  JSON.stringify({
    answers: Object.fromEntries(answers.map((entry) => [entry.id, { answers: [entry.answer] }])),
  });

/**
 * How the harness reaches the user.
 *
 * Resolving with `null` means the request was cancelled or went unanswered,
 * which upstream distinguishes from an empty answer set — see the two different
 * observations in `runRequestUserInput`.
 */
export type RequestUserInputSink = (request: {
  questions: UserInputQuestion[];
  isBlocking: boolean;
}) => Promise<UserInputAnswer[] | null>;

/** `MAX` questions, from the schema description: "Prefer 1 and do not exceed 3". */
const MAX_QUESTIONS = 3;

export const REQUEST_USER_INPUT_TOOL_NAME = 'request_user_input';

/**
 * The tool description, generated the way upstream generates it.
 *
 * It names the modes the tool works in, so a model in Default mode that reads
 * the tool list learns from the description itself why calling it would fail.
 */
export const requestUserInputDescription = (): string => requestUserInputToolDescription();

/** `normalize_request_user_input_tool_args`, plus the shape validation around it. */
export function normalizeQuestions(raw: unknown): UserInputQuestion[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return `${REQUEST_USER_INPUT_TOOL_NAME} requires a non-empty "questions" array`;
  }
  if (raw.length > MAX_QUESTIONS) {
    return `${REQUEST_USER_INPUT_TOOL_NAME} accepts at most ${MAX_QUESTIONS} questions`;
  }

  const questions: UserInputQuestion[] = [];
  for (const [index, entry] of raw.entries()) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const options = Array.isArray(record.options) ? record.options : [];

    // Upstream's exact message, and its exact condition: every question needs
    // options. A question without them is a free-text prompt in disguise, which
    // the client has no way to render as a choice.
    if (options.length === 0) {
      return `${REQUEST_USER_INPUT_TOOL_NAME} requires non-empty options for every question`;
    }

    const question = typeof record.question === 'string' ? record.question.trim() : '';
    if (!question) {
      return `${REQUEST_USER_INPUT_TOOL_NAME} requires a "question" for every entry`;
    }

    questions.push({
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `q${index + 1}`,
      header:
        typeof record.header === 'string' && record.header.trim()
          ? record.header.trim()
          : 'Question',
      question,
      options: options.map((option) => {
        const shape = (option ?? {}) as Record<string, unknown>;
        return {
          label: typeof shape.label === 'string' ? shape.label.trim() : String(shape.label ?? ''),
          description:
            typeof shape.description === 'string' ? shape.description.trim() : '',
        };
      }),
      isOther: true,
    });
  }

  return questions;
}

/**
 * Builds the handler.
 *
 * `mode` is captured rather than read per call because a turn cannot change
 * mode partway through — upstream changes it only on a new developer message,
 * which is a new turn.
 */
export function makeRequestUserInputTool(
  mode: ModeKind,
  sink: RequestUserInputSink | undefined,
  isRootThread = true,
  /**
   * The modes the tool is offered in, from `requestUserInputModes`.
   *
   * **This parameter is Spark's, and is the one place this file diverges from
   * the Code harness's copy of it.** Without it, turning on the
   * ask-outside-Plan-mode flag registers a tool that then refuses itself:
   * `toolsForTurn` would expose it in Default mode while
   * `requestUserInputUnavailableMessage` still answered "unavailable in Default
   * mode". Upstream avoids that by deriving both from one
   * `request_user_input_available_modes`, which is what this threads through.
   *
   * The default preserves upstream's shipped behaviour — Plan mode only — so
   * omitting it behaves exactly as the Code copy does.
   */
  availableModes: ModeKind[] = REQUEST_USER_INPUT_MODES,
): ToolHandler {
  return {
    id: REQUEST_USER_INPUT_TOOL_NAME,
    async run(args, context): Promise<ToolResult> {
      if (!isRootThread) {
        return {
          observation: `${REQUEST_USER_INPUT_TOOL_NAME} can only be used by the root thread`,
          failed: true,
        };
      }

      const unavailable = requestUserInputUnavailableMessage(mode, availableModes);
      if (unavailable) return { observation: unavailable, failed: true };

      /*
       * No sink means the host did not wire the affordance. Say so plainly
       * rather than pretending the user declined: a model told "no answers" is
       * instructed to continue on best judgement, and it would do that on a
       * question the user never saw.
       */
      if (!sink) {
        return {
          observation:
            `${REQUEST_USER_INPUT_TOOL_NAME} is not available in this client. Continue with ` +
            'your best judgement and record the assumption in the plan.',
          failed: true,
        };
      }

      const questions = normalizeQuestions(args.questions);
      if (typeof questions === 'string') {
        return { observation: questions, failed: true };
      }

      const blocking = allowsRequestUserInput(mode);

      // The card goes up before the await, so the questions are on screen while
      // the turn is waiting on them rather than appearing once answered.
      const cardId = context.emit({
        id: `call_${Date.now().toString(36)}_rui`,
        kind: 'user-input',
        status: 'running',
        startedAt: Date.now(),
        questions,
        blocking,
      });

      const answers = await sink({
        questions,
        // The one behavioural difference between the modes, and upstream's
        // whole reason for gating the tool on mode at all.
        isBlocking: blocking,
      });

      if (answers === null) {
        context.patch(cardId, { status: 'cancelled', endedAt: Date.now() });
        return {
          observation: `${REQUEST_USER_INPUT_TOOL_NAME} was cancelled before receiving a response`,
          failed: true,
        };
      }

      context.patch(cardId, { status: 'success', endedAt: Date.now(), answers });

      /*
       * An empty answer set is a legitimate outcome, not a failure — the user
       * dismissed the prompt — and upstream reports it as an empty map with no
       * commentary attached.
       *
       * An earlier version appended "The user did not answer. Continue with
       * your best judgement…" here and attributed it to `default.md`. That
       * sentence is not in either mode template; it was invented. The guidance
       * it was reaching for is already in `plan.md`, which says that when a
       * preference question goes unanswered the agent should "proceed with the
       * recommended option and record it as an assumption in the final plan" —
       * so the model has already read it, in upstream's own words, and does not
       * need a paraphrase competing with it from inside a tool result.
       */
      return { observation: responsePayload(answers) };
    },
  };
}
