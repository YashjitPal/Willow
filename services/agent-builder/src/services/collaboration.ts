import type {
  Workflow,
  WorkflowCollaborationEvent,
  WorkflowCollaborator,
  WorkflowPresence,
  WorkflowReviewAnchor,
  WorkflowReviewThread,
} from '../domain/types.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { newId, nowIso } from '../util/id.ts';
import type { AuthPrincipal } from './governance.ts';
import type { WorkflowService } from './workflows.ts';

const DEFAULT_PRESENCE_TTL_SECONDS = 45;
const MAX_PRESENCE_TTL_SECONDS = 120;
const MAX_REVIEW_BODY_LENGTH = 10_000;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_SELECTED_NODES = 100;
const PRESENCE_SWEEP_INTERVAL_MS = 1_000;

export class CollaborationConflictError extends Error {
  expectedRevision: number;
  current: WorkflowReviewThread;

  constructor(expectedRevision: number, current: WorkflowReviewThread) {
    super(`review thread revision conflict: expected ${expectedRevision}, current revision is ${current.revision}`);
    this.name = 'CollaborationConflictError';
    this.expectedRevision = expectedRevision;
    this.current = current;
  }
}

export class CollaborationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollaborationValidationError';
  }
}

type Subscriber = (event: WorkflowCollaborationEvent) => void;

export class CollaborationService {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly presenceSweepTimers = new Map<string, ReturnType<typeof setInterval>>();
  private closed = false;
  private eventSeq = 0;
  private readonly storage: Storage;
  private readonly workflows: WorkflowService;

  constructor(storage: Storage, workflows: WorkflowService) {
    this.storage = storage;
    this.workflows = workflows;
  }

  private collaborator(access: AuthPrincipal, displayName?: string): WorkflowCollaborator {
    const normalizedName = displayName?.trim();
    if (normalizedName && normalizedName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new CollaborationValidationError(`displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`);
    }
    return {
      subjectId: access.subjectId,
      actorId: access.id,
      role: access.role,
      ...(normalizedName ? { displayName: normalizedName } : {}),
    };
  }

  private emit(workflowId: string, event: Omit<WorkflowCollaborationEvent, 'seq' | 'workflowId' | 'at'>): void {
    if (this.closed) return;
    const full: WorkflowCollaborationEvent = {
      ...event,
      seq: ++this.eventSeq,
      workflowId,
      at: nowIso(),
    };
    const subscribers = this.subscribers.get(workflowId);
    if (!subscribers) return;
    for (const subscriber of [...subscribers]) {
      try { subscriber(structuredClone(full)); }
      catch {
        // Drop broken streams immediately; a disconnected client must not be retried forever.
        subscribers.delete(subscriber);
      }
    }
    if (subscribers.size === 0) {
      this.subscribers.delete(workflowId);
      const timer = this.presenceSweepTimers.get(workflowId);
      if (timer) clearInterval(timer);
      this.presenceSweepTimers.delete(workflowId);
    }
  }

  subscribe(workflowId: string, subscriber: Subscriber): () => void {
    if (this.closed) throw new Error('collaboration service is closed');
    let subscribers = this.subscribers.get(workflowId);
    if (!subscribers) {
      subscribers = new Set();
      this.subscribers.set(workflowId, subscribers);
    }
    subscribers.add(subscriber);
    if (!this.presenceSweepTimers.has(workflowId)) {
      const timer = setInterval(() => { void this.sweepExpiredPresence(workflowId); }, PRESENCE_SWEEP_INTERVAL_MS);
      timer.unref?.();
      this.presenceSweepTimers.set(workflowId, timer);
    }
    return () => {
      subscribers?.delete(subscriber);
      if (subscribers?.size === 0) {
        this.subscribers.delete(workflowId);
        const timer = this.presenceSweepTimers.get(workflowId);
        if (timer) clearInterval(timer);
        this.presenceSweepTimers.delete(workflowId);
      }
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.presenceSweepTimers.values()) clearInterval(timer);
    this.presenceSweepTimers.clear();
    this.subscribers.clear();
  }

  private async sweepExpiredPresence(workflowId: string): Promise<void> {
    try {
      const now = nowIso();
      const rows = await this.storage.list<WorkflowPresence>(COLLECTIONS.workflowPresence, { ref: workflowId });
      for (const row of rows) {
        if (row.doc.expiresAt > now) continue;
        if (await this.storage.compareAndDelete(COLLECTIONS.workflowPresence, row.id, 'expiresAt', row.doc.expiresAt)) {
          this.emit(workflowId, { type: 'presence.left', presence: row.doc });
        }
      }
    } catch {
      // A transient storage failure must not create an unhandled timer rejection.
    }
  }

  private async workflow(workflowId: string, access: AuthPrincipal): Promise<Workflow | undefined> {
    return this.workflows.get(workflowId, access);
  }

  private reviewBody(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new CollaborationValidationError('review body must be a non-empty string');
    const body = value.trim();
    if (body.length > MAX_REVIEW_BODY_LENGTH) throw new CollaborationValidationError(`review body must be at most ${MAX_REVIEW_BODY_LENGTH} characters`);
    return body;
  }

  private reviewAnchor(workflow: Workflow, value: unknown): WorkflowReviewAnchor {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CollaborationValidationError('review anchor must be an object');
    const anchor = value as Record<string, unknown>;
    if (anchor.type === 'canvas') {
      const x = Number(anchor.x);
      const y = Number(anchor.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 10_000_000 || Math.abs(y) > 10_000_000) {
        throw new CollaborationValidationError('canvas anchor x and y must be finite coordinates');
      }
      return { type: 'canvas', x, y };
    }
    if (anchor.type === 'node') {
      const nodeId = typeof anchor.nodeId === 'string' ? anchor.nodeId.trim() : '';
      if (!nodeId || !workflow.draft.nodes.some((node) => node.id === nodeId)) throw new CollaborationValidationError(`review anchor references unknown node '${nodeId}'`);
      const fieldPath = typeof anchor.fieldPath === 'string' ? anchor.fieldPath.trim() : undefined;
      if (fieldPath && fieldPath.length > 512) throw new CollaborationValidationError('anchor fieldPath must be at most 512 characters');
      return { type: 'node', nodeId, ...(fieldPath ? { fieldPath } : {}) };
    }
    if (anchor.type === 'edge') {
      const edgeId = typeof anchor.edgeId === 'string' ? anchor.edgeId.trim() : '';
      if (!edgeId || !workflow.draft.edges.some((edge) => edge.id === edgeId)) throw new CollaborationValidationError(`review anchor references unknown edge '${edgeId}'`);
      return { type: 'edge', edgeId };
    }
    throw new CollaborationValidationError("review anchor type must be 'canvas', 'node', or 'edge'");
  }

  async listThreads(workflowId: string, access: AuthPrincipal, includeResolved = true): Promise<WorkflowReviewThread[] | undefined> {
    if (!await this.workflow(workflowId, access)) return undefined;
    const rows = await this.storage.list<WorkflowReviewThread>(COLLECTIONS.workflowReviewThreads, { ref: workflowId, order: 'asc' });
    return rows.map((row) => row.doc).filter((thread) => includeResolved || thread.status === 'open');
  }

  async createThread(
    workflowId: string,
    input: { body: unknown; anchor: unknown; displayName?: string },
    access: AuthPrincipal,
  ): Promise<WorkflowReviewThread | undefined> {
    const workflow = await this.workflow(workflowId, access);
    if (!workflow) return undefined;
    const now = nowIso();
    const thread: WorkflowReviewThread = {
      id: newId('review'),
      workflowId,
      workspaceId: workflow.workspaceId ?? access.workspaceId,
      anchor: this.reviewAnchor(workflow, input.anchor),
      status: 'open',
      revision: 1,
      draftRevision: workflow.draftRevision,
      messages: [{
        id: newId('reviewmsg', 12),
        body: this.reviewBody(input.body),
        author: this.collaborator(access, input.displayName),
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put(COLLECTIONS.workflowReviewThreads, thread.id, thread, workflowId);
    this.emit(workflowId, { type: 'review.created', thread });
    return thread;
  }

  private async ownedThread(workflowId: string, threadId: string, access: AuthPrincipal): Promise<WorkflowReviewThread | undefined> {
    if (!await this.workflow(workflowId, access)) return undefined;
    const thread = await this.storage.get<WorkflowReviewThread>(COLLECTIONS.workflowReviewThreads, threadId);
    return thread?.workflowId === workflowId
      && (access.authority === 'platform' || thread.workspaceId === access.workspaceId) ? thread : undefined;
  }

  async reply(
    workflowId: string,
    threadId: string,
    input: { body: unknown; expectedRevision: number; displayName?: string },
    access: AuthPrincipal,
  ): Promise<WorkflowReviewThread | undefined> {
    const thread = await this.ownedThread(workflowId, threadId, access);
    if (!thread) return undefined;
    if (thread.revision !== input.expectedRevision) throw new CollaborationConflictError(input.expectedRevision, thread);
    const now = nowIso();
    const updated: WorkflowReviewThread = {
      ...thread,
      revision: thread.revision + 1,
      updatedAt: now,
      messages: [...thread.messages, {
        id: newId('reviewmsg', 12),
        body: this.reviewBody(input.body),
        author: this.collaborator(access, input.displayName),
        createdAt: now,
        updatedAt: now,
      }],
    };
    if (!await this.storage.compareAndSwap(COLLECTIONS.workflowReviewThreads, thread.id, 'revision', thread.revision, updated, workflowId)) {
      const current = await this.storage.get<WorkflowReviewThread>(COLLECTIONS.workflowReviewThreads, thread.id);
      if (!current) return undefined;
      throw new CollaborationConflictError(input.expectedRevision, current);
    }
    this.emit(workflowId, { type: 'review.updated', thread: updated });
    return updated;
  }

  async setStatus(
    workflowId: string,
    threadId: string,
    status: WorkflowReviewThread['status'],
    expectedRevision: number,
    access: AuthPrincipal,
  ): Promise<WorkflowReviewThread | undefined> {
    const thread = await this.ownedThread(workflowId, threadId, access);
    if (!thread) return undefined;
    if (thread.revision !== expectedRevision) throw new CollaborationConflictError(expectedRevision, thread);
    const now = nowIso();
    const updated: WorkflowReviewThread = {
      ...thread,
      status,
      revision: thread.revision + 1,
      updatedAt: now,
      ...(status === 'resolved'
        ? { resolvedAt: now, resolvedBy: this.collaborator(access) }
        : { resolvedAt: undefined, resolvedBy: undefined }),
    };
    if (!await this.storage.compareAndSwap(COLLECTIONS.workflowReviewThreads, thread.id, 'revision', thread.revision, updated, workflowId)) {
      const current = await this.storage.get<WorkflowReviewThread>(COLLECTIONS.workflowReviewThreads, thread.id);
      if (!current) return undefined;
      throw new CollaborationConflictError(expectedRevision, current);
    }
    this.emit(workflowId, { type: 'review.updated', thread: updated });
    return updated;
  }

  async removeThread(workflowId: string, threadId: string, expectedRevision: number, access: AuthPrincipal): Promise<boolean> {
    const thread = await this.ownedThread(workflowId, threadId, access);
    if (!thread) return false;
    const firstAuthor = thread.messages[0]?.author.subjectId;
    if (access.role !== 'admin' && firstAuthor !== access.subjectId) throw new CollaborationValidationError('only the review author or an admin can delete a review thread');
    if (thread.revision !== expectedRevision) throw new CollaborationConflictError(expectedRevision, thread);
    const removed = await this.storage.compareAndDelete(COLLECTIONS.workflowReviewThreads, threadId, 'revision', expectedRevision);
    if (!removed) {
      const current = await this.storage.get<WorkflowReviewThread>(COLLECTIONS.workflowReviewThreads, thread.id);
      if (!current) return false;
      throw new CollaborationConflictError(expectedRevision, current);
    }
    if (removed) this.emit(workflowId, { type: 'review.deleted', threadId });
    return removed;
  }

  private finitePoint(value: unknown, name: string): { x: number; y: number } | undefined {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CollaborationValidationError(`${name} must be an object`);
    const point = value as Record<string, unknown>;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 10_000_000 || Math.abs(y) > 10_000_000) {
      throw new CollaborationValidationError(`${name} x and y must be finite coordinates`);
    }
    return { x, y };
  }

  private presenceId(workflowId: string, access: AuthPrincipal, clientId: string): string {
    return `${workflowId}:${access.subjectId}:${clientId}`;
  }

  async listPresence(workflowId: string, access: AuthPrincipal): Promise<WorkflowPresence[] | undefined> {
    if (!await this.workflow(workflowId, access)) return undefined;
    const now = nowIso();
    const rows = await this.storage.list<WorkflowPresence>(COLLECTIONS.workflowPresence, { ref: workflowId });
    const active: WorkflowPresence[] = [];
    for (const row of rows) {
      if (row.doc.expiresAt > now) active.push(row.doc);
      else if (await this.storage.compareAndDelete(COLLECTIONS.workflowPresence, row.id, 'expiresAt', row.doc.expiresAt)) {
        this.emit(workflowId, { type: 'presence.left', presence: row.doc });
      }
    }
    return active.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
  }

  async heartbeat(
    workflowId: string,
    input: {
      clientId: unknown;
      displayName?: string;
      color?: unknown;
      cursor?: unknown;
      selectedNodeIds?: unknown;
      activeNodeId?: unknown;
      ttlSeconds?: unknown;
    },
    access: AuthPrincipal,
  ): Promise<WorkflowPresence | undefined> {
    const workflow = await this.workflow(workflowId, access);
    if (!workflow) return undefined;
    const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(clientId)) throw new CollaborationValidationError('clientId must be 1-128 letters, numbers, dots, colons, underscores, or hyphens');
    const ttlSeconds = input.ttlSeconds === undefined ? DEFAULT_PRESENCE_TTL_SECONDS : Number(input.ttlSeconds);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > MAX_PRESENCE_TTL_SECONDS) {
      throw new CollaborationValidationError(`ttlSeconds must be an integer between 5 and ${MAX_PRESENCE_TTL_SECONDS}`);
    }
    const selectedNodeIds = input.selectedNodeIds === undefined ? [] : input.selectedNodeIds;
    if (!Array.isArray(selectedNodeIds) || selectedNodeIds.length > MAX_SELECTED_NODES || selectedNodeIds.some((id) => typeof id !== 'string')) {
      throw new CollaborationValidationError(`selectedNodeIds must be an array of at most ${MAX_SELECTED_NODES} strings`);
    }
    const knownNodes = new Set(workflow.draft.nodes.map((node) => node.id));
    const uniqueSelected = [...new Set(selectedNodeIds as string[])];
    if (uniqueSelected.some((id) => !knownNodes.has(id))) throw new CollaborationValidationError('selectedNodeIds contains an unknown node');
    const activeNodeId = typeof input.activeNodeId === 'string' && input.activeNodeId.trim() ? input.activeNodeId.trim() : undefined;
    if (activeNodeId && !knownNodes.has(activeNodeId)) throw new CollaborationValidationError(`activeNodeId references unknown node '${activeNodeId}'`);
    const color = typeof input.color === 'string' && input.color.trim() ? input.color.trim() : undefined;
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new CollaborationValidationError('color must be a six-digit hex color');
    const cursor = this.finitePoint(input.cursor, 'cursor');
    const now = new Date();
    const presence: WorkflowPresence = {
      workflowId,
      workspaceId: workflow.workspaceId ?? access.workspaceId,
      clientId,
      collaborator: this.collaborator(access, input.displayName),
      ...(cursor ? { cursor } : {}),
      selectedNodeIds: uniqueSelected,
      ...(activeNodeId ? { activeNodeId } : {}),
      ...(color ? { color } : {}),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    };
    await this.storage.put(COLLECTIONS.workflowPresence, this.presenceId(workflowId, access, clientId), presence, workflowId);
    this.emit(workflowId, { type: 'presence.updated', presence });
    return presence;
  }

  async leave(workflowId: string, clientId: string, access: AuthPrincipal): Promise<boolean | undefined> {
    if (!await this.workflow(workflowId, access)) return undefined;
    const id = this.presenceId(workflowId, access, clientId);
    const presence = await this.storage.get<WorkflowPresence>(COLLECTIONS.workflowPresence, id);
    if (!presence) return false;
    const removed = await this.storage.delete(COLLECTIONS.workflowPresence, id);
    if (removed) this.emit(workflowId, { type: 'presence.left', presence });
    return removed;
  }
}
