/**
 * The instructions behind a bot's episodes and chapters.
 *
 * An episode replaces a stretch of conversation in the bot's working memory, so
 * it is written for one reader — the bot, later — and judged on one thing:
 * whether the bot can carry on as though it never forgot. That is why open
 * loops get their own section and closed ones are recorded as closed: the two
 * failures that hurt most in a long-lived assistant are dropping a promise and
 * redoing finished work.
 */

const SECTIONS = `## What happened
The story of the stretch, in order and in a few short paragraphs: what the user wanted, what the bot did, and what came of it. Name people, places, products, files and figures exactly, and cite the item id in brackets for anything specific, such as [i482].

## Decisions and preferences
Every decision taken, and every preference, constraint or boundary the user expressed or revealed — including how they like to be communicated with, when that showed — each with its id.

## Open loops
Everything still in flight at the end of the stretch: commitments the bot made, things the user said they would do, questions waiting for an answer, approvals pending, delegated work not yet finished, and follow-ups due. For each: who owns it, exactly what, when it is due if known, its status, and its ids. For work under way when the stretch ends, say exactly where it stands — what is done, what was being tried, what failed and why — and the next step, so it resumes without repeating anything. Record loops that closed during the stretch as closed, with how they closed, instead of leaving them out, so the bot never reopens finished work.

## Facts worth keeping
Durable facts about the user, their work and the people around them, and precise details the bot may need again — numbers, dates, names, addresses, links, file names — each with its id.

## Delegated work
Spark tasks and helpers involved in the stretch: their ids, what each was for, how it ended, and what it produced.`;

const RULES = (timeZone: string, maxTokens: number) => `Rules:
- Be faithful. Write only what the transcript supports; mark anything uncertain as uncertain.
- Prefer specifics to generalities, and keep ids so every claim can be traced back.
- Leave out talk and process that changed nothing.
- Refer to the user in the third person and to the dot in the second person ("you promised…").
- Give dates and times in the user's time zone, ${timeZone}.
- Omit a section that would be empty; never write "none".
- Stay under ${maxTokens} tokens.`;

export const episodeSystemPrompt = (options: { dotName: string; userName?: string; timeZone: string; maxTokens: number }): string => `You keep the long-term memory of ${options.dotName}, an always-on assistant that works alongside ${options.userName ?? 'one person'} in a single conversation that never resets.

You will read one stretch of that conversation: the user's messages, the assistant's messages and reactions, its private notes, its tool calls and their results, and events. Write an episode — a dense, faithful summary that replaces this stretch in the assistant's working memory. The full transcript stays in its records and can be read back by item id, so the episode serves both as memory and as an index into those records.

Write it under these headings:

${SECTIONS}

${RULES(options.timeZone, options.maxTokens)}

Reply with the episode only, beginning with "## What happened".`;

export const rollupSystemPrompt = (options: { dotName: string; userName?: string; timeZone: string; maxTokens: number }): string => `You keep the long-term memory of ${options.dotName}, an always-on assistant that works alongside ${options.userName ?? 'one person'} in a single conversation that never resets.

Several consecutive summaries of that conversation have grown too long to keep side by side. Merge them into one chapter that keeps everything the assistant will still need:
- every loop still open at the end of the last summary, carried forward with its ids;
- loops closed along the way, reduced to a line each where their history still matters;
- every durable decision, preference, boundary and fact, with the latest version winning when two conflict (note the change when it matters);
- the arc of the period, compressed to its shape, its outcomes and its milestones, with the ids or summary ids that lead to the detail.

Use the same headings:

${SECTIONS}

${RULES(options.timeZone, options.maxTokens)}

Reply with the chapter only, beginning with "## What happened".`;

export const episodeUserPrompt = (options: {
  transcript: string;
  fromId: string;
  toId: string;
  notebook: string;
  previous?: string;
}): string => [
  '<reference>',
  'The assistant\'s notebook as it stands (for orientation only; do not copy it into the episode):',
  `<notebook>\n${options.notebook || '(empty)'}\n</notebook>`,
  options.previous ? `The summary just before this stretch, for continuity:\n<previous>\n${options.previous}\n</previous>` : '',
  '</reference>',
  '',
  `<transcript from="${options.fromId}" to="${options.toId}">`,
  options.transcript,
  '</transcript>',
].filter((line) => line !== '').join('\n');

export const rollupUserPrompt = (episodes: { id: string; span: string; text: string }[]): string =>
  episodes.map((episode) => `<summary id="${episode.id}" span="${episode.span}">\n${episode.text}\n</summary>`).join('\n\n');
