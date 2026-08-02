import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clipboard,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  AgentBuilderApiError,
  getAgentBuilderClient,
  setAgentBuilderApiToken,
  type CredentialVaultStatus,
  type GovernanceAuditEvent,
  type GovernanceRole,
  type ManagedApiKey,
} from '@willow/agent-builder/agent-builder';

type LoadState = 'loading' | 'ready' | 'unauthorized' | 'unsupported' | 'error';

const describeError = (error: unknown): { state: Exclude<LoadState, 'loading' | 'ready'>; message: string } => {
  if (error instanceof AgentBuilderApiError) {
    if (error.status === 401 || error.status === 403) {
      return { state: 'unauthorized', message: 'Administrator access is required to manage Agent Builder governance.' };
    }
    if ([404, 405, 501].includes(error.status)) {
      return { state: 'unsupported', message: 'Governance controls are not available on this Agent Builder backend.' };
    }
    return { state: 'error', message: error.message };
  }
  return { state: 'error', message: error instanceof Error ? error.message : 'Unable to load governance settings.' };
};

const formatDate = (value?: string) => {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const outcomeClass: Record<GovernanceAuditEvent['outcome'], string> = {
  success: 'text-emerald-300 bg-emerald-500/10',
  denied: 'text-amber-300 bg-amber-500/10',
  error: 'text-red-300 bg-red-500/10',
};

export const GovernanceTab: React.FC = () => {
  const [keys, setKeys] = useState<ManagedApiKey[]>([]);
  const [events, setEvents] = useState<GovernanceAuditEvent[]>([]);
  const [vault, setVault] = useState<CredentialVaultStatus | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<GovernanceRole>('admin');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadState('loading');
    setMessage('');
    try {
      const client = getAgentBuilderClient();
      const [keyResponse, auditResponse, vaultResponse] = await Promise.all([
        client.listApiKeys(),
        client.listAuditEvents(50),
        client.getCredentialVaultStatus(),
      ]);
      setKeys(keyResponse.keys);
      if (keyResponse.keys.length === 0) setRole('admin');
      setEvents(auditResponse.events);
      setVault(vaultResponse.vault);
      setLoadState('ready');
    } catch (error) {
      const described = describeError(error);
      setLoadState(described.state);
      setMessage(described.message);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => setNewToken(null);
  }, [load]);

  const createKey = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setBusyAction('create');
    setMessage('');
    setNewToken(null);
    try {
      const bootstrapKey = keys.length === 0;
      const response = await getAgentBuilderClient().createApiKey({ name: trimmedName, role });
      if (bootstrapKey) setAgentBuilderApiToken(response.token);
      setKeys((current) => [response.key, ...current]);
      setNewToken(response.token);
      setName('');
    } catch (error) {
      setMessage(describeError(error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const revokeKey = async (key: ManagedApiKey) => {
    if (!window.confirm(`Revoke "${key.name}"? Applications using this key will immediately lose access.`)) return;
    setBusyAction(`revoke:${key.id}`);
    setMessage('');
    try {
      await getAgentBuilderClient().revokeApiKey(key.id);
      setKeys((current) => current.map((item) => item.id === key.id ? { ...item, revokedAt: new Date().toISOString() } : item));
    } catch (error) {
      setMessage(describeError(error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const maintainVault = async (action: 'rotate' | 'retire') => {
    const prompt = action === 'rotate'
      ? 'Rotate the active credential-encryption key and migrate stored credentials?'
      : 'Retire every unused credential-encryption key?';
    if (!window.confirm(prompt)) return;
    setBusyAction(action);
    setMessage('');
    try {
      const client = getAgentBuilderClient();
      if (action === 'rotate') await client.rotateCredentialVault();
      else await client.retireUnusedCredentialVaultKeys();
      setVault((await client.getCredentialVaultStatus()).vault);
      setMessage(action === 'rotate' ? 'Credential vault rotated successfully.' : 'Unused vault keys retired successfully.');
    } catch (error) {
      setMessage(describeError(error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const activateAdminToken = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = adminToken.trim();
    if (!token) return;
    setAgentBuilderApiToken(token);
    setAdminToken('');
    await load();
  };

  if (loadState !== 'ready') {
    return (
      <div className="w-full h-full px-12 py-10 overflow-y-auto">
        <h1 className="text-[24px] font-bold text-white">Agent Builder governance</h1>
        <p className="mt-2 text-[14px] text-zinc-400">Manage administrative access, encryption, and audit activity.</p>
        <div className="mt-10 flex items-center gap-3 text-[14px] text-zinc-400">
          {loadState === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <AlertCircle size={18} className="text-amber-400" />}
          <span>{loadState === 'loading' ? 'Loading governance controls...' : message}</span>
        </div>
        {loadState !== 'loading' && (
          <div className="mt-5">
            {loadState === 'unauthorized' && (
              <form onSubmit={activateAdminToken} className="mb-3 flex max-w-xl gap-2">
                <input type="password" autoComplete="one-time-code" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Managed admin API token" className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-[#151515] px-3 text-[13px] text-white outline-none focus:border-zinc-500" />
                <button disabled={!adminToken.trim()} className="h-9 rounded-md bg-white px-3 text-[13px] font-semibold text-black disabled:opacity-40">Use token</button>
              </form>
            )}
            <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-[13px] font-medium text-zinc-200 hover:bg-white/5">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full px-12 py-10 overflow-y-auto">
      <div className="flex items-start justify-between gap-6 border-b border-white/5 pb-6">
        <div>
          <h1 className="text-[24px] font-bold text-white">Agent Builder governance</h1>
          <p className="mt-1 text-[14px] text-zinc-400">Manage administrative access, encryption, and audit activity.</p>
        </div>
        <button aria-label="Refresh governance data" title="Refresh" onClick={() => void load()} className="p-2 text-zinc-400 hover:text-white">
          <RefreshCw size={17} />
        </button>
      </div>

      {message && <div role="status" className="mt-5 flex items-center gap-2 text-[13px] text-zinc-300"><AlertCircle size={15} className="text-amber-400" />{message}</div>}

      <section className="border-b border-white/5 py-6">
        <div className="flex items-center gap-2"><KeyRound size={17} className="text-zinc-400" /><h2 className="text-[15px] font-semibold text-white">API keys</h2></div>
        <p className="mt-1 text-[13px] text-zinc-500">Create role-based keys for Agent Builder automation. Existing secret values are never shown.</p>

        <form onSubmit={createKey} className="mt-5 flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 text-[12px] font-medium text-zinc-400">Key name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Production deployer" className="mt-1.5 h-9 w-full rounded-md border border-white/10 bg-[#151515] px-3 text-[13px] text-white outline-none focus:border-zinc-500" />
          </label>
          <label className="text-[12px] font-medium text-zinc-400">Role
            <select disabled={keys.length === 0} value={keys.length === 0 ? 'admin' : role} onChange={(event) => setRole(event.target.value as GovernanceRole)} className="mt-1.5 h-9 rounded-md border border-white/10 bg-[#151515] px-3 text-[13px] text-white outline-none disabled:opacity-60">
              <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="publisher">Publisher</option><option value="admin">Admin</option>
            </select>
          </label>
          <button disabled={!name.trim() || busyAction === 'create'} className="h-9 rounded-md bg-white px-4 text-[13px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">
            {busyAction === 'create' ? 'Creating...' : 'Create key'}
          </button>
        </form>
        {keys.length === 0 && <p className="mt-2 text-[11px] text-amber-300">The first managed key must be an admin key so this browser can continue managing the local backend.</p>}

        {newToken && (
          <div className="mt-4 border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3">
            <div className="flex items-center justify-between gap-3"><strong className="text-[13px] text-emerald-200">Copy this token now. It will not be shown again.</strong><button onClick={() => setNewToken(null)} className="text-[12px] text-zinc-400 hover:text-white">Dismiss</button></div>
            <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200">{newToken}</code><button aria-label="Copy new API token" title="Copy token" onClick={() => void copyToken()} className="p-2 text-zinc-300 hover:text-white">{copied ? <Check size={16} /> : <Clipboard size={16} />}</button></div>
          </div>
        )}

        <div className="mt-5 divide-y divide-white/5 border-y border-white/5">
          {keys.length === 0 && <p className="py-4 text-[13px] text-zinc-500">No managed API keys.</p>}
          {keys.map((key) => <div key={key.id} className="flex items-center gap-4 py-3 text-[13px]">
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium text-zinc-200">{key.name}</span>{key.revokedAt && <span className="text-[11px] text-red-300">Revoked</span>}</div><div className="mt-1 text-[11px] text-zinc-500">{key.prefix}... / {key.role} / created {formatDate(key.createdAt)}</div></div>
            {!key.revokedAt && <button aria-label={`Revoke ${key.name}`} title="Revoke key" disabled={busyAction === `revoke:${key.id}`} onClick={() => void revokeKey(key)} className="p-2 text-zinc-500 hover:text-red-300 disabled:opacity-40">{busyAction === `revoke:${key.id}` ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}</button>}
          </div>)}
        </div>
      </section>

      <section className="border-b border-white/5 py-6">
        <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-zinc-400" /><h2 className="text-[15px] font-semibold text-white">Credential vault</h2></div>
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-[13px] sm:grid-cols-4"><div><span className="block text-zinc-500">Mode</span><span className="text-zinc-200">{vault?.mode}</span></div><div><span className="block text-zinc-500">Active key</span><span className="text-zinc-200">{vault?.activeKeyId}</span></div><div><span className="block text-zinc-500">Key count</span><span className="text-zinc-200">{vault?.keyCount}</span></div><div><span className="block text-zinc-500">Encrypted records</span><span className="text-zinc-200">{vault?.encryptedRecords}</span></div></div>
        <div className="mt-5 flex gap-2"><button disabled={busyAction !== null} onClick={() => void maintainVault('rotate')} className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-[13px] font-medium text-zinc-200 hover:bg-white/5 disabled:opacity-40"><RotateCw size={14} /> Rotate key</button><button disabled={busyAction !== null || (vault?.keyCount ?? 0) < 2} onClick={() => void maintainVault('retire')} className="rounded-md border border-white/10 px-3 py-2 text-[13px] font-medium text-zinc-200 hover:bg-white/5 disabled:opacity-40">Retire unused keys</button></div>
      </section>

      <section className="py-6">
        <h2 className="text-[15px] font-semibold text-white">Recent audit activity</h2>
        <p className="mt-1 text-[13px] text-zinc-500">The 50 most recent administrative and Agent Builder requests.</p>
        <div className="mt-4 divide-y divide-white/5 border-y border-white/5">
          {events.length === 0 && <p className="py-4 text-[13px] text-zinc-500">No audit events recorded.</p>}
          {events.map((event) => <div key={event.id} className="grid grid-cols-[minmax(120px,1fr)_auto] gap-4 py-3 text-[12px]"><div className="min-w-0"><div className="truncate font-medium text-zinc-200">{event.action}</div><div className="mt-1 truncate text-zinc-500">{event.actor.subjectId} / {event.method} {event.path}</div></div><div className="text-right"><span className={`rounded px-1.5 py-0.5 ${outcomeClass[event.outcome]}`}>{event.outcome}</span><div className="mt-1 text-zinc-600">{formatDate(event.occurredAt)}</div></div></div>)}
        </div>
      </section>
    </div>
  );
};
