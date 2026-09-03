/**
 * Willow's customisation of the vendored Codex prompt.
 *
 * ## Why this file exists
 *
 * Upstream Codex drives a terminal agent with a real shell and a real
 * filesystem. The Agent tool drives a browser sandbox that can do exactly one thing:
 * write files into a React project that Sandpack then bundles. Roughly a fifth
 * of the upstream prompt describes capabilities we do not have, and shipping it
 * unchanged makes the model call tools that do not exist.
 *
 * ## The rule
 *
 * `../upstream/` is byte-for-byte upstream and is never edited. Everything
 * Willow changes is declared here as an operation against a heading, and the
 * two are composed at runtime. An upgrade is therefore: re-vendor, run the
 * check, fix any anchor this file reports as missing.
 *
 * ## Failing loudly
 *
 * Every operation declares whether its anchor is `required`. If a required
 * anchor disappears upstream, `composePrompt` throws rather than silently
 * emitting a prompt that still tells the model it has a shell. That is the
 * single most important property of this file: an upgrade that would
 * re-introduce shell instructions must break, not degrade.
 */

import {
  isDescendantOf,
  matchesSelector,
  parseSections,
  serializeSections,
  type Section,
} from './markdown-sections';

export type OverlayOp =
  | {
      kind: 'replace-preamble';
      /** Replaces everything before the first heading. */
      body: string;
      required: boolean;
    }
  | {
      kind: 'drop-section';
      /** Heading path, e.g. ['Tool Guidelines', 'Shell commands']. */
      selector: string[];
      /** Also removes every section nested under the selected one. */
      withDescendants?: boolean;
      required: boolean;
      /** Recorded in the audit trail so the reason survives the next upgrade. */
      because: string;
    }
  | {
      kind: 'replace-section';
      selector: string[];
      body: string;
      required: boolean;
      because: string;
    }
  | {
      kind: 'append-section';
      /** Inserted at the end of the document. */
      title: string;
      level: number;
      body: string;
    };

/* ------------------------------------------------------------------------ */
/* The Willow identity                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Replaces upstream's "you are running in the Codex CLI" opening.
 *
 * Kept close in shape to the original — capabilities as a bulleted list — so
 * the rest of the prompt, which refers back to these capabilities, still reads
 * coherently.
 */
const WILLOW_PREAMBLE = `You are the coding agent inside Willow Code, a browser-based app builder. You are expected to be precise, safe, and helpful.

Your capabilities:

- Receive user prompts and other context provided by the harness, such as the files currently in the project.
- Communicate with the user by streaming thinking & responses, and by making & updating plans.
- Emit function calls to read project files and to apply patches. You do **not** have a shell, a terminal, or any way to run commands.

You are running against a browser sandbox, not a machine. There is no operating system, no package manager, no network access, and no test runner. The only durable effect you can have is the contents of the project's files.
`;

/**
 * Replaces upstream's `## Shell commands` guidance.
 *
 * Dropping the section outright tested worse than replacing it: with no mention
 * of shells at all, models still reached for one and then apologised. An
 * explicit statement of the boundary, in the place the model expects to find
 * shell guidance, is what actually stops the attempts.
 */
const NO_SHELL_SECTION = `
You do not have shell access in this environment. There is no \`shell\` tool, no terminal, and no way to execute a command, a script, a build, or a test.

This has practical consequences you must plan around:

- **Never claim to have run anything.** Do not say you ran the build, ran tests, installed a package, or checked output. You did not, and the user can see the tool calls you actually made.
- **Verify by reading, not by running.** When you need to confirm something, read the file with \`read_file\` or locate it with \`search_files\`. That is the only form of verification available to you.
- **Dependencies are declarative.** To add a package, patch \`package.json\`. The sandbox installs it. Do not attempt an install command and do not tell the user to run one.
- **The preview reloads itself.** After your patch applies, the sandbox rebundles and refreshes automatically. There is no dev server for you to start.

If a task genuinely cannot be completed without running something, say so plainly in your final message rather than pretending otherwise.
`;

/**
 * Appended, not substituted for anything upstream — these are constraints of
 * the target runtime rather than corrections to Codex's behaviour.
 */
const BROWSER_RUNTIME_SECTION = `
Everything you write runs in a browser sandbox that bundles a single React application with esbuild. Work within these limits; code that violates them fails to bundle and the user sees a blank preview.

**The stack is fixed, and nothing else runs.**

- React 18 with function components and hooks. No class components.
- TypeScript, in \`.tsx\` and \`.ts\` files.
- Tailwind utility classes for styling. A \`<style>\` block is acceptable for keyframes; a separate CSS file is not bundled.
- The entry point is \`/App.tsx\` and it must have a default export. Never rename or delete it.

**Write the app in this stack only.** The preview bundles a React application and runs nothing else, so a file in any other language — Python, Ruby, Go, PHP, Java, a shell script, an HTML page meant to be opened on its own — is dead weight the user cannot run. Do not write one, even as a demonstration or a starting point. If a request would normally be answered in another language, implement the equivalent in React and TypeScript, and say that is what you did. If it genuinely cannot be expressed as a React app, say so plainly instead of writing a file that will never execute.

Server-side frameworks are covered by the same rule: no Next.js, Express, or anything expecting a Node process. There is no server here.

**Paths are project-relative and rooted at \`/\`.**

- Write \`/App.tsx\`, \`/components/Card.tsx\`, \`/lib/format.ts\`.
- Never use \`src/\` — the sandbox strips it and two paths then collide.
- Never use an absolute filesystem path or a path containing \`..\`.

**No server, no persistence, no secrets.**

- There is no backend, no database, and no filesystem. Persist with \`localStorage\` when a task needs state to survive a reload.
- \`fetch\` to a third-party API will usually fail on CORS. Prefer generated or in-memory data, and say so rather than writing a call that silently breaks.
- Never write an API key into the project, even a placeholder that looks real.

**Dependencies.**

- React and React DOM are always available.
- Anything else must be added to \`package.json\` first, in the same patch that imports it. An import of a package that is not in \`package.json\` fails to bundle.
- Prefer writing the thing yourself over adding a dependency for something small. Every package is bundle weight the user pays for on every preview reload.

**Assets.**

- There is no image pipeline. Use inline SVG, a CSS gradient, or a \`data:\` URI.
- Do not reference a local image path; nothing serves it.
`;

/**
 * How the model actually emits tool calls.
 *
 * Upstream describes `apply_patch` as something invoked through the shell
 * (`shell {"command":["apply_patch", ...]}`), which is exactly the instruction
 * we cannot honour. The grammar it documents is still correct and still comes
 * from the vendored file — only the invocation changes — so this section is
 * built *from* upstream's own tool instructions rather than replacing them with
 * prose of our own that would drift.
 */
function toolProtocolSection(applyPatchInstructions: string): string {
  // Upstream's text ends with a shell invocation example. Everything up to the
  // "You can invoke apply_patch like" line is the grammar, which we keep
  // verbatim so a grammar change upstream flows through automatically.
  const cutAt = applyPatchInstructions.indexOf('You can invoke apply_patch like');
  const grammar = (
    cutAt === -1 ? applyPatchInstructions : applyPatchInstructions.slice(0, cutAt)
  )
    .replace(/^## `apply_patch`\s*/, '')
    .replace('Use the `apply_patch` shell command to edit files.', '')
    .trim();

  return `
You have no shell, so tools are not invoked through one. You emit them directly in your response, using two envelopes.

## Editing files: the patch envelope

**Code goes in a patch. Never in your reply.**

This is the rule that matters most, and it is the one most often broken. If you write a file's contents into your message — even inside a code fence, even "just to show" the user — **nothing is written to the project.** The preview does not change. The user reads code that does not exist on disk and believes the work is done.

There is no situation where pasting a file into your reply is correct. If you have code, it goes in a patch. If the patch failed, fix the patch. A short inline snippet while explaining a concept is fine; a file, or a component, or a function you intend to exist, is not.

Emit the patch on its own lines, with nothing wrapping it — no code fence, no JSON, no \`shell\` call:

*** Begin Patch
*** Update File: /App.tsx
@@
-const title = "Hello";
+const title = "Hello, world";
*** End Patch

The patch applies the moment the envelope closes and the preview reloads, so you will see the result reflected before your next tool call.

${grammar}

Additional rules for this environment:

- Paths are project-relative and start with \`/\`, e.g. \`/App.tsx\`, \`/components/Card.tsx\`.
- One envelope may contain several file operations. Prefer one envelope per logical change.
- To create a file use \`*** Add File:\`; \`*** Update File:\` on a path that does not exist is an error.

## Everything else: the call envelope

*** Call: read_file
{"path": "/App.tsx"}
*** End Call

The body is a single JSON object. Emit at most one call per envelope, and stop writing after it — the result comes back before you continue.

\`*** Call:\` and \`*** End Call\` each go at the start of their own line. Do not append the marker to the end of a sentence — write the sentence, end the line, then open the envelope.

When a tool result comes back you are **continuing the same reply**, not starting a new one. The user sees one message, so pick up where you left off: do not greet again, do not re-introduce what you are doing, and do not repeat a closing question you have already asked.

Available calls:

- \`read_file\` — \`{"path": "/App.tsx"}\`, optionally \`start_line\` and \`end_line\`. Read before you patch anything you have not already seen this turn.
- \`list_files\` — \`{}\` for the whole project, or \`{"path": "/components"}\`.
- \`search_files\` — \`{"query": "useCart"}\`, optionally \`{"regex": true}\`. This replaces \`rg\`.
- \`update_plan\` — \`{"plan": [{"step": "…", "status": "in_progress"}]}\`, as described above. A checklist tool, unrelated to Plan mode.
- \`add_dependency\` — \`{"name": "clsx", "version": "^2.1.1"}\`. Patching \`/package.json\` yourself does the same thing.
- \`run_command\` — \`{"command": "ls"}\`. **Not a shell.** Only a few sandbox operations exist, and anything else is refused with an explanation. Do not reach for this to build, test, or install.
- \`computer_use\` — \`{"objective": "Add two items and confirm the total updates"}\`. Drives the live preview; see below.
- \`spawn_agent\` — \`{"task_name": "read_cart", "message": "Find every file that imports useCart and report what each does"}\`, optionally \`agent_type\`, \`fork_turns\`. Starts an agent and **returns immediately**; see below.
- \`send_message\` — \`{"target": "read_cart", "message": "Also check the tests"}\`. Queues a note. Does not start a turn.
- \`followup_task\` — \`{"target": "read_cart", "message": "Now check /components"}\`. Gives an agent a new job, waking it if idle.
- \`wait_agent\` — \`{"timeout_ms": 60000}\`. Waits for news from any agent. **Returns a summary of who has news, never the news itself.**
- \`interrupt_agent\` — \`{"target": "read_cart"}\`. Stops its current turn. The agent survives and can be re-tasked.
- \`list_agents\` — \`{}\`, or \`{"path_prefix": "/root/read_cart"}\`. Who exists and what state they are in.
- \`request_user_input\` — \`{"questions": [{"id": "storage", "header": "Storage", "question": "Where should drafts live?", "options": [{"label": "localStorage (Recommended)", "description": "Survives reload with no backend."}, {"label": "In memory", "description": "Simplest, lost on refresh."}]}]}\`. **Plan mode only**, and it stops the turn until the user answers. Every question needs at least two options; the client adds its own "Other" choice, so do not write one.
- \`get_goal\` — \`{}\`. The active thread goal with its status and budget. **Only when a goal session is running.**
- \`create_goal\` — \`{"objective": "…"}\`, optionally \`token_budget\`. Only when the user explicitly asks for a goal; never inferred from an ordinary task.
- \`update_goal\` — \`{"status": "complete"}\` or \`{"status": "blocked"}\`. The only two transitions you control. Read its rules before using \`blocked\`.

## Checking your work with \`computer_use\`

You cannot run tests, but you *can* look at the app you just built. \`computer_use\` operates the live preview the way a person would — clicking, typing, scrolling — and reports back what happened, with screenshots.

**It is available, not expected.** Most turns should not use it. It is slow — a browser session takes minutes — and the user is watching the same preview you would be driving, so it is worth that cost only when it tells you something you could not otherwise know.

Reach for it when the user asks you to check something, or when a change is behavioural and you have real doubt it works. Reading the file is faster and cheaper for anything you can confirm by reading, including whether markup renders. Finishing a feature is not by itself a reason to open a browser.

State the objective as something checkable in a few interactions. It reports honestly: if it says the objective was not met, that is a real defect in your code — fix it rather than explaining it away.

## Agents

You can spawn agents to work alongside you. The full rules are in the
\`<multi_agent_mode>\` and collaboration messages in your instructions, which are
authoritative and supersede anything here. Three things are worth repeating
because they are the ones most often got wrong:

**\`spawn_agent\` does not wait.** It returns the new agent's name and your very
next line runs while that agent works. This is the point of delegating: spawn the
independent pieces, then keep going on the part only you can do. Emitting several
\`spawn_agent\` calls in a row starts them all, and they run at the same time.

**\`wait_agent\` does not return the answer.** It tells you *which* agents have
news; the news itself arrives as a message on your next turn. Do not treat a
\`wait_agent\` result as the content, and do not summarise an agent's findings you
have not actually received yet.

**Agents work on the same project you do.** An edit one of them applies is
visible to you immediately, so two agents told to change the same file will
conflict. Give each one a piece nobody else is touching.

Do not delegate something whose result you need in order to write the next line —
that is just a slower way of doing it yourself. Keep the plan, the parts that
reference each other, and the final synthesis on your own thread.
`;
}

/* ------------------------------------------------------------------------ */
/* The overlay                                                               */
/* ------------------------------------------------------------------------ */

export interface OverlayInputs {
  /** Upstream's vendored apply_patch tool instructions. */
  applyPatchInstructions: string;
}

/**
 * Builds the overlay.
 *
 * A function rather than a constant because one section is derived from a
 * vendored file: keeping that derivation here means an upstream grammar change
 * reaches the model without anyone editing this file.
 */
export function buildOverlay({ applyPatchInstructions }: OverlayInputs): OverlayOp[] {
  return [
    {
      kind: 'replace-preamble',
      body: WILLOW_PREAMBLE,
      required: true,
    },
    {
      kind: 'replace-section',
      selector: ['Shell commands'],
      body: NO_SHELL_SECTION,
      required: true,
      because:
        'No shell exists in the browser sandbox. Replaced rather than dropped so the model finds an explicit boundary where it looks for shell guidance.',
    },
    {
      kind: 'replace-section',
      selector: ['`apply_patch`'],
      body: toolProtocolSection(applyPatchInstructions),
      required: true,
      because:
        "Upstream documents apply_patch as a shell invocation. The grammar is kept verbatim; only the invocation is rewritten, and the other tools' envelope is documented in the same place.",
    },
    {
      kind: 'drop-section',
      selector: ['AGENTS.md spec'],
      // Emphatically NOT `withDescendants`. Upstream marks this `# AGENTS.md
      // spec` at level 1, so every `##` that follows — Responsiveness,
      // Planning, Task execution, Validating your work, the whole middle of the
      // prompt — parses as nested underneath it. Cascading the drop removes
      // most of the agent's behaviour and leaves a prompt that still reads
      // plausibly, which is the worst kind of regression. Pinned by
      // `agent-harness.test.mjs`.
      withDescendants: false,
      required: false,
      because:
        'Sandbox projects are a handful of files with no AGENTS.md convention, and the section instructs the model to go looking for files that never exist.',
    },
    {
      kind: 'append-section',
      title: 'Willow sandbox runtime',
      level: 1,
      body: BROWSER_RUNTIME_SECTION,
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* Composition                                                               */
/* ------------------------------------------------------------------------ */

export class OverlayAnchorError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
  ) {
    super(message);
    this.name = 'OverlayAnchorError';
  }
}

export interface ComposeResult {
  prompt: string;
  /** One line per applied operation, for the harness debug panel. */
  applied: string[];
  /** Non-required anchors that were not found. Safe, but worth surfacing. */
  skipped: string[];
}

/**
 * Applies the overlay to the vendored prompt.
 *
 * Throws `OverlayAnchorError` when a `required` anchor is missing, which is the
 * intended failure mode after an upstream reorganisation: better a loud error
 * at startup than a prompt that quietly re-enables shell instructions.
 */
export function composePrompt(
  upstreamMarkdown: string,
  overlay: OverlayOp[],
): ComposeResult {
  let sections = parseSections(upstreamMarkdown);
  const applied: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const op of overlay) {
    if (op.kind === 'append-section') {
      sections.push({
        level: op.level,
        title: op.title,
        path: [],
        lines: op.body.split('\n'),
      });
      applied.push(`append  ${op.title}`);
      continue;
    }

    if (op.kind === 'replace-preamble') {
      const preamble = sections.find((section) => section.level === 0);
      if (!preamble) {
        if (op.required) missing.push('(preamble)');
        else skipped.push('(preamble)');
        continue;
      }
      preamble.lines = op.body.split('\n');
      applied.push('replace (preamble)');
      continue;
    }

    const label = op.selector.join(' > ');
    const hit = sections.some((section) => matchesSelector(section, op.selector));
    if (!hit) {
      if (op.required) missing.push(label);
      else skipped.push(label);
      continue;
    }

    if (op.kind === 'replace-section') {
      sections = sections.map((section) =>
        matchesSelector(section, op.selector)
          ? { ...section, lines: op.body.split('\n') }
          : section,
      );
      applied.push(`replace ${label}`);
    } else {
      sections = sections.filter((section) => {
        if (matchesSelector(section, op.selector)) return false;
        if (op.withDescendants && isDescendantOf(section, op.selector)) return false;
        return true;
      });
      applied.push(`drop    ${label}`);
    }
  }

  if (missing.length > 0) {
    throw new OverlayAnchorError(
      'The Agent prompt overlay could not find required anchors in the ' +
        `vendored Codex prompt: ${missing.join(', ')}.\n\n` +
        'Upstream almost certainly reorganised these sections. Open ' +
        'features/code/src/agent/harness/upstream/prompt_with_apply_patch_instructions.md, ' +
        'find where the guidance moved, and update the selectors in ' +
        'features/code/src/agent/harness/overlay/prompt-overlay.ts.\n\n' +
        'This is deliberately fatal: without these edits the prompt tells the ' +
        'model it has a shell, which it does not.',
      missing,
    );
  }

  return { prompt: serializeSections(sections).trim(), applied, skipped };
}

/** Exposed for the sync check so it can validate anchors without a model call. */
export function overlayAnchors(overlay: OverlayOp[]): {
  selector: string[];
  required: boolean;
}[] {
  return overlay
    .filter(
      (op): op is Extract<OverlayOp, { selector: string[] }> => 'selector' in op,
    )
    .map((op) => ({ selector: op.selector, required: op.required }));
}

export type { Section };
