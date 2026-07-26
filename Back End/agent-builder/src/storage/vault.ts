import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { DeploymentCreation, DeploymentCreationResult, DeploymentRunAdmission, DeploymentRunAdmissionResult, DeploymentRunAdmissionStatus, DeploymentSessionAdmission, DeploymentSessionAdmissionResult, ListOptions, Storage, StoredDoc, VectorStoreMutation, WorkflowDeletionResult, WorkflowDependencyRef, WorkflowPublishResult } from './index.ts';

interface VaultEnvelope {
  $vault: 1;
  alg: 'A256GCM';
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

function isEnvelope(value: unknown): value is VaultEnvelope {
  const v = value as Partial<VaultEnvelope> | undefined;
  return Boolean(v && v.$vault === 1 && v.alg === 'A256GCM' && typeof v.keyId === 'string'
    && typeof v.iv === 'string' && typeof v.tag === 'string' && typeof v.ciphertext === 'string');
}

function hasVaultMarker(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && ('$vault' in value || 'ciphertext' in value || 'alg' in value));
}

function sensitive(collection: string, id: string): boolean {
  return collection === 'mcp_servers' || collection === 'secret_variables'
    || (collection === 'settings' && (id === 'provider_keys' || id.startsWith('provider_keys:')));
}

interface KeyringFile { version: 1; activeKeyId: string; keys: Record<string, string> }
interface LoadedKeys { mode: 'local' | 'environment'; activeKeyId: string; keys: Map<string, Buffer> }
function keyId(key: Buffer): string { return createHash('sha256').update(key).digest('hex').slice(0, 16); }
export type VaultFailurePhase = 'lease_acquire' | 'lease_stale_cleanup' | 'keyring_temp_write' | 'keyring_fsync' | 'keyring_rename' | 'journal_write' | 'provider_rewrite' | 'mcp_rewrite' | 'secret_rewrite' | 'envelope_verification' | 'journal_delete' | 'retirement_keyring_write';
export interface VaultStorageOptions { onPhase?: (phase: VaultFailurePhase) => void }
function atomicJson(file: string, value: unknown, hook?: (phase: 'temp_write' | 'fsync' | 'rename') => void): void {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  hook?.('temp_write');
  const handle = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(handle, JSON.stringify(value), 'utf8'); hook?.('fsync'); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  hook?.('rename');
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* unsupported */ }
}
function loadOrCreateKeys(dataDir: string): LoadedKeys {
  const configured = process.env.AGENT_BUILDER_MASTER_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, 'base64');
    if (decoded.length !== 32) throw new CredentialVaultError('AGENT_BUILDER_MASTER_KEY must be base64-encoded 32 bytes');
    const id = keyId(decoded); return { mode: 'environment', activeKeyId: id, keys: new Map([[id, decoded]]) };
  }
  const ringFile = path.join(dataDir, '.credential-vault-keyring');
  try {
    const ring = JSON.parse(fs.readFileSync(ringFile, 'utf8')) as KeyringFile;
    if (ring.version !== 1 || !ring.activeKeyId || !ring.keys?.[ring.activeKeyId]) throw new Error('invalid keyring');
    const keys = new Map(Object.entries(ring.keys).map(([id, encoded]) => [id, Buffer.from(encoded, 'base64')]));
    if ([...keys.values()].some((key) => key.length !== 32)) throw new Error('invalid key length');
    return { mode: 'local', activeKeyId: ring.activeKeyId, keys };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CredentialVaultError(`credential vault keyring is invalid: ${(error as Error).message}`);
  }
  const legacy = path.join(dataDir, '.credential-vault-key');
  let key: Buffer;
  try { key = Buffer.from(fs.readFileSync(legacy, 'utf8').trim(), 'base64'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; key = randomBytes(32); }
  if (key.length !== 32) throw new CredentialVaultError('legacy credential vault key is invalid');
  const id = keyId(key); const ring: KeyringFile = { version: 1, activeKeyId: id, keys: { [id]: key.toString('base64') } };
  try {
    atomicJson(ringFile, ring);
    return { mode: 'local', activeKeyId: id, keys: new Map([[id, key]]) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return loadOrCreateKeys(dataDir);
    throw error;
  }
}

export class VaultStorage implements Storage {
  private activeKeyId: string;
  private readonly keys: Map<string, Buffer>;
  private readonly mode: 'local' | 'environment';
  private readonly dataDir: string;
  private readonly inner: Storage;
  private rotationPromise?: Promise<{ activeKeyId: string; keyCount: number; migrated: number }>;
  private resumePromise?: Promise<void>;
  private readonly onPhase?: (phase: VaultFailurePhase) => void;

  constructor(inner: Storage, dataDir: string, options: VaultStorageOptions = {}) {
    this.inner = inner;
    this.dataDir = dataDir;
    this.onPhase = options.onPhase;
    const loaded = loadOrCreateKeys(dataDir); this.mode = loaded.mode; this.activeKeyId = loaded.activeKeyId; this.keys = loaded.keys;
  }

  private seal(collection: string, id: string, doc: unknown): VaultEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(Buffer.from(`agent-builder:v1:A256GCM:${this.activeKeyId}:${collection}:${id}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()]);
    return { $vault: 1, alg: 'A256GCM', keyId: this.activeKeyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }

  private open<T>(collection: string, id: string, value: unknown): T {
    if (!isEnvelope(value)) {
      if (hasVaultMarker(value)) throw new CredentialVaultError(`credential vault envelope is invalid for ${collection}/${id}`);
      return value as T;
    }
    let key = this.keys.get(value.keyId);
    if (!key && this.mode === 'local') { this.reloadLocalKeys(); key = this.keys.get(value.keyId); }
    if (!key) throw new CredentialVaultError(`credential vault key mismatch for ${collection}/${id}`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
      decipher.setAAD(Buffer.from(`agent-builder:v1:A256GCM:${value.keyId}:${collection}:${id}`));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as T;
    } catch {
      throw new CredentialVaultError(`credential vault authentication failed for ${collection}/${id}`);
    }
  }

  private async acquireRotationLease(): Promise<() => void> {
    const file = path.join(this.dataDir, '.credential-vault-rotation.lock');
    for (let attempt = 0; attempt < 2500; attempt++) {
      try {
        this.onPhase?.('lease_acquire');
        const handle = fs.openSync(file, 'wx', 0o600);
        fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: Date.now() })); fs.fsyncSync(handle);
        return () => { try { fs.closeSync(handle); } finally { try { fs.unlinkSync(file); } catch { /* released */ } } };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const owner = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; createdAt?: number };
          let alive = true; if (owner.pid) { try { process.kill(owner.pid, 0); } catch { alive = false; } }
          if (!alive || Date.now() - Number(owner.createdAt ?? 0) > 60_000) { this.onPhase?.('lease_stale_cleanup'); try { fs.unlinkSync(file); } catch { /* another process recovered */ } }
        } catch { try { fs.unlinkSync(file); } catch { /* retry */ } }
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
    }
    throw new CredentialVaultError('timed out acquiring credential vault rotation lease');
  }
  private reloadLocalKeys(): void {
    if (this.mode !== 'local') return;
    const loaded = loadOrCreateKeys(this.dataDir); this.activeKeyId = loaded.activeKeyId;
    this.keys.clear(); for (const [id, key] of loaded.keys) this.keys.set(id, key);
  }
  private async ensureRotationResumed(): Promise<void> {
    if (this.mode !== 'local' || !fs.existsSync(path.join(this.dataDir, '.credential-vault-rotation'))) return;
    if (!this.resumePromise) this.resumePromise = this.rotateCredentialVault().then(() => undefined).finally(() => { this.resumePromise = undefined; });
    await this.resumePromise;
  }

  async put(collection: string, id: string, doc: unknown, ref?: string): Promise<void> {
    return this.inner.put(collection, id, sensitive(collection, id) ? this.seal(collection, id, doc) : doc, ref);
  }
  async putIfAbsent(collection: string, id: string, doc: unknown, ref?: string): Promise<boolean> {
    return this.inner.putIfAbsent(collection, id, sensitive(collection, id) ? this.seal(collection, id, doc) : doc, ref);
  }
  async compareAndSwap(collection: string, id: string, field: string, expected: unknown, doc: unknown, ref?: string): Promise<boolean> {
    if (sensitive(collection, id)) throw new CredentialVaultError('compare-and-swap is unsupported for encrypted credential documents');
    return this.inner.compareAndSwap(collection, id, field, expected, doc, ref);
  }
  async compareAndDelete(collection: string, id: string, field: string, expected: unknown): Promise<boolean> {
    if (sensitive(collection, id)) throw new CredentialVaultError('compare-and-delete is unsupported for encrypted credential documents');
    return this.inner.compareAndDelete(collection, id, field, expected);
  }
  async compareAndSwapWithPut(collection: string, id: string, field: string, expected: unknown, doc: unknown, putCollection: string, putId: string, putDoc: unknown, putRef?: string): Promise<boolean> {
    if (sensitive(collection, id) || sensitive(putCollection, putId)) throw new CredentialVaultError('compare-and-swap is unsupported for encrypted credential documents');
    return this.inner.compareAndSwapWithPut(collection, id, field, expected, doc, putCollection, putId, putDoc, putRef);
  }
  async createDeploymentIfVersionExists(input: DeploymentCreation): Promise<DeploymentCreationResult> { return this.inner.createDeploymentIfVersionExists(input); }
  async admitDeploymentSession(input: DeploymentSessionAdmission): Promise<DeploymentSessionAdmissionResult> {
    return this.inner.admitDeploymentSession(input);
  }
  async admitDeploymentRun(input: DeploymentRunAdmission): Promise<DeploymentRunAdmissionResult> { return this.inner.admitDeploymentRun(input); }
  async bindDeploymentRun(admissionId: string, deploymentId: string, signature: string, runId: string): Promise<boolean> { return this.inner.bindDeploymentRun(admissionId, deploymentId, signature, runId); }
  async completeDeploymentRun(admissionId: string, deploymentId: string, runId: string, status: Extract<DeploymentRunAdmissionStatus, 'completed' | 'failed' | 'cancelled'>, completedAt: string, settlement?: import('./index.ts').DeploymentRunSettlement): Promise<boolean> { return this.inner.completeDeploymentRun(admissionId, deploymentId, runId, status, completedAt, settlement); }
  async releaseDeploymentRun(admissionId: string, deploymentId: string, signature: string): Promise<boolean> { return this.inner.releaseDeploymentRun(admissionId, deploymentId, signature); }
  async publishWorkflowVersion(input: { workflowId: string; expectedDraftRevision: number; workflow: unknown; versionId: string; version: unknown; dependencies: WorkflowDependencyRef[] }): Promise<WorkflowPublishResult> { return this.inner.publishWorkflowVersion(input); }
  async deleteWorkflowIfUnreferenced(workflowId: string): Promise<WorkflowDeletionResult> { return this.inner.deleteWorkflowIfUnreferenced(workflowId); }
  async mutateVectorStore(input: VectorStoreMutation): Promise<boolean> { return this.inner.mutateVectorStore(input); }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    if (sensitive(collection, id)) await this.ensureRotationResumed();
    const raw = await this.inner.get<unknown>(collection, id);
    if (raw === undefined) return undefined;
    if (!sensitive(collection, id)) return raw as T;
    const value = this.open<T>(collection, id, raw);
    if (!isEnvelope(raw)) await this.put(collection, id, value);
    return value;
  }
  async list<T>(collection: string, opts?: ListOptions): Promise<StoredDoc<T>[]> {
    if (collection === 'mcp_servers' || collection === 'settings' || collection === 'secret_variables') await this.ensureRotationResumed();
    const rows = await this.inner.list<unknown>(collection, opts);
    if (collection !== 'mcp_servers' && collection !== 'settings' && collection !== 'secret_variables') return rows as StoredDoc<T>[];
    return Promise.all(rows.map(async (row) => {
      if (!sensitive(collection, row.id)) return row as StoredDoc<T>;
      const doc = this.open<T>(collection, row.id, row.doc);
      if (!isEnvelope(row.doc)) await this.put(collection, row.id, doc, row.ref);
      return { ...row, doc };
    }));
  }
  delete(collection: string, id: string): Promise<boolean> { return this.inner.delete(collection, id); }
  deleteWhere(collection: string, ref: string): Promise<number> { return this.inner.deleteWhere(collection, ref); }
  count(collection: string, ref?: string): Promise<number> { return this.inner.count(collection, ref); }
  async credentialVaultStatus() {
    const providerRows = (await this.inner.list('settings')).filter((row) => sensitive('settings', row.id));
    const records = providerRows.length + await this.inner.count('mcp_servers') + await this.inner.count('secret_variables');
    let rotation: { targetKeyId: string; migrated: number; total: number } | undefined;
    try { rotation = JSON.parse(fs.readFileSync(path.join(this.dataDir, '.credential-vault-rotation'), 'utf8')); } catch { /* none */ }
    return { mode: this.mode, activeKeyId: this.activeKeyId, keyCount: this.keys.size, encryptedRecords: records, ...(rotation ? { rotation } : {}) };
  }
  async rotateCredentialVault() {
    if (this.rotationPromise) return this.rotationPromise;
    this.rotationPromise = this.rotateCredentialVaultInner();
    try { return await this.rotationPromise; } finally { this.rotationPromise = undefined; }
  }
  private async rotateCredentialVaultInner() {
    if (this.mode !== 'local') throw new CredentialVaultError('credential vault rotation is unavailable when AGENT_BUILDER_MASTER_KEY is configured');
    const requestedFromKeyId = this.activeKeyId;
    const release = await this.acquireRotationLease();
    try {
    this.reloadLocalKeys();
    const journalFile = path.join(this.dataDir, '.credential-vault-rotation');
    if (this.activeKeyId !== requestedFromKeyId && !fs.existsSync(journalFile)) return { activeKeyId: this.activeKeyId, keyCount: this.keys.size, migrated: 0 };
    let existing: { targetKeyId?: string } | undefined;
    try { existing = JSON.parse(fs.readFileSync(journalFile, 'utf8')); } catch { /* new rotation */ }
    const retained = existing?.targetKeyId ? this.keys.get(existing.targetKeyId) : undefined;
    const next = retained ?? randomBytes(32); const targetKeyId = existing?.targetKeyId ?? keyId(next); this.keys.set(targetKeyId, next);
    const ringFile = path.join(this.dataDir, '.credential-vault-keyring');
    atomicJson(ringFile, { version: 1, activeKeyId: targetKeyId, keys: Object.fromEntries([...this.keys].map(([id, key]) => [id, key.toString('base64')])) }, (phase) => this.onPhase?.(`keyring_${phase}` as VaultFailurePhase));
    this.activeKeyId = targetKeyId;
    const providerRows = (await this.inner.list<unknown>('settings')).filter((row) => sensitive('settings', row.id));
    const mcpRows = await this.inner.list<unknown>('mcp_servers');
    const secretRows = await this.inner.list<unknown>('secret_variables');
    const targets = [
      ...providerRows.map((row) => ({ collection: 'settings', id: row.id, ref: row.ref })),
      ...mcpRows.map((row) => ({ collection: 'mcp_servers', id: row.id, ref: row.ref })),
      ...secretRows.map((row) => ({ collection: 'secret_variables', id: row.id, ref: row.ref })),
    ];
    let migrated = 0;
    for (const target of targets) {
      this.onPhase?.('journal_write'); atomicJson(journalFile, { targetKeyId, migrated, total: targets.length });
      const raw = await this.inner.get<unknown>(target.collection, target.id);
      if (raw !== undefined) { this.onPhase?.(target.collection === 'settings' ? 'provider_rewrite' : target.collection === 'mcp_servers' ? 'mcp_rewrite' : 'secret_rewrite'); await this.put(target.collection, target.id, this.open(target.collection, target.id, raw), target.ref); }
      migrated += 1;
    }
    this.onPhase?.('envelope_verification');
    for (const target of targets) { const raw = await this.inner.get<unknown>(target.collection, target.id); if (raw !== undefined && (!isEnvelope(raw) || raw.keyId !== targetKeyId)) throw new CredentialVaultError('credential vault rotation verification failed'); }
    this.onPhase?.('journal_delete'); try { fs.unlinkSync(journalFile); } catch { /* complete */ }
    return { activeKeyId: targetKeyId, keyCount: this.keys.size, migrated };
    } finally { release(); }
  }
  async retireCredentialVaultKeys() {
    if (this.mode !== 'local') throw new CredentialVaultError('credential vault key retirement is unavailable when AGENT_BUILDER_MASTER_KEY is configured');
    await this.ensureRotationResumed();
    const release = await this.acquireRotationLease();
    try {
      this.reloadLocalKeys();
      const raw = [
        ...(await this.inner.list<unknown>('settings')).filter((row) => sensitive('settings', row.id)).map((row) => row.doc),
        ...(await this.inner.list<unknown>('mcp_servers')).map((row) => row.doc),
        ...(await this.inner.list<unknown>('secret_variables')).map((row) => row.doc),
      ];
      const used = new Set(raw.map((value) => { if (!isEnvelope(value)) throw new CredentialVaultError('credential vault retirement requires all credentials to be encrypted'); return value.keyId; }));
      const retired = [...this.keys.keys()].filter((id) => id !== this.activeKeyId && !used.has(id));
      const retained = new Map([...this.keys].filter(([id]) => !retired.includes(id)));
      this.onPhase?.('retirement_keyring_write'); atomicJson(path.join(this.dataDir, '.credential-vault-keyring'), { version: 1, activeKeyId: this.activeKeyId, keys: Object.fromEntries([...retained].map(([id, key]) => [id, key.toString('base64')])) });
      for (const id of retired) this.keys.delete(id);
      return { activeKeyId: this.activeKeyId, keyCount: this.keys.size, retired };
    } finally { release(); }
  }
  close(): Promise<void> { return this.inner.close(); }
}
