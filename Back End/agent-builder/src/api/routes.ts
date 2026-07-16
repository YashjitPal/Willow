/**
 * REST API — all routes under /api/v1.
 */

import type { JsonObject, JsonValue, ProviderKeys, Workflow } from '../domain/types.ts';
import { exportPython, exportTypeScript } from '../codegen/index.ts';
import { MCP_CONNECTOR_CATALOG, findConnector } from '../mcp/connectors.ts';
import type { McpManager } from '../mcp/manager.ts';
import { getProvider, resolveKey } from '../providers/index.ts';
import type { VectorStoreService } from '../rag/vectorStore.ts';
import type { RunEngine } from '../engine/executor.ts';
import type { ChatService } from '../services/chat.ts';
import type { EvaluationGrader, EvaluationService, GraderType } from '../services/evaluations.ts';
import type { WorkflowService } from '../services/workflows.ts';
import { WORKFLOW_TEMPLATES } from '../services/templates.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { HANDLED, HttpError, openSse, Router, type RequestCtx } from '../http/router.ts';

export interface ApiServices {
  storage: Storage;
  workflows: WorkflowService;
  engine: RunEngine;
  chat: ChatService;
  evaluations: EvaluationService;
  mcp: McpManager;
  vectorStores: VectorStoreService;
}

function requireBody(ctx: RequestCtx): JsonObject {
  if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) {
    throw new HttpError(400, 'a JSON object body is required');
  }
  return ctx.body as JsonObject;
}

/** Strip internal-only fields (engine checkpoint + graph snapshot) from a run. */
function publicRunView(run: import('../domain/types.ts').Run) {
  const { checkpoint: _cp, graph: _g, ...rest } = run;
  return rest;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new HttpError(400, `'${name}' must be a non-empty string`);
  return v;
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseEvaluationGraders(body: JsonObject): EvaluationGrader[] {
  const rawGraders = Array.isArray(body.graders) ? body.graders : [];
  if (rawGraders.length === 0) {
    throw new HttpError(400, 'an evaluation needs at least one grader');
  }
  const allowed = new Set<GraderType>(['contains', 'equals', 'regex', 'run_status', 'event_count']);
  return rawGraders.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, `grader ${index + 1} must be an object`);
    }
    const grader = value as JsonObject;
    const type = optStr(grader.type) as GraderType | undefined;
    if (!type || !allowed.has(type)) {
      throw new HttpError(400, `grader ${index + 1} has an unknown type`);
    }
    if (!('expected' in grader)) throw new HttpError(400, `grader ${index + 1} needs expected`);
    return {
      id: optStr(grader.id) ?? `grader_${index + 1}`,
      name: optStr(grader.name) ?? `Grader ${index + 1}`,
      type,
      target: optStr(grader.target) === 'error' ? 'error' : 'output',
      expected: grader.expected as JsonValue,
      eventType: optStr(grader.eventType),
    };
  });
}

/** Per-request provider keys: x-provider-keys header (JSON) or body.provider_keys. */
function parseRequestKeys(ctx: RequestCtx): ProviderKeys | undefined {
  const header = ctx.headers['x-provider-keys'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ProviderKeys;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      throw new HttpError(400, 'x-provider-keys header must be valid JSON');
    }
  }
  const body = ctx.body as JsonObject | undefined;
  const fromBody = body?.provider_keys ?? body?.providerKeys;
  if (fromBody && typeof fromBody === 'object' && !Array.isArray(fromBody)) {
    return fromBody as ProviderKeys;
  }
  return undefined;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function registerRoutes(router: Router, services: ApiServices): void {
  const { storage, workflows, engine, chat, evaluations, mcp, vectorStores } = services;

  // ------------------------------------------------------------------
  // health
  // ------------------------------------------------------------------
  router.get('/api/v1/health', () => ({
    ok: true,
    service: 'willow-agent-builder',
    version: '0.1.0',
    time: new Date().toISOString(),
  }));

  // ------------------------------------------------------------------
  // settings / provider keys
  // ------------------------------------------------------------------
  router.get('/api/v1/settings/keys', async () => {
    const keys = (await storage.get<ProviderKeys>(COLLECTIONS.settings, 'provider_keys')) ?? {};
    const masked: JsonObject = {};
    for (const [provider, list] of Object.entries(keys)) {
      masked[provider] = (list ?? []).map(maskKey);
    }
    return { keys: masked };
  });

  router.put('/api/v1/settings/keys', async (ctx) => {
    const body = requireBody(ctx);
    const allowed = ['gemini', 'openai', 'anthropic', 'brave', 'tavily'];
    const existing = (await storage.get<ProviderKeys>(COLLECTIONS.settings, 'provider_keys')) ?? {};
    const next: Record<string, string[]> = { ...existing } as Record<string, string[]>;
    for (const [provider, value] of Object.entries(body)) {
      if (!allowed.includes(provider)) continue;
      if (value === null) {
        delete next[provider];
        continue;
      }
      if (!Array.isArray(value) || value.some((k) => typeof k !== 'string')) {
        throw new HttpError(400, `'${provider}' must be an array of strings (or null to clear)`);
      }
      next[provider] = value as string[];
    }
    await storage.put(COLLECTIONS.settings, 'provider_keys', next);
    return { ok: true, providers: Object.fromEntries(Object.entries(next).map(([p, l]) => [p, l.length])) };
  });

  // ------------------------------------------------------------------
  // models
  // ------------------------------------------------------------------
  router.get('/api/v1/models', async (ctx) => {
    const providerParam = ctx.query.get('provider');
    const requestKeys = parseRequestKeys(ctx);
    const storedKeys = (await storage.get<ProviderKeys>(COLLECTIONS.settings, 'provider_keys')) ?? {};
    const wanted = providerParam
      ? [providerParam]
      : ['gemini', 'openai', 'anthropic', 'mock'];

    const models: Array<JsonObject> = [];
    const errors: JsonObject = {};
    await Promise.all(
      wanted.map(async (p) => {
        try {
          const provider = getProvider(p);
          const key = resolveKey(p as 'gemini' | 'openai' | 'anthropic' | 'mock', requestKeys, storedKeys);
          const list = await provider.listModels(key);
          for (const m of list) {
            models.push({ id: m.id, provider: p, displayName: m.displayName, description: m.description ?? '' });
          }
        } catch (e) {
          errors[p] = (e as Error).message;
        }
      }),
    );
    return { models, errors };
  });

  // ------------------------------------------------------------------
  // workflows
  // ------------------------------------------------------------------
  router.get('/api/v1/workflows', async () => {
    const list = await workflows.list();
    return {
      workflows: list.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description ?? '',
        latestVersion: w.latestVersion,
        nodeCount: w.draft.nodes.length,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
    };
  });

  router.get('/api/v1/workflow-templates', () => ({
    templates: WORKFLOW_TEMPLATES.map(({ graph: _graph, ...template }) => template),
  }));

  router.post('/api/v1/workflows/from-template', async (ctx) => {
    const body = requireBody(ctx);
    const templateId = str(body.templateId ?? body.template_id, 'templateId');
    const result = await workflows.createFromTemplate({
      templateId,
      name: optStr(body.name),
      description: optStr(body.description),
    });
    if (!result) throw new HttpError(404, `workflow template '${templateId}' not found`);
    return result;
  });

  router.post('/api/v1/workflows', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const { workflow, validation } = await workflows.create({
      name: optStr(body.name),
      description: optStr(body.description),
      graph: body.graph,
    });
    return { workflow, validation };
  });

  router.get('/api/v1/workflows/:id', async (ctx) => {
    const wf = await workflows.get(ctx.params.id);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { workflow: wf };
  });

  router.patch('/api/v1/workflows/:id', async (ctx) => {
    const body = requireBody(ctx);
    const wf = await workflows.update(ctx.params.id, {
      name: optStr(body.name),
      description: optStr(body.description),
    });
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { workflow: wf };
  });

  router.delete('/api/v1/workflows/:id', async (ctx) => {
    const ok = await workflows.remove(ctx.params.id);
    if (!ok) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { ok: true };
  });

  router.put('/api/v1/workflows/:id/draft', async (ctx) => {
    const body = requireBody(ctx);
    const graph = body.graph ?? body;
    const result = await workflows.saveDraft(ctx.params.id, graph);
    if (!result) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return result;
  });

  router.post('/api/v1/workflows/:id/validate', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    if (body.graph !== undefined) {
      return { validation: workflows.validate(body.graph) };
    }
    const wf = await workflows.get(ctx.params.id);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { validation: workflows.validate(wf.draft) };
  });

  router.post('/api/v1/workflows/:id/publish', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    try {
      const result = await workflows.publish(ctx.params.id, optStr(body.notes));
      if (!result) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
      return result;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const err = e as Error & { validation?: unknown };
      if (err.validation) {
        throw new HttpError(422, err.message, 'invalid_workflow');
      }
      throw e;
    }
  });

  router.get('/api/v1/workflows/:id/versions', async (ctx) => {
    const wf = await workflows.get(ctx.params.id);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { versions: await workflows.listVersions(ctx.params.id) };
  });

  router.get('/api/v1/workflows/:id/versions/:version', async (ctx) => {
    const v = Number.parseInt(ctx.params.version, 10);
    const ver = await workflows.getVersion(ctx.params.id, v);
    if (!ver) throw new HttpError(404, `version ${ctx.params.version} not found`);
    return { version: ver };
  });

  router.post('/api/v1/workflows/:id/versions/:version/restore', async (ctx) => {
    const version = Number.parseInt(ctx.params.version, 10);
    if (!Number.isInteger(version) || version < 1) {
      throw new HttpError(400, `'version' must be a positive integer`);
    }
    const restored = await workflows.restoreVersion(ctx.params.id, version);
    if (!restored) {
      throw new HttpError(404, `workflow '${ctx.params.id}' or version ${version} not found`);
    }
    return restored;
  });

  router.post('/api/v1/workflows/:id/export', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const format = (optStr(body.format) ?? 'typescript').toLowerCase();
    const wf = await workflows.get(ctx.params.id);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    let graph = wf.draft;
    if (typeof body.version === 'number' && body.version > 0) {
      const ver = await workflows.getVersion(ctx.params.id, body.version);
      if (!ver) throw new HttpError(404, `version ${body.version} not found`);
      graph = ver.graph;
    }
    if (format === 'python' || format === 'py') {
      return { format: 'python', code: exportPython(wf.name, graph) };
    }
    if (format === 'typescript' || format === 'ts') {
      return { format: 'typescript', code: exportTypeScript(wf.name, graph) };
    }
    throw new HttpError(400, `unknown export format '${format}' (typescript | python)`);
  });

  // ------------------------------------------------------------------
  // runs
  // ------------------------------------------------------------------
  router.post('/api/v1/workflows/:id/runs', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const requestKeys = parseRequestKeys(ctx);
    const inputRaw = (body.input ?? {}) as JsonObject;
    const input = typeof inputRaw === 'string' ? { input_as_text: inputRaw } : inputRaw;
    try {
      const run = await engine.createRun({
        workflowId: ctx.params.id,
        version: typeof body.version === 'number' ? body.version : 0,
        requestKeys,
        input: {
          input_as_text: optStr(input.input_as_text) ?? optStr(body.input_as_text) ?? '',
          variables: (input.variables ?? undefined) as JsonObject | undefined,
          state_variables: (input.state_variables ?? undefined) as JsonObject | undefined,
          history: (input.history ?? undefined) as never,
        },
      });
      const publicRun = publicRunView(run);
      return { run: publicRun };
    } catch (e) {
      if ((e as Error).message.includes('not found')) throw new HttpError(404, (e as Error).message);
      if ((e as Error).message.includes('invalid')) throw new HttpError(422, (e as Error).message);
      throw e;
    }
  });

  router.get('/api/v1/workflows/:id/runs', async (ctx) => {
    const limit = Number.parseInt(ctx.query.get('limit') ?? '50', 10) || 50;
    return { runs: await engine.listRuns(ctx.params.id, limit) };
  });

  // ------------------------------------------------------------------
  // trace evaluation
  // ------------------------------------------------------------------
  router.get('/api/v1/workflows/:id/evaluations', async (ctx) => {
    const wf = await workflows.get(ctx.params.id);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    return { evaluations: await evaluations.list(ctx.params.id) };
  });

  router.post('/api/v1/workflows/:id/evaluations', async (ctx) => {
    const wf = await workflows.get(ctx.params.id);
    if (!wf) throw new HttpError(404, `workflow '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    const graders = parseEvaluationGraders(body);
    return { evaluation: await evaluations.create({
      workflowId: ctx.params.id,
      name: optStr(body.name) ?? 'Untitled evaluation',
      graders,
    }) };
  });

  router.get('/api/v1/runs/:id', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    const publicRun = publicRunView(run);
    return { run: publicRun };
  });

  router.get('/api/v1/evaluations/:id', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    return { evaluation };
  });

  router.patch('/api/v1/evaluations/:id', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    const body = requireBody(ctx);
    const updated = await evaluations.update(ctx.params.id, {
      name: optStr(body.name),
      graders: body.graders === undefined ? undefined : parseEvaluationGraders(body),
    });
    return { evaluation: updated };
  });

  router.delete('/api/v1/evaluations/:id', async (ctx) => {
    const ok = await evaluations.remove(ctx.params.id);
    if (!ok) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    return { ok: true };
  });

  router.get('/api/v1/evaluations/:id/runs', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    return { runs: await evaluations.listRuns(ctx.params.id) };
  });

  router.post('/api/v1/evaluations/:id/run', async (ctx) => {
    const evaluation = await evaluations.get(ctx.params.id);
    if (!evaluation) throw new HttpError(404, `evaluation '${ctx.params.id}' not found`);
    const body = (ctx.body ?? {}) as JsonObject;
    const requestedRunIds = body.runIds ?? body.run_ids;
    const runIds = Array.isArray(requestedRunIds)
      ? (requestedRunIds as unknown[]).filter((value): value is string => typeof value === 'string')
      : undefined;
    return { run: await evaluations.evaluate(ctx.params.id, runIds) };
  });

  router.get('/api/v1/runs/:id/trace', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    return { events: await engine.pastEvents(ctx.params.id) };
  });

  router.get('/api/v1/runs/:id/events', async (ctx) => {
    const run = await engine.getRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    const sse = openSse(ctx);

    // subscribe FIRST so no events are missed between replay and live
    const buffered: unknown[] = [];
    let replaying = true;
    const unsubscribe = engine.subscribe(ctx.params.id, (event) => {
      if (replaying) buffered.push(event);
      else sse.send(event.type, event);
    });
    sse.onClose(unsubscribe);

    if (ctx.query.get('replay') !== 'false') {
      const past = await engine.pastEvents(ctx.params.id);
      for (const event of past) sse.send(event.type, event);
    }
    replaying = false;
    for (const event of buffered) {
      sse.send((event as { type: string }).type, event);
    }

    // Close automatically when the run is already settled and not streaming.
    const current = await engine.getRun(ctx.params.id);
    if (
      current &&
      (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled')
    ) {
      sse.send('done', { status: current.status });
      sse.close();
    }
    return HANDLED;
  });

  router.post('/api/v1/runs/:id/cancel', async (ctx) => {
    const run = await engine.cancelRun(ctx.params.id);
    if (!run) throw new HttpError(404, `run '${ctx.params.id}' not found`);
    const publicRun = publicRunView(run);
    return { run: publicRun };
  });

  router.post('/api/v1/runs/:id/approvals/:approvalId', async (ctx) => {
    const body = requireBody(ctx);
    const requestKeys = parseRequestKeys(ctx);
    try {
      const run = await engine.resolveApproval(
        ctx.params.id,
        ctx.params.approvalId,
        {
          approved: body.approved === true,
          result: body.result as JsonValue | undefined,
        },
        requestKeys,
      );
      const publicRun = publicRunView(run);
      return { run: publicRun };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      if (msg.includes('not awaiting') || msg.includes('not pending')) throw new HttpError(409, msg);
      throw e;
    }
  });

  // ------------------------------------------------------------------
  // MCP
  // ------------------------------------------------------------------
  router.get('/api/v1/mcp/connectors', () => ({ connectors: MCP_CONNECTOR_CATALOG }));

  router.get('/api/v1/mcp/servers', async () => {
    const servers = await mcp.list();
    // never echo auth secrets back
    return {
      servers: servers.map((s) => ({
        ...s,
        auth: { type: s.auth.type },
      })),
    };
  });

  router.post('/api/v1/mcp/servers', async (ctx) => {
    const body = requireBody(ctx);
    const connectorKey = optStr(body.connector);
    const connector = connectorKey ? findConnector(connectorKey) : undefined;

    let auth: import('../domain/types.ts').McpServerRegistration['auth'] = { type: 'none' };
    const authBody = body.auth as JsonObject | undefined;
    const authType = optStr(authBody?.type)?.toLowerCase() ?? optStr(body.authType)?.toLowerCase();
    const token = optStr(authBody?.token) ?? optStr(body.token);
    if (authType === 'bearer' || authType === 'token' || authType === 'access token / api key') {
      if (!token) throw new HttpError(400, 'bearer auth requires a token');
      auth = { type: 'bearer', token };
    } else if (authType === 'basic' || authType === 'basic auth') {
      auth = {
        type: 'basic',
        username: str(authBody?.username ?? body.username, 'auth.username'),
        password: str(authBody?.password ?? body.password, 'auth.password'),
      };
    } else if (authType === 'headers') {
      const headers = (authBody?.headers ?? {}) as Record<string, string>;
      auth = { type: 'headers', headers };
    }

    const server = await mcp.register({
      label: optStr(body.label) ?? (connector ? `${connector.key}_mcp` : 'mcp_server'),
      description: optStr(body.description),
      origin: connector ? connector.tier : 'custom',
      connector: connector?.key,
      url: optStr(body.url) ?? connector?.url,
      command: optStr(body.command),
      args: Array.isArray(body.args) ? (body.args as string[]) : undefined,
      transport: optStr(body.transport) as never,
      auth,
    });

    // optionally connect immediately
    if (body.connect !== false) {
      try {
        const connected = await mcp.connect(server.id);
        return { server: { ...connected, auth: { type: connected.auth.type } } };
      } catch (e) {
        return {
          server: { ...(await mcp.get(server.id))!, auth: { type: server.auth.type } },
          warning: `registered but connection failed: ${(e as Error).message}`,
        };
      }
    }
    return { server: { ...server, auth: { type: server.auth.type } } };
  });

  router.patch('/api/v1/mcp/servers/:id', async (ctx) => {
    const body = requireBody(ctx);
    const server = await mcp.update(ctx.params.id, body as never);
    if (!server) throw new HttpError(404, `MCP server '${ctx.params.id}' not found`);
    return { server: { ...server, auth: { type: server.auth.type } } };
  });

  router.delete('/api/v1/mcp/servers/:id', async (ctx) => {
    const ok = await mcp.remove(ctx.params.id);
    if (!ok) throw new HttpError(404, `MCP server '${ctx.params.id}' not found`);
    return { ok: true };
  });

  router.post('/api/v1/mcp/servers/:id/connect', async (ctx) => {
    try {
      const server = await mcp.connect(ctx.params.id);
      return { server: { ...server, auth: { type: server.auth.type } } };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(502, `connection failed: ${msg}`, 'mcp_connect_failed');
    }
  });

  router.get('/api/v1/mcp/servers/:id/tools', async (ctx) => {
    try {
      const tools = await mcp.listTools(ctx.params.id, ctx.query.get('refresh') === 'true');
      return { tools };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(502, msg, 'mcp_error');
    }
  });

  router.post('/api/v1/mcp/servers/:id/tools/:tool/call', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const args = (body.arguments ?? {}) as JsonObject;
    try {
      const result = await mcp.callTool(ctx.params.id, ctx.params.tool, args);
      return { result };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(502, msg, 'mcp_error');
    }
  });

  // ------------------------------------------------------------------
  // vector stores
  // ------------------------------------------------------------------
  router.get('/api/v1/vector-stores', async () => ({ stores: await vectorStores.listStores() }));

  router.post('/api/v1/vector-stores', async (ctx) => {
    const body = (ctx.body ?? {}) as JsonObject;
    const keys = parseRequestKeys(ctx) ??
      (await storage.get<ProviderKeys>(COLLECTIONS.settings, 'provider_keys')) ?? undefined;
    const store = await vectorStores.createStore(optStr(body.name) ?? 'Untitled store', keys);
    return { store };
  });

  router.get('/api/v1/vector-stores/:id', async (ctx) => {
    const store = await vectorStores.getStore(ctx.params.id);
    if (!store) throw new HttpError(404, `vector store '${ctx.params.id}' not found`);
    return { store, files: await vectorStores.listFiles(ctx.params.id) };
  });

  router.delete('/api/v1/vector-stores/:id', async (ctx) => {
    const ok = await vectorStores.deleteStore(ctx.params.id);
    if (!ok) throw new HttpError(404, `vector store '${ctx.params.id}' not found`);
    return { ok: true };
  });

  router.get('/api/v1/vector-stores/:id/files', async (ctx) => ({
    files: await vectorStores.listFiles(ctx.params.id),
  }));

  router.post('/api/v1/vector-stores/:id/files', async (ctx) => {
    const body = requireBody(ctx);
    const filename = optStr(body.filename) ?? 'untitled.txt';
    let content = optStr(body.content);
    const b64 = optStr(body.contentBase64) ?? optStr(body.content_base64);
    if (!content && b64) {
      try {
        content = Buffer.from(b64, 'base64').toString('utf8');
      } catch {
        throw new HttpError(400, 'contentBase64 is not valid base64');
      }
    }
    if (!content) throw new HttpError(400, `provide 'content' (text) or 'contentBase64'`);
    const keys = parseRequestKeys(ctx) ??
      (await storage.get<ProviderKeys>(COLLECTIONS.settings, 'provider_keys')) ?? undefined;
    try {
      const file = await vectorStores.addFile(ctx.params.id, filename, content, keys);
      return { file };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw new HttpError(422, msg);
    }
  });

  router.delete('/api/v1/vector-stores/:id/files/:fileId', async (ctx) => {
    const ok = await vectorStores.deleteFile(ctx.params.id, ctx.params.fileId);
    if (!ok) throw new HttpError(404, 'file not found in this store');
    return { ok: true };
  });

  router.post('/api/v1/vector-stores/:id/search', async (ctx) => {
    const body = requireBody(ctx);
    const query = str(body.query, 'query');
    const keys = parseRequestKeys(ctx) ??
      (await storage.get<ProviderKeys>(COLLECTIONS.settings, 'provider_keys')) ?? undefined;
    const results = await vectorStores.search([ctx.params.id], query, keys, {
      maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
      scoreThreshold: typeof body.scoreThreshold === 'number' ? body.scoreThreshold : undefined,
    });
    return { results };
  });

  // ------------------------------------------------------------------
  // chat sessions (ChatKit-style)
  // ------------------------------------------------------------------
  router.post('/api/v1/chatkit/sessions', async (ctx) => {
    const body = requireBody(ctx);
    const wf = (body.workflow ?? {}) as JsonObject;
    const workflowId = str(wf.id ?? body.workflowId, 'workflow.id');
    try {
      const session = await chat.createSession({
        workflowId,
        version: typeof wf.version === 'number' ? wf.version : undefined,
        user: optStr(body.user) ?? 'anonymous',
        stateVariables: (wf.state_variables ?? wf.stateVariables ?? undefined) as JsonObject | undefined,
        expiresAfterSeconds:
          typeof body.expires_after === 'number' ? body.expires_after : undefined,
      });
      return {
        session: {
          id: session.id,
          workflowId: session.workflowId,
          workflowVersion: session.workflowVersion,
          user: session.user,
          status: session.status,
          expiresAt: session.expiresAt,
        },
        client_secret: session.clientSecret,
        expires_at: session.expiresAt,
      };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      throw e;
    }
  });

  router.get('/api/v1/chatkit/sessions/:id', async (ctx) => {
    const session = await chat.getSession(ctx.params.id);
    if (!session) throw new HttpError(404, `session '${ctx.params.id}' not found`);
    const { clientSecret: _s, ...publicSession } = session;
    return { session: publicSession };
  });

  router.post('/api/v1/chatkit/sessions/:id/cancel', async (ctx) => {
    const session = await chat.cancelSession(ctx.params.id);
    if (!session) throw new HttpError(404, `session '${ctx.params.id}' not found`);
    const { clientSecret: _s, ...publicSession } = session;
    return { session: publicSession };
  });

  router.post('/api/v1/chatkit/sessions/:id/threads', async (ctx) => {
    try {
      return { thread: await chat.createThread(ctx.params.id) };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      if (msg.includes('expired') || msg.includes('cancelled')) throw new HttpError(410, msg);
      throw e;
    }
  });

  router.get('/api/v1/chatkit/sessions/:id/threads', async (ctx) => ({
    threads: await chat.listThreads(ctx.params.id),
  }));

  router.get('/api/v1/chatkit/threads/:threadId', async (ctx) => {
    const thread = await chat.getThread(ctx.params.threadId);
    if (!thread) throw new HttpError(404, `thread '${ctx.params.threadId}' not found`);
    return { thread };
  });

  router.post('/api/v1/chatkit/threads/:threadId/messages', async (ctx) => {
    const body = requireBody(ctx);
    const text = str(body.text ?? body.message, 'text');
    const requestKeys = parseRequestKeys(ctx);
    try {
      const { thread, run } = await chat.sendMessage(ctx.params.threadId, text, requestKeys);
      const publicRun = publicRunView(run);
      return { thread, run: publicRun };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) throw new HttpError(404, msg);
      if (msg.includes('expired') || msg.includes('cancelled')) throw new HttpError(410, msg);
      if (msg.includes('still in progress')) throw new HttpError(409, msg, 'turn_in_progress');
      if (msg.includes('invalid')) throw new HttpError(422, msg);
      throw e;
    }
  });
}

export type { Workflow };
