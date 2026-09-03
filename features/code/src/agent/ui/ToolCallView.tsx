import React from 'react';
import { useStore } from '@nanostores/react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Check,
  ChevronRight,
  ClipboardList,
  Copy,
  FileMinus2,
  FilePlus2,
  FolderTree,
  ListChecks,
  MessageCircleQuestion,
  Package,
  Search,
  Sparkles,
  SquarePen,
  SquareTerminal,
  Target,
} from 'lucide-react';
import {
  Badge,
  Collapsible,
  DiffStat,
  IconButton,
  ShimmerText,
  Tooltip,
  cn,
  formatDuration,
  useCopy,
  useElapsed,
  usePrefersReducedMotion,
} from './primitives';
import { PathLabel, ToolCard } from './ToolCard';
import { DiffView } from './DiffView';
import { CodeLine } from './CodeLine';
import { TerminalOutput } from './TerminalOutput';
import { ComputerUseCard } from './ComputerUseCard';
import { languageFromPath } from './highlight';
import { pendingUserInput } from '../agent-store';
import type {
  CommandCall,
  DependencyCall,
  EditCall,
  GoalCall,
  ListCall,
  PlanCall,
  ProposedPlanCall,
  ReadCall,
  SearchCall,
  ThinkCall,
  ToolCall,
  UserInputCall,
} from '../harness/runtime/protocol';

/**
 * Renders any tool call as its matching card.
 *
 * Every consumer goes through here rather than switching on `kind` itself, so
 * adding a tool kind means touching exactly one place.
 */
export function ToolCallView({ call }: { call: ToolCall }) {
  switch (call.kind) {
    case 'edit':
    case 'create':
    case 'delete':
      return <EditCardView call={call} />;
    case 'read':
      return <ReadCardView call={call} />;
    case 'list':
      return <ListCardView call={call} />;
    case 'search':
      return <SearchCardView call={call} />;
    case 'plan':
      return <PlanCardView call={call} />;
    case 'dependency':
      return <DependencyCardView call={call} />;
    case 'command':
      return <CommandCardView call={call} />;
    case 'computer':
      return <ComputerUseCard call={call} />;
    case 'think':
      return <ThinkCardView call={call} />;
    case 'proposed-plan':
      return <ProposedPlanCardView call={call} />;
    case 'user-input':
      return <UserInputCardView call={call} />;
    case 'goal':
      return <GoalCardView call={call} />;
    // `task` surfaces through the agents panel, never inline.
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Edits                                                                     */
/* ------------------------------------------------------------------------ */

const EDIT_VERB = {
  edit: { done: 'Edited', running: 'Editing', icon: SquarePen },
  create: { done: 'Created', running: 'Creating', icon: FilePlus2 },
  delete: { done: 'Deleted', running: 'Deleting', icon: FileMinus2 },
} as const;

function EditCardView({ call }: { call: EditCall }) {
  const verb = EDIT_VERB[call.kind];
  const [copied, copy] = useCopy();

  const patchText = call.lines
    .filter((line) => line.type !== 'hunk')
    .map((line) => `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.content}`)
    .join('\n');

  return (
    <ToolCard
      status={call.status}
      error={call.error}
      followStatus
      icon={<verb.icon size={13} strokeWidth={1.9} />}
      title={verb.done}
      runningTitle={verb.running}
      subject={<PathLabel path={call.movePath ?? call.path} />}
      // The counts, not the bar. A green/red proportion bar beside every edit
      // reads as a chart of nothing — the numbers already say it, in less room.
      meta={<DiffStat added={call.added} removed={call.removed} />}
      actions={
        <Tooltip content={copied ? 'Copied' : 'Copy patch'}>
          <IconButton size="xs" label="Copy patch" onClick={() => copy(patchText)}>
            {copied ? <Check size={11} className="text-[hsl(var(--cb-positive))]" /> : <Copy size={11} />}
          </IconButton>
        </Tooltip>
      }
      body={
        call.kind === 'delete' || call.lines.length === 0 ? undefined : (
          <DiffView
            lines={call.lines}
            path={call.path}
            revealed={call.status === 'running' ? call.revealed : undefined}
            showAllContext={call.kind === 'create'}
          />
        )
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Reads                                                                     */
/* ------------------------------------------------------------------------ */

function ReadCardView({ call }: { call: ReadCall }) {
  const language = languageFromPath(call.path);
  const start = call.range?.[0] ?? 1;

  return (
    <ToolCard
      status={call.status}
      error={call.error}
      icon={<BookOpen size={13} strokeWidth={1.9} />}
      title="Read"
      runningTitle="Reading"
      subject={<PathLabel path={call.path} />}
      meta={
        <span className="cb-tabular">
          {call.range ? `${call.range[0]}–${call.range[1]} of ${call.totalLines}` : `${call.totalLines} lines`}
        </span>
      }
      body={
        call.preview.length === 0 ? undefined : (
          <div
            className={cn(
              'cb-scroll max-h-[300px] overflow-auto',
              'bg-[hsl(var(--cb-sunken))] py-1.5',
            )}
          >
            <pre className="min-w-full font-mono text-[11.5px] leading-[1.6]">
              <code>
                {call.preview.map((line, index) => (
                  <span key={index} className="flex whitespace-pre px-3">
                    <span className="cb-tabular mr-3.5 w-8 shrink-0 select-none text-right text-[hsl(var(--cb-ink-ghost))]">
                      {start + index}
                    </span>
                    <CodeLine text={line} language={language} className="flex-1" />
                  </span>
                ))}
              </code>
            </pre>
          </div>
        )
      }
    />
  );
}

function ListCardView({ call }: { call: ListCall }) {
  return (
    <ToolCard
      status={call.status}
      error={call.error}
      icon={<FolderTree size={13} strokeWidth={1.9} />}
      title="Listed"
      runningTitle="Listing"
      subject={<span className="truncate font-mono">{call.path}</span>}
      meta={<span className="cb-tabular">{call.entries.length} files</span>}
      body={
        <ul
          className={cn(
            'cb-scroll max-h-[260px] divide-y divide-[hsl(var(--cb-line-subtle))] overflow-auto',
            'bg-[hsl(var(--cb-sunken))]',
          )}
        >
          {call.entries.map((entry) => (
            <li key={entry.name} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="flex-1 truncate font-mono text-[hsl(var(--cb-ink-muted))]">{entry.name}</span>
            </li>
          ))}
        </ul>
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Search                                                                    */
/* ------------------------------------------------------------------------ */

function SearchCardView({ call }: { call: SearchCall }) {
  return (
    <ToolCard
      status={call.status}
      error={call.error}
      icon={<Search size={13} strokeWidth={1.9} />}
      title="Searched"
      runningTitle="Searching"
      subject={<span className="min-w-0 flex-1 truncate font-mono">{call.query}</span>}
      meta={
        call.hits.length > 0 ? (
          <span className="cb-tabular">
            {call.hits.length} in {call.fileCount} {call.fileCount === 1 ? 'file' : 'files'}
          </span>
        ) : null
      }
      body={
        call.hits.length === 0 ? undefined : (
          <ul
            className={cn(
              'cb-scroll max-h-[280px] divide-y divide-[hsl(var(--cb-line-subtle))] overflow-auto',
              'bg-[hsl(var(--cb-sunken))]',
            )}
          >
            {call.hits.map((hit, index) => (
              <li
                key={`${hit.path}:${hit.line}:${index}`}
                className="flex items-baseline gap-2 px-3 py-1.5 transition-colors hover:bg-[hsl(var(--cb-ink)/0.03)]"
              >
                <span className="shrink-0 text-[11px] text-[hsl(var(--cb-ink-faint))]">
                  {hit.path.split('/').pop()}
                  <span className="cb-tabular text-[hsl(var(--cb-ink-ghost))]">:{hit.line}</span>
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[hsl(var(--cb-ink-muted))]">
                  {hit.text.slice(0, hit.match[0])}
                  <mark className="rounded-[3px] bg-[hsl(var(--cb-warning)/0.25)] px-0.5 text-[hsl(var(--cb-ink))]">
                    {hit.text.slice(hit.match[0], hit.match[1])}
                  </mark>
                  {hit.text.slice(hit.match[1])}
                </code>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Plan                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * The `update_plan` card.
 *
 * Always open: a collapsed plan is the one card with nothing useful in its
 * header, and the plan is the model's statement of intent — the thing a user
 * most wants visible while work runs.
 */
function PlanCardView({ call }: { call: PlanCall }) {
  const done = call.steps.filter((step) => step.status === 'completed').length;

  return (
    <ToolCard
      status={call.status}
      error={call.error}
      defaultOpen
      icon={<ListChecks size={13} strokeWidth={1.9} />}
      title="Plan"
      runningTitle="Planning"
      meta={
        <span className="cb-tabular">
          {done}/{call.steps.length}
        </span>
      }
      body={
        <ol className="space-y-1 py-0.5">
          {call.steps.map((step, index) => (
            <li key={index} className="flex items-start gap-2 text-xs leading-relaxed">
              <span className="mt-[3px] shrink-0">
                {step.status === 'completed' ? (
                  <Check size={11} className="text-[hsl(var(--cb-positive))]" strokeWidth={3} />
                ) : step.status === 'in_progress' ? (
                  <span className="cb-breathe block size-[7px] rounded-full bg-[hsl(var(--cb-accent))]" />
                ) : (
                  <span className="block size-[7px] rounded-full border border-[hsl(var(--cb-line-strong))]" />
                )}
              </span>
              <span
                className={cn(
                  step.status === 'completed'
                    ? 'text-[hsl(var(--cb-ink-ghost))] line-through'
                    : step.status === 'in_progress'
                      ? 'text-[hsl(var(--cb-ink))]'
                      : 'text-[hsl(var(--cb-ink-faint))]',
                )}
              >
                {step.text}
              </span>
            </li>
          ))}
          {call.explanation && (
            <li className="pt-1 text-[11px] italic text-[hsl(var(--cb-ink-ghost))]">{call.explanation}</li>
          )}
        </ol>
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Plan mode                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The `<proposed_plan>` block.
 *
 * Plan mode's deliverable, and the reason the mode document asks the model to
 * wrap it: *"so the client can render it specially"*. Rendered as its own card
 * rather than left in the prose because the surrounding turn is a conversation
 * — questions, exploration, revisions — and the plan is the one part of it the
 * user is meant to act on.
 *
 * Always open, for the same reason the `update_plan` card is.
 */
function ProposedPlanCardView({ call }: { call: ProposedPlanCall }) {
  const [copied, copy] = useCopy();

  return (
    <ToolCard
      status={call.status}
      error={call.error}
      defaultOpen
      icon={<ClipboardList size={13} strokeWidth={1.9} />}
      title="Proposed plan"
      runningTitle="Writing the plan"
      actions={
        <Tooltip content={copied ? 'Copied' : 'Copy plan'}>
          <IconButton size="xs" label="Copy plan" onClick={() => copy(call.markdown)}>
            {copied ? (
              <Check size={11} className="text-[hsl(var(--cb-positive))]" />
            ) : (
              <Copy size={11} />
            )}
          </IconButton>
        </Tooltip>
      }
      body={
        <div className="cb-proposed-plan whitespace-pre-wrap py-0.5 text-xs leading-relaxed text-[hsl(var(--cb-ink))]">
          {call.markdown.trim()}
        </div>
      }
    />
  );
}

/**
 * A `request_user_input` round.
 *
 * In Plan mode this call is *blocking* — the turn genuinely stops here — so the
 * card is the only way forward and has to be answerable in place. Once answered
 * it keeps the questions and shows what was chosen, because the plan that
 * follows was shaped by those answers and the record of them is part of reading
 * it.
 *
 * The options come from the model; the "Other" row does not. Upstream forces
 * `is_other` on every question and tells the model in the schema *not* to write
 * one, precisely so this affordance is always available — a question the user
 * cannot answer in their own words is a worse question.
 */
function UserInputCardView({ call }: { call: UserInputCall }) {
  const pending = useStore(pendingUserInput);
  const answered = new Map((call.answers ?? []).map((answer) => [answer.id, answer.answer]));

  // Only the live question is interactive. Matching on the questions rather than
  // on the card id keeps a re-rendered card wired to the promise it opened.
  const live =
    call.status === 'running' &&
    pending &&
    pending.questions.length === call.questions.length &&
    pending.questions.every((question, index) => question.id === call.questions[index]?.id)
      ? pending
      : null;

  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [chosen, setChosen] = React.useState<Record<string, string>>({});

  const submit = (next: Record<string, string>): void => {
    live?.resolve(
      call.questions
        .map((question) => ({ id: question.id, answer: next[question.id] ?? '' }))
        .filter((answer) => answer.answer !== ''),
    );
  };

  const pick = (questionId: string, answer: string): void => {
    const next = { ...chosen, [questionId]: answer };
    setChosen(next);
    // One question is the common case and the schema says to prefer it, so a
    // single pick submits rather than making the user confirm a choice of one.
    if (call.questions.length === 1) submit(next);
  };

  const allPicked = call.questions.every((question) => chosen[question.id]);

  return (
    <ToolCard
      status={call.status}
      error={call.error}
      defaultOpen
      icon={<MessageCircleQuestion size={13} strokeWidth={1.9} />}
      title={call.answers ? 'You answered' : 'Question'}
      runningTitle={call.blocking ? 'Waiting for you' : 'Asking'}
      meta={
        call.questions.length > 1 ? (
          <span className="cb-tabular">{call.questions.length}</span>
        ) : undefined
      }
      body={
        <div className="space-y-3 py-0.5">
          {call.questions.map((question) => {
            const answer = answered.get(question.id) ?? chosen[question.id];
            return (
              <div key={question.id} className="space-y-1.5">
                <div className="text-xs leading-relaxed text-[hsl(var(--cb-ink))]">
                  {question.question}
                </div>

                {answer && !live ? (
                  <div className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <Check
                      size={11}
                      className="mt-[3px] shrink-0 text-[hsl(var(--cb-positive))]"
                      strokeWidth={3}
                    />
                    <span className="text-[hsl(var(--cb-ink))]">{answer}</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {question.options.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        disabled={!live}
                        onClick={() => pick(question.id, option.label)}
                        className={cn(
                          'block w-full rounded-md px-2 py-1.5 text-left text-[11px] leading-relaxed transition-colors',
                          live
                            ? 'hover:bg-[hsl(var(--cb-surface-raised))]'
                            : 'cursor-default',
                          chosen[question.id] === option.label
                            ? 'bg-[hsl(var(--cb-surface-raised))] text-[hsl(var(--cb-ink))]'
                            : 'text-[hsl(var(--cb-ink-faint))]',
                        )}
                      >
                        {option.label}
                        {option.description ? (
                          <span className="text-[hsl(var(--cb-ink-ghost))]">
                            {' — '}
                            {option.description}
                          </span>
                        ) : null}
                      </button>
                    ))}

                    {live && (
                      <input
                        value={drafts[question.id] ?? ''}
                        onChange={(event) =>
                          setDrafts({ ...drafts, [question.id]: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          const value = (drafts[question.id] ?? '').trim();
                          if (value) pick(question.id, value);
                        }}
                        placeholder="Other…"
                        className="w-full rounded-md bg-[hsl(var(--cb-surface-sunken))] px-2 py-1.5 text-[11px] text-[hsl(var(--cb-ink))] outline-none placeholder:text-[hsl(var(--cb-ink-ghost))]"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {live && call.questions.length > 1 && (
            <button
              type="button"
              disabled={!allPicked}
              onClick={() => submit(chosen)}
              className="rounded-md bg-[hsl(var(--cb-surface-raised))] px-2.5 py-1 text-[11px] text-[hsl(var(--cb-ink))] disabled:opacity-40"
            >
              Answer
            </button>
          )}

          {live && (
            /*
             * Skipping is a real answer, and both mode documents say what
             * happens next: "continue with best judgment instead of asking
             * again". Without it a blocking question in Plan mode would be a
             * dead end for anyone who does not want to choose.
             */
            <button
              type="button"
              onClick={() => live.resolve([])}
              className="block text-[11px] text-[hsl(var(--cb-ink-ghost))] hover:text-[hsl(var(--cb-ink-faint))]"
            >
              Skip and use your judgement
            </button>
          )}
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Goal mode                                                                 */
/* ------------------------------------------------------------------------ */

const GOAL_VERB = {
  get: { done: 'Checked the goal', running: 'Checking the goal' },
  create: { done: 'Goal set', running: 'Setting the goal' },
  update: { done: 'Goal updated', running: 'Updating the goal' },
} as const;

/**
 * A goal tool call.
 *
 * These cards are what keep Goal mode honest. The harness starts turns the user
 * did not send, so every transition that decides whether it keeps going — the
 * objective, the status, the budget consumed — has to be somewhere the user can
 * see it after the fact.
 */
function GoalCardView({ call }: { call: GoalCall }) {
  const verb = GOAL_VERB[call.action];
  const budget =
    call.tokenBudget === undefined
      ? undefined
      : `${call.tokensUsed ?? 0}/${call.tokenBudget} tokens`;

  return (
    <ToolCard
      status={call.status}
      error={call.error}
      icon={<Target size={13} strokeWidth={1.9} />}
      title={verb.done}
      runningTitle={verb.running}
      subject={
        call.goalStatus ? (
          <span className="text-[hsl(var(--cb-ink-faint))]">{call.goalStatus}</span>
        ) : undefined
      }
      meta={budget ? <span className="cb-tabular">{budget}</span> : undefined}
      body={
        call.objective ? (
          <div className="py-0.5 text-xs leading-relaxed text-[hsl(var(--cb-ink))]">
            {call.objective}
          </div>
        ) : undefined
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Dependency                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Rendered as a terminal-style card even though nothing executes.
 *
 * Adding a package *reads* as an install, and matching that expectation is
 * clearer than inventing a new shape for it. The text is honest about what
 * actually happened — a file was written.
 */
function DependencyCardView({ call }: { call: DependencyCall }) {
  return (
    <ToolCard
      status={call.status}
      error={call.error}
      followStatus
      icon={<Package size={13} strokeWidth={1.9} />}
      title="Added"
      runningTitle="Adding"
      subject={
        <span className="min-w-0 flex-1 truncate font-mono">
          {call.name}@{call.version}
        </span>
      }
      body={
        <TerminalOutput
          chunks={call.output}
          running={call.status === 'running'}
          maxHeight={200}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Commands                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * A command run in the sandbox.
 *
 * The command is restated inside the body rather than only in the header,
 * because the header truncates and an expanded card should be readable on its
 * own. A non-zero exit code is surfaced in the header — that is the one fact
 * worth seeing without opening anything.
 */
function CommandCardView({ call }: { call: CommandCall }) {
  const [copied, copy] = useCopy();
  const failed = call.status === 'error';

  return (
    <ToolCard
      status={call.status}
      error={call.error}
      followStatus
      icon={<SquareTerminal size={13} strokeWidth={1.9} />}
      title="Ran"
      runningTitle="Running"
      subject={<span className="min-w-0 flex-1 truncate font-mono">{call.command}</span>}
      meta={
        call.exitCode !== undefined && call.exitCode !== 0 ? (
          <Badge tone="negative" className="font-mono">
            exit {call.exitCode}
          </Badge>
        ) : null
      }
      actions={
        <Tooltip content={copied ? 'Copied' : 'Copy command'}>
          <IconButton size="xs" label="Copy command" onClick={() => copy(call.command)}>
            {copied ? <Check size={11} className="text-[hsl(var(--cb-positive))]" /> : <Copy size={11} />}
          </IconButton>
        </Tooltip>
      }
      body={
        <div>
          <div
            className={cn(
              'flex items-start gap-2 border-b border-[hsl(var(--cb-line-subtle))]',
              'bg-[hsl(var(--cb-sunken))] px-3 py-1.5 font-mono text-[11.5px]',
            )}
          >
            <span className="select-none text-[hsl(var(--cb-ink-ghost))]">$</span>
            <CodeLine
              text={call.command}
              language="shell"
              className="min-w-0 flex-1 whitespace-pre-wrap break-all"
            />
            <span className="shrink-0 text-[11px] text-[hsl(var(--cb-ink-ghost))]">{call.cwd}</span>
          </div>

          <TerminalOutput
            chunks={call.output}
            running={call.status === 'running'}
            className={cn(failed && 'bg-[hsl(var(--cb-negative-soft)/0.25)]')}
          />
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Reasoning                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The reasoning block.
 *
 * Deliberately not a `ToolCard`: reasoning is the model's internal voice, not
 * an action on the project, and giving it the same bordered chrome as a file
 * edit overstates it. While active it shows only the newest line — a growing
 * list pushes live output off screen and makes the turn feel slower than it is.
 */
function ThinkCardView({ call }: { call: ThinkCall }) {
  const running = call.status === 'running';
  const [open, setOpen] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const reduced = usePrefersReducedMotion();

  const elapsed = useElapsed(call.startedAt, running);
  const duration = call.endedAt ? call.endedAt - call.startedAt : elapsed;

  React.useEffect(() => {
    if (!touched && !running) setOpen(false);
  }, [running, touched]);

  const latest = call.lines[call.lines.length - 1];

  return (
    <div className="relative pl-4">
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 left-0 w-px rounded-full transition-colors duration-500',
          running
            ? 'bg-gradient-to-b from-transparent via-[hsl(var(--cb-accent)/0.6)] to-transparent'
            : 'bg-[hsl(var(--cb-line))]',
        )}
      />

      <button
        type="button"
        onClick={() => {
          setTouched(true);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="group/think flex w-full items-center gap-1.5 py-0.5 text-left"
      >
        <ChevronRight
          size={11}
          aria-hidden
          className={cn(
            'shrink-0 text-[hsl(var(--cb-ink-ghost))] transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
        <Sparkles
          size={11}
          aria-hidden
          className={cn(
            'shrink-0 transition-colors duration-300',
            running ? 'text-[hsl(var(--cb-accent))]' : 'text-[hsl(var(--cb-ink-ghost))]',
          )}
        />
        {running ? (
          <ShimmerText className="text-xs font-medium">Thinking</ShimmerText>
        ) : (
          <span className="text-xs font-medium text-[hsl(var(--cb-ink-faint))] transition-colors group-hover/think:text-[hsl(var(--cb-ink-muted))]">
            Thought for {formatDuration(duration)}
          </span>
        )}
      </button>

      {!open && running && latest && (
        <div className="relative mt-0.5 h-[1.35rem] overflow-hidden">
          <motion.p
            key={call.lines.length}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="truncate text-xs italic leading-[1.35rem] text-[hsl(var(--cb-ink-faint))]"
          >
            {latest}
          </motion.p>
        </div>
      )}

      <Collapsible open={open}>
        <ul className="mt-1 space-y-1.5 pb-1">
          {call.lines.map((line, index) => (
            <li key={index} className="text-xs italic leading-relaxed text-[hsl(var(--cb-ink-faint))]">
              {line}
            </li>
          ))}
        </ul>
      </Collapsible>
    </div>
  );
}

export { Badge };
