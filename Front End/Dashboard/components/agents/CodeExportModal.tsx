/**
 * CodeExportModal — shows the Agents-SDK code exported for the workflow
 * (TypeScript / Python), with a copy button and a language toggle.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { Copy, Check, X, Loader2 } from 'lucide-react';
import { codeModal } from '../../lib/stores/agent-builder-store';
import type { AgentBuilderBackend } from '../../hooks/useAgentBuilderBackend';

export const CodeExportModal: React.FC<{ backend: AgentBuilderBackend }> = ({ backend }) => {
  const state = useStore(codeModal);
  const [copied, setCopied] = React.useState(false);

  if (!state.open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return createPortal(
    <AnimatePresence>
      {state.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60" onClick={() => codeModal.setKey('open', false)}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative w-full max-w-3xl h-[70vh] bg-[#1a1a1a] rounded-[14px] shadow-2xl flex flex-col overflow-hidden border border-[#2b2b2b]"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2b2b2b]">
              <div className="flex items-center gap-3">
                <h2 className="text-white text-[15px] font-semibold">Agents SDK code</h2>
                <div className="flex items-center bg-[#2b2b2b] rounded-lg p-0.5">
                  {(['typescript', 'python'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => backend.exportCode(f)}
                      className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${state.format === f ? 'bg-[#404040] text-white' : 'text-[#a1a1aa] hover:text-white'}`}
                    >
                      {f === 'typescript' ? 'TypeScript' : 'Python'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3 text-[#a1a1aa]">
                <button onClick={copy} title="Copy" className="hover:text-white transition-colors flex items-center gap-1.5 text-[12px]">
                  {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button onClick={() => codeModal.setKey('open', false)} className="hover:text-white transition-colors">
                  <X size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {state.loading ? (
                <div className="h-full flex items-center justify-center text-[#6a6a6a]">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : state.error ? (
                <div className="p-5 text-red-300 text-[13px]">{state.error}</div>
              ) : (
                <pre className="p-5 text-[#d4d4d4] text-[12.5px] leading-relaxed font-mono whitespace-pre">{state.code}</pre>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default CodeExportModal;
