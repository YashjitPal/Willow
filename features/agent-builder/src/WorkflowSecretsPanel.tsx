import React from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { AgentBuilderApiError, getAgentBuilderClient, type ScopedSecret } from './agent-builder';

interface Props {
  open: boolean;
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

export const WorkflowSecretsPanel: React.FC<Props> = ({ open, workflowId, workflowName, onClose }) => {
  const { apiKeys } = useUserDataContext();
  const [secrets, setSecrets] = React.useState<ScopedSecret[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ScopedSecret | 'new' | null>(null);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [value, setValue] = React.useState('');
  const [showValue, setShowValue] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const loadEpoch = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  const load = React.useCallback(async (): Promise<ScopedSecret[] | null> => {
    const epoch = ++loadEpoch.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getAgentBuilderClient(apiKeys).listWorkflowSecrets(workflowId);
      if (epoch === loadEpoch.current) {
        const nextSecrets = [...response.secrets].sort((a, b) => a.name.localeCompare(b.name));
        setSecrets(nextSecrets);
        return nextSecrets;
      }
    } catch (reason) {
      if (epoch === loadEpoch.current) setError((reason as Error).message);
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
    return null;
  }, [apiKeys, workflowId]);

  React.useEffect(() => {
    if (!open) return;
    setSecrets([]);
    setError(null);
    setBusy(null);
    setEditing(null);
    setDeleteTarget(null);
    void load();
  }, [load, open]);

  const beginCreate = () => {
    setEditing('new');
    setName('');
    setDescription('');
    setValue('');
    setShowValue(false);
    setError(null);
  };

  const beginEdit = (secret: ScopedSecret) => {
    setEditing(secret);
    setName(secret.name);
    setDescription(secret.description ?? '');
    setValue('');
    setShowValue(false);
    setDeleteTarget(null);
    setError(null);
  };

  const save = async () => {
    if (!editing) return;
    const normalizedName = name.trim().toUpperCase();
    if (!SECRET_NAME.test(normalizedName)) {
      setError('Name must start with A-Z and contain only uppercase letters, numbers, or underscores.');
      return;
    }
    if (editing === 'new' && !value) {
      setError('A value is required for a new secret.');
      return;
    }
    setBusy(editing === 'new' ? 'new' : editing.id);
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const response = editing === 'new'
        ? await client.createWorkflowSecret(workflowId, { name: normalizedName, value, ...(description.trim() ? { description: description.trim() } : {}) })
        : await client.updateWorkflowSecret(workflowId, editing.id, {
          expectedRevision: editing.revision,
          name: normalizedName,
          description: description.trim(),
          ...(value ? { value } : {}),
        });
      setSecrets((current) => [response.secret, ...current.filter((secret) => secret.id !== response.secret.id)].sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
      setValue('');
    } catch (reason) {
      if (reason instanceof AgentBuilderApiError && reason.status === 409) {
        setError('This secret changed elsewhere. The latest values have been reloaded.');
        const latestSecrets = await load();
        if (editing !== 'new') {
          const latest = latestSecrets?.find((secret) => secret.id === editing.id);
          setEditing(latest ?? null);
        }
      } else {
        setError((reason as Error).message);
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (secret: ScopedSecret) => {
    setBusy(secret.id);
    setError(null);
    try {
      await getAgentBuilderClient(apiKeys).deleteWorkflowSecret(workflowId, secret.id, secret.revision);
      setSecrets((current) => current.filter((item) => item.id !== secret.id));
      setDeleteTarget(null);
      if (editing !== 'new' && editing?.id === secret.id) setEditing(null);
    } catch (reason) {
      if (reason instanceof AgentBuilderApiError && reason.status === 409) {
        setError('This secret changed elsewhere. The latest values have been reloaded.');
        await load();
      } else {
        setError((reason as Error).message);
      }
    } finally {
      setBusy(null);
    }
  };

  const copyReference = async (secret: ScopedSecret) => {
    try {
      await navigator.clipboard.writeText(`{{secrets.${secret.name}}}`);
      setCopiedId(secret.id);
      window.setTimeout(() => setCopiedId((current) => current === secret.id ? null : current), 1200);
    } catch {
      setError('Clipboard access is unavailable.');
    }
  };

  if (!open) return null;
  const editingExisting = editing !== null && editing !== 'new';

  return (
    <aside role="dialog" aria-modal="true" aria-label="Workflow secrets" className="fixed bottom-4 right-4 top-4 z-[96] flex w-[min(430px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#171717] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[#303030] px-4 py-3">
        <div className="min-w-0"><div className="flex items-center gap-2 text-[13px] font-semibold text-white"><KeyRound size={15} /> Secrets</div><div className="mt-0.5 truncate text-[10px] text-[#777]">{workflowName}</div></div>
        <button type="button" title="Close secrets" aria-label="Close secrets" onClick={onClose} className="text-[#777] hover:text-white"><X size={16} /></button>
      </header>

      <div className="flex items-center gap-2 border-b border-[#292929] px-3 py-2.5">
        <button type="button" onClick={beginCreate} disabled={busy !== null} className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[10.5px] font-medium text-black disabled:opacity-40"><Plus size={12} /> New secret</button>
        <button type="button" title="Refresh secrets" aria-label="Refresh secrets" onClick={() => void load()} disabled={loading || busy !== null} className="flex h-8 w-8 items-center justify-center rounded-md border border-[#383838] text-[#888] hover:text-white disabled:opacity-40"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
        <span className="ml-auto text-[9.5px] text-[#666]">{secrets.length} configured</span>
      </div>

      {error && <div role="alert" className="border-b border-red-900/50 bg-red-950/20 px-3 py-2 text-[10px] text-red-300">{error}</div>}

      {editing && (
        <section className="border-b border-[#303030] bg-[#1d1d1d] p-3">
          <div className="mb-2.5 flex items-center justify-between"><div className="text-[11px] font-semibold text-white">{editing === 'new' ? 'New secret' : `Edit ${editing.name}`}</div><button type="button" title="Close editor" onClick={() => setEditing(null)} className="text-[#777] hover:text-white"><X size={13} /></button></div>
          <label className="block text-[9px] font-semibold uppercase text-[#777]">Name</label>
          <input value={name} onChange={(event) => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} maxLength={128} autoFocus spellCheck={false} autoCapitalize="characters" className="mt-1 h-9 w-full rounded-md border border-[#383838] bg-[#111] px-2.5 font-mono text-[11px] text-white outline-none focus:border-[#666]" placeholder="SERVICE_API_KEY" />
          <label className="mt-2.5 block text-[9px] font-semibold uppercase text-[#777]">Description</label>
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} className="mt-1 h-9 w-full rounded-md border border-[#383838] bg-[#111] px-2.5 text-[11px] text-white outline-none focus:border-[#666]" placeholder="Optional label" />
          <label className="mt-2.5 block text-[9px] font-semibold uppercase text-[#777]">Value</label>
          <div className="relative mt-1"><input type={showValue ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} className="h-9 w-full rounded-md border border-[#383838] bg-[#111] px-2.5 pr-9 font-mono text-[11px] text-white outline-none focus:border-[#666]" placeholder={editingExisting ? 'Leave blank to keep current value' : 'Enter secret value'} /><button type="button" title={showValue ? 'Hide value' : 'Show value'} aria-label={showValue ? 'Hide value' : 'Show value'} onClick={() => setShowValue((current) => !current)} className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-[#777] hover:text-white">{showValue ? <EyeOff size={13} /> : <Eye size={13} />}</button></div>
          <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} disabled={busy !== null} className="h-8 rounded-md px-2.5 text-[10.5px] text-[#aaa] hover:bg-[#292929] hover:text-white">Cancel</button><button type="button" onClick={() => void save()} disabled={busy !== null || !name.trim() || (editing === 'new' && !value)} className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[10.5px] font-medium text-black disabled:opacity-40">{busy && <Loader2 size={11} className="animate-spin" />} Save secret</button></div>
        </section>
      )}

      <div className="min-h-0 flex-1 divide-y divide-[#292929] overflow-y-auto">
        {secrets.map((secret) => (
          <article key={secret.id} className="px-3 py-3 hover:bg-[#1c1c1c]">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#343434] bg-[#222] text-[#aaa]"><KeyRound size={13} /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-mono text-[11px] font-semibold text-white">{secret.name}</div><div className="mt-0.5 truncate text-[9.5px] text-[#666]">{secret.description || 'No description'}</div><button type="button" onClick={() => void copyReference(secret)} className="mt-1.5 flex max-w-full items-center gap-1 rounded bg-[#222] px-1.5 py-1 font-mono text-[9px] text-[#999] hover:text-white"><span className="truncate">{`{{secrets.${secret.name}}}`}</span>{copiedId === secret.id ? <Check size={10} className="shrink-0 text-green-400" /> : <Copy size={10} className="shrink-0" />}</button></div>
              <button type="button" title={`Edit ${secret.name}`} aria-label={`Edit ${secret.name}`} disabled={busy !== null} onClick={() => beginEdit(secret)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#777] hover:bg-[#292929] hover:text-white disabled:opacity-40"><Pencil size={12} /></button>
              <button type="button" title={`Delete ${secret.name}`} aria-label={`Delete ${secret.name}`} disabled={busy !== null} onClick={() => setDeleteTarget(secret.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#777] hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"><Trash2 size={12} /></button>
            </div>
            {deleteTarget === secret.id && <div className="mt-2 flex items-center justify-end gap-2 border-t border-[#303030] pt-2"><span className="mr-auto text-[9.5px] text-red-300">Delete permanently?</span><button type="button" onClick={() => setDeleteTarget(null)} className="h-7 px-2 text-[9.5px] text-[#999] hover:text-white">Cancel</button><button type="button" onClick={() => void remove(secret)} disabled={busy !== null} className="flex h-7 items-center gap-1 rounded bg-red-700 px-2 text-[9.5px] font-medium text-white disabled:opacity-40">{busy === secret.id && <Loader2 size={10} className="animate-spin" />} Delete</button></div>}
          </article>
        ))}
        {!loading && secrets.length === 0 && <div className="flex h-44 flex-col items-center justify-center px-6 text-center"><KeyRound size={20} className="text-[#555]" /><div className="mt-2 text-[11px] text-[#888]">No workflow secrets</div></div>}
        {loading && secrets.length === 0 && <div className="flex h-44 items-center justify-center text-[#666]"><Loader2 size={17} className="animate-spin" /></div>}
      </div>
    </aside>
  );
};

export default WorkflowSecretsPanel;
