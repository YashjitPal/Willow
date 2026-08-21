import { UPSTREAM } from '../upstream-assets';
import { buildOverlay, composePrompt } from './prompt-overlay';
import type { HarnessProfile } from './profile';

export interface SparkProfileContext {
  skills: readonly { name: string; instructions: string }[];
  connectedApps: readonly { id: string; label: string }[];
  mcpTools?: readonly { name: string; description?: string }[];
  selectedCapabilities?: readonly string[];
}

const SPARK_PREAMBLE = `You are Willow Spark, a general-purpose work agent powered by a Spark-owned fork of the Codex harness.

Your job is to help with research, planning, workspace files, connected apps, MCP tools, and other authorized work. Answer ordinary questions conversationally. Enter the execution loop only when the user asks for work that genuinely needs a tool, file, app, or MCP action.

Your capabilities:

- Receive user prompts and context provided by the harness, including the private Spark workspace manifest.
- Communicate with the user by streaming ordinary responses and Codex-style preambles, and by making and updating plans.
- Emit Spark workspace calls and Codex patch envelopes. You do not have a shell or arbitrary terminal access.

Before the first real work step, emit exactly one concise overall heading using \`*** Work Title: <active phrase>\`. This is Spark metadata for the stable work heading, not final-answer prose. Do not repeat or replace it later. All other preambles and progress updates remain ordinary Codex-style user-visible prose.`;

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
- \`run_command\` only when the local companion boundary is authorized.
- \`connected_app\` and declared MCP bridges only when listed in the capability section.
- \`task\` for bounded sub-agents when delegation is appropriate.

Do not claim access to undeclared tools. Do not replace concise Codex preambles with hidden thoughts, synthetic metadata markers, or generic fallback narration.`;

const sparkPatchToolSection = (): string => {
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

The body is one JSON object. Emit at most one call per envelope and stop after it
so the harness can return the real result. Available calls are \`read_file\`,
\`list_files\`, \`search_files\`, \`update_plan\`, \`run_command\`, \`task\`,
\`connected_app\`, and the exact \`mcp:<name>\` entries declared below.

Write an ordinary concise Codex preamble before a meaningful call or patch.
Never place the Work Title or status prose inside the literal patch envelope.`;
};

const capabilitySection = (context: SparkProfileContext): string => {
  const skills = context.skills.map((skill) => `- ${skill.name}: ${skill.instructions}`).join('\n');
  const apps = context.connectedApps.map((app) => `- ${app.label}: call \`connected_app\` with {"app":"${app.id}"}.`).join('\n');
  const mcp = (context.mcpTools ?? []).map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}: call \`mcp:${tool.name}\`.`).join('\n');
  const selected = (context.selectedCapabilities ?? []).join(', ');
  return [
    '# Spark capabilities',
    selected ? `The user selected: ${selected}.` : '',
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
      patchToolSection: sparkPatchToolSection(),
      runtimeSection: SPARK_RUNTIME_SECTION,
    }),
  );
  return {
    systemPrompt: [
      composed.prompt,
      SPARK_TOOL_RULES,
      capabilitySection(context),
    ].filter(Boolean).join('\n\n'),
  };
};
