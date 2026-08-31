/**
 * Slash commands for the Agent tool's composer.
 *
 * Upstream Codex has these in its TUI (`/model`, `/review`, `/plan`, …) and
 * they exist for a reason that survives the port: the useful prompts for a
 * coding agent are the same half-dozen every session, and typing them out in
 * full each time is friction that makes people write worse prompts.
 *
 * ## The rule they follow
 *
 * A command is a **prompt template**, never a mode. It expands into text in the
 * composer, which the user can then edit before sending. That matters:
 *
 * - The harness stays the only thing deciding what tools run. A command that
 *   flipped the composer into a special path would be a second control flow,
 *   which is exactly what the Test tool was and why it is gone.
 * - The user sees what will be sent. A command that silently rewrote the prompt
 *   on submit would make the transcript disagree with what actually happened.
 *
 * `/clear` is the one exception — it is an action, not a template — and it is
 * marked as such.
 */

export interface SlashCommand {
  /** Including the leading slash. */
  name: string;
  /** One line, shown beside the name in the menu. */
  hint: string;
  /**
   * Text placed in the composer. `{}` marks where the caret should land so the
   * user can keep typing without repositioning.
   */
  template: string;
  /** Actions run immediately instead of expanding. */
  action?: 'clear';
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/goal',
    hint: 'State an outcome and let the agent plan it',
    // Deliberately outcome-shaped rather than instruction-shaped. Asking for a
    // goal produces a plan and a sequence of edits; asking for a change
    // produces one edit and a stop.
    template:
      'Goal: {}\n\n' +
      'Work until this is true. Plan it first, then make the changes, then ' +
      'check the result in the preview.',
  },
  {
    name: '/plan',
    hint: 'Plan the work without changing anything yet',
    template:
      'Plan how you would do this, but do not change any files yet:\n\n{}\n\n' +
      'Use update_plan, and tell me what you would touch and what you are ' +
      'unsure about.',
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
