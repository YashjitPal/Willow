import React from 'react';
import { useStore } from '@nanostores/react';
import { experimentsStore, setExperiment, type ExperimentId } from '@willow/core/experiments-store';

/**
 * Switch for a Labs experiment.
 *
 * The markup matches the static toggles already on this tab so an experiment
 * that is wired up is visually indistinguishable from one that is not.
 */
const ExperimentToggle: React.FC<{
  id: ExperimentId;
  enabled: boolean;
  label: string;
}> = ({ id, enabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={enabled}
    aria-label={label}
    onClick={() => setExperiment(id, !enabled)}
    className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5 shrink-0"
  >
    <div
      className={`w-3.5 h-3.5 rounded-full transition-all group-hover:bg-zinc-500 ${
        enabled ? 'translate-x-[16px] bg-white' : '-translate-x-0 bg-zinc-600'
      }`}
    />
  </button>
);

export const LabsTab: React.FC = () => {
  const experiments = useStore(experimentsStore);

  return (
    <div className="w-full h-full px-12 py-10 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[24px] font-bold text-white">Labs</h1>
      </div>

      <div className="pb-6 border-b border-white/5 mb-0">
        <p className="text-[14px] text-zinc-400">
          These are experimental features, that might be modified or removed.
        </p>
      </div>

      <div className="space-y-0 pb-10">
        {/* Darker Design Background */}
        <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
          <div className="flex-1 max-w-[60%]">
            <h3 className="text-[14px] font-bold text-white mb-1">Darker Design Background</h3>
            <p className="text-[14px] text-zinc-400">
              Applies a darker pitch-black background to the Design tab instead of the default dark gray.
            </p>
          </div>
          <ExperimentToggle
            id="darker-design-background"
            enabled={experiments['darker-design-background']}
            label="Darker Design Background"
          />
        </div>

        {/* GitHub branch switching */}
        <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
          <div className="flex-1 max-w-[60%]">
            <h3 className="text-[14px] font-bold text-white mb-1">GitHub branch switching</h3>
            <p className="text-[14px] text-zinc-400">Select the branch to make edits to in your GitHub repository.</p>
          </div>
          <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
            <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all group-hover:bg-zinc-500 translate-x-[16px] !bg-white" />
          </div>
        </div>

         {/* Prototyping */}
         <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
          <div className="flex-1 max-w-[60%]">
            <h3 className="text-[14px] font-bold text-white mb-1">Prototyping</h3>
            <p className="text-[14px] text-zinc-400">Build and share AI-powered mini-apps using natural language prompts.</p>
          </div>
           <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
            <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all -translate-x-0 group-hover:bg-zinc-500" />
          </div>
        </div>

         {/* Designing */}
         <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
          <div className="flex-1 max-w-[60%]">
            <h3 className="text-[14px] font-bold text-white mb-1">Designing</h3>
            <p className="text-[14px] text-zinc-400">Generate production-ready UI designs and code from text or sketches.</p>
          </div>
           <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
            <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all -translate-x-0 group-hover:bg-zinc-500" />
          </div>
        </div>

      </div>
    </div>
  );
};
