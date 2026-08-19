import React, { useEffect, useRef, useState } from 'react';
import { InputBar, type Attachment, type ComposerHandle } from '@willow/chat/composer/Composer';
import {
  createSparkTaskAttachments,
  deleteSparkAttachmentPayloads,
  validateSparkAttachmentFiles,
} from './attachment-storage';
import { getActiveSparkStorageScope } from './spark-store';
import type { SparkTaskAttachment } from './spark-types';
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
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  placeholder?: string;
  className?: string;
  /** Locks the box. The follow-up composer uses this while its task is still running. */
  disabled?: boolean;
  /** Lets the page fill the box — Spark's Suggested cards write a prompt into it. */
  composerRef?: React.MutableRefObject<ComposerHandle | null>;
}

export const SparkComposer: React.FC<SparkComposerProps> = ({
  onSubmitTask,
  onSubmitFiles,
  modelConfig,
  selectedModelId = '',
  setSelectedModelId,
  workspaceColor,
  isAuthenticated,
  onAuthRequired,
  placeholder = 'Describe a task',
  className = '',
  disabled = false,
  composerRef,
}) => {
  const [error, setError] = useState('');
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
    if (!prompt || disabled || submitInFlightRef.current) return;
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
    <div className={`spark-composer-host ${className}`.trim()}>
      <InputBar
        chatVariant
        composerRef={composerRef}
        disabled={disabled}
        placeholder={placeholder}
        currentMode="chat"
        onModeChange={() => undefined}
        onSubmit={(prompt, _mode, attachments, tool) => submit(prompt, attachments ?? [], tool)}
        modelConfig={modelConfig}
        selectedModelId={selectedModelId}
        setSelectedModelId={setSelectedModelId ?? (() => undefined)}
        workspaceColor={workspaceColor}
        isAuthenticated={isAuthenticated}
        onAuthRequired={onAuthRequired}
        // Spark has no voice session. With this false the send slot is empty until there
        // is something to send, and the live handlers below are deliberately absent.
        liveAvailable={false}
      />
      {error && <p className="spark-composer-host__error" role="status">{error}</p>}
    </div>
  );
};

export default SparkComposer;
