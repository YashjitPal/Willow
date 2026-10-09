import { useId } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { setDotPermissions } from '../harness/dot-runtime';
import type { DotPermissionMode, DotThread } from '../harness/thread/thread-types';
import './DotPermissions.css';

const MODES: ReadonlyArray<{ mode: DotPermissionMode; icon: string; title: string; sub: string }> = [
  { mode: 'ask', icon: 'front_hand', title: 'Ask before doing anything', sub: 'Shows you every change, command, email and post first' },
  { mode: 'auto', icon: 'rule', title: 'Ask when it needs to', sub: 'Works on its own; asks before commands, sending, or anything risky' },
  { mode: 'act', icon: 'bolt', title: 'Do it right away', sub: 'Runs commands and sends emails and posts without asking' },
];

/**
 * How freely the bot acts: the three ways its harness can work (`runtime.permissions`), each with what it means. The
 * choice reaches its tools at once and its instructions from its next turn.
 */
export function DotPermissionsSection({ dotId, name, thread }: { dotId: string; name: string; thread: DotThread | undefined }) {
  const current = thread?.runtime.permissions ?? 'auto';
  // Its own group in each profile on screen (docked and floating at once): radios sharing a name are one choice.
  const group = `dot-permissions-${useId()}`;

  return (
    <>
      <h3 className="dot-panel__label" id={`${group}-label`}>
        Permissions
      </h3>
      <div className="dot-panel__group dot-permissions" role="radiogroup" aria-labelledby={`${group}-label`}>
        {MODES.map((option) => {
          const selected = option.mode === current;
          return (
            <label key={option.mode} className={`dot-panel__row dot-permissions__option${selected ? ' is-selected' : ''}`}>
              <input
                type="radio"
                className="dot-permissions__input"
                name={group}
                value={option.mode}
                checked={selected}
                disabled={!thread}
                onChange={() => setDotPermissions(dotId, option.mode)}
              />
              <MaterialSymbol name={option.icon} size={20} opticalSize={20} weight={350} className="dot-panel__row-icon" />
              <span className="dot-panel__row-copy">
                <span className="dot-panel__row-title">{option.title}</span>
                <span className="dot-panel__row-sub">{option.sub}</span>
              </span>
              <MaterialSymbol name={selected ? 'radio_button_checked' : 'radio_button_unchecked'} size={20} opticalSize={20} weight={350} className="dot-permissions__mark" />
            </label>
          );
        })}
      </div>
      <p className="dot-permissions__note">{name} can still ask you about the work itself in any of these, and what you have allowed for good stays allowed.</p>
    </>
  );
}
