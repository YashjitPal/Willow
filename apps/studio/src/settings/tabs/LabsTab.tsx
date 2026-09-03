import React from 'react';
import { useStore } from '@nanostores/react';
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
 * on `border-white/5` dividers, not the page's cards.
 */

/**
 * Switch for a Labs experiment.
 *
 * The markup matches the static toggles below so an experiment that is wired up
 * is visually indistinguishable from one that is not.
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

/**
 * The same switch for a row with no flag behind it.
 *
 * A div rather than a disabled button, which is what these rows have always
 * been: they are drawn in a fixed state and do nothing when clicked.
 */
const StaticToggle: React.FC<{ enabled: boolean }> = ({ enabled }) => (
  <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5 shrink-0">
    <div
      className={`w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all group-hover:bg-zinc-500 ${
        enabled ? 'translate-x-[16px] !bg-white' : '-translate-x-0'
      }`}
    />
  </div>
);

export const LabsTab: React.FC = () => {
  const experiments = useStore(experimentsStore);

  return (
    <div className="w-full h-full px-12 py-10 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[24px] font-bold text-white">Labs</h1>
      </div>

      <div className="pb-6 border-b border-white/5 mb-0">
        <p className="text-[14px] text-zinc-400">{LABS_DESCRIPTION}</p>
      </div>

      <div className="space-y-0 pb-10">
        {LABS_EXPERIMENTS.map((row) => (
          <div
            key={row.id ?? row.title}
            className="py-6 border-b border-white/5 flex items-start justify-between gap-8"
          >
            <div className="flex-1 max-w-[60%]">
              <h3 className="text-[14px] font-bold text-white mb-1">{row.title}</h3>
              <p className="text-[14px] text-zinc-400">{row.description}</p>
            </div>
            {row.id ? (
              <ExperimentToggle id={row.id} enabled={experiments[row.id]} label={row.title} />
            ) : (
              <StaticToggle enabled={!!row.staticEnabled} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
