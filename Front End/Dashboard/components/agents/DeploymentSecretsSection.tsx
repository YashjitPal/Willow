import React from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useUserDataContext } from '../../context/UserDataContext';
import { AgentBuilderApiError, getAgentBuilderClient, type ScopedSecret } from '../../lib/agentBuilder';

interface Props {
  workflowId: string;
  deploymentId: string;
  environment: string;
}

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

export const DeploymentSecretsSection: React.FC<Props> = ({ workflowId, deploymentId, environment }) => {
  const { apiKeys } = useUserDataContext();
  const [workflowSecrets, setWorkflowSecrets] = React.useState<ScopedSecret[]>([]);
  const [overrides, setOverrides] = React.useState<ScopedSecret[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ScopedSecret | 'new' | null>(null);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [value, setValue] = React.useState('');
  const [showValue, setShowValue] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const loadEpoch = React.useRef(0);

  const load = React.useCallback(async (): Promise<ScopedSecret[] | null> => {
    const epoch = ++loadEpoch.current;
    setLoading(true); setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const [workflow, deployment] = await Promise.all([
        client.listWorkflowSecrets(workflowId),
        client.listDeploymentSecrets(deploymentId),
      ]);
      if (epoch === loadEpoch.current) {
        setWorkflowSecrets(workflow.secrets);
        setOverrides(deployment.secrets);
        return deployment.secrets;
      }
    } catch (reason) { if (epoch === loadEpoch.current) setError((reason as Error).message); }
    finally { if (epoch === loadEpoch.current) setLoading(false); }
    return null;
  }, [apiKeys, deploymentId, workflowId]);

  React.useEffect(() => {
    setWorkflowSecrets([]);
    setOverrides([]);
    setError(null);
    setBusy(null);
    setEditing(null);
    setDeleteTarget(null);
    void load();
  }, [load]);

  const beginCreate = (inherited?: ScopedSecret) => {
    setEditing('new');
    setName(inherited?.name ?? '');
    setDescription(inherited?.description ?? '');
    setValue(''); setShowValue(false); setError(null);
  };

  const beginEdit = (secret: ScopedSecret) => {
    setEditing(secret); setName(secret.name); setDescription(secret.description ?? '');
    setValue(''); setShowValue(false); setDeleteTarget(null); setError(null);
  };

  const save = async () => {
    if (!editing) return;
    const normalizedName = name.trim().toUpperCase();
    if (!SECRET_NAME.test(normalizedName)) { setError('Use uppercase letters, numbers, and underscores.'); return; }
    if (editing === 'new' && !value) { setError('A value is required for a deployment override.'); return; }
    setBusy(editing === 'new' ? 'new' : editing.id); setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const result = editing === 'new'
        ? await client.createDeploymentSecret(deploymentId, { name: normalizedName, value, ...(description.trim() ? { description: description.trim() } : {}) })
        : await client.updateDeploymentSecret(deploymentId, editing.id, { expectedRevision: editing.revision, name: normalizedName, description: description.trim(), ...(value ? { value } : {}) });
      setOverrides((current) => [result.secret, ...current.filter((item) => item.id !== result.secret.id)]);
      setEditing(null); setValue('');
    } catch (reason) {
      if (reason instanceof AgentBuilderApiError && reason.status === 409) {
        setError('This override changed elsewhere. Latest values reloaded.');
        const latestOverrides = await load();
        if (editing !== 'new') {
          const latest = latestOverrides?.find((secret) => secret.id === editing.id);
          setEditing(latest ?? null);
        }
      }
      else setError((reason as Error).message);
    } finally { setBusy(null); }
  };

  const remove = async (secret: ScopedSecret) => {
    setBusy(secret.id); setError(null);
    try {
      await getAgentBuilderClient(apiKeys).deleteDeploymentSecret(deploymentId, secret.id, secret.revision);
      setOverrides((current) => current.filter((item) => item.id !== secret.id));
      setDeleteTarget(null);
      if (editing !== 'new' && editing?.id === secret.id) setEditing(null);
    } catch (reason) {
      if (reason instanceof AgentBuilderApiError && reason.status === 409) { setError('This override changed elsewhere. Latest values reloaded.'); await load(); }
      else setError((reason as Error).message);
    } finally { setBusy(null); }
  };

  const overrideNames = new Set(overrides.map((secret) => secret.name));
  const inherited = workflowSecrets.filter((secret) => !overrideNames.has(secret.name)).sort((a, b) => a.name.localeCompare(b.name));
  const sortedOverrides = [...overrides].sort((a, b) => a.name.localeCompare(b.name));
  const editingExisting = editing !== null && editing !== 'new';

  return (
    <details className="rounded border border-[#292929] bg-[#1b1b1b] p-2 text-[9.5px] text-[#777]">
      <summary className="cursor-pointer text-[#aaa]">Environment secret overrides ({overrides.length})</summary>
      <div className="mt-2 border-t border-[#292929] pt-2">
        <div className="flex items-center gap-1.5"><KeyRound size={11} /><span className="min-w-0 flex-1 truncate">{environment}</span><button type="button" title="Refresh secrets" onClick={() => void load()} disabled={loading || busy !== null} className="text-[#777] hover:text-white disabled:opacity-40"><RefreshCw size={10} className={loading ? 'animate-spin' : ''} /></button><button type="button" title="Add deployment override" onClick={() => beginCreate()} disabled={busy !== null} className="text-[#777] hover:text-white disabled:opacity-40"><Plus size={11} /></button></div>
        {error && <div role="alert" className="mt-2 rounded border border-red-900/50 bg-red-950/20 px-2 py-1.5 text-red-300">{error}</div>}

        {editing && <div className="mt-2 space-y-1.5 border-y border-[#303030] py-2"><div className="flex items-center justify-between text-[#bbb]"><span>{editing === 'new' ? 'New override' : `Edit ${editing.name}`}</span><button type="button" title="Close editor" onClick={() => setEditing(null)}><X size={10} /></button></div><input value={name} onChange={(event) => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} maxLength={128} spellCheck={false} autoCapitalize="characters" placeholder="SECRET_NAME" className="h-7 w-full rounded border border-[#333] bg-[#151515] px-2 font-mono text-[9.5px] text-white outline-none" /><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Description" className="h-7 w-full rounded border border-[#333] bg-[#151515] px-2 text-[9.5px] text-white outline-none" /><div className="relative"><input type={showValue ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} placeholder={editingExisting ? 'Leave blank to keep current value' : 'Override value'} className="h-7 w-full rounded border border-[#333] bg-[#151515] px-2 pr-7 font-mono text-[9.5px] text-white outline-none" /><button type="button" title={showValue ? 'Hide value' : 'Show value'} aria-label={showValue ? 'Hide value' : 'Show value'} onClick={() => setShowValue((current) => !current)} className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center text-[#666] hover:text-white">{showValue ? <EyeOff size={10} /> : <Eye size={10} />}</button></div><button type="button" onClick={() => void save()} disabled={busy !== null || !name.trim() || (editing === 'new' && !value)} className="flex h-7 w-full items-center justify-center gap-1 rounded bg-white text-[9.5px] font-medium text-black disabled:opacity-40">{busy && <Loader2 size={10} className="animate-spin" />} Save override</button></div>}

        <div className="mt-2 space-y-1.5">
          {sortedOverrides.map((secret) => <div key={secret.id} className="rounded border border-[#343434] bg-[#202020] px-2 py-1.5"><div className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-white">{secret.name}</span><span className="rounded bg-cyan-950/50 px-1 py-0.5 text-[8px] text-cyan-300">{workflowSecrets.some((item) => item.name === secret.name) ? 'Override' : 'Environment'}</span><button type="button" title={`Edit ${secret.name}`} onClick={() => beginEdit(secret)} disabled={busy !== null} className="text-[#666] hover:text-white"><Pencil size={9} /></button><button type="button" title={`Delete ${secret.name}`} onClick={() => setDeleteTarget(secret.id)} disabled={busy !== null} className="text-[#666] hover:text-red-300"><Trash2 size={9} /></button></div>{secret.description && <div className="mt-0.5 truncate text-[8.5px] text-[#666]">{secret.description}</div>}{deleteTarget === secret.id && <div className="mt-1.5 flex items-center gap-1 border-t border-[#303030] pt-1.5"><span className="mr-auto text-[8.5px] text-red-300">{workflowSecrets.some((item) => item.name === secret.name) ? 'Restore workflow fallback?' : 'Delete environment secret?'}</span><button type="button" onClick={() => setDeleteTarget(null)} className="px-1 text-[#888]">Cancel</button><button type="button" onClick={() => void remove(secret)} className="rounded bg-red-700 px-1.5 py-0.5 text-white">Delete</button></div>}</div>)}
          {inherited.map((secret) => <div key={secret.id} className="flex items-center gap-1.5 px-2 py-1"><span className="min-w-0 flex-1 truncate font-mono text-[9px] text-[#999]">{secret.name}</span><span className="text-[8px] text-[#555]">Workflow</span><button type="button" onClick={() => beginCreate(secret)} disabled={busy !== null} className="rounded border border-[#333] px-1.5 py-0.5 text-[8px] text-[#aaa] hover:text-white">Override</button></div>)}
          {!loading && sortedOverrides.length === 0 && inherited.length === 0 && <div className="py-3 text-center text-[#555]">No workflow or environment secrets</div>}
        </div>
      </div>
    </details>
  );
};

export default DeploymentSecretsSection;
