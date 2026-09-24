import React from 'react';
import { useStore } from '@nanostores/react';
import { useThemeMode } from '@willow/core/theme-mode';
import { experimentsStore, setExperiment, type ExperimentId } from '@willow/core/experiments-store';
import { LABS_DESCRIPTION, LABS_EXPERIMENTS } from '../labs-experiments';

/**
 * Labs, inside the settings modal.
 *
 * The rows come from `settings/labs-experiments.ts`, which the standalone
 * `tabs/labs/LabsPage.tsx` renders too — the same arrangement Models & API has,
 * where both surfaces read one roster so neither can offer an experiment the
 * other hides. The flags live in `experimentsStore`, which is the single writer,
 * so this tab and that page are never out of step.
 *
 * The drawing is this file's own and stays deliberately dialog-shaped: 14px type
 * on dividers, not the page's cards.
 */

/**
 * Switch for a Labs experiment.
 */
const ExperimentToggle: React.FC<{
  id: ExperimentId;
  enabled: boolean;
  label: string;
  isLight?: boolean;
}> = ({ id, enabled, label, isLight = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={enabled}
    aria-label={label}
    onClick={() => setExperiment(id, !enabled)}
    className={`w-9 h-5 rounded-full p-0.5 cursor-pointer relative group border shrink-0 transition-colors ${
      enabled
        ? isLight
          ? 'bg-[#0b57d0] border-[#0b57d0]'
          : 'bg-zinc-800 border-white/5'
        : isLight
          ? 'bg-zinc-200 border-zinc-300'
          : 'bg-zinc-800 border-white/5'
    }`}
  >
    <div
      className={`w-3.5 h-3.5 rounded-full transition-all ${
        enabled
          ? 'translate-x-[16px] bg-white'
          : isLight
            ? '-translate-x-0 bg-zinc-500'
            : '-translate-x-0 bg-zinc-600 group-hover:bg-zinc-500'
      }`}
    />
  </button>
);

/**
 * The same switch for a row with no flag behind it.
 */
const StaticToggle: React.FC<{ enabled: boolean; isLight?: boolean }> = ({ enabled, isLight = false }) => (
  <div
    className={`w-9 h-5 rounded-full p-0.5 cursor-pointer relative group border shrink-0 ${
      enabled
        ? isLight
          ? 'bg-[#0b57d0] border-[#0b57d0]'
          : 'bg-zinc-800 border-white/5'
        : isLight
          ? 'bg-zinc-200 border-zinc-300'
          : 'bg-zinc-800 border-white/5'
    }`}
  >
    <div
      className={`w-3.5 h-3.5 rounded-full transition-all ${
        enabled
          ? 'translate-x-[16px] !bg-white'
          : isLight
            ? '-translate-x-0 bg-zinc-500'
            : '-translate-x-0 bg-zinc-600'
      }`}
    />
  </div>
);

export const LabsTab: React.FC = () => {
  const { isLight } = useThemeMode();
  const experiments = useStore(experimentsStore);

  return (
    <div className="w-full h-full px-12 py-10 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className={`text-[24px] font-bold ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Labs</h1>
      </div>

      <div className={`pb-6 border-b ${isLight ? 'border-black/10' : 'border-white/5'} mb-0`}>
        <p className={`text-[14px] ${isLight ? 'text-[#444746]' : 'text-zinc-400'}`}>{LABS_DESCRIPTION}</p>
      </div>

      <div className="space-y-0 pb-10">
        {LABS_EXPERIMENTS.map((row) => (
          <div
            key={row.id ?? row.title}
            className={`py-6 border-b ${isLight ? 'border-black/10' : 'border-white/5'} flex items-start justify-between gap-8`}
          >
            <div className="flex-1 max-w-[60%]">
              <h3 className={`text-[14px] font-bold ${isLight ? 'text-[#1f1f1f]' : 'text-white'} mb-1`}>{row.title}</h3>
              <p className={`text-[14px] ${isLight ? 'text-[#444746]' : 'text-zinc-400'}`}>{row.description}</p>
            </div>
            {row.id ? (
              <ExperimentToggle id={row.id} enabled={experiments[row.id]} label={row.title} isLight={isLight} />
            ) : (
              <StaticToggle enabled={!!row.staticEnabled} isLight={isLight} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

