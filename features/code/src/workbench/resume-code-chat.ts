/**
 * Reading a Code chat back off disk.
 *
 * The workbench only ever *wrote* the inbox copy of a Code conversation
 * (`saveLocalFSChat` in `WorkbenchSidebar`); nothing on the Code side read one
 * back, which is why reopening such a chat from the sidebar's Recents used to
 * land in the normal chat UI. This is the read half of that contract, kept here
 * rather than inline because it is pure and is the one place that decides what
 * survives a round trip through the file.
 *
 * Defensive in the same way as `features/chat/src/chat-message.ts`: the file is
 * in the user's own folder, it is editable, and it may have been written by an
 * older build. Every field is re-checked and a malformed message is dropped
 * rather than repaired.
 */

/**
 * Structurally the workbench's own `ChatMessage` (declared inside
 * `WorkbenchSidebar`, so it cannot be imported). Kept in sync by hand: a field
 * added there and not here is simply absent from a reopened chat.
 */
export interface ResumedCodeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingTime?: number;
  hasCodeChanges?: boolean;
  filesSnapshot?: Record<string, string>;
  timestamp: number;
  attachments?: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[];
  designNodeId?: string;
}

const ATTACHMENT_TYPES = new Set(['image', 'text', 'file']);

const sanitizeAttachments = (value: unknown): ResumedCodeMessage['attachments'] => {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .filter((entry: any) =>
      entry
      && typeof entry === 'object'
      && ATTACHMENT_TYPES.has(entry.type)
      && typeof entry.data === 'string'
      && entry.data.length > 0)
    .map((entry: any) => ({
      type: entry.type as 'image' | 'text' | 'file',
      mimeType: typeof entry.mimeType === 'string' && entry.mimeType ? entry.mimeType : 'application/octet-stream',
      data: entry.data as string,
      ...(typeof entry.name === 'string' && entry.name ? { name: entry.name } : {}),
    }));
  return attachments.length ? attachments : undefined;
};

/**
 * A snapshot is a whole codebase keyed by path, so one bad entry must not cost
 * the rest of the tree — non-string contents are dropped individually.
 */
const sanitizeFilesSnapshot = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const snapshot: Record<string, string> = {};
  for (const [path, content] of Object.entries(value as Record<string, unknown>)) {
    if (path && typeof content === 'string') snapshot[path] = content;
  }
  return Object.keys(snapshot).length ? snapshot : undefined;
};

/**
 * Turn a saved chat body into workbench messages.
 *
 * Two fields are deliberately *not* carried across:
 *
 * - `isGenerating` / `isThinking`, so a reopened chat never resumes mid-turn —
 *   the same rule `serializeChatMessage` applies on the chat side.
 * - `codexTurnId`, which joins a message to the Agent harness's tool calls in
 *   `agent-store`. That store is in-memory only and is empty on a fresh mount,
 *   so a kept id would point at nothing; dropping it is what makes the message
 *   fall back to plain rendering instead of an empty agent timeline.
 */
export const sanitizeResumedCodeMessages = (value: unknown): ResumedCodeMessage[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry: any) =>
      entry
      && typeof entry === 'object'
      && (entry.role === 'user' || entry.role === 'assistant')
      && typeof entry.content === 'string')
    .map((entry: any, index: number) => {
      const message: ResumedCodeMessage = {
        // The id only has to be unique within the thread (React keys, and the
        // edit/retry handlers look messages up by it), so a missing one is
        // synthesised from its position rather than costing the message.
        id: typeof entry.id === 'string' && entry.id ? entry.id : `resumed_${index}`,
        role: entry.role,
        content: entry.content,
        timestamp: Number.isFinite(entry.timestamp) && Number(entry.timestamp) > 0
          ? Math.floor(Number(entry.timestamp))
          : 0,
      };
      if (Number.isFinite(entry.thinkingTime) && Number(entry.thinkingTime) > 0) {
        message.thinkingTime = Number(entry.thinkingTime);
      }
      if (entry.hasCodeChanges === true) message.hasCodeChanges = true;
      const filesSnapshot = sanitizeFilesSnapshot(entry.filesSnapshot);
      if (filesSnapshot) message.filesSnapshot = filesSnapshot;
      const attachments = sanitizeAttachments(entry.attachments);
      if (attachments) message.attachments = attachments;
      if (typeof entry.designNodeId === 'string' && entry.designNodeId) {
        message.designNodeId = entry.designNodeId;
      }
      return message;
    })
    // An entry with nothing to show would render an empty bubble. Checked after
    // the mapping so that a message whose only content is an attachment or a
    // file snapshot still counts.
    .filter((message) =>
      message.content.trim().length > 0
      || !!message.attachments?.length
      || !!message.filesSnapshot);
};

/**
 * The newest file snapshot in a reopened conversation, or null.
 *
 * Normally there is none: promotion (the first file mutation) moves the chat
 * into its project folder and deletes the inbox copy, so anything still in
 * Recents predates any generated code. The exception is narrow but real — the
 * promote branch bails out until `projectName` resolves, so a chat abandoned
 * inside that window keeps both its marker and a snapshot-bearing message.
 */
export const latestResumedSnapshot = (messages: ResumedCodeMessage[]): Record<string, string> | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const snapshot = messages[index].filesSnapshot;
    if (snapshot && Object.keys(snapshot).length > 0) return snapshot;
  }
  return null;
};
