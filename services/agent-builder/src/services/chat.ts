/**
 * ChatKit-style chat sessions: mint client secrets bound to a workflow (+
 * pinned version + injected state variables), manage threads, and run one
 * workflow execution per user turn with rolling conversation history.
 */

import type { AppConfig } from '../config.ts';
import type {
  ChatDeployment,
  ChatSession,
  ChatThread,
  ChatThreadMessage,
  JsonObject,
  ProviderKeys,
  Run,
  RunAttachment,
} from '../domain/types.ts';
import type { RunEngine } from '../engine/executor.ts';
import type { EngineCheckpoint } from '../engine/context.ts';
import { COLLECTIONS, type DeploymentRunAdmission, type DeploymentRunAdmissionResult, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { DeploymentService } from './deployments.ts';

function issueSecret(sessionId: string): { plaintext: string; hash: string; salt: string } {
  const plaintext = `chatkit_token_${sessionId}_${randomBytes(24).toString('base64url')}`;
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(plaintext, salt, 32).toString('base64url');
  return { plaintext, hash, salt };
}

function secretSessionId(secret: string): string | undefined {
  return /^chatkit_token_(cks_[a-z0-9]+)_/.exec(secret)?.[1];
}

function attachmentSignature(attachments: RunAttachment[] | undefined): string {
  return createHash('sha256').update(JSON.stringify((attachments ?? []).map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    bytes: attachment.bytes,
    sha256: attachment.sha256 ?? createHash('sha256').update(attachment.contentBase64).digest('hex'),
  })))).digest('hex');
}

export class ChatService {
  private storage: Storage;
  private engine: RunEngine;
  private config: AppConfig;
  private deployments: DeploymentService;
  private watchedRuns = new Set<string>();
  private threadLocks = new Map<string, Promise<void>>();
  private sessionLocks = new Map<string, Promise<void>>();

  private async withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.sessionLocks.set(sessionId, queued);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.sessionLocks.get(sessionId) === queued) this.sessionLocks.delete(sessionId);
    }
  }

  constructor(storage: Storage, engine: RunEngine, config: AppConfig, deployments: DeploymentService) {
    this.storage = storage;
    this.engine = engine;
    this.config = config;
    this.deployments = deployments;
  }

  private async admitDeploymentRunWithRecovery(input: DeploymentRunAdmission): Promise<DeploymentRunAdmissionResult> {
    let admission = await this.storage.admitDeploymentRun(input);
    if (admission.status !== 'rejected') return admission;

    // A crash between reserving quota and creating/binding the run can leave a
    // stale admission behind. Reconcile only when capacity is denied, then
    // retry through the storage driver's atomic admission path.
    await this.deployments.reconcileRunAdmissions();
    admission = await this.storage.admitDeploymentRun(input);
    return admission;
  }

  private async withThreadLock<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadLocks.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.threadLocks.set(threadId, queued);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.threadLocks.get(threadId) === queued) this.threadLocks.delete(threadId);
    }
  }

  private async assertSessionSecret(session: ChatSession, secret: string | undefined, origin?: string): Promise<void> {
    if (session.origin && origin !== session.origin) throw new Error('invalid chat session origin');
    // A session keeps the origin it was minted for, but a deployment may also
    // tighten its allow-list after the session was issued. Re-check the
    // current deployment policy on every authenticated operation so existing
    // client secrets cannot outlive an origin revocation. Legacy sessions may
    // not have an origin snapshot; those are still constrained by the current
    // deployment policy when one is configured.
    let deploymentStatus: ChatDeployment['status'] | 'missing' | undefined;
    if (session.deploymentId) {
      const deployment = await this.deployments.get(session.deploymentId);
      deploymentStatus = deployment?.status ?? 'missing';
      const allowedOrigins = deployment?.allowedOrigins;
      if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0 && (!origin || !allowedOrigins.includes(origin))) {
        throw new Error(`origin '${origin ?? '(missing)'}' is not allowed for deployment '${session.deploymentId}'`);
      }
    }
    if (!secret) throw new Error('invalid chat session secret');
    let valid = false;
    if (session.clientSecretHash && session.clientSecretSalt) {
      const expected = Buffer.from(session.clientSecretHash, 'base64url');
      const actual = scryptSync(secret, session.clientSecretSalt, expected.length);
      valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    } else if (session.clientSecret) {
      const expected = Buffer.from(session.clientSecret);
      const actual = Buffer.from(secret);
      valid = actual.length === expected.length && timingSafeEqual(actual, expected);
      if (valid) {
        const migrated = issueSecret(session.id);
        const salt = migrated.salt;
        session.clientSecretSalt = salt;
        session.clientSecretHash = scryptSync(secret, salt, 32).toString('base64url');
        session.secretVersion = 1;
        delete session.clientSecret;
        await this.storage.put(COLLECTIONS.sessions, session.id, session, session.workflowId);
      }
    }
    if (!valid) throw new Error('invalid chat session secret');
    if (session.deploymentId && deploymentStatus !== 'active') {
      throw new Error(`deployment '${session.deploymentId}' is ${deploymentStatus ?? 'missing'}`);
    }
  }

  async authenticateSession(id: string, secret?: string, origin?: string): Promise<ChatSession | undefined> {
    const session = await this.getSession(id);
    if (!session) return undefined;
    await this.assertSessionSecret(session, secret, origin);
    if (session.status !== 'active') throw new Error(`session is ${session.status}`);
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      session.status = 'expired';
      await this.storage.put(COLLECTIONS.sessions, session.id, session, session.workflowId);
      throw new Error('session is expired');
    }
    return session;
  }

  async authenticateSessionOwner(id: string, secret?: string, origin?: string): Promise<ChatSession | undefined> {
    const session = await this.getSession(id);
    if (!session) return undefined;
    await this.assertSessionSecret(session, secret, origin);
    return session;
  }

  async createSession(input: {
    workflowId: string;
    /** 0 = explicit draft preview, -1/undefined = latest published. */
    version?: number;
    user: string;
    stateVariables?: JsonObject;
    expiresAfterSeconds?: number;
    deploymentId?: string;
    environment?: string;
    origin?: string;
    cohortKey?: string;
  }): Promise<ChatSession> {
    const wf = await this.storage.get<{ latestVersion: number }>(
      COLLECTIONS.workflows,
      input.workflowId,
    );
    if (!wf) throw new Error(`workflow '${input.workflowId}' not found`);
    const deployment = await this.deployments.resolve(input.workflowId, { deploymentId: input.deploymentId, environment: input.environment });
    if ((input.deploymentId || input.environment) && !deployment) throw new Error('deployment not found');
    if (deployment && deployment.status !== 'active') throw new Error(`deployment '${deployment.id}' is ${deployment.status}`);
    if (deployment?.allowedOrigins.length && (!input.origin || !deployment.allowedOrigins.includes(input.origin))) throw new Error(`origin '${input.origin ?? '(missing)'}' is not allowed for deployment '${deployment.id}'`);
    if (deployment) {
      const sessions = (await this.storage.list<ChatSession>(COLLECTIONS.sessions, { ref: input.workflowId })).map((row) => row.doc).filter((session) => session.deploymentId === deployment.id);
      const now = Date.now();
      if (sessions.filter((session) => session.status === 'active' && new Date(session.expiresAt).getTime() > now).length >= deployment.maxActiveSessions) throw new Error('deployment active session limit exceeded');
      if (sessions.filter((session) => now - new Date(session.createdAt).getTime() < 60_000).length >= deployment.sessionRateLimitPerMinute) throw new Error('deployment session rate limit exceeded');
    }
    const sessionId = ids.session();
    const cohortKey = input.cohortKey || (input.user && input.user !== 'anonymous' ? input.user : sessionId);
    const resolvedRelease = deployment ? await this.deployments.resolveRelease(deployment, cohortKey) : undefined;
    const requestedVersion = resolvedRelease ? resolvedRelease.workflowVersion : input.version ?? -1;
    if (!Number.isInteger(requestedVersion) || requestedVersion < -1) {
      throw new Error('workflow version must be -1 (latest), 0 (draft), or a positive published version');
    }
    const version = requestedVersion === -1 ? wf.latestVersion : requestedVersion;
    if (requestedVersion === -1 && version === 0) {
      throw new Error(`workflow '${input.workflowId}' has no published versions`);
    }
    if (version > 0) {
      const published = await this.storage.get(COLLECTIONS.versions, `${input.workflowId}@${version}`);
      if (!published) throw new Error(`workflow '${input.workflowId}' has no published version ${version}`);
    }

    const ttl = Math.min(
      Math.max(60, input.expiresAfterSeconds ?? this.config.sessionTtlSeconds),
      24 * 3600,
    );
    const credential = issueSecret(sessionId);
    const session: ChatSession = {
      id: sessionId,
      workflowId: input.workflowId,
      workflowVersion: version,
      deploymentId: deployment?.id,
      deploymentReleaseId: resolvedRelease?.id,
      deploymentRevision: deployment?.revision,
      origin: deployment ? input.origin : undefined,
      deployment: {
        selection: deployment ? 'deployment' : requestedVersion === -1 ? 'latest' : version === 0 ? 'draft' : 'pinned',
        source: version === 0 ? 'draft' : 'published',
        requestedVersion: requestedVersion === -1 ? 'latest' : requestedVersion,
        resolvedVersion: version,
        resolvedAt: nowIso(),
        deploymentId: deployment?.id,
        environment: deployment?.environment,
        releaseId: resolvedRelease?.id,
        deploymentRevision: deployment?.revision,
        route: deployment ? (deployment.candidateReleaseId && deployment.candidateReleaseId === resolvedRelease?.id ? 'candidate' : 'active') : undefined,
        candidateTrafficPercent: deployment?.candidateTrafficPercent,
        cohortKeyHash: deployment ? createHash('sha256').update(cohortKey).digest('hex') : undefined,
      },
      user: input.user || 'anonymous',
      stateVariables: input.stateVariables,
      clientSecretHash: credential.hash,
      clientSecretSalt: credential.salt,
      secretVersion: 1,
      status: 'active',
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      createdAt: nowIso(),
    };
    if (deployment) {
      let stored = false;
      for (let attempt = 0; attempt < 12 && !stored; attempt++) {
        const current = await this.deployments.get(deployment.id);
        if (!current || current.status !== 'active') throw new Error(`deployment '${deployment.id}' is ${current?.status ?? 'missing'}`);
        if (current.allowedOrigins.length && (!input.origin || !current.allowedOrigins.includes(input.origin))) throw new Error(`origin '${input.origin ?? '(missing)'}' is not allowed for deployment '${current.id}'`);
        const sessions = (await this.storage.list<ChatSession>(COLLECTIONS.sessions, { ref: input.workflowId })).map((row) => row.doc).filter((item) => item.deploymentId === current.id);
        const now = Date.now();
        if (sessions.filter((item) => item.status === 'active' && new Date(item.expiresAt).getTime() > now).length >= current.maxActiveSessions) throw new Error('deployment active session limit exceeded');
        if (sessions.filter((item) => now - new Date(item.createdAt).getTime() < 60_000).length >= current.sessionRateLimitPerMinute) throw new Error('deployment session rate limit exceeded');
        const release = await this.deployments.resolveRelease(current, cohortKey);
        session.workflowVersion = release.workflowVersion;
        session.deploymentReleaseId = release.id;
        session.deploymentRevision = current.revision;
        session.deployment.resolvedVersion = release.workflowVersion;
        session.deployment.resolvedAt = nowIso();
        session.deployment.releaseId = release.id;
        session.deployment.deploymentRevision = current.revision;
        session.deployment.route = current.candidateReleaseId && current.candidateReleaseId === release.id ? 'candidate' : 'active';
        session.deployment.candidateTrafficPercent = current.candidateTrafficPercent;
        const admission = await this.storage.admitDeploymentSession({ deploymentId: current.id, workflowId: input.workflowId, expectedMutationRevision: current.mutationRevision, expectedReleaseId: release.id, origin: input.origin, now: new Date(now).toISOString(), rateWindowStart: new Date(now - 60_000).toISOString(), sessionId: session.id, session });
        if (admission.status === 'inserted') stored = true;
        else if (admission.status === 'revision_conflict' || (admission.status === 'rejected' && admission.reason === 'release_conflict')) continue;
        else if (admission.status === 'id_collision') throw new Error('chat session id collision; retry');
        else if (admission.reason === 'active_limit') throw new Error('deployment active session limit exceeded');
        else if (admission.reason === 'rate_limit') throw new Error('deployment session rate limit exceeded');
        else if (admission.reason === 'origin_denied') throw new Error(`origin '${input.origin ?? '(missing)'}' is not allowed for deployment '${current.id}'`);
        else throw new Error(`deployment '${current.id}' is unavailable`);
      }
      if (!stored) throw new Error('deployment changed repeatedly while creating the session; retry');
    } else {
      await this.storage.put(COLLECTIONS.sessions, session.id, session, input.workflowId);
    }
    return { ...session, clientSecret: credential.plaintext };
  }

  async getSession(id: string): Promise<ChatSession | undefined> {
    return this.storage.get<ChatSession>(COLLECTIONS.sessions, id);
  }

  async requireActiveSession(idOrSecret: string): Promise<ChatSession> {
    let session = await this.getSession(idOrSecret);
    const presentedSecret = session ? undefined : idOrSecret;
    if (!session) {
      const id = secretSessionId(idOrSecret);
      if (id) session = await this.getSession(id);
    }
    if (!session) throw new Error('session not found');
    if (presentedSecret) await this.assertSessionSecret(session, presentedSecret);
    if (session.status !== 'active') throw new Error(`session is ${session.status}`);
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      session.status = 'expired';
      await this.storage.put(COLLECTIONS.sessions, session.id, session, session.workflowId);
      throw new Error('session is expired');
    }
    return session;
  }

  async cancelSession(id: string, secret?: string, origin?: string): Promise<ChatSession | undefined> {
    return this.withSessionLock(id, async () => {
      const session = await this.getSession(id);
      if (!session) return undefined;
      await this.assertSessionSecret(session, secret, origin);
      session.status = 'cancelled';
      await this.storage.put(COLLECTIONS.sessions, session.id, session, session.workflowId);
      const threads = await this.listThreadsRaw(session.id);
      const runIds = new Set(threads.flatMap((thread) => thread.messages.map((message) => message.runId).filter((runId): runId is string => Boolean(runId))));
      await Promise.all([...runIds].map(async (runId) => {
        const run = await this.engine.getRun(runId);
        if (run && ['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug'].includes(run.status)) {
          await this.engine.cancelRun(runId);
        }
      }));
      return session;
    });
  }

  async rotateSessionSecret(id: string, secret?: string, origin?: string): Promise<{ session: ChatSession; clientSecret: string } | undefined> {
    const session = await this.getSession(id);
    if (!session) return undefined;
    await this.assertSessionSecret(session, secret, origin);
    if (session.status !== 'active') throw new Error(`session is ${session.status}`);
    const credential = issueSecret(session.id);
    session.clientSecretHash = credential.hash;
    session.clientSecretSalt = credential.salt;
    session.secretVersion = 1;
    delete session.clientSecret;
    await this.storage.put(COLLECTIONS.sessions, session.id, session, session.workflowId);
    return { session, clientSecret: credential.plaintext };
  }

  async createThread(sessionId: string, secret?: string, origin?: string): Promise<ChatThread> {
    const session = await this.requireActiveSession(sessionId);
    await this.assertSessionSecret(session, secret, origin);
    const thread: ChatThread = {
      id: ids.thread(),
      sessionId: session.id,
      deploymentId: session.deploymentId,
      deploymentReleaseId: session.deploymentReleaseId,
      deploymentRevision: session.deploymentRevision,
      workflowId: session.workflowId,
      messages: [],
      state: session.stateVariables ? structuredClone(session.stateVariables) : undefined,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.threads, thread.id, thread, session.id);
    return thread;
  }

  private async listThreadsRaw(sessionId: string): Promise<ChatThread[]> {
    const rows = await this.storage.list<ChatThread>(COLLECTIONS.threads, { ref: sessionId });
    return rows.map((r) => r.doc);
  }

  async listThreads(sessionId: string, secret?: string, origin?: string): Promise<ChatThread[]> {
    const session = await this.requireActiveSession(sessionId);
    await this.assertSessionSecret(session, secret, origin);
    return this.listThreadsRaw(session.id);
  }

  async getThread(threadId: string): Promise<ChatThread | undefined> {
    return this.storage.get<ChatThread>(COLLECTIONS.threads, threadId);
  }

  /**
   * Threads persist the deployment pin that was selected when they were
   * created.  Older records may omit these fields, so those remain compatible
   * with their legacy session; modern records must never be rebound to a
   * different deployment/release/workflow through a stale or corrupted row.
   */
  private threadMatchesSession(thread: ChatThread, session: ChatSession): boolean {
    if (thread.sessionId !== session.id || thread.workflowId !== session.workflowId) return false;
    if (thread.deploymentId !== undefined && thread.deploymentId !== session.deploymentId) return false;
    if (thread.deploymentReleaseId !== undefined && thread.deploymentReleaseId !== session.deploymentReleaseId) return false;
    if (thread.deploymentRevision !== undefined && thread.deploymentRevision !== session.deploymentRevision) return false;
    return true;
  }

  async getThreadAuthorized(threadId: string, secret?: string, origin?: string): Promise<ChatThread | undefined> {
    const thread = await this.getThread(threadId);
    if (!thread) return undefined;
    const session = await this.requireActiveSession(thread.sessionId);
    await this.assertSessionSecret(session, secret, origin);
    if (!this.threadMatchesSession(thread, session)) return undefined;
    return thread;
  }

  /**
   * One chat turn: append the user message, launch a run seeded with the
   * thread's history + rolling state, and finalize the thread when the run
   * settles. Returns the run (stream events via /runs/:id/events).
   */
  async sendMessage(
    threadId: string,
    text: string,
    requestKeys?: ProviderKeys,
    secret?: string,
    idempotencyKey?: string,
    origin?: string,
    attachments: RunAttachment[] = [],
  ): Promise<{ thread: ChatThread; run: Run }> {
    const thread = await this.getThread(threadId);
    if (!thread) throw new Error(`thread '${threadId}' not found`);
    return this.withSessionLock(thread.sessionId, () =>
      this.withThreadLock(threadId, () => this.sendMessageLocked(threadId, text, requestKeys, secret, idempotencyKey, origin, attachments)),
    );
  }

  private async sendMessageLocked(
    threadId: string,
    text: string,
    requestKeys?: ProviderKeys,
    secret?: string,
    idempotencyKey?: string,
    origin?: string,
    attachments: RunAttachment[] = [],
  ): Promise<{ thread: ChatThread; run: Run }> {
    let thread = await this.getThread(threadId);
    if (!thread) throw new Error(`thread '${threadId}' not found`);
    const session = await this.requireActiveSession(thread.sessionId);
    await this.assertSessionSecret(session, secret, origin);
    if (!this.threadMatchesSession(thread, session)) throw new Error(`thread '${threadId}' not found`);
    const key = idempotencyKey?.trim();
    if (idempotencyKey !== undefined && !key) throw new Error('invalid idempotency key: value cannot be blank');
    if (key) {
      const priorMessage = thread.messages.find((message) => message.role === 'user' && message.idempotencyKey === key);
      if (priorMessage) {
        if (priorMessage.content !== text || attachmentSignature(priorMessage.attachments) !== attachmentSignature(attachments)) throw new Error('idempotency key was already used with a different chat message');
        const priorRun = priorMessage.runId ? await this.engine.getRun(priorMessage.runId) : undefined;
        if (!priorRun) throw new Error('idempotency request is still in progress; retry shortly');
        return { thread, run: priorRun };
      }
    }

    // One turn at a time per thread: a concurrent second message would fork
    // the conversation state (its run seeds from pre-turn history/state).
    const lastUser = [...thread.messages].reverse().find((m) => m.role === 'user');
    if (lastUser?.runId) {
      const prior = await this.engine.getRun(lastUser.runId);
      if (
        prior &&
        ['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug'].includes(prior.status)
      ) {
        throw new Error(
          `previous turn is still in progress (run ${prior.id}, status ${prior.status}); ` +
          `wait for it to settle or cancel it first`,
        );
      }
      const priorAssistant = thread.messages.find((message) => message.role === 'assistant' && message.runId === prior?.id);
      if (prior && ['completed', 'failed', 'cancelled'].includes(prior.status) && priorAssistant?.status !== 'completed' && priorAssistant?.status !== 'failed' && priorAssistant?.status !== 'cancelled') {
        await this.finalizeTurnLocked(thread.id, prior.id, prior.status === 'completed');
        thread = (await this.getThread(threadId)) ?? thread;
      }
    }

    const userMsg: ChatThreadMessage = {
      id: ids.message(),
      role: 'user',
      content: text,
      ...(attachments.length ? { attachments: structuredClone(attachments) } : {}),
      idempotencyKey: key,
      at: nowIso(),
    };

    const priorHistory = thread.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.attachments?.length ? { attachments: structuredClone(m.attachments) } : {}),
      at: m.at,
    }));

    const runIdempotencyKey = key ? `chat:${thread.id}:${key}` : undefined;
    const admissionSignature = createHash('sha256').update(`${thread.id}\0${text}\0${attachmentSignature(attachments)}`).digest('hex');
    const admissionId = session.deploymentId
      ? key
        ? `dra_${createHash('sha256').update(`${session.deploymentId}\0${thread.id}\0${key}`).digest('hex').slice(0, 32)}`
        : ids.deploymentRunAdmission()
      : undefined;
    let insertedAdmission = false;
    if (session.deploymentId && admissionId) {
      const attachmentKinds = [...attachments, ...priorHistory.flatMap((message) => message.attachments ?? [])]
        .map((attachment) => attachment.kind ?? 'unknown');
      const reservation = await this.deployments.runReservation(session.deploymentId, session.workflowVersion, {
        attachmentKinds,
      });
      const now = new Date();
      const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
      const admission = await this.admitDeploymentRunWithRecovery({
        deploymentId: session.deploymentId,
        workflowId: session.workflowId,
        deploymentReleaseId: session.deploymentReleaseId,
        admissionId,
        signature: admissionSignature,
        now: now.toISOString(),
        rateWindowStart: new Date(now.getTime() - 60_000).toISOString(),
        dayWindowStart: dayStart.toISOString(),
        reservedTokens: reservation.tokens,
        reservedEstimatedCostUsd: reservation.estimatedCostUsd,
      });
      insertedAdmission = admission.status === 'inserted';
      if (admission.status === 'idempotency_conflict') throw new Error('idempotency key was already used with a different chat message');
      if (admission.status === 'rejected') {
        if (admission.reason === 'concurrent_limit') throw new Error('deployment concurrent run limit exceeded');
        if (admission.reason === 'rate_limit') throw new Error('deployment run rate limit exceeded');
        if (admission.reason === 'daily_limit') throw new Error('deployment daily run limit exceeded');
        if (admission.reason === 'token_limit') throw new Error('deployment run token limit exceeded');
        if (admission.reason === 'cost_limit') throw new Error('deployment run cost limit exceeded');
        if (admission.reason === 'unpriced_cost') throw new Error('deployment run cost limit exceeded because prior usage was unpriced');
        throw new Error(`deployment '${session.deploymentId}' is unavailable`);
      }
    }

    let run: Run;
    try {
      run = await this.engine.createRun({
        workflowId: session.workflowId,
        version: session.workflowVersion,
        sessionId: session.id,
        deploymentId: session.deploymentId,
        deploymentReleaseId: session.deploymentReleaseId,
        deploymentRevision: session.deploymentRevision,
        deploymentRunAdmissionId: admissionId,
        requestKeys,
        idempotencyKey: runIdempotencyKey,
        input: {
          input_as_text: text,
          history: priorHistory,
          state_variables: thread.state ?? session.stateVariables,
          ...(attachments.length ? { attachments: structuredClone(attachments) } : {}),
        },
      });
    } catch (error) {
      if (insertedAdmission && session.deploymentId && admissionId) {
        await this.storage.releaseDeploymentRun(admissionId, session.deploymentId, admissionSignature);
      }
      throw error;
    }
    if (session.deploymentId && admissionId && !await this.storage.bindDeploymentRun(admissionId, session.deploymentId, admissionSignature, run.id)) {
      throw new Error('deployment run admission could not be bound to the created run');
    }

    userMsg.runId = run.id;
    thread.messages.push(userMsg, {
      id: ids.message(),
      role: 'assistant',
      content: '',
      runId: run.id,
      status: 'in_progress',
      at: nowIso(),
    });
    thread.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.threads, thread.id, thread, session.id);

    this.watchRun(thread.id, run.id);

    return { thread, run };
  }

  private watchRun(threadId: string, runId: string): void {
    if (this.watchedRuns.has(runId)) return;
    this.watchedRuns.add(runId);
    const unsubscribe = this.engine.subscribe(runId, (event) => {
      if (event.type === 'llm.delta') {
        void this.appendAssistantDelta(threadId, runId, event.delta);
      }
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        unsubscribe();
        this.watchedRuns.delete(runId);
        void this.finalizeTurn(threadId, runId, event.type === 'run.completed');
      }
    });
    void this.syncAssistantFromRun(threadId, runId, unsubscribe);
  }

  private async syncAssistantFromRun(threadId: string, runId: string, unsubscribe: () => void): Promise<void> {
    const records = await this.engine.pastEventRecords(runId);
    const content = records
      .filter((record) => record.event.type === 'llm.delta')
      .map((record) => (record.event as Extract<import('../domain/types.ts').RunEvent, { type: 'llm.delta' }>).delta)
      .join('');
    if (content) {
      await this.withThreadLock(threadId, async () => {
        const thread = await this.getThread(threadId);
        const assistant = thread?.messages.find((message) => message.role === 'assistant' && message.runId === runId);
        if (!thread || !assistant || assistant.status !== 'in_progress') return;
        assistant.content = content;
        thread.updatedAt = nowIso();
        await this.storage.put(COLLECTIONS.threads, thread.id, thread, thread.sessionId);
      });
    }
    const run = await this.engine.getRun(runId);
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
      unsubscribe();
      this.watchedRuns.delete(runId);
      await this.finalizeTurn(threadId, runId, run.status === 'completed');
    }
  }

  private async appendAssistantDelta(threadId: string, runId: string, delta: string): Promise<void> {
    await this.withThreadLock(threadId, async () => {
      const thread = await this.getThread(threadId);
      if (!thread) return;
      const assistant = thread.messages.find((message) => message.role === 'assistant' && message.runId === runId);
      if (!assistant || assistant.status !== 'in_progress') return;
      assistant.content += delta;
      thread.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.threads, thread.id, thread, thread.sessionId);
    });
  }

  /** Restore thread finalizers lost across a server restart. */
  async recoverPendingTurns(): Promise<number> {
    const rows = await this.storage.list<ChatThread>(COLLECTIONS.threads);
    let recovered = 0;
    for (const { doc: thread } of rows) {
      for (const message of thread.messages) {
        if (message.role !== 'user' || !message.runId) continue;
        const assistant = thread.messages.find((candidate) => candidate.role === 'assistant' && candidate.runId === message.runId);
        if (assistant && assistant.status && assistant.status !== 'in_progress') continue;
        const run = await this.engine.getRun(message.runId);
        if (!run) continue;
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
          await this.finalizeTurn(thread.id, run.id, run.status === 'completed');
          recovered += 1;
        } else {
          this.watchRun(thread.id, run.id);
          recovered += 1;
        }
      }
    }
    return recovered;
  }

  private async finalizeTurn(threadId: string, runId: string, ok: boolean): Promise<void> {
    await this.withThreadLock(threadId, () => this.finalizeTurnLocked(threadId, runId, ok));
  }

  private async finalizeTurnLocked(threadId: string, runId: string, ok: boolean): Promise<void> {
    try {
      const thread = await this.getThread(threadId);
      const run = await this.engine.getRun(runId);
      if (!thread || !run) return;
      let assistant = thread.messages.find((message) => message.role === 'assistant' && message.runId === runId);

      let content: string;
      if (ok) {
        content =
          typeof run.output === 'string' ? run.output : JSON.stringify(run.output ?? null);
      } else {
        content = `(run ${run.status}${run.error ? `: ${run.error}` : ''})`;
      }
      if (!assistant) {
        assistant = { id: ids.message(), role: 'assistant', content: '', runId, at: nowIso() };
        thread.messages.push(assistant);
      }
      assistant.content = content;
      assistant.status = ok ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'failed';
      // roll state forward for the next turn
      const cp = run.checkpoint as unknown as EngineCheckpoint | undefined;
      if (run.state && Object.keys(run.state).length) {
        thread.state = structuredClone(run.state);
      } else if (cp?.state && Object.keys(cp.state).length) {
        thread.state = structuredClone(cp.state);
      }
      thread.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.threads, thread.id, thread, thread.sessionId);
    } catch { /* best-effort */ }
  }
}
