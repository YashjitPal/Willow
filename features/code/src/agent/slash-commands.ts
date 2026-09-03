/**
 * Slash commands for the Agent tool's composer.
 *
 * Upstream Codex has these in its TUI (`/model`, `/review`, `/plan`, `/goal`, …)
 * and they exist for a reason that survives the port: the useful prompts for a
 * coding agent are the same half-dozen every session, and typing them out in
 * full each time is friction that makes people write worse prompts.
 *
 * ## Two kinds, and the distinction is upstream's
 *
 * Most commands are **prompt templates**. They expand into text in the composer,
 * which the user can then edit before sending, and the harness stays the only
 * thing deciding what tools run.
 *
 * `/plan` and `/goal` are **not templates**, because upstream's are not. They
 * are the entry points to a collaboration mode and to the goal extension
 * respectively, and this file used to get that wrong in a way that mattered:
 * `/plan` expanded to a paragraph ending "Use update_plan", while upstream's
 * Plan mode *refuses* `update_plan` and its mode document explains at length
 * that the two are unrelated. The template was instructing the model to do the
 * one thing the real mode forbids.
 *
 * So both are `mode` actions now. The harness receives a `ModeKind` and a goal
 * objective; nothing about the request is a paraphrase of upstream's
 * instructions, because the instructions themselves are vendored.
 *
 * ## Why templates still see the composer
 *
 * For a template, the user sees what will be sent. A command that silently
 * rewrote the prompt on submit would make the transcript disagree with what
 * actually happened.
 */

export interface SlashCommand {
  /** Including the leading slash. */
  name: string;
  /** One line, shown beside the name in the menu. */
  hint: string;
  /**
   * Text placed in the composer. `{}` marks where the caret should land so the
   * user can keep typing without repositioning.
   *
   * Empty for an action.
   */
  template: string;
  /** Actions run immediately instead of expanding. */
  action?: 'clear' | 'plan-mode' | 'default-mode' | 'goal-mode';
  /**
   * Whether the action needs the rest of the line as an argument.
   *
   * `/goal ship the checkout flow` starts a goal with that objective, so the
   * command is submitted with its text rather than expanded into the composer.
   */
  takesArgument?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/plan',
    hint: 'Enter Plan mode — explore and design, change nothing',
    template: '',
    action: 'plan-mode',
  },
  {
    name: '/goal',
    hint: 'Pursue an outcome across turns until it is true',
    template: '',
    action: 'goal-mode',
    takesArgument: true,
  },
  {
    name: '/code',
    hint: 'Leave Plan mode and start building',
    template: '',
    action: 'default-mode',
  },
  {
    name: '/fix',
    hint: 'Describe a bug and have it found and fixed',
    template:
      'This is broken: {}\n\n' +
      'Find the actual cause before changing anything — read the files ' +
      'involved rather than guessing. Then fix it and verify with computer_use.',
  },
  {
    name: '/test',
    hint: 'Drive the preview and report what happens',
    // The old Test tool was a separate prompted environment. This is just a
    // prompt that reaches the harness's computer_use tool like anything else.
    template:
      'Use computer_use on the preview to check this actually works: {}\n\n' +
      'Report what you saw. If it is broken, fix it and check again.',
  },
  {
    name: '/review',
    hint: 'Review recent changes for problems',
    template:
      'Review the code you have written so far in this session.\n\n' +
      'Look for: state that can go stale, unhandled loading and error cases, ' +
      'accessibility gaps, and anything that would break at 390px wide. ' +
      'Fix what you find. Say so plainly if it is fine.{}',
  },
  {
    name: '/explain',
    hint: 'Explain how part of the project works',
    template:
      'Explain how this works, without changing anything: {}\n\n' +
      'Read the relevant files first. Be concrete about which file does what.',
  },
  {
    name: '/polish',
    hint: 'Improve the visual design of what exists',
    template:
      'Improve the visual design of {} without changing what it does.\n\n' +
      'Consistent spacing scale, real type hierarchy, a restrained palette, ' +
      'proper empty and loading states, and it must hold up at 390px.',
  },
  {
    name: '/clear',
    hint: 'Start a new session',
    template: '',
    action: 'clear',
  },
];

/**
 * Matches a partially-typed command.
 *
 * Only fires when the slash is the very first character and no space has been
 * typed yet — otherwise "use the /api endpoint" would open the menu mid-thought.
 */
export function matchSlashCommands(draft: string): SlashCommand[] {
  const match = /^\/(\w*)$/.exec(draft);
  if (!match) return [];
  const query = (match[1] ?? '').toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.slice(1).startsWith(query));
}

/**
 * Resolves a submitted draft that begins with an action command.
 *
 * Checked on submit as well as in the menu, because `/goal ship the checkout
 * flow` is a complete instruction the user can type and send without ever
 * opening the menu — and `matchSlashCommands` deliberately stops matching the
 * moment a space is typed.
 */
export interface CommandSubmission {
  command: SlashCommand;
  /** The rest of the line, for a command that takes one. */
  argument: string;
}

export function matchCommandSubmission(draft: string): CommandSubmission | null {
  const match = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(draft.trim());
  if (!match) return null;

  const command = SLASH_COMMANDS.find(
    (candidate) => candidate.name.slice(1) === match[1]!.toLowerCase(),
  );
  if (!command?.action) return null;

  return { command, argument: (match[2] ?? '').trim() };
}

export interface Expansion {
  text: string;
  /** Where to put the caret, or the end of the text when there is no `{}`. */
  caret: number;
}

export function expandCommand(command: SlashCommand): Expansion {
  const marker = command.template.indexOf('{}');
  if (marker === -1) {
    return { text: command.template, caret: command.template.length };
  }
  return {
    text: command.template.replace('{}', ''),
    caret: marker,
  };
}
