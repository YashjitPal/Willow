/**
 * The Code harness's vocabulary: the action tags the model writes, the steps a
 * turn records, and the events the UI listens to.
 *
 * ## Why a text protocol
 *
 * The model changes the project by writing tags into its reply rather than by
 * native function calls, for three reasons:
 *
 * 1. **It works on every provider and relay.** Function calling depends on the
 *    endpoint, and a profile whose tool policy is `disabled` sends none at all.
 *    Text is the one thing every model can produce.
 * 2. **It streams.** A `<willow-write>` tag names its file the moment it opens,
 *    so the transcript can say "Editing App.tsx" while the file is still being
 *    written. A function call's arguments only arrive once they are complete.
 * 3. **Code stays code.** A file inside a tag is written verbatim, not escaped
 *    into a JSON string, which is how models write their best code.
 *
 * Edits use SEARCH/REPLACE blocks — the format models reproduce most reliably —
 * and the V4A `*** Begin Patch` envelope is accepted as well, because some models
 * reach for it out of habit and refusing a correct patch helps nobody.
 */

/* ------------------------------------------------------------------------ */
/* Action tags                                                               */
/* ------------------------------------------------------------------------ */

export const TAGS = {
  write: 'willow-write',
  edit: 'willow-edit',
  delete: 'willow-delete',
  rename: 'willow-rename',
  dependency: 'willow-dependency',
  plan: 'willow-plan',
  tool: 'willow-tool',
} as const;

export type BlockKind =
  | 'write'
  | 'edit'
  | 'delete'
  | 'rename'
  | 'dependency'
  | 'plan'
  | 'tool'
  | 'patch'
  /** A tag the harness recognises and deliberately does nothing with. */
  | 'ignored';

/** Kinds whose meaning is entirely in their attributes. */
export const ATTRIBUTE_ONLY_KINDS: ReadonlySet<BlockKind> = new Set(['delete', 'rename', 'dependency']);

/** Kinds that change the project. Plan mode refuses all of them. */
export const MUTATING_KINDS: ReadonlySet<BlockKind> = new Set([
  'write',
  'edit',
  'delete',
  'rename',
  'dependency',
  'patch',
]);

/** One action, as the stream parser hands it over. */
export interface ParsedBlock {
  id: string;
  kind: BlockKind;
  /** The tag as written, e.g. `willow-write`. */
  tag: string;
  attrs: Record<string, string>;
  /** Everything between the opening and closing tag, untouched. */
  body: string;
  /** False when the reply ended before the block closed. */
  complete: boolean;
}

/* ------------------------------------------------------------------------ */
/* Turn steps                                                                */
/* ------------------------------------------------------------------------ */

export type StepStatus = 'running' | 'done' | 'error';

interface StepBase {
  id: string;
}

export interface TextStep extends StepBase {
  kind: 'text';
  text: string;
}

export interface FileStep extends StepBase {
  kind: 'file';
  action: 'write' | 'edit' | 'delete' | 'rename';
  path: string;
  /** For a rename. */
  toPath?: string;
  status: StepStatus;
  /** True when the write created the file. */
  created?: boolean;
  added?: number;
  removed?: number;
  error?: string;
}

export interface ReadStep extends StepBase {
  kind: 'read';
  path: string;
  status: StepStatus;
  error?: string;
}

export interface ListStep extends StepBase {
  kind: 'list';
  path: string;
  status: StepStatus;
}

export interface SearchStep extends StepBase {
  kind: 'search';
  query: string;
  matches?: number;
  status: StepStatus;
}

export interface CheckStep extends StepBase {
  kind: 'check';
  status: StepStatus;
  /** Run by the harness after the model finished, rather than asked for. */
  automatic?: boolean;
  errors?: string[];
  warnings?: string[];
  /** Why the check could not run, when it could not. */
  skipped?: string;
}

export interface DependencyStep extends StepBase {
  kind: 'dependency';
  name: string;
  version?: string;
  status: StepStatus;
  error?: string;
}

export interface PlanItem {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanStep extends StepBase {
  kind: 'plan';
  items: PlanItem[];
}

export interface SkillStep extends StepBase {
  kind: 'skill';
  name: string;
  status: StepStatus;
  error?: string;
}

/** A connector (MCP) tool, or any other tool without a dedicated step. */
export interface ToolStep extends StepBase {
  kind: 'tool';
  name: string;
  /** What the transcript calls it, e.g. "GitHub · create_issue". */
  label: string;
  status: StepStatus;
  error?: string;
}

export interface NoticeStep extends StepBase {
  kind: 'notice';
  tone: 'info' | 'warning';
  text: string;
}

/** Something done to the live preview: a look at it, or computer use. */
export type ComputerAction =
  | 'screenshot'
  | 'inspect'
  | 'click'
  | 'type'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'select'
  | 'drag'
  | 'wait'
  | 'navigate'
  | 'viewport';

export interface ComputerStep extends StepBase {
  kind: 'computer';
  action: ComputerAction;
  /** What it acted on, e.g. `"Add task" button`, or the key pressed. */
  label?: string;
  status: StepStatus;
  error?: string;
}

/** A picture the turn made: an image generated into the project, or an annotated screenshot. */
export interface ImageStep extends StepBase {
  kind: 'image';
  origin: 'generated' | 'annotation';
  /** Generated: where in the project it was saved. */
  path?: string;
  /** Annotation: the picture itself, as a data URL. */
  src?: string;
  /** The prompt it was made from, or the annotation's caption. */
  caption: string;
  /** Annotation: the numbered notes drawn on it, in order. */
  notes?: string[];
  status: StepStatus;
  error?: string;
}

/** A screen put on the Design canvas. */
export interface DesignStep extends StepBase {
  kind: 'design';
  name: string;
  /** The canvas node, for "View". */
  nodeId?: string;
  status: StepStatus;
  error?: string;
}

export type TurnStep =
  | TextStep
  | FileStep
  | ReadStep
  | ListStep
  | SearchStep
  | CheckStep
  | DependencyStep
  | PlanStep
  | SkillStep
  | ToolStep
  | NoticeStep
  | ComputerStep
  | ImageStep
  | DesignStep;

export type TurnMode = 'build' | 'plan';

/** What the harness is doing right now, for the live transcript. */
export type TurnPhase =
  /** Waiting on the model, before it has said anything this round. */
  | 'thinking'
  /** The model is writing. */
  | 'responding'
  /** Tools from the last reply are running. */
  | 'tools'
  /** Building and running the app to look for errors. */
  | 'checking';

export type StopReason =
  | 'finished'
  | 'step-limit'
  | 'cancelled'
  | 'error';

export interface TurnOutcome {
  reason: StopReason;
  error?: string;
  steps: TurnStep[];
  /** The prose of the turn, without any actions — what Copy and history use. */
  text: string;
  /** Paths the turn created, changed or deleted. */
  changedPaths: string[];
  /** The turn ended on a plan the user has to approve before anything is built. */
  awaitingApproval?: boolean;
  /** Time spent waiting on the model before it said anything, summed over every round. */
  thinkingMs: number;
}

let counter = 0;
export const nextId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;

/** The prose of a step list, as one string. */
export function stepsText(steps: readonly TurnStep[]): string {
  return steps
    .filter((step): step is TextStep => step.kind === 'text')
    .map((step) => step.text.trim())
    .filter(Boolean)
    .join('\n\n');
}
