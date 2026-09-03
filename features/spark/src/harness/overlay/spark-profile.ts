import { UPSTREAM } from '../upstream-assets';
import { buildOverlay, composePrompt } from './prompt-overlay';
import { requestUserInputModes, requestUserInputToolDescription } from './collaboration-mode';
import type { HarnessProfile } from './profile';

export interface SparkProfileContext {
  /**
   * The enabled skill library.
   *
   * `description` is what the model reads to decide a skill is relevant, so it
   * is not optional in spirit even though an old record may lack one. Upstream's
   * catalog line is `- {name}: {description} ({locator})`, and the description
   * is the whole of the selection signal: `instructions` is deliberately
   * withheld until `use_skill` is called.
   */
  skills: readonly { name: string; description?: string; instructions: string }[];
  connectedApps: readonly { id: string; label: string }[];
  mcpTools?: readonly { name: string; description?: string }[];
  selectedCapabilities?: readonly string[];
  /**
   * Whether the agent may ask questions outside Plan mode. **Defaults to on**,
   * matching the Codex app.
   *
   * It has to reach the prompt, not just the tool registry. Upstream generates
   * the tool's description from `request_user_input_available_modes`, so the
   * sentence the model reads has to agree with what was registered.
   *
   * This was a real bug, and it presented exactly as you would expect:
   * registering the tool while the prompt still said "only available in Plan
   * mode" got a model that read the description, believed it, and declined to
   * call a tool it was holding.
   */
  askOutsidePlanMode?: boolean;
}

const SPARK_PREAMBLE = `You are Willow Spark, a general-purpose work agent powered by a Spark-owned fork of the Codex harness.

Your job is to help with research, planning, workspace files, connected apps, MCP tools, and other authorized work. Treat substantive questions and requests as agentic work even when they ultimately need no tool. Greetings, thanks, acknowledgements, and genuinely tiny conversational replies may remain direct.

Your capabilities:

- Receive user prompts and context provided by the harness, including the private Spark workspace manifest.
- Communicate with the user by streaming ordinary responses and Codex-style preambles, and by making and updating plans.
- Emit Spark workspace calls and Codex patch envelopes. You do not have a shell or arbitrary terminal access.

Before the first real work step, emit exactly one concise overall heading using \`*** Work Title: <active phrase>\`. This is Spark metadata for the stable work heading, not final-answer prose. Do not repeat or replace it later. All other preambles and progress updates remain ordinary Codex-style user-visible prose.

For a substantive work batch, keep the final answer separate. After all tool use, checking, calculation, or other work is finished, emit \`*** Final Response\` on its own line and write the complete user-facing answer only after it. Never start the final answer and then return to tools or progress updates.`;

const SPARK_SHELL_SECTION = `
You do not have arbitrary shell access in this environment. There is no general terminal, package manager, or test runner.

\`run_command\` is available only through Willow's local companion, only for a user-authorised workspace. If that boundary is unavailable, say so plainly; never claim that a command ran.

Verify local workspace work by reading files or using an actually available tool. Do not invent command output, tests, installs, or filesystem effects.`;

const SPARK_RUNTIME_SECTION = `
Spark uses a private browser-backed workspace rooted at \`/workspace\` for small files. Use the declared workspace tools for file work.

Connected Apps and MCP tools are actions only when their declarations appear in the capability section below. Native Google Search and Code Execution may be supplied by the provider for tasks that genuinely need them; they are separate provider operations, not local shell access.

Keep provider thought summaries and hidden reasoning private. Visible progress must be ordinary, factual preamble prose; do not invent a separate work-log metadata marker.`;

const SPARK_TOOL_RULES = `
# Spark-specific capability boundary

Use the full Codex preamble, planning, task-execution, progress-update, verification, and final-response behavior above. The following are the only Spark-local actions available in this run:

- \`read_file\`, \`list_files\`, and \`search_files\` for the private workspace.
- \`apply_patch\` using the literal Codex patch envelope.
- \`update_plan\` for visible multi-step plans.
- \`request_user_input\` to ask the user a short multiple-choice question, when
  it is listed among the available calls for this turn.
- \`run_command\` only when the local companion boundary is authorized.
- \`connected_app\` and declared MCP bridges only when listed in the capability section.
- \`get_goal\`, \`create_goal\`, and \`update_goal\` expose Codex's persisted thread-goal lifecycle. Create a goal only when the user explicitly asks for one; ordinary tasks are not goals.
Do not claim access to undeclared tools. Do not replace concise Codex preambles with hidden thoughts, synthetic metadata markers, or generic fallback narration.`;

const SPARK_WORK_BATCH_RULES = `
# Spark work batches

Prefer a visible work batch for substantive requests, including web research,
native Search, native Code Execution, comparisons, calculations, drafting, and
multi-step answers that happen not to require a tool. A greeting, thanks,
acknowledgement, or truly immediate one-line reply may be answered directly.

Inside a work batch:

- Emit the Work Title before any progress prose or action.
- Write a factual progress update before the first meaningful action.
- Treat each meaningful phase as its own visible checkpoint: orientation,
  discovery, action, result, verification, and handoff. Around a phase change,
  emit as many consecutive, distinct updates as the work genuinely supports.
  There is no fixed count and no required placement immediately before or after
  a tool call. Keep emitting while each update adds a new observable fact,
  decision, milestone, or next step; stop when the next sentence would only pad
  or repeat the timeline.
- Keep each update factual and outcome-based, usually 8-20 words. Put each
  distinct update on its own line or paragraph so the timeline can display it
  separately. Consecutive updates may appear before, between, or after actions
  when that reflects the real flow of work.
- Write timeline updates as plain text. Do not use Markdown formatting,
  headings, bullets, emphasis, inline code, fenced code, or links in Work Title
  or progress prose. Protocol markers and literal Patch contents are exempt;
  never alter a user's requested file contents merely to satisfy this display
  rule.
- Native Search and Code Execution belong inside the same work batch. After the
  native result arrives, state the useful factual checkpoint in ordinary prose.
- Include verification or outcome updates whenever there is a real result to
  confirm, wherever they naturally belong in the work sequence.
- When no tool is needed, use as many concise progress updates as the real
  comparison, calculation, synthesis, or drafting requires, and no more.
- Emit \`*** Final Response\` only after the work is complete. Everything before
  that marker is timeline prose; everything after it is the final answer.
- Never call a tool, emit a Patch, or add more progress prose after
  \`*** Final Response\`.

Progress prose is not hidden reasoning. State only observable actions, obtained
facts, decisions, and next steps that are appropriate to show the user.`;

const sparkPatchToolSection = (askOutsidePlanMode = true): string => {
  const cutAt = UPSTREAM.applyPatchInstructions.indexOf('You can invoke apply_patch like');
  const grammar = (
    cutAt === -1
      ? UPSTREAM.applyPatchInstructions
      : UPSTREAM.applyPatchInstructions.slice(0, cutAt)
  )
    .replace(/^## `apply_patch`\s*/, '')
    .replace('Use the `apply_patch` shell command to edit files.', '')
    .trim();

  return `
You have no arbitrary shell, so local actions use the Codex text protocol.

## Editing workspace files

Emit a patch on its own lines with no code fence, JSON wrapper, or shell call:

*** Begin Patch
*** Update File: /workspace/example.txt
@@
-old
+new
*** End Patch

${grammar}

## Other Spark calls

*** Call: read_file
{"path":"/workspace/example.txt"}
*** End Call

The body is one JSON object. Emit at most one call per envelope. Collaboration
calls may be interleaved with other calls; their results are returned as
coordination proceeds. When the next meaningful action is \`spawn_agent\`, invoke
it directly without an announcing or explanatory preamble immediately before
the call. This rule applies only to that immediate pre-spawn narration; after
the call, continue with ordinary progress updates and coordination as useful.
Available calls are \`read_file\`,
\`list_files\`, \`search_files\`, \`update_plan\`, \`run_command\`,
\`spawn_agent\`, \`send_message\`, \`followup_task\`, \`wait_agent\`,
\`interrupt_agent\`, \`list_agents\`,
\`get_goal\`, \`create_goal\`, \`update_goal\`, \`request_user_input\`,
\`connected_app\`, \`use_skill\`, and the exact \`mcp:<name>\` entries declared below.

\`request_user_input\` accepts
\`{"questions":[{"id":"storage","header":"Storage","question":"Where should saved tasks live?","options":[{"label":"IndexedDB (Recommended)","description":"Survives reload, no sync."},{"label":"Google Drive","description":"Syncs across devices, needs sign-in."}]}]}\`.
${requestUserInputToolDescription(requestUserInputModes(askOutsidePlanMode))}
Ask one to three questions, each with two or three meaningful options, the
recommended one first. Do not add an "Other" choice — the client supplies a
free-text field itself. Do not write a multiple-choice question as ordinary
prose; either call the tool or ask a single plain question.

\`spawn_agent\` accepts \`{"task_name":"<name>","message":"Self-contained task","agent_type":"researcher","fork_turns":"all"}\`.
It returns immediately with the new agent path. Use \`wait_agent\` to wait for
mail, \`send_message\` to add context without starting a turn,
\`followup_task\` to start more work on an idle agent, \`interrupt_agent\` to
stop an active turn, and \`list_agents\` to inspect the live tree. Use these
native collaboration names; Spark does not expose a separate \`task\` tool.

Write an ordinary concise Codex preamble before a meaningful call or patch.
Never place the Work Title or status prose inside the literal patch envelope.`;
};

const capabilitySection = (context: SparkProfileContext): string => {
  /*
   * The skill catalog, in upstream's shape: name, description, locator.
   *
   * The description used to be missing entirely — every line read
   * "- <name>: call `use_skill` with …", so the model was handed a list of bare
   * names and no way to tell what any of them were for. That is the one piece
   * of information progressive disclosure depends on: upstream withholds the
   * `SKILL.md` body until a skill is invoked precisely *because* the
   * description is enough to choose by. Without it the catalog is unusable and
   * the model either ignores skills or calls one at random.
   */
  const skills = context.skills
    .map((skill) => {
      const description = skill.description?.replace(/\s+/g, ' ').trim();
      const summary = description ? `${skill.name}: ${description}` : skill.name;
      return `- ${summary} (call \`use_skill\` with {"skill":"${skill.name}"} to read its instructions before applying it.)`;
    })
    .join('\n');
  const apps = context.connectedApps.map((app) => `- ${app.label}: call \`connected_app\` with {"app":"${app.id}"}.`).join('\n');
  const mcp = (context.mcpTools ?? []).map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}: call \`mcp:${tool.name}\`.`).join('\n');
  const selected = (context.selectedCapabilities ?? []).join(', ');
  const selectedSet = new Set(context.selectedCapabilities ?? []);
  const selectedModeRules = [
    /*
     * Plan is deliberately absent from this list.
     *
     * It used to say "Plan was explicitly selected. Before the first meaningful
     * action, call `update_plan`…", which is the exact opposite of what Plan
     * mode is: upstream refuses `update_plan` in Plan mode and says so in the
     * mode document — "Do not confuse it with Plan mode or try to use it while
     * in Plan mode. If you try to use `update_plan` in Plan mode, it will
     * return an error." Two unrelated Codex features had been collapsed into
     * one chip.
     *
     * Plan now arrives the way upstream sends it: as the vendored `plan.md`
     * inside a `<collaboration_mode>` block, composed per turn by
     * `runTurn` rather than as a capability bullet. See
     * `./collaboration-mode.ts`.
     */
    selectedSet.has('goal')
      ? '- Goal was explicitly selected and the harness has activated the complete user request as the persisted goal objective. Use `get_goal` when you need its state, keep the objective intact, and call `update_goal` only after the goal is verified complete or the strict blocked audit is satisfied; do not create a second goal.'
      : '',
    selectedSet.has('sub-agents')
      ? '- Sub-agents was explicitly selected. Use `spawn_agent` for concrete independent work that benefits from delegation; parallelize independent subtasks when useful, then wait for and synthesize their results.'
      : '',
    selectedSet.has('computer-use') || selectedSet.has('create-pet') || selectedSet.has('create-skill') || selectedSet.has('personal-intelligence')
      ? '- The other selected Spark entries are UI placeholders for now. No corresponding runtime tool is declared; do not claim that one ran.'
      : '',
  ].filter(Boolean).join('\n');
  return [
    '# Spark capabilities',
    selected ? `The user selected: ${selected}.` : '',
    selectedModeRules ? `## Selected Spark modes\n${selectedModeRules}` : '',
    skills ? `## Skills\n${skills}` : '',
    apps ? `## Connected Apps\n${apps}` : '',
    mcp ? `## MCP tools\n${mcp}` : '',
  ].filter(Boolean).join('\n\n');
};

export const createSparkHarnessProfile = (context: SparkProfileContext): Pick<HarnessProfile, 'systemPrompt'> => {
  const composed = composePrompt(
    UPSTREAM.prompt,
    buildOverlay({
      applyPatchInstructions: UPSTREAM.applyPatchInstructions,
      preamble: SPARK_PREAMBLE,
      shellSection: SPARK_SHELL_SECTION,
      patchToolSection: sparkPatchToolSection(context.askOutsidePlanMode !== false),
      runtimeSection: SPARK_RUNTIME_SECTION,
    }),
  );
  return {
    systemPrompt: [
      composed.prompt,
      SPARK_TOOL_RULES,
      SPARK_WORK_BATCH_RULES,
      capabilitySection(context),
    ].filter(Boolean).join('\n\n'),
  };
};
