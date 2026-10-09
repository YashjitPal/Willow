import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { applyDotEdit, declineDotEdit } from '../harness/dot-runtime';
import { editProblem, editState } from '../harness/runtime/edits';
import { sizeOf } from '../harness/runtime/transfer';
import type { DotItem, DotThread } from '../harness/thread/thread-types';
import { M3_SCOPE } from '../m3/m3';
import './DotEditCard.css';

const lineClass = (line: string): string | undefined => {
  if (line.startsWith('*** ')) return 'is-file';
  if (line.startsWith('@@')) return 'is-hunk';
  if (line.startsWith('+')) return 'is-added';
  if (line.startsWith('-')) return 'is-removed';
  return undefined;
};

/** A patch as the user reads it: each file's heading, then its lines, added and removed ones marked. */
function PatchView({ patch }: { patch: string }) {
  const lines = patch.replace(/\r\n/g, '\n').split('\n').filter((line) => !/^\*\*\* (Begin|End) Patch\s*$/.test(line));
  return (
    <pre className="dot-edit-card__patch" tabIndex={0} aria-label="The change">
      {lines.map((line, index) => (
        <span key={index} className={lineClass(line)}>
          {line.startsWith('*** ') ? line.replace(/^\*\*\* (Add|Update) File: /, (_, kind: string) => (kind === 'Add' ? 'New file: ' : '')) : line}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

/**
 * Files a bot changed on the user's computer in one edit, with what each gained and lost — or, while it checks with
 * them before doing anything, the change it proposes, which happens only when they apply it.
 */
export function DotEditCard({ dotId, name, item, thread }: { dotId: string; name: string; item: DotItem; thread: DotThread }) {
  const [open, setOpen] = useState(false);
  const edit = item.edit;
  if (!edit) return null;
  const count = edit.files.length;
  const proposed = edit.proposed;
  const state = editState(thread, item);
  const problem = state === 'failed' ? editProblem(thread, item) : undefined;
  // A file copied from the bot's own computer, rather than lines changed.
  const copied = Boolean(proposed?.copy) || edit.files.some((file) => file.bytes !== undefined);
  const changed = copied ? `Copied a file from ${name}'s computer` : count === 1 ? 'Changed a file' : `Changed ${count} files`;
  const title = !proposed || state === 'applied'
    ? changed
    : state === 'pending'
      ? copied ? `Copy this file from ${name}'s computer?` : count === 1 ? 'Change this file?' : `Change these ${count} files?`
      : state === 'applying' ? 'Applying…' : 'Not applied';
  const files = count === 1 ? edit.files[0]!.path : `${count} files`;

  return (
    <article
      className={`dot-edit-card is-${state} ${M3_SCOPE}`}
      aria-label={proposed && state === 'pending' ? `${name} asks to change ${files}` : `${name} ${state === 'applied' ? 'changed' : 'did not change'} ${files}`}
    >
      <md-outlined-card>
        <div className="dot-edit-card__body">
          <div className="dot-edit-card__head">
            <MaterialSymbol name={state === 'declined' || state === 'failed' ? 'edit_off' : 'edit_document'} size={18} opticalSize={20} weight={350} />
            <span className="dot-edit-card__title">{title}</span>
            {state === 'applying' && <md-circular-progress indeterminate aria-label="Applying" />}
          </div>
          <ul className="dot-edit-card__files">
            {edit.files.map((file) => (
              <li key={file.path}>
                <span className="dot-edit-card__path">{file.path}</span>
                {file.kind === 'add' && <span className="dot-edit-card__new">new</span>}
                {file.bytes !== undefined ? (
                  <span className="dot-edit-card__counts">{sizeOf(file.bytes)}</span>
                ) : copied ? null : (
                  <span className="dot-edit-card__counts">
                    <span className="is-added">+{file.added}</span>
                    <span className="is-removed">−{file.removed}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="dot-edit-card__where">In {edit.root}</p>
          {proposed?.patch && open && <PatchView patch={proposed.patch} />}
          {proposed?.copy && state === 'pending' && <p className="dot-edit-card__note">From {proposed.copy.from} on {name}&apos;s computer. Nothing is copied until you apply it.</p>}
          {problem && <p className="dot-edit-card__note is-error">{problem}</p>}
          {proposed && (state === 'pending' || proposed.patch) && (
            <div className="dot-edit-card__actions">
              {state === 'pending' && (
                <>
                  <md-filled-tonal-button data-action="edit-apply" onClick={() => void applyDotEdit(dotId, item.id)}>
                    Apply
                  </md-filled-tonal-button>
                  <md-text-button data-action="edit-decline" onClick={() => declineDotEdit(dotId, item.id)}>
                    Don&apos;t apply
                  </md-text-button>
                </>
              )}
              {proposed.patch && (
                <md-text-button data-action="edit-show" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((shown) => !shown)}>
                  {open ? 'Hide the change' : 'Show the change'}
                </md-text-button>
              )}
            </div>
          )}
        </div>
      </md-outlined-card>
    </article>
  );
}
