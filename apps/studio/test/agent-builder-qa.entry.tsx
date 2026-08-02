import React from 'react';
import { createRoot } from 'react-dom/client';
import { AgentBuilderContent } from '@willow/agent-builder/AgentBuilder';

const QaHarness = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0e0e0e] text-white">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-amber-700/60 bg-amber-950/40 px-3 text-[11px] text-amber-200">
        <strong>TEST ONLY: Agent Builder interactive QA</strong>
        {!open && <button type="button" onClick={() => setOpen(true)} className="rounded border border-amber-700/60 px-2 py-1 hover:bg-amber-900/40">Reopen builder</button>}
      </div>
      <div className="min-h-0 flex-1">
        {open ? <AgentBuilderContent onClose={() => setOpen(false)} /> : <div className="flex h-full items-center justify-center text-sm text-[#777]">Builder closed.</div>}
      </div>
    </div>
  );
};

const root = document.getElementById('root');
if (!root) throw new Error('QA harness root is missing');
createRoot(root).render(<QaHarness />);
