import type { LLMMessage } from '../providers/types.ts';

export interface InputCompactionMetadata {
  unit: 'utf8_bytes_upper_bound';
  configuredMaxUnits: number;
  beforeUnits: number;
  afterUnits: number;
  removedMessages: number;
  removedGroups: number;
}

export interface InputCompactionResult {
  messages: LLMMessage[];
  metadata: InputCompactionMetadata;
}

interface MessageGroup {
  indexes: number[];
  protected: boolean;
}

function messageGroups(messages: LLMMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
  let latestToolGroup = -1;

  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (message.role === 'system') {
      groups.push({ indexes: [index], protected: true });
      index += 1;
      continue;
    }
    if (message.role === 'user') {
      const indexes = [index++];
      while (index < messages.length && messages[index].role !== 'user' && messages[index].role !== 'system') indexes.push(index++);
      groups.push({ indexes, protected: indexes[0] === lastUserIndex || Boolean(message.attachments?.length) });
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const indexes = [index++];
      while (index < messages.length && messages[index].role === 'tool') indexes.push(index++);
      groups.push({ indexes, protected: false });
      latestToolGroup = groups.length - 1;
      continue;
    }
    groups.push({ indexes: [index], protected: false });
    index += 1;
  }

  if (lastUserIndex < 0 && latestToolGroup >= 0) groups[latestToolGroup].protected = true;
  return groups;
}

export function compactMessagesForInputBudget(
  messages: LLMMessage[],
  measureRequestUnits: (messages: LLMMessage[]) => number,
  configuredMaxUnits: number,
): InputCompactionResult {
  const beforeUnits = measureRequestUnits(messages);
  const groups = messageGroups(messages);
  const removed = new Set<number>();
  let afterUnits = beforeUnits;
  let removedGroups = 0;

  for (const group of groups) {
    if (afterUnits <= configuredMaxUnits) break;
    if (group.protected) continue;
    group.indexes.forEach((index) => removed.add(index));
    removedGroups += 1;
    afterUnits = measureRequestUnits(messages.filter((_, index) => !removed.has(index)));
  }

  const compacted = messages.filter((_, index) => !removed.has(index));
  if (afterUnits > configuredMaxUnits) {
    throw new Error(
      `protected model input requires at most ${afterUnits} UTF-8 token units, configured maximum is ${configuredMaxUnits}`,
    );
  }
  return {
    messages: compacted,
    metadata: {
      unit: 'utf8_bytes_upper_bound',
      configuredMaxUnits,
      beforeUnits,
      afterUnits,
      removedMessages: removed.size,
      removedGroups,
    },
  };
}
