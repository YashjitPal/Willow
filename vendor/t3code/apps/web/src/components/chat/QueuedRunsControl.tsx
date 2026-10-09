import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import type {
  ChatAttachment as ContractChatAttachment,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { GripVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { threadEnvironment } from "../../state/threads";
import { useThreadProjection } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { isImageAttachment, type ChatMessage } from "../../types";
import { willowSymbol } from "~/willow/icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";

/** Codex's queued-message glyphs (its queued-message-list), in Willow's Material Symbols. */
const QueuedIcon = willowSymbol("low_priority");
const SteerIcon = willowSymbol("subdirectory_arrow_right");
const MoreIcon = willowSymbol("more_horiz");
const QueueingIcon = willowSymbol("playlist_add");

export interface EditQueuedRunRequest {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ContractChatAttachment>;
}

interface QueuedRowThumbnail {
  readonly key: string;
  readonly name: string;
  readonly url: string | null;
}

const QUEUED_RUN_DRAG_TYPE = "application/x-t3code-queued-run";

export interface QueuedRunsControlHandle {
  steerNext: (repeat: boolean) => boolean;
  editLatest: (repeat: boolean) => boolean;
}

export function QueuedRunsControl({
  ref,
  ...props
}: {
  readonly ref?: Ref<QueuedRunsControlHandle>;
  readonly steerShortcutLabel?: string | null;
  readonly editShortcutLabel?: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly optimisticMessages: ReadonlyArray<
    Pick<ChatMessage, "id" | "inputIntent" | "text" | "attachments">
  >;
  /** The saved queue entry stays visible while its draft is edited in the composer. */
  readonly editingRunId: RunId | null;
  readonly onEditQueuedRun: (request: EditQueuedRunRequest) => void;
  readonly onCancelEdit: () => void;
}) {
  const projection = useThreadProjection(
    scopeThreadRef(props.environmentId, props.threadId),
  )?.projection;
  const reorder = useAtomCommand(threadEnvironment.reorderQueuedRun);
  const promote = useAtomCommand(threadEnvironment.promoteQueuedRun);
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun);
  const [busyRunId, setBusyRunId] = useState<RunId | null>(null);
  // Live drag-reorder state: the dragged run and the queue index the row
  // would be inserted at (0..queued.length) as of the latest dragover.
  const [dragState, setDragState] = useState<{
    readonly runId: RunId;
    readonly insertIndex: number | null;
  } | null>(null);
  // Drags must start from the grip, not from an accidental text-drag on the
  // row. The grip arms its run id on pointerdown; dragstart verifies it.
  const dragArmedRunIdRef = useRef<RunId | null>(null);
  const workflow = useMemo(
    () => (projection ? deriveThreadQueueWorkflowState(projection) : null),
    [projection],
  );
  const queued = workflow?.queuedRuns ?? [];
  const activeRun = workflow?.activeRun ?? null;
  const canReorder = workflow?.canReorder === true;
  const queuedImageAttachmentIds = useMemo(() => {
    const ids: string[] = [];
    for (const { attachments } of workflow?.queuedRuns ?? []) {
      for (const attachment of attachments) {
        if (attachment.type === "image") ids.push(attachment.id);
      }
    }
    return ids;
  }, [workflow]);
  const queuedImageAttachmentResources = useMemo(
    () =>
      queuedImageAttachmentIds.map((attachmentId) => ({
        _tag: "attachment" as const,
        attachmentId,
      })),
    [queuedImageAttachmentIds],
  );
  const queuedImageAttachmentUrls = useAssetUrls(
    props.environmentId,
    queuedImageAttachmentResources,
  );
  const queuedImageUrlById = useMemo(
    () =>
      new Map(
        queuedImageAttachmentIds.flatMap((attachmentId, index) => {
          const url = queuedImageAttachmentUrls[index];
          return url ? [[attachmentId, url] as const] : [];
        }),
      ),
    [queuedImageAttachmentIds, queuedImageAttachmentUrls],
  );
  // Once the projection holds the message the optimistic copy is stale no
  // matter what happened to its run — keying on still-queued runs alone would
  // resurrect a phantom "pending" row after the run is cancelled or started.
  const acknowledgedMessageIds = useMemo(
    () => new Set((projection?.messages ?? []).map((message) => message.id)),
    [projection],
  );
  const optimisticQueued = props.optimisticMessages.filter(
    (message) => message.inputIntent === "queued_turn" && !acknowledgedMessageIds.has(message.id),
  );
  const items = [
    ...queued.map(({ run, text, attachments }, serverIndex) => ({
      key: run.id,
      runId: run.id,
      messageId: run.userMessageId,
      serverIndex,
      text,
      attachments,
      thumbnails: attachments
        .filter((attachment) => attachment.type === "image")
        .map<QueuedRowThumbnail>((attachment) => ({
          key: attachment.id,
          name: attachment.name,
          url: queuedImageUrlById.get(attachment.id) ?? null,
        })),
      pending: false,
    })),
    ...optimisticQueued.map((message) => ({
      key: message.id,
      runId: null,
      messageId: null,
      serverIndex: null,
      text: message.text,
      attachments: [] as ReadonlyArray<ContractChatAttachment>,
      thumbnails: (message.attachments ?? [])
        .filter(isImageAttachment)
        .map<QueuedRowThumbnail>((attachment) => ({
          key: attachment.id,
          name: attachment.name,
          url: attachment.previewUrl ?? null,
        })),
      pending: true,
    })),
  ];

  const move = async (runId: RunId, beforeRunId: RunId | null) => {
    setBusyRunId(runId);
    try {
      await reorder({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, runId, beforeRunId },
      });
    } finally {
      setBusyRunId(null);
    }
  };

  const completeDrag = (runId: RunId, insertIndex: number | null) => {
    setDragState(null);
    dragArmedRunIdRef.current = null;
    if (insertIndex === null || busyRunId !== null) return;
    const draggedIndex = queued.findIndex(({ run }) => run.id === runId);
    if (draggedIndex === -1) return;
    // Inserting immediately before or after itself is a no-op.
    if (insertIndex === draggedIndex || insertIndex === draggedIndex + 1) return;
    void move(runId, queued[insertIndex]?.run.id ?? null);
  };

  const followUpBehavior = useClientSettings((settings) => settings.followUpBehavior);
  const updateClientSettings = useUpdateClientSettings();

  const steerInFlightRef = useRef(false);
  const steer = async (queuedRunId: RunId) => {
    if (activeRun === null || !workflow?.canPromoteToSteer || steerInFlightRef.current) return;
    steerInFlightRef.current = true;
    setBusyRunId(queuedRunId);
    try {
      await promote({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, queuedRunId, targetRunId: activeRun.id },
      });
    } finally {
      steerInFlightRef.current = false;
      setBusyRunId(null);
    }
  };

  useImperativeHandle(ref, () => ({
    steerNext(repeat) {
      const next = queued[0];
      if (!next || !workflow?.canPromoteToSteer) return false;
      if (!repeat && busyRunId === null) void steer(next.run.id);
      return true;
    },
    // Declines while a queued message is already being edited so the key keeps
    // moving the caret inside that draft.
    editLatest(repeat) {
      const latest = queued.at(-1);
      if (!latest || props.editingRunId !== null || busyRunId !== null) return false;
      if (!repeat) {
        props.onEditQueuedRun({
          runId: latest.run.id,
          messageId: latest.run.userMessageId,
          text: latest.text,
          attachments: latest.attachments,
        });
      }
      return true;
    },
  }));

  if (items.length === 0) return null;

  const remove = async (runId: RunId) => {
    setBusyRunId(runId);
    try {
      await cancel({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, runId },
      });
    } finally {
      setBusyRunId(null);
    }
  };

  return (
    <ComposerBanner.Attachment data-chat-composer-collapsed-controls="true">
      <ComposerBanner.Root
        role="region"
        aria-label={`${items.length} queued message${items.length === 1 ? "" : "s"}`}
        aria-live="polite"
        data-willow-queued-runs="true"
      >
        <ol className="willow-queued-runs">
          {items.map((item) => {
            const previewText = replaceComposerContextReferences(item.text, (reference) =>
              reference.kind === "image" && item.thumbnails.length > 0 ? "" : reference.label,
            ).trim();
            const rowRunId = item.runId;
            const rowServerIndex = item.serverIndex;
            const isEditing = rowRunId !== null && rowRunId === props.editingRunId;
            const rowDraggable =
              rowRunId !== null && rowServerIndex !== null && canReorder && busyRunId === null;
            const steerShortcut =
              item.serverIndex === 0 && props.steerShortcutLabel ? props.steerShortcutLabel : null;
            const editShortcut =
              item.serverIndex === queued.length - 1 && props.editShortcutLabel
                ? props.editShortcutLabel
                : null;
            return (
              <li
                key={item.key}
                aria-current={isEditing ? "true" : undefined}
                data-editing={isEditing ? "true" : undefined}
                data-dragging={
                  dragState !== null && dragState.runId === item.runId ? "true" : undefined
                }
                className="willow-queued-run"
                draggable={rowDraggable}
                onDragStart={(event) => {
                  if (item.runId === null || dragArmedRunIdRef.current !== item.runId) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.setData(QUEUED_RUN_DRAG_TYPE, item.runId);
                  event.dataTransfer.effectAllowed = "move";
                  setDragState({ runId: item.runId, insertIndex: null });
                }}
                onDragEnd={() => {
                  dragArmedRunIdRef.current = null;
                  setDragState(null);
                }}
                onDragOver={(event) => {
                  if (dragState === null || item.serverIndex === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const rect = event.currentTarget.getBoundingClientRect();
                  const insertIndex =
                    event.clientY < rect.top + rect.height / 2
                      ? item.serverIndex
                      : item.serverIndex + 1;
                  if (dragState.insertIndex !== insertIndex) {
                    setDragState({ runId: dragState.runId, insertIndex });
                  }
                }}
                onDrop={(event) => {
                  if (dragState === null) return;
                  event.preventDefault();
                  completeDrag(dragState.runId, dragState.insertIndex);
                }}
              >
                {item.serverIndex !== null && dragState?.insertIndex === item.serverIndex ? (
                  <span
                    aria-hidden
                    className="willow-queued-run__drop willow-queued-run__drop--top"
                  />
                ) : null}
                {item.serverIndex === queued.length - 1 &&
                dragState?.insertIndex === queued.length ? (
                  <span
                    aria-hidden
                    className="willow-queued-run__drop willow-queued-run__drop--bottom"
                  />
                ) : null}
                {canReorder && rowRunId !== null && rowServerIndex !== null ? (
                  <button
                    type="button"
                    aria-label="Reorder queued message (drag, or press the arrow keys)"
                    className="willow-queued-run__lead willow-queued-run__grip"
                    disabled={busyRunId !== null}
                    onPointerDown={() => {
                      dragArmedRunIdRef.current = rowRunId;
                    }}
                    onKeyDown={(event) => {
                      if (busyRunId !== null) return;
                      if (event.key === "ArrowUp" && rowServerIndex > 0) {
                        event.preventDefault();
                        void move(rowRunId, queued[rowServerIndex - 1]?.run.id ?? null);
                      }
                      if (event.key === "ArrowDown" && rowServerIndex < queued.length - 1) {
                        event.preventDefault();
                        void move(rowRunId, queued[rowServerIndex + 2]?.run.id ?? null);
                      }
                    }}
                  >
                    <QueuedIcon aria-hidden className="willow-queued-run__glyph" />
                    <GripVerticalIcon aria-hidden className="willow-queued-run__grip-icon" />
                  </button>
                ) : (
                  <span className="willow-queued-run__lead">
                    <QueuedIcon
                      aria-label={item.pending ? "Saving queued message" : undefined}
                      aria-hidden={item.pending ? undefined : true}
                      className="willow-queued-run__glyph"
                    />
                  </span>
                )}
                <span className="willow-queued-run__title">
                  {isEditing ? <span className="sr-only">Editing queued message: </span> : null}
                  {item.thumbnails.length > 0 ? (
                    <span className="willow-queued-run__thumbs">
                      {item.thumbnails.map((thumbnail) => (
                        <span key={thumbnail.key} className="willow-queued-run__thumb">
                          {thumbnail.url ? (
                            <img
                              src={thumbnail.url}
                              alt={thumbnail.name}
                              className="size-full object-cover"
                            />
                          ) : (
                            <span aria-label={thumbnail.name} className="block size-full" />
                          )}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger render={<span className="willow-queued-run__text" />}>
                      {previewText}
                    </TooltipTrigger>
                    <TooltipPopup side="top" className="max-w-96 break-words">
                      {previewText}
                    </TooltipPopup>
                  </Tooltip>
                </span>
                <span className="willow-queued-run__actions">
                  {isEditing ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Cancel editing queued message"
                      onClick={props.onCancelEdit}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <>
                      <Tooltip>
                        <TooltipTrigger render={<span className="flex shrink-0" />}>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={
                              item.runId === null ||
                              busyRunId !== null ||
                              !workflow?.canPromoteToSteer
                            }
                            onClick={() => {
                              if (item.runId !== null) {
                                void steer(item.runId);
                              }
                            }}
                          >
                            <SteerIcon aria-hidden />
                            Steer
                          </Button>
                        </TooltipTrigger>
                        <TooltipPopup>
                          {activeRun === null ? (
                            "There is no active run to steer"
                          ) : (
                            <>
                              Submit without interrupting the model
                              {steerShortcut ? (
                                <kbd data-willow-tooltip-shortcut>{steerShortcut}</kbd>
                              ) : null}
                            </>
                          )}
                        </TooltipPopup>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Delete queued message"
                              disabled={item.runId === null || busyRunId !== null}
                              onClick={() => {
                                if (item.runId !== null) void remove(item.runId);
                              }}
                            />
                          }
                        >
                          <Trash2Icon aria-hidden />
                        </TooltipTrigger>
                        <TooltipPopup>Delete queued message</TooltipPopup>
                      </Tooltip>
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Queued message actions"
                              disabled={item.runId === null || busyRunId !== null}
                            />
                          }
                        >
                          <MoreIcon aria-hidden />
                        </MenuTrigger>
                        <MenuPopup align="end" side="top">
                          <MenuItem
                            disabled={item.messageId === null}
                            onClick={() => {
                              if (item.runId !== null && item.messageId !== null) {
                                props.onEditQueuedRun({
                                  runId: item.runId,
                                  messageId: item.messageId,
                                  text: item.text,
                                  attachments: item.attachments,
                                });
                              }
                            }}
                          >
                            <PencilIcon aria-hidden />
                            Edit message
                            {editShortcut ? <MenuShortcut>{editShortcut}</MenuShortcut> : null}
                          </MenuItem>
                          <MenuItem
                            onClick={() =>
                              void updateClientSettings({
                                followUpBehavior: followUpBehavior === "queue" ? "steer" : "queue",
                              })
                            }
                          >
                            <QueueingIcon aria-hidden />
                            {followUpBehavior === "queue"
                              ? "Turn off queueing"
                              : "Turn on queueing"}
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
