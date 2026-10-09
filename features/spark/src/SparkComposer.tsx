import React, { useEffect, useRef, useState } from 'react';
import { InputBar, type Attachment, type ComposerHandle } from '@willow/chat/composer/Composer';
import type { WorkspaceComputedTheme } from '@willow/core/workspace-theme';
import {
  createSparkTaskAttachments,
  deleteSparkAttachmentPayloads,
  validateSparkAttachmentFiles,
} from './attachment-storage';
import { getActiveSparkStorageScope } from './spark-store';
import { setSparkUltraEngaged, sparkUltraEngaged } from './spark-store';
import { useStore } from '@nanostores/react';
import type { SparkTaskAttachment } from './spark-types';
import { SparkMentions } from './composer/SparkMentions';
import { useSparkMentionOptions } from './composer/spark-mention-options';
import './SparkComposer.css';

/**
 * Spark's prompt box is Chat's `InputBar`, not a second implementation of it.
 *
 * Spark used to hand-build its own composer around Chat's `PlusDropdownMenu`, which meant
 * the file input, the dictation button, the send-button entrance and the attachment chips
 * were all written twice and drifted apart — Spark's could attach files but never showed a
 * thumbnail, and never gained image paste or the GitHub import that Chat's grew.
 *
 * Three things make Chat's composer fit here without a fork:
 *
 * - **`chatVariant`** is already the Gemini-styled box: 660px wide, 32px corners, #1e1f21,
 *   which is what Spark had measured its own copy to independently.
 * - **`liveAvailable={false}`** is exactly the behaviour Spark wants from the send slot.
 *   `InputBar` mounts the button only when there is something to send, so an empty box
 *   shows nothing at all and the arrow animates in on the first character — the same rule
 *   Gemini Spark follows. Passing no live handlers alongside it means the voice session
 *   can never be reached from here.
 * The model pill stays. Gemini's Spark composer has no model control, so this is a
 * deliberate divergence: `selectedModelId` is the model Spark actually resolves the task
 * against (`SparkWorkspace` reads it to pick the provider and key), so the pill is the
 * shortest path to "run this one on something else" — and it writes back to the same
 * app-level state Chat's picker does, so the two never disagree.
 *
 * The one real seam is attachments. Chat hands back `ComposerAttachment`s holding the live
 * `File`; Spark persists its own `SparkTaskAttachment` records into IndexedDB before the
 * task is created. So this bridges the two, keeping the ownership rule Spark already had:
 * if the task cannot be created, the payloads it wrote are deleted again.
 */
export interface SparkComposerProps {
  /** Receives the prepared attachments, already written to the active storage scope. */
  onSubmitTask?: (prompt: string, attachments?: SparkTaskAttachment[], tools?: string[]) => void;
  /**
   * Alternative to `onSubmitTask`, taking the raw files and owning the whole pipeline.
   *
   * The task-detail composers use this. Their submit paths are keyed to a specific task and
   * abort if the user navigates away mid-upload, and the follow-up one reads a boolean back
   * from the store to decide whether the turn was actually accepted — neither of which a
   * shared bridge can see. Rather than grow this component a callback per race, hand those
   * two the files and leave their existing logic untouched.
   */
  onSubmitFiles?: (prompt: string, files: File[], tools: string[]) => void;
  modelConfig?: any;
  selectedModelId?: string;
  setSelectedModelId?: (id: string) => void;
  workspaceColor?: string;
  /** A whole theme in place of the workspace colour's — a bot's composer, in the bot's colour. */
  theme?: WorkspaceComputedTheme;
  onAuthRequired?: () => void;
  placeholder?: string;
  className?: string;
  /**
   * Locks the box outright. The follow-up composer uses this only for the states
   * where a reply genuinely cannot be accepted — an approval it is waiting on.
   * A task that is merely still working uses `isGenerating` instead.
   */
  disabled?: boolean;
  /**
   * The task is still working: the box stays live so a reply can be drafted, and
   * the send slot becomes stop. `InputBar` also refuses Enter while this is set,
   * so the draft cannot be submitted into a run that has not finished.
   */
  isGenerating?: boolean;
  onStopGenerating?: () => void;
  /** Lets the page fill the box — Spark's Suggested cards write a prompt into it. */
  composerRef?: React.MutableRefObject<ComposerHandle | null>;
  /** A chip beside the plus, as a picked tool's: the desktop app's folder or full-access chip. */
  leadingChip?: React.ReactNode;
  /** Files may go with no words, as a picture does in a messenger: a bot's composer. A task always needs its prompt. */
  allowFilesOnly?: boolean;
  /** Where unsent text is kept across a restart (`InputBar`'s `draftKey`): the new-task box, a task, a bot. */
  draftKey?: string;
}

export const SparkComposer: React.FC<SparkComposerProps> = ({
  onSubmitTask,
  onSubmitFiles,
  modelConfig,
  selectedModelId = '',
  setSelectedModelId,
  workspaceColor,
  theme,
  onAuthRequired,
  placeholder = 'Describe a task',
  className = '',
  disabled = false,
  isGenerating = false,
  onStopGenerating,
  composerRef,
  leadingChip,
  allowFilesOnly = false,
  draftKey,
}) => {
  const isUltra = useStore(sparkUltraEngaged);
  const [error, setError] = useState('');
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const mentionOptions = useSparkMentionOptions();
  const mountedRef = useRef(true);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * `InputBar.onSubmit` is synchronous and clears its own state the moment it returns, so
   * the files have to be read out of the attachments here and now. That is safe: the
   * cleanup it schedules revokes the object URLs, not the `File` handles themselves.
   */
  const submit = (prompt: string, attachments: readonly Attachment[], tool?: string | null) => {
    if ((!prompt && !(allowFilesOnly && attachments.length)) || disabled || isGenerating || submitInFlightRef.current) return;
    const files = attachments.map((attachment) => attachment.file).filter((file): file is File => !!file);
    const tools = tool ? [tool] : [];

    if (onSubmitFiles) {
      onSubmitFiles(prompt, files, tools);
      return;
    }

    submitInFlightRef.current = true;
    setError('');

    void (async () => {
      const scope = getActiveSparkStorageScope();
      let prepared: SparkTaskAttachment[] = [];
      try {
        if (files.length) {
          validateSparkAttachmentFiles(files);
          prepared = await createSparkTaskAttachments(files, scope);
        }

        /* Signing out or switching account mid-upload would otherwise file the payloads
         * under the previous scope and attach them to a task the new one can never read. */
        if (!mountedRef.current || getActiveSparkStorageScope() !== scope) {
          await deleteSparkAttachmentPayloads(prepared.map((a) => a.id), scope).catch(() => undefined);
          if (mountedRef.current) {
            setError('Your account changed before the task could be created. Please try again.');
          }
          return;
        }

        if (!onSubmitTask) throw new Error('Spark is not ready to create this task yet.');
        onSubmitTask(prompt, prepared, tools);
      } catch (cause) {
        await deleteSparkAttachmentPayloads(prepared.map((a) => a.id), scope).catch(() => undefined);
        if (mountedRef.current) {
          setError(cause instanceof Error ? cause.message : 'One or more files could not be attached.');
        }
      } finally {
        submitInFlightRef.current = false;
      }
    })();
  };

  return (
    <div ref={setHost} className={`spark-composer-host ${className}`.trim()}>
      <InputBar
        chatVariant
        sparkMode
        sparkToolsEnabled
        composerRef={composerRef}
        disabled={disabled}
        isGenerating={isGenerating}
        onStopGenerating={onStopGenerating}
        placeholder={placeholder}
        currentMode="chat"
        onModeChange={() => undefined}
        onSubmit={(prompt, _mode, attachments, tool) => submit(prompt, attachments ?? [], tool)}
        modelConfig={modelConfig}
        selectedModelId={selectedModelId}
        setSelectedModelId={(id) => {
          setSparkUltraEngaged(false);
          setSelectedModelId?.(id);
        }}
        effortDisplayOverride={isUltra ? 'Ultra' : undefined}
        extraEfforts={[{
          id: 'spark-ultra',
          label: 'Ultra',
          badge: 'Sub-agents',
          selected: isUltra,
          onSelect: () => setSparkUltraEngaged(true),
        }]}
        workspaceColor={workspaceColor}
        theme={theme}
        onAuthRequired={onAuthRequired}
        // Spark has no voice session. With this false the send slot is empty until there
        // is something to send, and the live handlers below are deliberately absent.
        liveAvailable={false}
        leadingChip={leadingChip}
        draftKey={draftKey}
      />
      {/* "@" for apps and "/" for skills, as in Gemini Spark's composer. */}
      <SparkMentions host={host} options={mentionOptions} disabled={disabled} />
      {error && <p className="spark-composer-host__error" role="status">{error}</p>}
    </div>
  );
};

export default SparkComposer;
