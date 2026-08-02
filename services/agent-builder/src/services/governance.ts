import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';

const scrypt = promisify(scryptCallback);

export type GovernanceRole = 'viewer' | 'editor' | 'publisher' | 'admin';

export const DEFAULT_SUBJECT_ID = 'default';
export const DEFAULT_WORKSPACE_ID = 'default';

export interface AuthPrincipal {
  /** Credential identity used for audit and revocation. */
  id: string;
  /** Stable resource owner identity, independent of API-key rotation. */
  subjectId: string;
  /** Tenant/workspace boundary for owned resources. */
  workspaceId: string;
  role: GovernanceRole;
  scopes: string[];
  kind: 'anonymous' | 'bootstrap' | 'api_key';
  authority: 'platform' | 'workspace';
  apiKeyId?: string;
}

export interface ManagedApiKey {
  id: string;
  name: string;
  prefix: string;
  role: GovernanceRole;
  scopes: string[];
  salt: string;
  secretHash: string;
  createdAt: string;
  createdBy: string;
  subjectId?: string;
  workspaceId?: string;
  authority?: 'platform' | 'workspace';
  expiresAt?: string;
  revokedAt?: string;
}

export interface GovernanceAuditEvent {
  id: string;
  occurredAt: string;
  actor: Pick<AuthPrincipal, 'id' | 'subjectId' | 'workspaceId' | 'role' | 'kind' | 'apiKeyId'>;
  action: string;
  outcome: 'success' | 'denied' | 'error';
  requestId: string;
  method: string;
  path: string;
  ip?: string;
  resourceId?: string;
}

const ROLE_SCOPES: Record<GovernanceRole, string[]> = {
  viewer: ['catalog:read', 'workflow:read', 'run:read', 'trace:read', 'eval:read', 'mcp:read', 'vector:read', 'chat:read'],
  editor: ['catalog:read', 'workflow:read', 'workflow:write', 'run:read', 'run:create', 'run:control', 'trace:read', 'eval:read', 'eval:write', 'eval:execute', 'mcp:read', 'mcp:manage', 'vector:read', 'vector:write', 'chat:read', 'chat:write'],
  publisher: ['catalog:read', 'workflow:read', 'workflow:write', 'workflow:publish', 'workflow:delete', 'workflow:export', 'run:read', 'run:create', 'run:control', 'trace:read', 'trace:export', 'eval:read', 'eval:write', 'eval:execute', 'mcp:read', 'mcp:manage', 'vector:read', 'vector:write', 'chat:read', 'chat:write', 'deployment:manage'],
  admin: ['*'],
};

export function requiredScope(method: string, path: string): string | null {
  if (path === '/api/v1/health') return null;
  if (path.startsWith('/api/v1/admin/api-keys') || path.startsWith('/api/v1/admin/audit')) return 'admin:manage';
  if (path.startsWith('/api/v1/admin/credential-vault') || path.startsWith('/api/v1/settings/keys')) return 'credentials:manage';
  if (path.startsWith('/api/v1/realtime/sessions')) return 'run:read';
  if (path.includes('/secrets')) return path.startsWith('/api/v1/deployments/') ? 'deployment:manage' : 'workflow:write';
  if (path.startsWith('/api/v1/deployments')) return method === 'GET' ? 'workflow:read' : 'deployment:manage';
  if (path === '/api/v1/openapi.json' || path === '/api/v1/models' || path.startsWith('/api/v1/workflow-templates') || path === '/api/v1/mcp/connectors') return 'catalog:read';
  if (path.includes('/collaboration/events')) return 'workflow:read';
  if (path.includes('/presence')) return 'workflow:read';
  if (path.includes('/comments')) return method === 'GET' ? 'workflow:read' : 'workflow:write';
  if (method === 'DELETE' && path.startsWith('/api/v1/workflows/')) return 'workflow:delete';
  if (path.includes('/publish') || path.includes('/restore')) return 'workflow:publish';
  if (path.includes('/export')) return path.includes('/trace') ? 'trace:export' : 'workflow:export';
  if (method === 'GET' && /^\/api\/v1\/runs\/[^/]+\/(?:trace|spans|compare)$/.test(path)) return 'trace:read';
  if (path.startsWith('/api/v1/mcp/')) return method === 'GET' ? 'mcp:read' : 'mcp:manage';
  if (path.startsWith('/api/v1/vector-stores')) return method === 'GET' ? 'vector:read' : 'vector:write';
  if (path.startsWith('/api/v1/evaluations') || path.startsWith('/api/v1/evaluation-runs') || path.startsWith('/api/v1/datasets') || path.includes('/evaluations') || path.includes('/datasets')) return method === 'GET' ? 'eval:read' : path.endsWith('/run') ? 'eval:execute' : 'eval:write';
  if (path.startsWith('/api/v1/batches')) return method === 'GET' ? 'run:read' : 'run:control';
  if (path.includes('/batches')) return 'run:create';
  if (path.startsWith('/api/v1/runs') || path.includes('/runs')) return method === 'GET' ? 'run:read' : path.includes('/trace') ? 'trace:read' : path.endsWith('/runs') ? 'run:create' : 'run:control';
  if (path.startsWith('/api/v1/chatkit')) return method === 'GET' ? 'chat:read' : 'chat:write';
  if (path.startsWith('/api/v1/workflows')) return method === 'GET' ? 'workflow:read' : 'workflow:write';
  return 'admin:manage';
}

export class GovernanceService {
  private storage: Storage;
  private config: AppConfig;

  constructor(storage: Storage, config: AppConfig) {
    this.storage = storage;
    this.config = config;
  }

  private async hash(secret: string, salt: string): Promise<Buffer> {
    return scrypt(secret, Buffer.from(salt, 'base64'), 32) as Promise<Buffer>;
  }

  async authenticate(authorization: string | undefined): Promise<AuthPrincipal | null> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (this.config.apiToken && token === this.config.apiToken) return { id: 'bootstrap-admin', subjectId: DEFAULT_SUBJECT_ID, workspaceId: DEFAULT_WORKSPACE_ID, role: 'admin', scopes: ['*'], kind: 'bootstrap', authority: 'platform' };
    if (token?.startsWith('wab_')) {
      const separator = token.indexOf('.', 4);
      if (separator > 4) {
        const id = token.slice(4, separator);
        const secret = token.slice(separator + 1);
        const record = await this.storage.get<ManagedApiKey>(COLLECTIONS.apiKeys, id);
        if (record && !record.revokedAt && (!record.expiresAt || record.expiresAt > new Date().toISOString())) {
          const actual = await this.hash(secret, record.salt);
          const expected = Buffer.from(record.secretHash, 'base64');
          if (actual.length === expected.length && timingSafeEqual(actual, expected)) return {
            id: record.id,
            subjectId: record.subjectId ?? DEFAULT_SUBJECT_ID,
            workspaceId: record.workspaceId ?? DEFAULT_WORKSPACE_ID,
            role: record.role,
            scopes: record.scopes,
            kind: 'api_key',
            authority: record.authority ?? (record.role === 'admin' && (record.workspaceId ?? DEFAULT_WORKSPACE_ID) === DEFAULT_WORKSPACE_ID ? 'platform' : 'workspace'),
            apiKeyId: record.id,
          };
        }
      }
    }
    if (!this.config.apiToken && await this.storage.count(COLLECTIONS.apiKeys) === 0) return { id: 'local-admin', subjectId: DEFAULT_SUBJECT_ID, workspaceId: DEFAULT_WORKSPACE_ID, role: 'admin', scopes: ['*'], kind: 'anonymous', authority: 'platform' };
    return null;
  }

  allows(principal: AuthPrincipal, scope: string | null): boolean {
    return scope === null || principal.scopes.includes('*') || principal.scopes.includes(scope);
  }

  async createKey(input: { name: string; role: GovernanceRole; scopes?: string[]; expiresAt?: string; subjectId?: string; workspaceId?: string }, actor: AuthPrincipal): Promise<{ key: ManagedApiKey; token: string }> {
    const id = randomUUID().replace(/-/g, '').slice(0, 20);
    const secret = randomBytes(32).toString('base64url');
    const salt = randomBytes(16).toString('base64');
    const scopes = input.scopes?.length ? [...new Set(input.scopes)] : ROLE_SCOPES[input.role];
    if (input.role !== 'admin' && scopes.includes('*')) throw new Error('only admin keys may use wildcard scope');
    if (input.role !== 'admin') {
      const allowed = new Set(ROLE_SCOPES[input.role]);
      const invalid = scopes.filter((scope) => !allowed.has(scope));
      if (invalid.length) throw new Error(`scopes exceed ${input.role} role: ${invalid.join(', ')}`);
    }
    const subjectId = (input.subjectId ?? actor.subjectId).trim();
    const workspaceId = (input.workspaceId ?? actor.workspaceId).trim();
    if (actor.authority !== 'platform' && workspaceId !== actor.workspaceId) throw new Error(`workspace admin cannot create API keys for workspace '${workspaceId}'`);
    const validIdentity = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
    if (!validIdentity.test(subjectId)) throw new Error('subjectId must be 1-128 letters, numbers, dots, colons, underscores, or hyphens');
    if (!validIdentity.test(workspaceId)) throw new Error('workspaceId must be 1-128 letters, numbers, dots, colons, underscores, or hyphens');
    const authority: ManagedApiKey['authority'] = actor.authority === 'platform' && input.role === 'admin' && input.workspaceId === undefined && input.subjectId === undefined ? 'platform' : 'workspace';
    const record: ManagedApiKey = { id, name: input.name, prefix: `wab_${id}`, role: input.role, scopes, salt, secretHash: (await this.hash(secret, salt)).toString('base64'), createdAt: new Date().toISOString(), createdBy: actor.id, subjectId, workspaceId, authority, expiresAt: input.expiresAt };
    await this.storage.put(COLLECTIONS.apiKeys, id, record);
    return { key: record, token: `wab_${id}.${secret}` };
  }

  async listKeys(actor: AuthPrincipal): Promise<Array<Omit<ManagedApiKey, 'salt' | 'secretHash'>>> {
    return (await this.storage.list<ManagedApiKey>(COLLECTIONS.apiKeys, { order: 'desc' }))
      .map(({ doc }) => doc)
      .filter((record) => actor.authority === 'platform' || (record.workspaceId ?? DEFAULT_WORKSPACE_ID) === actor.workspaceId)
      .map((doc) => { const { salt: _s, secretHash: _h, ...safe } = doc; return safe; });
  }

  async revokeKey(id: string, actor: AuthPrincipal): Promise<boolean> {
    const record = await this.storage.get<ManagedApiKey>(COLLECTIONS.apiKeys, id);
    if (!record || record.revokedAt) return false;
    if (actor.authority !== 'platform' && (record.workspaceId ?? DEFAULT_WORKSPACE_ID) !== actor.workspaceId) return false;
    await this.storage.put(COLLECTIONS.apiKeys, id, { ...record, revokedAt: new Date().toISOString() });
    return true;
  }

  async audit(event: Omit<GovernanceAuditEvent, 'id' | 'occurredAt'>): Promise<void> {
    const full: GovernanceAuditEvent = { ...event, id: randomUUID(), occurredAt: new Date().toISOString() };
    await this.storage.putIfAbsent(COLLECTIONS.governanceAudit, full.id, full, full.actor.id);
  }

  async listAudit(actor: AuthPrincipal, limit = 100, offset = 0): Promise<GovernanceAuditEvent[]> {
    const visible = (await this.storage.list<GovernanceAuditEvent>(COLLECTIONS.governanceAudit, { order: 'desc' }))
      .map((row) => row.doc)
      .filter((event) => actor.authority === 'platform' || event.actor.workspaceId === actor.workspaceId);
    return visible.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(500, Math.max(0, limit)));
  }
}
