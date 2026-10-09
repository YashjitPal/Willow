import { useStore } from '@nanostores/react';
import { profileStore } from '@willow/personal';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { setLearning } from '../harness/memory/learning';
import type { DotThread } from '../harness/thread/thread-types';
import { M3Switch } from '../m3/M3Switch';
import '../m3/m3';

/**
 * "<bot>'s knowledge about you": whether this bot learns about the user from its own conversations
 * (memory/learning.ts). Only the switch shows here, not what it has learned. Willow's own Personal Intelligence is
 * separate and shared; this is the bot's alone.
 */
export function DotLearnedSection({ dotId, name, thread }: { dotId: string; name: string; thread: DotThread | undefined }) {
  const memory = useStore(profileStore).enabled;
  const on = !thread?.runtime.learned?.off;

  return (
    <>
      <h3 className="dot-panel__label">{name}’s knowledge about you</h3>
      <div className="dot-panel__group">
        <div className="dot-panel__row">
          <MaterialSymbol name="psychology" size={20} opticalSize={20} weight={350} className="dot-panel__row-icon" />
          <span className="dot-panel__row-copy">
            <span className="dot-panel__row-title">Learn about you</span>
            <span className="dot-panel__row-sub">{!memory ? 'Off while Memory is off' : on ? 'From your conversations' : 'Off'}</span>
          </span>
          <M3Switch selected={on && memory} disabled={!memory || !thread} label={`Let ${name} learn about you`} onToggle={(next) => setLearning(dotId, next)} />
        </div>
      </div>
    </>
  );
}
