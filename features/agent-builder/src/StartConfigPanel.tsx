/**
 * StartConfigPanel — the config editor for the workflow Start node.
 *
 * Declares the workflow's input and state variables: the typed fields a run is
 * started with, and the mutable state other nodes read and write. The add-variable
 * popup closes on canvas pan and on outside clicks so it cannot outlive its anchor.
 *
 * The inner AnimatePresence tree moves as one unit: its motion.div child must stay a
 * direct child of the presence boundary or the popup exit animation stops running.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Plus, Trash2 } from 'lucide-react';
import { useOnViewportChange } from '@xyflow/react';

const InputTextIcon: React.FC<{ className?: string; size?: number }> = ({ className, size = 16 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="16" height="16" x="4" y="4" rx="4" />
    <path d="M8 8h3" />
    <path d="M14 8h2" />
    <path d="M8 12h5" />
    <path d="M8 16h8" />
  </svg>
);

export const StartConfigPanel: React.FC<{ config: Record<string, any>; onConfigChange: (config: Record<string, any>) => void }> = ({ config, onConfigChange }) => {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('String');
  const [variableKind, setVariableKind] = useState<'input' | 'state'>('input');
  const [variableName, setVariableName] = useState('');
  const [variableDescription, setVariableDescription] = useState('');
  const [defaultValue, setDefaultValue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const types = ['String', 'Number', 'Boolean', 'Object', 'List'];
  const inputVariables = (Array.isArray(config.inputVariables) ? config.inputVariables : []).filter((variable: any) => variable.name !== 'input_as_text');
  const stateVariables = Array.isArray(config.stateVariables) ? config.stateVariables : [];

  const removeVariable = (kind: 'input' | 'state', index: number) => {
    if (kind === 'input') onConfigChange({ ...config, inputVariables: inputVariables.filter((_: any, candidate: number) => candidate !== index) });
    else onConfigChange({ ...config, stateVariables: stateVariables.filter((_: any, candidate: number) => candidate !== index) });
  };

  const saveVariable = () => {
    const name = variableName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setFormError('Use a letter or underscore followed by letters, numbers, or underscores.');
      return;
    }
    if ([...inputVariables, ...stateVariables].some((variable: any) => variable.name === name)) {
      setFormError(`Variable '${name}' already exists.`);
      return;
    }
    const type = selectedType.toLowerCase() === 'list' ? 'list' : selectedType.toLowerCase();
    let parsedDefault: unknown = undefined;
    if (defaultValue.trim()) {
      try {
        if (type === 'number') {
          parsedDefault = Number(defaultValue);
          if (!Number.isFinite(parsedDefault)) throw new Error('Enter a valid number.');
        } else if (type === 'boolean') {
          if (!['true', 'false'].includes(defaultValue.trim().toLowerCase())) throw new Error('Enter true or false.');
          parsedDefault = defaultValue.trim().toLowerCase() === 'true';
        } else if (type === 'object' || type === 'list') {
          parsedDefault = JSON.parse(defaultValue);
          if (type === 'object' && (!parsedDefault || typeof parsedDefault !== 'object' || Array.isArray(parsedDefault))) throw new Error('Enter a JSON object.');
          if (type === 'list' && !Array.isArray(parsedDefault)) throw new Error('Enter a JSON array.');
        } else parsedDefault = defaultValue;
      } catch (error) {
        setFormError((error as Error).message);
        return;
      }
    }
    if (variableKind === 'input') {
      onConfigChange({
        ...config,
        inputVariables: [...inputVariables, { name, type, ...(variableDescription.trim() ? { description: variableDescription.trim() } : {}), ...(parsedDefault !== undefined ? { defaultValue: parsedDefault } : {}) }],
      });
    } else {
      onConfigChange({ ...config, stateVariables: [...stateVariables, { name, type, ...(parsedDefault !== undefined ? { initialValue: parsedDefault } : {}) }] });
    }
    setVariableName('');
    setVariableDescription('');
    setDefaultValue('');
    setFormError(null);
    setIsAddMenuOpen(false);
  };

  useOnViewportChange({
    onStart: () => {
      setIsAddMenuOpen(false);
    }
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Use globalThis.Node to disambiguate from ReactFlow's Node type
      const target = event.target as globalThis.Node;
      const el = event.target as HTMLElement;

      if (
        menuRef.current && !menuRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        // If the click is inside the main StartConfigPanel itself (but outside the popup/add button), 
        // we deliberately trigger the smooth fade out.
        // If the click is entirely outside the StartConfigPanel (e.g. on the React Flow canvas),
        // we do nothing and let React Flow native unmount routine completely obliterate the pane instantly.
        if (panelRef.current && !panelRef.current.contains(target)) {
          return;
        }

        setIsAddMenuOpen(false);
      }
    };

    if (isAddMenuOpen) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isAddMenuOpen]);

  return (
    <motion.div 
      ref={panelRef}
      initial={{ opacity: 0, x: 20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 15, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 35, mass: 0.8 }}
      className="absolute inset-x-3 top-16 max-h-[calc(100%-148px)] w-auto bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto md:inset-x-auto md:right-6 md:top-6 md:max-h-[calc(100%-48px)] md:w-[340px]"
    >
      <div className="p-5 flex-1 flex flex-col min-h-0 relative">
        <h2 className="text-white text-[16px] font-semibold tracking-wide">
          Start
        </h2>
        <p className="text-[#a1a1aa] text-[13px] mt-1 tracking-wide">
          Define the workflow inputs
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <h3 className="text-white text-[14.5px] font-medium tracking-wide">Input variables</h3>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-white">
              <InputTextIcon className="text-[#22c55e]" size={16} />
              <span className="text-[14.5px]">input_as_text</span>
            </div>
            <span className="text-[#a1a1aa] text-[13px]">string</span>
          </div>
          {inputVariables.map((variable: any, index: number) => (
            <div key={variable.name || index} className="flex items-center gap-2 rounded-lg bg-[#242424] px-3 py-2">
              <InputTextIcon className="text-[#22c55e]" size={15} />
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] text-white">{variable.name}</div>{(variable.description || variable.defaultValue !== undefined) && <div className="truncate text-[10px] text-[#777]">{variable.description || `Default: ${JSON.stringify(variable.defaultValue)}`}</div>}</div>
              <span className="text-[10px] font-semibold uppercase text-[#888]">{variable.type}</span>
              <button type="button" title={`Delete ${variable.name}`} onClick={() => removeVariable('input', index)} className="text-[#666] hover:text-red-300"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <h3 className="text-white text-[14.5px] font-medium tracking-wide">State variables</h3>
          {stateVariables.map((variable: any, index: number) => (
            <div key={variable.name || index} className="flex items-center gap-2 rounded-lg bg-[#242424] px-3 py-2">
              <Database size={14} className="text-sky-400" />
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] text-white">{variable.name}</div>{variable.initialValue !== undefined && <div className="truncate text-[10px] text-[#777]">{JSON.stringify(variable.initialValue)}</div>}</div>
              <span className="text-[10px] font-semibold uppercase text-[#888]">{variable.type}</span>
              <button type="button" title={`Delete ${variable.name}`} onClick={() => removeVariable('state', index)} className="text-[#666] hover:text-red-300"><Trash2 size={13} /></button>
            </div>
          ))}
          <button 
            ref={buttonRef}
            onClick={(e) => {
              e.stopPropagation();
              setIsAddMenuOpen(!isAddMenuOpen);
            }}
            className="flex items-center justify-center gap-1.5 w-[76px] h-[32px] bg-[#2b2b2b] hover:bg-[#333] transition-colors rounded-full text-white text-[14px] font-medium"
          >
            <Plus size={16} strokeWidth={2.5} className="text-[#a1a1aa]" /> Add
          </button>
        </div>

        {/* Add State Variable Popup Menu */}
        <AnimatePresence>
          {isAddMenuOpen && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute right-0 top-[102%] w-[400px] bg-[#2a2a2a] rounded-[16px] shadow-xl p-4 flex flex-col gap-4 border border-[#3a3a3a] z-50"
            >
              {/* Type Selector Tabs */}
              <div className="grid grid-cols-2 rounded-[10px] bg-[#141414] p-1">
                <button type="button" onClick={() => setVariableKind('input')} className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium ${variableKind === 'input' ? 'bg-[#3b3b3b] text-white' : 'text-[#999]'}`}>Workflow input</button>
                <button type="button" onClick={() => setVariableKind('state')} className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium ${variableKind === 'state' ? 'bg-[#3b3b3b] text-white' : 'text-[#999]'}`}>State variable</button>
              </div>
              <div className="flex items-center bg-[#141414] rounded-[10px] p-1 w-full justify-between">
                {types.map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`flex-1 min-w-max px-3 py-1.5 rounded-[8px] text-[13px] font-medium transition-colors ${
                      selectedType === type
                        ? 'bg-[#3b3b3b] text-white shadow-sm'
                        : 'text-[#a1a1aa] hover:text-white hover:bg-[#222]'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {/* Name Input */}
              <div className="flex flex-col gap-2">
                <label className="text-white text-[14px] font-medium">Name</label>
                <input
                  type="text"
                  placeholder="Enter the variable name"
                  value={variableName}
                  onChange={(event) => { setVariableName(event.target.value); setFormError(null); }}
                  className="w-full bg-[#3b3b3b]/50 border-transparent rounded-[8px] px-3 py-2 text-[14px] text-white placeholder:text-[#888] focus:outline-none focus:ring-0 focus:border-transparent transition-colors font-medium"
                />
              </div>

              {variableKind === 'input' && <div className="flex flex-col gap-2"><label className="text-white text-[14px] font-medium">Description <span className="text-[#6a6a6a] font-normal">Optional</span></label><input value={variableDescription} onChange={(event) => setVariableDescription(event.target.value)} placeholder="How this input is used" className="w-full rounded-[8px] bg-[#3b3b3b]/50 px-3 py-2 text-[14px] text-white outline-none placeholder:text-[#888]" /></div>}
              <div className="flex flex-col gap-2"><label className="text-white text-[14px] font-medium">Default value <span className="text-[#6a6a6a] font-normal">Optional</span></label><input value={defaultValue} onChange={(event) => { setDefaultValue(event.target.value); setFormError(null); }} placeholder={selectedType === 'Object' ? '{}' : selectedType === 'List' ? '[]' : variableKind === 'input' ? 'Makes this input optional' : 'Initial value'} className="w-full rounded-[8px] bg-[#3b3b3b]/50 px-3 py-2 text-[14px] text-white outline-none placeholder:text-[#888]" /></div>
              {formError && <div className="text-[12px] text-red-300">{formError}</div>}

              {/* Save Button */}
              <div className="flex justify-end mt-1">
                <button
                  onClick={saveVariable}
                  className="px-5 py-2 bg-white hover:bg-gray-100 text-black text-[14px] font-medium rounded-full transition-colors"
                >
                  Save
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
};
