import type { Run } from '../domain/types.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from './governance.ts';

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const SECRET_REFERENCE = /\{\{\s*secrets\.([A-Z][A-Z0-9_]{0,127})\s*\}\}/g;
export type SecretScope = 'workflow' | 'deployment';
export type SecretAccess = Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>;

export interface SecretVariable {
  id: string;
  name: string;
  description?: string;
  kind: 'secret';
  scope: SecretScope;
  scopeId: string;
  workflowId: string;
  environment?: string;
  ownerId: string;
  workspaceId: string;
  value: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSecretVariable extends Omit<SecretVariable, 'value' | 'ownerId' | 'workspaceId'> {
  hasValue: true;
  maskedValue: '[REDACTED]';
}

function scopeRef(scope: SecretScope, scopeId: string): string { return `${scope}:${scopeId}`; }
function validateName(name: string): string {
  const normalized = name.trim().toUpperCase();
  if (!SECRET_NAME.test(normalized)) throw new Error('secret name must be 1-128 uppercase letters, numbers, or underscores and start with a letter');
  return normalized;
}
function validateValue(value: string): string {
  if (!value || value.length > 65_536) throw new Error('secret value must be 1-65536 characters');
  return value;
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function percentEncodedRegex(value: string): RegExp {
  let source = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '%' && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      source += '%';
      for (const digit of value.slice(index + 1, index + 3)) {
        source += /[A-Fa-f]/.test(digit) ? `[${digit.toLowerCase()}${digit.toUpperCase()}]` : digit;
      }
      index += 2;
    } else {
      source += regexEscape(character);
    }
  }
  return new RegExp(source, 'g');
}

function encodedSecretPatterns(secret: string): RegExp[] {
  const encoded = new Set<string>();
  let candidates = [secret];
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = [];
    for (const candidate of candidates) {
      try { next.push(encodeURI(candidate)); } catch { /* raw redaction still applies to malformed Unicode */ }
      try { next.push(encodeURIComponent(candidate)); } catch { /* raw redaction still applies to malformed Unicode */ }
    }
    for (const candidate of next) encoded.add(candidate);
    candidates = next;
  }
  encoded.delete(secret);
  return [...encoded].filter(Boolean).map(percentEncodedRegex);
}

export class ResolvedSecrets {
  private readonly values: Map<string, string>;
  constructor(values: Map<string, string>) { this.values = values; }

  render(template: string, renderNonSecret?: (protectedTemplate: string) => string): string {
    const tokens: Array<{ token: string; value: string }> = [];
    const protectedTemplate = template.replace(SECRET_REFERENCE, (_match, name: string) => {
      const value = this.values.get(name);
      if (value === undefined) throw new Error(`secret '${name}' is not configured for this run`);
      const token = `__WILLOW_SECRET_${tokens.length}_${Math.random().toString(36).slice(2)}__`;
      tokens.push({ token, value });
      return token;
    });
    if (/\{\{\s*secrets\./i.test(protectedTemplate)) throw new Error('secret reference is invalid; use {{secrets.NAME}}');
    let output = renderNonSecret ? renderNonSecret(protectedTemplate) : protectedTemplate;
    for (const { token, value } of tokens) output = output.split(token).join(value);
    return output;
  }

  redact<T>(value: T): T {
    const secrets = [...new Set(this.values.values())].filter(Boolean).sort((a, b) => b.length - a.length);
    const encodedPatterns = secrets.flatMap(encodedSecretPatterns);
    const visit = (input: unknown): unknown => {
      if (typeof input === 'string') {
        let output = input;
        for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
        for (const pattern of encodedPatterns) output = output.replace(pattern, '[REDACTED]');
        return output;
      }
      if (Array.isArray(input)) return input.map(visit);
      if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, visit(item)]));
      return input;
    };
    return visit(value) as T;
  }
}

export class SecretService {
  private readonly storage: Storage;
  private readonly locks = new Map<string, Promise<void>>();
  constructor(storage: Storage) { this.storage = storage; }

  publicView(secret: SecretVariable): PublicSecretVariable {
    const { value: _value, ownerId: _owner, workspaceId: _workspace, ...metadata } = secret;
    return { ...metadata, hasValue: true, maskedValue: '[REDACTED]' };
  }

  private canAccess(secret: SecretVariable, access?: SecretAccess): boolean {
    return !access || access.authority === 'platform'
      || (secret.workspaceId === access.workspaceId && (access.role === 'admin' || secret.ownerId === access.subjectId));
  }

  private async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    try { return await action(); }
    finally { release(); if (this.locks.get(key) === chained) this.locks.delete(key); }
  }

  async list(scope: SecretScope, scopeId: string, access?: SecretAccess): Promise<PublicSecretVariable[]> {
    const rows = await this.storage.list<SecretVariable>(COLLECTIONS.secretVariables, { ref: scopeRef(scope, scopeId), order: 'asc' });
    return rows.map((row) => row.doc).filter((secret) => this.canAccess(secret, access)).map((secret) => this.publicView(secret));
  }

  async create(input: { scope: SecretScope; scopeId: string; workflowId: string; environment?: string; ownerId?: string; workspaceId?: string; name: string; value: string; description?: string }, validateScope?: () => Promise<void>): Promise<PublicSecretVariable> {
    const name = validateName(input.name);
    const value = validateValue(input.value);
    return this.withLock(scopeRef(input.scope, input.scopeId), async () => {
      await validateScope?.();
      const existing = await this.storage.list<SecretVariable>(COLLECTIONS.secretVariables, { ref: scopeRef(input.scope, input.scopeId) });
      if (existing.some((row) => row.doc.name === name)) throw new Error(`secret '${name}' already exists`);
      const now = nowIso();
      const secret: SecretVariable = {
        id: ids.secretVariable(), name, value, description: input.description?.trim() || undefined, kind: 'secret',
        scope: input.scope, scopeId: input.scopeId, workflowId: input.workflowId, environment: input.environment,
        ownerId: input.ownerId ?? DEFAULT_SUBJECT_ID, workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
        revision: 1, createdAt: now, updatedAt: now,
      };
      await this.storage.put(COLLECTIONS.secretVariables, secret.id, secret, scopeRef(input.scope, input.scopeId));
      return this.publicView(secret);
    });
  }

  async update(scope: SecretScope, scopeId: string, id: string, expectedRevision: number, patch: { name?: string; value?: string; description?: string | null }, access?: SecretAccess): Promise<PublicSecretVariable | undefined> {
    return this.withLock(scopeRef(scope, scopeId), async () => {
      const secret = await this.storage.get<SecretVariable>(COLLECTIONS.secretVariables, id);
      if (!secret || secret.scope !== scope || secret.scopeId !== scopeId || !this.canAccess(secret, access)) return undefined;
      if (secret.revision !== expectedRevision) throw new Error(`secret revision conflict: expected ${expectedRevision}, current ${secret.revision}`);
      const name = patch.name === undefined ? secret.name : validateName(patch.name);
      if (name !== secret.name) {
        const siblings = await this.storage.list<SecretVariable>(COLLECTIONS.secretVariables, { ref: scopeRef(scope, scopeId) });
        if (siblings.some((row) => row.id !== id && row.doc.name === name)) throw new Error(`secret '${name}' already exists`);
      }
      const next: SecretVariable = {
        ...secret, name,
        ...(patch.value === undefined ? {} : { value: validateValue(patch.value) }),
        ...(patch.description === undefined ? {} : { description: patch.description?.trim() || undefined }),
        revision: secret.revision + 1, updatedAt: nowIso(),
      };
      await this.storage.put(COLLECTIONS.secretVariables, id, next, scopeRef(scope, scopeId));
      return this.publicView(next);
    });
  }

  async remove(scope: SecretScope, scopeId: string, id: string, expectedRevision: number, access?: SecretAccess): Promise<boolean> {
    return this.withLock(scopeRef(scope, scopeId), async () => {
      const secret = await this.storage.get<SecretVariable>(COLLECTIONS.secretVariables, id);
      if (!secret || secret.scope !== scope || secret.scopeId !== scopeId || !this.canAccess(secret, access)) return false;
      if (secret.revision !== expectedRevision) throw new Error(`secret revision conflict: expected ${expectedRevision}, current ${secret.revision}`);
      return this.storage.delete(COLLECTIONS.secretVariables, id);
    });
  }

  async removeScope(scope: SecretScope, scopeId: string): Promise<number> {
    return this.withLock(scopeRef(scope, scopeId), async () => {
      const rows = await this.storage.list<SecretVariable>(COLLECTIONS.secretVariables, { ref: scopeRef(scope, scopeId) });
      let removed = 0;
      for (const row of rows) {
        if (await this.storage.delete(COLLECTIONS.secretVariables, row.id)) removed += 1;
      }
      return removed;
    });
  }

  async resolveForRun(run: Run): Promise<ResolvedSecrets> {
    let deploymentId = run.deploymentId;
    if (!deploymentId && run.rootRunId && run.rootRunId !== run.id) deploymentId = (await this.storage.get<Run>(COLLECTIONS.runs, run.rootRunId))?.deploymentId;
    const workflowRows = await this.storage.list<SecretVariable>(COLLECTIONS.secretVariables, { ref: scopeRef('workflow', run.workflowId) });
    const deploymentRows = deploymentId ? await this.storage.list<SecretVariable>(COLLECTIONS.secretVariables, { ref: scopeRef('deployment', deploymentId) }) : [];
    const values = new Map<string, string>();
    for (const row of workflowRows) values.set(row.doc.name, row.doc.value);
    for (const row of deploymentRows) values.set(row.doc.name, row.doc.value);
    return new ResolvedSecrets(values);
  }
}
