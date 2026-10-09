import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DotAskCard, DotAskMeta, DotAskNote, type DotAskTone } from '../ask/DotAskCard';
import { applyDotEdit, declineDotEdit } from '../harness/dot-runtime';
import { editProblem, editState } from '../harness/runtime/edits';
import { sizeOf } from '../harness/runtime/transfer';
import type { DotItem, DotThread } from '../harness/thread/thread-types';
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

type EditState = ReturnType<typeof editState>;

const TONES: Record<EditState, DotAskTone> = { pending: 'ask', applying: 'busy', applied: 'done', declined: 'off', failed: 'error' };

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
  const changed = copied ? `Copied a file from ${name}’s computer` : count === 1 ? 'Changed a file' : `Changed ${count} files`;
  const title = !proposed || state === 'applied'
    ? changed
    : state === 'pending'
      ? copied ? `${name} wants to copy a file from its computer` : count === 1 ? `${name} wants to change a file` : `${name} wants to change ${count} files`
      : state === 'applying' ? 'Applying…' : 'Not applied';
  const files = count === 1 ? edit.files[0]!.path : `${count} files`;
  const tone: DotAskTone = proposed ? TONES[state] : 'done';

  return (
    <DotAskCard
      kind="edit"
      tone={tone}
      icon={<MaterialSymbol name={state === 'declined' || state === 'failed' ? 'edit_off' : copied ? 'file_copy' : 'edit_document'} size={22} opticalSize={24} weight={350} />}
      kicker={copied ? 'A file to copy' : 'Your files'}
      title={title}
      label={proposed && state === 'pending' ? `${name} asks to change ${files}` : `${name} ${state === 'applied' || !proposed ? 'changed' : 'did not change'} ${files}`}
      footer={
        proposed && state === 'pending' ? (
          <>
            <md-text-button data-action="edit-decline" onClick={() => declineDotEdit(dotId, item.id)}>
              Don&rsquo;t apply
            </md-text-button>
            <md-filled-button data-action="edit-apply" onClick={() => void applyDotEdit(dotId, item.id)}>
              Apply
            </md-filled-button>
          </>
        ) : undefined
      }
    >
      <div className="dot-edit-card__changes">
        <ul className="dot-edit-card__files">
          {edit.files.map((file) => (
            <li key={file.path}>
              <MaterialSymbol name={file.kind === 'add' ? 'note_add' : 'description'} size={16} opticalSize={20} weight={350} className="dot-edit-card__file-icon" />
              <span className="dot-edit-card__path">{file.path}</span>
              {file.kind === 'add' && <span className="dot-edit-card__new">New</span>}
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
        {proposed?.patch && (
          <button type="button" className="dot-edit-card__toggle" data-action="edit-show" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((shown) => !shown)}>
            <MaterialSymbol name={open ? 'expand_less' : 'expand_more'} size={18} opticalSize={20} weight={400} />
            {open ? 'Hide the change' : 'Show the change'}
          </button>
        )}
        {proposed?.patch && open && <PatchView patch={proposed.patch} />}
      </div>
      <DotAskMeta icon="folder" title={edit.root}>
        In {edit.root}
      </DotAskMeta>
      {proposed?.copy && state === 'pending' && <DotAskNote>From {proposed.copy.from} on {name}&rsquo;s computer. Nothing is copied until you apply it.</DotAskNote>}
      {problem && <DotAskNote error>{problem}</DotAskNote>}
    </DotAskCard>
  );
}
