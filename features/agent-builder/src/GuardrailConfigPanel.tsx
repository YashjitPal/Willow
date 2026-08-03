/**
 * GuardrailConfigPanel — the config editor for a Guardrail node.
 *
 * Toggles the four guardrail checks (PII, moderation, jailbreak,
 * hallucination) and the per-check settings each one exposes, including the
 * vector store a hallucination check grounds against.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Check, Copy, Trash2 } from 'lucide-react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { getAgentBuilderClient, type VectorStore } from './agent-builder';

export interface GuardrailConfigPanelProps {
  nodeName: string;
  onNameChange: (newName: string) => void;
  config: {
    pii?: boolean;
    moderation?: boolean;
    jailbreak?: boolean;
  hallucination?: boolean;
  continueOnError?: boolean;
  onTripwire?: 'branch' | 'stop';
  input?: string;
  settings?: {
    piiEntities?: string[];
    piiMode?: 'block' | 'mask';
    moderationCategories?: string[];
    confidenceThreshold?: number;
    hallucinationVectorStoreId?: string;
    checkModel?: string;
  };
  };
  onConfigChange: (newConfig: any) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

export const GuardrailConfigPanel: React.FC<GuardrailConfigPanelProps> = ({ nodeName, onNameChange, config, onConfigChange, onDelete, onDuplicate }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [localName, setLocalName] = useState(nodeName);
  const [vectorStores, setVectorStores] = useState<VectorStore[]>([]);
  const { apiKeys } = useUserDataContext();
  const settings = config.settings ?? {};
  const confidenceThreshold = typeof settings.confidenceThreshold === 'number' && Number.isFinite(settings.confidenceThreshold)
    ? Math.max(0, Math.min(1, settings.confidenceThreshold))
    : 0.7;

  useEffect(() => {
    if (!config.hallucination) return;
    getAgentBuilderClient(apiKeys).listVectorStores().then((response) => setVectorStores(response.stores)).catch(() => setVectorStores([]));
  }, [apiKeys, config.hallucination]);

  const updateSettings = (patch: Partial<NonNullable<typeof config.settings>>) => onConfigChange({
    ...config,
    settings: { ...settings, ...patch },
  });

  // Sync state when props change (switching nodes of same type)
  useEffect(() => {
    setLocalName(nodeName);
  }, [nodeName]);

  const handleToggle = (key: keyof typeof config) => {
    onConfigChange({
      ...config,
      [key]: !config[key],
    });
  };

  const renderToggle = (label: string, key: keyof typeof config) => (
    <div className="flex items-center justify-between shrink-0">
      <div className="flex items-center gap-1.5 text-white text-[14.5px] font-medium">
        {label}
      </div>
      <div 
        onClick={() => handleToggle(key)}
        className={`w-[42px] h-[24px] rounded-full flex items-center px-0.5 cursor-pointer transition-colors ${config[key] ? 'bg-white justify-end' : 'bg-[#404040] justify-start'}`}
      >
        <div className={`w-[20px] h-[20px] rounded-full shadow-sm ${config[key] ? 'bg-black' : 'bg-[#a1a1aa]'}`} />
      </div>
    </div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 15, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 35, mass: 0.8 }}
      className="absolute inset-x-3 top-16 max-h-[calc(100%-148px)] w-auto bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto md:inset-x-auto md:right-6 md:top-6 md:max-h-[calc(100%-48px)] md:w-[340px]"
    >
      <div 
        ref={scrollContainerRef}
        className="p-5 pb-8 flex-1 flex flex-col gap-[18px] min-h-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {/* Fixed Header */}
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-white text-[16px] font-semibold tracking-wide">
            {localName || 'Guardrails'}
          </h2>
          <div className="flex items-center gap-3 text-[#a1a1aa]">
            <button className="hover:text-white transition-colors"><BookOpen size={16} strokeWidth={2.5} /></button>
            <button type="button" title="Duplicate guardrail" aria-label="Duplicate guardrail" onClick={onDuplicate} className="hover:text-white transition-colors"><Copy size={16} strokeWidth={2.5} /></button>
            <button type="button" title="Delete guardrail" aria-label="Delete guardrail" onClick={onDelete} className="hover:text-red-400 transition-colors"><Trash2 size={16} strokeWidth={2.5} /></button>
          </div>
        </div>
        <p className="text-[#a1a1aa] text-[13px] -mt-3.5 tracking-wide shrink-0">Run moderation, PII, jailbreak or fact checks</p>

        {/* Name Setting */}
        <div className="flex items-center justify-between gap-4 mt-2 shrink-0">
          <label className="text-white text-[14.5px] font-medium">Name</label>
          <div className="w-[min(220px,60%)] h-[32px] bg-[#2b2b2b] rounded-lg px-3 flex items-center">
            <input 
              type="text" 
              className="bg-transparent border-none outline-none text-white text-[14px] w-full placeholder:text-[#6a6a6a]" 
              placeholder="Guardrails" 
              value={localName}
              onChange={(e) => {
                setLocalName(e.target.value);
                onNameChange(e.target.value);
              }}
            />
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-white text-[13px]">Input template
          <textarea rows={2} value={config.input ?? '{{workflow.input_as_text}}'} onChange={(event) => onConfigChange({ ...config, input: event.target.value })} className="w-full resize-none rounded-lg bg-[#2b2b2b] p-2.5 font-mono text-[12px] text-white outline-none" />
        </label>

        {/* Toggles */}
        <div className="flex flex-col gap-4 mt-2 mb-2">
          {renderToggle('Personally identifiable information', 'pii')}
          {renderToggle('Moderation', 'moderation')}
          {renderToggle('Jailbreak', 'jailbreak')}
          {renderToggle('Hallucination', 'hallucination')}
          {renderToggle('Continue on error', 'continueOnError')}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">On tripwire
            <select value={config.onTripwire ?? 'branch'} onChange={(event) => onConfigChange({ ...config, onTripwire: event.target.value as 'branch' | 'stop' })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none"><option value="branch">Route to fail</option><option value="stop">Stop run</option></select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Check model
            <input value={settings.checkModel ?? 'gemini-3-flash'} onChange={(event) => updateSettings({ checkModel: event.target.value })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none" />
          </label>
        </div>

        {(config.moderation || config.jailbreak || config.hallucination) && (
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Confidence threshold
            <div className="flex items-center gap-3"><input type="range" min={0} max={1} step={0.05} value={confidenceThreshold} onChange={(event) => updateSettings({ confidenceThreshold: Number(event.target.value) })} className="min-w-0 flex-1 accent-white" /><span className="w-9 text-right text-white">{confidenceThreshold.toFixed(2)}</span></div>
          </label>
        )}

        {config.pii && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between text-[12px] text-[#aaa]">PII action
              <select value={settings.piiMode ?? 'block'} onChange={(event) => updateSettings({ piiMode: event.target.value as 'block' | 'mask' })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none"><option value="block">Block</option><option value="mask">Mask and continue</option></select>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN', 'CREDIT_CARD', 'IP_ADDRESS', 'IBAN', 'API_KEY'].map((entity) => {
                const selected = settings.piiEntities ?? [];
                const checked = selected.length === 0 || selected.includes(entity);
                return <label key={entity} className="flex items-center gap-1.5 text-[10.5px] text-[#aaa]"><input type="checkbox" checked={checked} onChange={() => {
                  const all = ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN', 'CREDIT_CARD', 'IP_ADDRESS', 'IBAN', 'API_KEY'];
                  const active = selected.length === 0 ? all : selected;
                  const next = active.includes(entity) ? active.filter((value) => value !== entity) : [...active, entity];
                  updateSettings({ piiEntities: next });
                }} className="accent-white" />{entity.replaceAll('_', ' ')}</label>;
              })}
            </div>
          </div>
        )}

        {config.moderation && (
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Moderation categories
            <input value={(settings.moderationCategories ?? []).join(', ')} onChange={(event) => updateSettings({ moderationCategories: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="All categories" className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none placeholder:text-[#666]" />
          </label>
        )}

        {config.hallucination && (
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Knowledge source
            <select value={settings.hallucinationVectorStoreId ?? ''} onChange={(event) => updateSettings({ hallucinationVectorStoreId: event.target.value })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none"><option value="">Select vector store</option>{vectorStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
          </label>
        )}
      </div>
    </motion.div>
  );
};
