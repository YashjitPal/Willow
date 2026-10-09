import { approvalDecision, approvalOutcome } from '../harness/tools/computer-tools';
import type { DotItem, DotThread } from '../harness/thread/thread-types';

export type CommandState = 'pending' | 'running' | 'background' | 'done' | 'failed' | 'declined' | 'withdrawn';

/** Where a command ran or would run, as the user reads it: the folder it was given, with Windows separators on Windows. */
export const commandFolder = (approval: NonNullable<DotItem['approval']>): string => {
  const windows = /^[A-Za-z]:/.test(approval.root);
  if (approval.cwd === '.') return approval.root;
  const separator = windows ? '\\' : '/';
  return `${approval.root.replace(/[\\/]+$/, '')}${separator}${approval.cwd.split('/').join(separator)}`;
};

export const commandState = (thread: DotThread, item: DotItem): CommandState => {
  const decision = approvalDecision(thread, item.id);
  if (!decision) return 'pending';
  if (decision.approvalStep === 'declined' || decision.approvalStep === 'withdrawn') return decision.approvalStep;
  const outcome = approvalOutcome(thread, item.id);
  if (outcome) return outcome.failed ? 'failed' : 'done';
  return decision.approvalStep === 'started' ? 'background' : 'running';
};

/**
 * What a command's outcome says, split into its first line and the rest: outcomes read
 * "`command` (id) exited with code 0.\nOutput: …" or "Background job `command` (id) …", and only what follows matters.
 */
export const commandReport = (thread: DotThread, item: DotItem): { summary: string; details: string } | null => {
  const outcome = approvalOutcome(thread, item.id);
  if (!outcome || !item.approval) return null;
  const prefix = `\`${item.approval.command}\` (${item.id}) `;
  const raw = outcome.text.replace(/^Background job /, '');
  const report = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  const breakAt = report.indexOf('\n');
  const summary = breakAt === -1 ? report : report.slice(0, breakAt);
  return { summary: summary.charAt(0).toUpperCase() + summary.slice(1), details: breakAt === -1 ? '' : report.slice(breakAt + 1) };
};

/** When a command's run ended, or undefined while it waits or runs. */
export const commandEndedAt = (thread: DotThread, item: DotItem): number | undefined =>
  approvalOutcome(thread, item.id)?.at ?? (() => {
    const decision = approvalDecision(thread, item.id);
    return decision && (decision.approvalStep === 'declined' || decision.approvalStep === 'withdrawn') ? decision.at : undefined;
  })();

export interface CommandGroup {
  /** The first command's id, which names the group's page. */
  key: string;
  items: DotItem[];
  at: number;
}

/**
 * The commands the bot ran, a group for each stretch between messages, newest first: a message from either side
 * closes the stretch, so the commands behind one reply stay together.
 */
export const commandGroups = (thread: Pick<DotThread, 'items'> | undefined): CommandGroup[] => {
  if (!thread) return [];
  const groups: CommandGroup[] = [];
  let current: CommandGroup | null = null;
  for (const item of thread.items) {
    if ((item.kind === 'dot' || item.kind === 'user') && item.text.trim() && !item.streaming) {
      current = null;
      continue;
    }
    if (item.kind !== 'approval' || !item.approval) continue;
    if (!current) {
      current = { key: item.id, items: [], at: item.at };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups.reverse();
};

/** Commands the chat still shows: those waiting for the user's answer. Everything after lives in Activity. */
export const decidedCommands = (thread: Pick<DotThread, 'items'>): Set<string> => {
  const decided = new Set<string>();
  for (const item of thread.items) {
    if (item.kind === 'event' && item.event === 'approval' && item.ref && item.approvalStep !== 'finished') decided.add(item.ref);
  }
  return decided;
};

/** The group's line in Activity: what it ran and how that went, in a few words. */
export const groupSummary = (thread: DotThread, group: CommandGroup): { title: string; status: string; busy: boolean } => {
  const states = group.items.map((item) => commandState(thread, item));
  const count = (state: CommandState) => states.filter((candidate) => candidate === state).length;
  const busy = count('running') + count('background') > 0;
  const first = group.items[0]?.approval?.command.split('\n')[0]?.trim() ?? '';
  const title = group.items.length === 1 ? first : `Ran ${group.items.length} commands`;
  const parts: string[] = [];
  if (count('pending')) parts.push(count('pending') === 1 && group.items.length === 1 ? 'Waiting for you' : `${count('pending')} waiting for you`);
  if (count('running')) parts.push(count('running') === 1 && group.items.length === 1 ? 'Running' : `${count('running')} running`);
  if (count('background')) parts.push(group.items.length === 1 ? 'Running in the background' : `${count('background')} in the background`);
  if (count('failed')) parts.push(group.items.length === 1 ? 'Ran with a problem' : `${count('failed')} with a problem`);
  if (count('declined')) parts.push(group.items.length === 1 ? 'You declined it' : `${count('declined')} declined`);
  if (count('withdrawn') && group.items.length === 1) parts.push('Withdrawn');
  if (!parts.length) parts.push(group.items.length === 1 ? 'Ran' : 'All finished');
  return { title, status: parts.join(' · '), busy };
};
