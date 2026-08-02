import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Search, X } from 'lucide-react';

export interface WorkflowVariableSource {
  id: string;
  label: string;
  path: string;
  kind: 'input' | 'state' | 'node';
  type?: string;
}

interface VariablePickerProps {
  sources: WorkflowVariableSource[];
  mode?: 'template' | 'expression';
  onInsert: (value: string) => void;
  label?: string;
}

export const VariablePicker: React.FC<VariablePickerProps> = ({ sources, mode = 'template', onInsert, label = 'Insert variable' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sources;
    return sources.filter((source) => `${source.label} ${source.path} ${source.kind} ${source.type ?? ''}`.toLowerCase().includes(normalized));
  }, [query, sources]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const insert = (source: WorkflowVariableSource) => {
    onInsert(mode === 'template' ? `{{${source.path}}}` : source.path);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="relative">
      <button type="button" title={label} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#888] hover:bg-[#333] hover:text-white">
        <Braces size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-72 overflow-hidden rounded-md border border-[#3a3a3a] bg-[#1d1d1d] shadow-2xl">
          <div className="flex h-9 items-center gap-2 border-b border-[#333] px-2.5">
            <Search size={13} className="shrink-0 text-[#666]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Search variables and outputs" aria-label="Search variables and outputs" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-white outline-none placeholder:text-[#666]" />
            {query && <button type="button" title="Clear search" aria-label="Clear variable search" onClick={() => setQuery('')} className="text-[#666] hover:text-white"><X size={12} /></button>}
          </div>
          <div role="listbox" aria-label="Workflow variables and node outputs" className="max-h-64 overflow-y-auto py-1">
            {filtered.map((source) => (
              <button key={source.id} type="button" role="option" aria-selected="false" onClick={() => insert(source)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#292929]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${source.kind === 'input' ? 'bg-emerald-300' : source.kind === 'state' ? 'bg-amber-300' : 'bg-blue-300'}`} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] text-[#ddd]">{source.label}</span><code className="block truncate text-[9.5px] text-[#777]">{mode === 'template' ? `{{${source.path}}}` : source.path}</code></span>
                {source.type && <span className="shrink-0 text-[8.5px] uppercase text-[#666]">{source.type}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3 py-6 text-center text-[11px] text-[#666]">No matching variables.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

