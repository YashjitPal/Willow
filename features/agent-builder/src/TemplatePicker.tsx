/**
 * TemplatePicker — the workflow template catalog overlay.
 *
 * Lists templates from the backend catalog, filters them by search text,
 * category, and tag, and previews the graph shape, data contracts, and safety
 * findings of the selected one before the caller creates a workflow from it.
 */

import React, { useEffect, useState } from 'react';
import { ChevronRight, LayoutTemplate, Loader2, Search, X } from 'lucide-react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { getAgentBuilderClient, type NodeDataContract, type WorkflowTemplate } from './agent-builder';

export const TemplatePicker: React.FC<{
  onClose: () => void;
  onUse: (template: WorkflowTemplate) => void | Promise<void>;
}> = ({ onClose, onUse }) => {
  type CatalogTemplate = WorkflowTemplate & {
    tags?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    preview?: {
      nodes?: Array<{ id: string; type: string; name: string }>;
      edges?: Array<{ source: string; target: string; sourceHandle?: string }>;
      contracts?: NodeDataContract[];
      safetyFindings?: Array<{ code: string; severity: string; message: string; remediation?: string; nodeId?: string }>;
      riskFactors?: Array<{ code: string; level: 'low' | 'medium' | 'high'; nodeId: string; message: string }>;
    };
  };
  const { apiKeys } = useUserDataContext();
  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAgentBuilderClient(apiKeys).listWorkflowTemplates()
      .then((response) => {
        if (active) {
          const catalog = response.templates as CatalogTemplate[];
          setTemplates(catalog);
          setSelectedId((current) => current || catalog[0]?.id || '');
        }
      })
      .catch((err) => active && setError((err as Error).message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [apiKeys, reloadKey]);

  const categories = [...new Set(templates.flatMap((template) => template.categories))].sort();
  const tags = [...new Set(templates.flatMap((template) => template.tags ?? []))].sort();
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTemplates = templates.filter((template) => {
    if (category !== 'all' && !template.categories.includes(category)) return false;
    if (tag !== 'all' && !(template.tags ?? []).includes(tag)) return false;
    if (!normalizedQuery) return true;
    return [template.name, template.description, ...template.categories, ...(template.tags ?? [])]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const selectedTemplate = filteredTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0];
  const riskClass = selectedTemplate?.riskLevel === 'high'
    ? 'border-red-800/70 bg-red-950/30 text-red-200'
    : selectedTemplate?.riskLevel === 'medium'
      ? 'border-amber-800/70 bg-amber-950/30 text-amber-200'
      : 'border-green-900/70 bg-green-950/20 text-green-200';

  const createFromTemplate = async (template: CatalogTemplate) => {
    setCreatingId(template.id);
    setError(null);
    try {
      await onUse(template);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="flex h-[min(720px,calc(100%_-_48px))] w-[min(980px,calc(100%_-_48px))] flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#1a1a1a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <LayoutTemplate size={17} className="text-[#93dfca]" />
            <div><h2 className="text-white text-[16px] font-semibold">Workflow templates</h2><p className="mt-0.5 text-[11px] text-[#777]">Inspect the graph shape and contracts before creating a workflow.</p></div>
          </div>
          <button title="Close templates" onClick={onClose} className="text-[#8a8a8a] hover:text-white"><X size={17} /></button>
        </div>
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[#777]"><Loader2 size={18} className="animate-spin" /><span className="text-[11px]">Loading template catalog</span></div>
        ) : error && templates.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><div className="max-w-md text-[12px] text-red-300">{error}</div><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="rounded-md border border-[#3a3a3a] px-3 py-1.5 text-[11px] text-[#bbb] hover:text-white">Retry</button></div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-[#303030] bg-[#171717]">
              <div className="space-y-2 border-b border-[#303030] p-3">
                <label className="flex h-9 items-center gap-2 rounded-md border border-[#333] bg-[#222] px-2.5"><Search size={13} className="text-[#666]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-white outline-none placeholder:text-[#666]" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Template category" className="h-8 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-[#bbb] outline-none"><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                  <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Template tag" className="h-8 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-[#bbb] outline-none"><option value="all">All tags</option>{tags.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {filteredTemplates.map((template) => (
                  <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`mb-2 block w-full rounded-md border p-3 text-left ${selectedTemplate?.id === template.id ? 'border-[#555] bg-[#292929]' : 'border-[#2d2d2d] bg-[#202020] hover:border-[#444]'}`}>
                    <div className="flex items-start justify-between gap-2"><span className="text-[12px] font-semibold text-white">{template.name}</span><span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase ${template.riskLevel === 'high' ? 'border-red-800 text-red-300' : template.riskLevel === 'medium' ? 'border-amber-800 text-amber-300' : 'border-green-900 text-green-300'}`}>{template.riskLevel ?? 'low'}</span></div>
                    <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-[#888]">{template.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">{template.categories.map((value) => <span key={value} className="rounded bg-[#303030] px-1.5 py-0.5 text-[8px] uppercase text-[#999]">{value}</span>)}{(template.tags ?? []).slice(0, 3).map((value) => <span key={value} className="rounded border border-[#383838] px-1.5 py-0.5 text-[8px] text-[#777]">{value}</span>)}</div>
                  </button>
                ))}
                {filteredTemplates.length === 0 && <div className="flex h-48 flex-col items-center justify-center px-5 text-center"><LayoutTemplate size={18} className="mb-2 text-[#555]" /><div className="text-[11.5px] text-[#777]">No templates match these filters.</div><button type="button" onClick={() => { setQuery(''); setCategory('all'); setTag('all'); }} className="mt-2 text-[10.5px] text-[#aaa] hover:text-white">Clear filters</button></div>}
              </div>
            </aside>
            <main className="min-w-0 overflow-y-auto p-5">
              {selectedTemplate ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4"><div><h3 className="text-[15px] font-semibold text-white">{selectedTemplate.name}</h3><p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-[#888]">{selectedTemplate.description}</p></div><span className={`shrink-0 rounded-md border px-2 py-1 text-[9px] font-semibold uppercase ${riskClass}`}>{selectedTemplate.riskLevel ?? 'low'} risk</span></div>
                  <section className="rounded-md border border-[#303030] bg-[#181818]">
                    <div className="flex items-center justify-between border-b border-[#303030] px-3 py-2 text-[9px] font-semibold uppercase text-[#777]"><span>Node flow</span><span>{selectedTemplate.preview?.nodes?.length ?? 0} nodes | {selectedTemplate.preview?.edges?.length ?? 0} edges</span></div>
                    <div className="flex min-h-20 flex-wrap items-center gap-1.5 p-3">{(selectedTemplate.preview?.nodes ?? []).map((node, index, nodes) => <React.Fragment key={node.id}><div className="rounded-md border border-[#383838] bg-[#242424] px-2 py-1.5"><div className="text-[9px] font-semibold uppercase text-[#666]">{node.type}</div><div className="mt-0.5 max-w-28 truncate text-[10.5px] text-[#ddd]">{node.name}</div></div>{index < nodes.length - 1 && <ChevronRight size={12} className="text-[#555]" />}</React.Fragment>)}{!selectedTemplate.preview?.nodes?.length && <span className="text-[10.5px] text-[#666]">Node preview unavailable.</span>}</div>
                  </section>
                  <div className="grid grid-cols-2 gap-3">
                    <section className="rounded-md border border-[#303030] bg-[#202020] p-3"><div className="mb-2 text-[9px] font-semibold uppercase text-[#777]">Data contracts</div><div className="max-h-44 space-y-2 overflow-y-auto">{(selectedTemplate.preview?.contracts ?? []).filter((contract) => contract.outputs.length > 0).slice(0, 6).map((contract) => <div key={contract.nodeId}><div className="text-[10.5px] font-medium text-[#ccc]">{contract.nodeName}</div><div className="mt-1 flex flex-wrap gap-1">{contract.outputs.map((field) => <span key={field.name} className="rounded bg-[#292929] px-1.5 py-0.5 font-mono text-[8.5px] text-[#999]">{field.name}: {field.type}</span>)}</div></div>)}{!(selectedTemplate.preview?.contracts ?? []).some((contract) => contract.outputs.length > 0) && <div className="text-[10.5px] text-[#666]">No structured outputs declared.</div>}</div></section>
                    <section className="rounded-md border border-[#303030] bg-[#202020] p-3"><div className="mb-2 flex items-center justify-between text-[9px] font-semibold uppercase text-[#777]"><span>Risk and safety</span><span>{selectedTemplate.preview?.safetyFindings?.length ?? 0} findings</span></div><div className="max-h-44 space-y-2 overflow-y-auto">{(selectedTemplate.preview?.riskFactors ?? []).slice(0, 3).map((factor) => <div key={`${factor.code}-${factor.nodeId}`} className={`border-l-2 pl-2 ${factor.level === 'high' ? 'border-red-500' : factor.level === 'medium' ? 'border-amber-400' : 'border-green-600'}`}><div className="text-[9px] font-semibold text-[#aaa]">{factor.code.replaceAll('_', ' ')}</div><div className="mt-0.5 text-[10px] leading-relaxed text-[#888]">{factor.message}</div></div>)}{(selectedTemplate.preview?.safetyFindings ?? []).slice(0, 6).map((finding) => <div key={`${finding.code}-${finding.nodeId ?? ''}`} className={`border-l-2 pl-2 ${finding.severity === 'high' ? 'border-red-500' : 'border-amber-400'}`}><div className="text-[9px] font-semibold text-[#aaa]">{finding.code}</div><div className="mt-0.5 text-[10px] leading-relaxed text-[#888]">{finding.message}</div></div>)}{!selectedTemplate.preview?.safetyFindings?.length && <div className="text-[10.5px] text-green-300/70">No unsafe configuration findings.</div>}</div></section>
                  </div>
                  {error && <div className="rounded-md border border-red-900/60 bg-red-950/20 p-2.5 text-[11px] text-red-300">{error}</div>}
                  <div className="flex justify-end"><button type="button" disabled={creatingId !== null} onClick={() => void createFromTemplate(selectedTemplate)} className="flex h-9 items-center gap-1.5 rounded-md bg-white px-3.5 text-[11.5px] font-medium text-black hover:bg-[#e5e5e5] disabled:opacity-50">{creatingId === selectedTemplate.id ? <Loader2 size={13} className="animate-spin" /> : <LayoutTemplate size={13} />} Create workflow</button></div>
                </div>
              ) : <div className="flex h-full items-center justify-center text-[11px] text-[#666]">Select a template to inspect it.</div>}
            </main>
          </div>
        )}
      </div>
    </div>
  );
};
