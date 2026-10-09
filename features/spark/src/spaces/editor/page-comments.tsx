import clsx from "clsx";
import { AnimatePresence } from "framer-motion";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  ArrowUpMdLight16Icon,
  CheckmarkMdLight16Icon,
  ChevronRightMdLight16Icon,
  EllipsisHorizontalLight16Icon,
  EmojiFaceBadgePlusLight16Icon,
  TextBubbleLight20Icon,
} from "../../codex/icons";
import { Button, CommentMessageLayout, CommentsSidebarLayout, Dialog, DialogDescription, DialogTitle, DropdownMenu, InlineMention, Menu, PanelHeader, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, SymbolPicker, Tooltip } from "../../codex/ui";
import { Avatar } from "../../codex/ui/avatar";
import { CompactRelativeTime } from "../../codex/ui/compact-relative-time";
import { DialogBody, DialogFooter, DialogHeader, DialogSection } from "../../codex/ui/dialog-layout";
import { DotAvatar } from "../willow/dot/character";
import { ComposerFrame } from "../willow/dot/composer";
import { dotName, resolveDot, useDots, useResolvedDot } from "../willow/dot/dot-identity";
import { selfUserId } from "../willow/dot/state/room-store";
import { WillowMark } from "../willow/willow-mark";
import { findSpacesUser, useSpacesStore } from "../state";
import { MentionMenu, mentionOptions, type MentionOption } from "./mention-menu";
import { commentMessages, mentionMessages } from "./messages";
import { sendCommentMentions, sendTaskMention } from "./state/dot-requests";
import { anchorCommentThread, clearCommentAnchors, type CommentTarget } from "./state/editor-actions";
import { createPageId, taskMentionLeafText, text, type PageCommentMessage, type PageCommentThread, type PageDocument, type PageInline } from "./state/page-document";
import { usePageDocumentsStore } from "./state/page-documents-store";
import { usePageEditorUiStore } from "./state/page-editor-ui-store";
import { TaskMentionChip } from "./task-mention-chip";

/** A comment being written: on selected text, or the prompt of a composing task mention. */
export type PendingComment = { kind: "comment"; target: CommentTarget } | { kind: "task"; mentionId: string };

const allowedEmojis = ["👍", "❤️", "🎉", "👀"];
const maxCommentLength = 4000;
const previewCss = { preview: "_preview_13x5z_1", standalone: "_standalone_13x5z_6" } as const;
const selfAuthor = { kind: "user", accountUserId: selfUserId } as const;

// --- Drafts: comment text with mention tokens ---------------------------------------------

interface DraftMention {
  token: string;
  run: Extract<PageInline, { kind: "taskMention" | "personMention" }>;
}

interface CommentDraft {
  text: string;
  mentions: DraftMention[];
}

const emptyDraft: CommentDraft = { text: "", mentions: [] };

function runToken(run: DraftMention["run"], mentions: PageDocument["taskMentions"]) {
  return run.kind === "personMention" ? run.title : taskMentionLeafText(mentions[run.mentionId]);
}

function bodyToDraft(body: PageInline[], mentions: PageDocument["taskMentions"]): CommentDraft {
  const draft: CommentDraft = { text: "", mentions: [] };
  for (const run of body) {
    if (run.kind === "text") draft.text += run.text;
    else if (run.kind !== "pageReference") {
      const token = runToken(run, mentions);
      draft.text += token;
      draft.mentions.push({ token, run });
    }
  }
  return draft;
}

/** Rebuilds the comment body, keeping each mention whose token is still in the text. */
function draftToBody({ text: value, mentions }: CommentDraft): PageInline[] {
  const body: PageInline[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    const at = value.indexOf(mention.token, cursor);
    if (at < 0) continue;
    if (at > cursor) body.push(text(value.slice(cursor, at)));
    body.push(mention.run);
    cursor = at + mention.token.length;
  }
  if (cursor < value.length) body.push(text(value.slice(cursor)));
  const last = body.at(-1);
  if (last?.kind === "text") {
    const trimmed = last.text.trimEnd();
    if (trimmed === "") body.pop();
    else body[body.length - 1] = { ...last, text: trimmed };
  }
  const first = body[0];
  if (first?.kind === "text") {
    const trimmed = first.text.trimStart();
    if (trimmed === "") body.shift();
    else body[0] = { ...first, text: trimmed };
  }
  return body;
}

function draftValid(draft: CommentDraft) {
  const trimmed = draft.text.trim();
  return trimmed !== "" && Array.from(trimmed).length <= maxCommentLength;
}

// --- People -------------------------------------------------------------------------------

function useUserName(accountUserId: string | undefined) {
  const users = useSpacesStore((state) => state.users);
  return accountUserId == null ? undefined : findSpacesUser(users, accountUserId)?.display_name;
}

/** `GC1`: profile avatar of a Page collaborator. */
function PersonAvatar({ accountUserId, name, size }: { accountUserId: string; name: string | undefined; size?: "badge" | "inline" | "sm" }) {
  return <Avatar colorKey={accountUserId} name={name ?? "?"} size={size} />;
}

// --- Composer -----------------------------------------------------------------------------

const mentionTrigger = /(?:^|\s|[([{])@((?:[^\s@()[\]`]| ){0,80})$/u;

/** Character ranges of the draft's mention tokens, with each one's index in `mentions`. */
function mentionRanges({ text: value, mentions }: CommentDraft) {
  const ranges: { from: number; to: number; index: number }[] = [];
  let cursor = 0;
  mentions.forEach((mention, index) => {
    const at = value.indexOf(mention.token, cursor);
    if (at < 0) return;
    ranges.push({ from: at, to: at + mention.token.length, index });
    cursor = at + mention.token.length;
  });
  return ranges;
}

interface CommentTextInputProps {
  pageId: string;
  ariaLabel: string;
  placeholder: string;
  autoFocus: boolean;
  submitOnEnter?: boolean;
  initialSelection?: number;
  canMention: boolean;
  draft: CommentDraft;
  onDraftChange: (draft: CommentDraft) => void;
  onCancel: () => void;
}

/** `Hk`: the comment textarea, with the `@` mention list above it. */
function CommentTextInput({ pageId, ariaLabel, placeholder, autoFocus, submitOnEnter = true, initialSelection, canMention, draft, onDraftChange, onCancel }: CommentTextInputProps) {
  const listboxId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<number | undefined>(initialSelection ?? draft.text.length);
  const dots = useDots();
  const canGenerate = usePageEditorUiStore((state) => state.capabilities.canGenerate);
  const selfName = useUserName(selfUserId);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const query = canMention && !composing && selection.start === selection.end ? mentionTrigger.exec(draft.text.slice(0, selection.start))?.[1] : undefined;
  const at = query == null ? null : selection.start - query.length - 1;
  const queryKey = `${at}:${query}`;
  const open = query != null && at != null && dismissed !== queryKey && !mentionRanges(draft).some((range) => at >= range.from && at < range.to);
  const options = open ? mentionOptions({ query, dots, canStartTask: canGenerate }) : [];
  const menuOpen = options.length > 0;
  const currentId = options.find((option) => option.id === highlightedId)?.id ?? options[0]?.id;
  const dismiss = () => setDismissed(queryKey);
  const sync = (input: HTMLTextAreaElement) => setSelection({ start: input.selectionStart, end: input.selectionEnd });

  const select = (option: MentionOption) => {
    if (at == null) return;
    const token = option.kind === "person" ? `@${option.name}` : option.kind === "dot" ? `@${dotName(option)}` : "@Willow";
    const text = `${draft.text.slice(0, at)}${token} ${draft.text.slice(selection.start)}`;
    if (text.length > maxCommentLength) return;
    let run: DraftMention["run"];
    if (option.kind === "person") run = { kind: "personMention", accountUserId: option.accountUserId, mentionId: createPageId("mention"), title: token };
    else {
      const mentionId = createPageId("mention");
      usePageDocumentsStore.getState().addTaskMention(pageId, {
        id: mentionId,
        source: "comment",
        owner: selfUserId,
        ownerName: selfName,
        threadId: null,
        orbit: option.kind === "dot" ? { threadId: option.conversationId } : undefined,
        prompt: "",
        status: "composing",
      });
      run = { kind: "taskMention", mentionId };
    }
    const index = mentionRanges(draft).find((range) => range.from >= at)?.index ?? draft.mentions.length;
    const caret = at + token.length + 1;
    onDraftChange({ text, mentions: [...draft.mentions.slice(0, index), { token, run }, ...draft.mentions.slice(index)] });
    setSelection({ start: caret, end: caret });
    setDismissed(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      const index = Math.max(0, options.findIndex((option) => option.id === currentId));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedId(options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.id ?? null);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const option = options[index];
        if (option != null) select(option);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (menuOpen) dismiss();
      else onCancel();
    } else if (event.key === "Enter" && !event.shiftKey && submitOnEnter) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <Popover
      open={menuOpen}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <PopoverAnchor asChild>
        <textarea
          ref={(element) => {
            textareaRef.current = element;
            if (element != null && pendingSelection.current != null) {
              element.setSelectionRange(pendingSelection.current, pendingSelection.current);
              pendingSelection.current = undefined;
            }
          }}
          className="block field-sizing-content max-h-48 min-h-7 w-full min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1 text-document leading-normal text-default outline-none placeholder:text-tertiary"
          aria-label={ariaLabel}
          aria-autocomplete={menuOpen ? "list" : undefined}
          aria-controls={menuOpen ? listboxId : undefined}
          aria-activedescendant={menuOpen && currentId != null ? `${listboxId}-option-${currentId}` : undefined}
          autoFocus={autoFocus}
          maxLength={maxCommentLength}
          placeholder={placeholder}
          rows={1}
          value={draft.text}
          onChange={(event) => {
            onDraftChange({ ...draft, text: event.currentTarget.value });
            sync(event.currentTarget);
          }}
          onInput={(event) => {
            if (event.currentTarget.value === draft.text) sync(event.currentTarget);
          }}
          onSelect={(event) => sync(event.currentTarget)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={onKeyDown}
        />
      </PopoverAnchor>
      {menuOpen ? (
        <PopoverContent
          className="z-50 flex w-fit flex-col overflow-y-auto text-default outline-hidden"
          align="start"
          side="top"
          unstyled
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.isComposing) return;
            dismiss();
            textareaRef.current?.focus();
          }}
          onInteractOutside={(event) => {
            if (event.target === textareaRef.current) event.preventDefault();
          }}
        >
          <MentionMenu id={listboxId} options={options} highlightedId={currentId} onHighlight={setHighlightedId} onSelect={select} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

interface CommentComposerProps {
  pageId: string;
  isReply: boolean;
  canMention: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  draft: CommentDraft;
  onDraftChange: (draft: CommentDraft) => void;
  onCancel: () => void;
  onSubmit: (body: PageInline[]) => void;
}

/** `TA1`: new comment or reply form, with `@` mentions of ChatGPT, the viewer's bot and people. */
function CommentComposer({ pageId, isReply, canMention, autoFocus = true, placeholder, draft, onDraftChange, onCancel, onSubmit }: CommentComposerProps) {
  const intl = useIntl();
  const selfName = useUserName(selfUserId);
  const hasText = draft.text.trim() !== "";
  const label = intl.formatMessage(isReply ? commentMessages.submitReply : commentMessages.submit);
  const submitButton = (
    <Button aria-label={label} disabled={!hasText} size="iconCircleSm" type="submit" uniform>
      <ArrowUpMdLight16Icon />
    </Button>
  );

  return (
    <form
      className={clsx("comment-typography relative flex min-w-0 items-start", isReply ? "gap-2.5 ps-4 pe-2 pb-2.5" : "gap-2")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (draftValid(draft)) onSubmit(draftToBody(draft));
      }}
    >
      {isReply ? (
        <div className="shrink-0 pt-1">
          <span aria-hidden className="pointer-events-none absolute start-7 top-0 h-1 w-px bg-border-subtle" />
          <PersonAvatar accountUserId={selfUserId} name={selfName} />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <ComposerFrame layout="multiline" radiusVariant="compact" surfaceVariant="default">
          <ComposerFrame.Body>
            <ComposerFrame.Input layout={hasText ? "multiline" : "single-line"}>
              <div className={clsx("flex min-w-0 items-center gap-1", hasText ? "pt-0.5" : "ps-3 pe-2 py-0.5")}>
                <CommentTextInput
                  pageId={pageId}
                  ariaLabel={intl.formatMessage(commentMessages.body)}
                  placeholder={placeholder ?? intl.formatMessage(isReply ? commentMessages.placeholder : commentMessages.createPlaceholder)}
                  autoFocus={autoFocus}
                  canMention={canMention}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  onCancel={onCancel}
                />
                {hasText ? null : submitButton}
              </div>
            </ComposerFrame.Input>
            {hasText ? (
              <ComposerFrame.Footer>
                <div className="col-span-full">
                  <ComposerFrame.FooterControls>{submitButton}</ComposerFrame.FooterControls>
                </div>
              </ComposerFrame.Footer>
            ) : null}
          </ComposerFrame.Body>
        </ComposerFrame>
      </div>
    </form>
  );
}

// --- Message ------------------------------------------------------------------------------

/** `PA`: comment text, clipped to 3 (6 when alone) lines until expanded. */
function CommentBody({ body, collapsedLines, resolved, mentions, onExpand }: { body: PageInline[]; collapsedLines: 3 | 6; resolved: boolean; mentions: PageDocument["taskMentions"]; onExpand?: () => void }) {
  const id = useId();
  const clipRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = clipRef.current;
    if (element == null) return;
    setClipped(!expanded && element.scrollHeight > element.clientHeight + 1);
  });
  const expand = () => {
    setExpanded(true);
    onExpand?.();
  };
  return (
    <div className={clsx("text-document leading-normal", resolved && "text-secondary")}>
      <div id={id} ref={clipRef} className={clsx(!expanded && previewCss.preview, !expanded && collapsedLines === 6 && previewCss.standalone)}>
        <div className="break-words outline-none" tabIndex={-1} onFocusCapture={clipped ? expand : undefined}>
          <span className="whitespace-pre-wrap">
            {body.map((run, index) => {
              if (run.kind === "text") return <Fragment key={index}>{run.text}</Fragment>;
              if (run.kind === "taskMention") {
                const mention = mentions[run.mentionId];
                return mention == null ? null : <TaskMentionChip key={index} mention={mention} viewer={selfUserId} resolved={resolved} onCompose={() => undefined} />;
              }
              if (run.kind === "pageReference") return null;
              return <PersonMention key={index} accountUserId={run.accountUserId} label={run.title} />;
            })}
          </span>
        </div>
      </div>
      {clipped ? (
        <div className="text-secondary">
          <Button className="min-h-6 text-sm" aria-controls={id} aria-expanded={false} color="ghostMuted" size="inline" onClick={expand}>
            <FormattedMessage {...commentMessages.more} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PersonMention({ accountUserId, label }: { accountUserId: string; label: string }) {
  return (
    <InlineMention
      icon={
        <span>
          <PersonAvatar accountUserId={accountUserId} name={label.replace(/^@/u, "")} size="inline" />
        </span>
      }
      tone="neutral"
    >
      {label}
    </InlineMention>
  );
}

/** `GA`: edit / delete menu of the viewer's own message, with its delete confirmation. */
function CommentMessageMenu({ threadId, message, editing, onEdit, onDelete, onDeleteThread }: { threadId: string; message: PageCommentMessage; editing: boolean; onEdit?: () => void; onDelete?: () => void; onDeleteThread?: () => void }) {
  const intl = useIntl();
  const label = intl.formatMessage(commentMessages.actions);
  const [confirm, setConfirm] = useState<"message" | "thread" | null>(null);
  return (
    <>
      <DropdownMenu
        align="end"
        contentWidth="menu"
        onCloseAutoFocus={(event) => {
          if (editing) event.preventDefault();
        }}
        triggerButton={
          <Tooltip cloneCustomTrigger side="left" tooltipContent={label}>
            <Button color="ghost" size="composerSm" uniform aria-label={label}>
              <EllipsisHorizontalLight16Icon />
            </Button>
          </Tooltip>
        }
      >
        {onEdit != null && message.deletedAt == null ? (
          <Menu.Item disabled={editing} onSelect={onEdit}>
            <FormattedMessage {...commentMessages.edit} />
          </Menu.Item>
        ) : null}
        {onDelete != null && message.deletedAt == null ? (
          <Menu.Item onSelect={() => setConfirm("message")}>
            <FormattedMessage {...commentMessages.deleteMessage} />
          </Menu.Item>
        ) : null}
        {onDeleteThread == null ? null : (
          <Menu.Item onSelect={() => setConfirm("thread")}>
            <FormattedMessage {...commentMessages.deleteThread} />
          </Menu.Item>
        )}
      </DropdownMenu>
      <Dialog
        open={confirm != null && (confirm !== "thread" || onDeleteThread != null)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogBody
          as="form"
          data-page-comment-thread-id={threadId}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (confirm === "thread") onDeleteThread?.();
            else onDelete?.();
            setConfirm(null);
          }}
        >
          <DialogSection>
            <DialogHeader
              title={<DialogTitle>{confirm === "thread" ? <FormattedMessage {...commentMessages.confirmDeleteThread} /> : <FormattedMessage {...commentMessages.confirmDeleteMessage} />}</DialogTitle>}
              subtitle={
                <DialogDescription>
                  {confirm === "thread" ? <FormattedMessage {...commentMessages.deleteThreadDescription} /> : <FormattedMessage {...commentMessages.deleteMessageDescription} />}
                </DialogDescription>
              }
            />
          </DialogSection>
          <DialogFooter>
            <Button color="secondary" onClick={() => setConfirm(null)}>
              <FormattedMessage {...commentMessages.cancelEdit} />
            </Button>
            <Button type="submit" color="danger">
              <FormattedMessage {...commentMessages.confirmDelete} />
            </Button>
          </DialogFooter>
        </DialogBody>
      </Dialog>
    </>
  );
}

/** `hA`: scrolls `target` into the visible part of `container`, respecting its scroll padding. */
function scrollIntoContainer(container: HTMLElement, target: HTMLElement) {
  const box = container.getBoundingClientRect();
  if (container.offsetHeight === 0 || box.height === 0) return;
  const rect = target.getBoundingClientRect();
  const scale = box.height / container.offsetHeight;
  const style = getComputedStyle(container);
  const paddingTop = Number.parseFloat(style.scrollPaddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.scrollPaddingBottom) || 0;
  const top = box.top + (container.clientTop + paddingTop) * scale;
  const bottom = box.top + (container.clientTop + container.clientHeight - paddingBottom) * scale;
  const delta = rect.top < top ? rect.top - top : Math.max(0, Math.min(rect.bottom - bottom, rect.top - top));
  if (delta !== 0) container.scrollTo({ top: container.scrollTop + delta / scale, behavior: "instant" });
}

/** `ZA`: focuses the edit field once its form mounts. */
function focusEditForm(form: HTMLFormElement | null) {
  const input = form?.querySelector("textarea");
  const scroller = form?.closest<HTMLElement>("[data-page-comment-sidebar-scroll]");
  input?.focus({ preventScroll: scroller != null });
  if (input != null && scroller != null) scrollIntoContainer(scroller, input);
}

/** `XA`: inline edit form of the viewer's own message. */
function CommentEditForm({ pageId, draft, onDraftChange, onCancel, onSave }: { pageId: string; draft: CommentDraft; onDraftChange: (draft: CommentDraft) => void; onCancel: () => void; onSave: () => void }) {
  const intl = useIntl();
  const valid = draftValid(draft);
  return (
    <form
      ref={focusEditForm}
      className="flex min-w-0 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <CommentTextInput
        pageId={pageId}
        ariaLabel={intl.formatMessage(commentMessages.editBody)}
        placeholder=""
        autoFocus={false}
        submitOnEnter={false}
        canMention
        draft={draft}
        onDraftChange={onDraftChange}
        onCancel={onCancel}
      />
      <div className="flex justify-end gap-2">
        <Button color="secondary" size="compact" onClick={onCancel}>
          <FormattedMessage {...commentMessages.cancelEdit} />
        </Button>
        <Button type="submit" size="compact" disabled={!valid}>
          <FormattedMessage {...commentMessages.saveEdit} />
        </Button>
      </div>
    </form>
  );
}

interface CommentMessageViewProps {
  pageId: string;
  thread: PageCommentThread;
  message: PageCommentMessage;
  mentions: PageDocument["taskMentions"];
  writable: boolean;
  resolved: boolean;
  hasConnector: boolean;
  hasPrevious: boolean;
  collapsedLines: 3 | 6;
  action?: ReactNode;
  canDeleteThread: boolean;
  onToggleSelection?: () => void;
  onExpand?: () => void;
}

/** Who reacted: you, or one of your bots by name. */
function useReactorNames() {
  const users = useSpacesStore((state) => state.users);
  const dots = useDots();
  return (reactorIds: string[]) =>
    reactorIds.flatMap((id) => {
      const user = findSpacesUser(users, id);
      if (user != null) return [user.display_name];
      const dot = resolveDot(dots, id);
      return dot == null ? [] : [dotName(dot)];
    });
}

/** `Nj1`: one message of a thread with its author, time, actions, reactions and body. */
function CommentMessageView({ pageId, thread, message, mentions, writable, resolved, hasConnector, hasPrevious, collapsedLines, action, canDeleteThread, onToggleSelection, onExpand }: CommentMessageViewProps) {
  const intl = useIntl();
  const store = usePageDocumentsStore.getState;
  const { author } = message;
  const name = useUserName(author.accountUserId);
  const knownAuthor = name != null;
  const agent = author.kind !== "user";
  /** A bot's comment; with no bot to stand for it (you have none), it reads as Willow's. */
  const authorDot = useResolvedDot(author.kind === "dot" ? author.conversationId : null);
  const own = writable && author.kind === "user" && author.accountUserId === selfUserId;
  const [editDraft, setEditDraft] = useState<CommentDraft | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactorNames = useReactorNames();
  const addReaction = intl.formatMessage(commentMessages.addReaction);
  const agentName = authorDot != null ? dotName(authorDot) : intl.formatMessage(commentMessages.chatgptAuthor);
  const editing = editDraft != null && message.deletedAt == null;

  const react = (emoji: string, active: boolean) => store().toggleReaction(pageId, thread.id, message.id, emoji, selfUserId, active);

  const avatar = agent ? (
    <span className="relative block size-6 shrink-0">
      {authorDot != null ? <DotAvatar className="size-6" identity={authorDot.conversationId} animated={false} /> : <WillowMark className="size-6" />}
    </span>
  ) : (
    <PersonAvatar accountUserId={author.accountUserId} name={knownAuthor ? name : "?"} />
  );

  const authorLabel = agent ? (
    <button
      className={clsx("flex min-w-0 items-center rounded-sm text-start font-medium focus-visible:outline-2 focus-visible:outline-ring", resolved && "text-secondary")}
      type="button"
      onClick={onToggleSelection}
    >
      <span className="truncate">{agentName}</span>
    </button>
  ) : (
    <span className={clsx("flex min-w-0 items-center font-medium", resolved && "text-secondary")}>
      <span className="truncate">
        <FormattedMessage {...commentMessages.author} values={{ viewer: String(author.accountUserId === selfUserId), knownAuthor: String(knownAuthor), authorName: name }} />
      </span>
    </span>
  );

  const header = (
    <div className="flex min-w-0 items-start gap-1">
      <span className="flex min-w-0 flex-1 items-center gap-1 text-base select-none">
        {authorLabel}
        <span className="truncate text-sm text-tertiary">
          <CompactRelativeTime dateString={new Date(message.createdAt).toISOString()} />
        </span>
        {message.editedAt != null && message.deletedAt == null ? (
          <span className="text-sm text-tertiary">
            <FormattedMessage {...commentMessages.edited} />
          </span>
        ) : null}
      </span>
      <div className={clsx("-my-1 me-px flex shrink-0 items-center focus-within:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100 electron:relative electron:-end-1", pickerOpen ? "opacity-100" : "opacity-0")}>
        {action}
        {writable && message.deletedAt == null ? (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <Tooltip tooltipContent={addReaction}>
              <PopoverTrigger asChild>
                <Button aria-label={addReaction} color="ghostActive" size="composerSm" uniform>
                  <EmojiFaceBadgePlusLight16Icon />
                </Button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent className="z-50 outline-hidden" align="end" aria-label={addReaction} unstyled>
              <SymbolPicker
                layout="compact"
                capabilities={{
                  emoji: {
                    allowedEmojis,
                    selectedEmojis: message.reactions.filter((reaction) => reaction.reactorIds.includes(selfUserId)).map((reaction) => reaction.emoji),
                    getEmojiLabel: (emoji) => intl.formatMessage(commentMessages.reaction, { emoji }),
                  },
                }}
                showSearch={false}
                onSelect={(selection) => {
                  if (selection.kind !== "emoji") return;
                  setPickerOpen(false);
                  react(selection.value, !message.reactions.find((reaction) => reaction.emoji === selection.value)?.reactorIds.includes(selfUserId));
                }}
              />
            </PopoverContent>
          </Popover>
        ) : null}
        {own || canDeleteThread ? (
          <CommentMessageMenu
            threadId={thread.id}
            message={message}
            editing={editing}
            onEdit={own ? () => setEditDraft(bodyToDraft(message.body, mentions)) : undefined}
            onDelete={own ? () => store().deleteMessage(pageId, thread.id, message.id) : undefined}
            onDeleteThread={
              canDeleteThread
                ? () => {
                    clearCommentAnchors(pageId, thread.id);
                    store().deleteThread(pageId, thread.id);
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <CommentMessageLayout data-page-comment-message-id={message.id} tabIndex={-1} hasConnector={hasConnector} hasPrevious={hasPrevious} avatar={avatar} header={header}>
      {editing && editDraft != null ? (
        <CommentEditForm
          pageId={pageId}
          draft={editDraft}
          onDraftChange={setEditDraft}
          onCancel={() => setEditDraft(null)}
          onSave={() => {
            store().editMessage(pageId, thread.id, message.id, draftToBody(editDraft));
            setEditDraft(null);
          }}
        />
      ) : (
        <CommentBody body={message.body} collapsedLines={collapsedLines} resolved={resolved} mentions={mentions} onExpand={onExpand} />
      )}
      {message.deletedAt == null && message.reactions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-xs text-secondary">
          {message.reactions.map((reaction) => {
            const reactedByMe = reaction.reactorIds.includes(selfUserId);
            const people = reactorNames(reaction.reactorIds);
            return (
              <Tooltip
                key={reaction.emoji}
                tooltipContent={
                  <span>
                    {people.length > 0 ? (
                      <FormattedMessage {...commentMessages.reactionPeople} values={{ emoji: reaction.emoji, people: intl.formatList(people) }} />
                    ) : (
                      <FormattedMessage {...commentMessages.reactionCountWithEmoji} values={{ emoji: reaction.emoji, count: reaction.reactorIds.length }} />
                    )}
                  </span>
                }
              >
                <Button
                  aria-label={intl.formatMessage(commentMessages.reaction, { emoji: reaction.emoji })}
                  aria-pressed={reactedByMe}
                  color={reactedByMe ? "secondary" : "ghostSecondary"}
                  disabled={!writable}
                  size="compact"
                  onClick={() => react(reaction.emoji, !reactedByMe)}
                >
                  {reaction.emoji}
                  <span className="text-xs tabular-nums">{reaction.reactorIds.length}</span>
                </Button>
              </Tooltip>
            );
          })}
        </div>
      ) : null}
    </CommentMessageLayout>
  );
}

// --- Thread card --------------------------------------------------------------------------

/** `Gj`: rounded comment card. */
function CommentCard({ borderless = false, inPanel = false, selected = false, className, ref, ...rest }: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement>; borderless?: boolean; inPanel?: boolean; selected?: boolean }) {
  return (
    <div
      ref={ref}
      {...rest}
      className={clsx(
        "comment-typography group relative min-w-0 rounded-xl text-default",
        !inPanel && "bg-surface-elevated",
        inPanel && selected && "bg-background-secondary-soft",
        !borderless && "ring-1 ring-inset ring-border hover:ring-[1.5px]",
        className,
      )}
      data-page-comment-card=""
    />
  );
}

interface ThreadCardProps {
  pageId: string;
  document: PageDocument;
  thread: PageCommentThread;
  writable: boolean;
  canComment: boolean;
  selected: boolean;
  inPanel: boolean;
  onSelect: () => void;
  onDeselect: () => void;
  onHighlight: (threadId: string | null) => void;
}

/** `Bj1`: a thread card; selecting it reveals the reply field. */
function ThreadCard({ pageId, document: pageDocument, thread, writable, canComment, selected, inPanel, onSelect, onDeselect, onHighlight }: ThreadCardProps) {
  const intl = useIntl();
  const messagesId = useId();
  const [expandedFrom, setExpandedFrom] = useState<string | null>(null);
  const [reply, setReply] = useState<CommentDraft>(emptyDraft);
  const messages = thread.messages.filter((message) => message.deletedAt == null || thread.messages.length > 1);
  const resolved = thread.state === "resolved";
  const open = !resolved && thread.blockId != null;
  const canDeleteThread = writable && thread.messages.every((message) => message.author.kind === "user" && message.author.accountUserId === selfUserId);
  if (messages.length === 0) return null;
  const expandedIndex = messages.findIndex((message) => message.id === expandedFrom);
  const firstShown = expandedIndex > 0 ? expandedIndex : Math.max(1, messages.length - 1);
  const hiddenCount = firstShown - 1;
  const shown = messages.filter((_, index) => index === 0 || index >= firstShown);
  const resolveLabel = intl.formatMessage(commentMessages.resolve);
  const store = usePageDocumentsStore.getState;
  const composer =
    selected && canComment && !resolved ? (
      <CommentComposer
        key="reply"
        pageId={pageId}
        isReply
        canMention
        draft={reply}
        onDraftChange={setReply}
        onCancel={onDeselect}
        onSubmit={(body) => {
          const messageId = store().replyToThread(pageId, thread.id, selfAuthor, body);
          sendCommentMentions(intl, pageId, thread.id, messageId, body);
          setReply(emptyDraft);
        }}
      />
    ) : null;

  return (
    <CommentCard
      aria-label={intl.formatMessage(commentMessages.thread)}
      inPanel={inPanel}
      selected={selected}
      role="group"
      data-page-comment-thread-card={thread.id}
      onMouseEnter={() => onHighlight(open ? thread.id : null)}
      onMouseLeave={() => onHighlight(null)}
      onClick={(event) => {
        if (window.getSelection()?.isCollapsed === false || !(event.target instanceof Element)) return;
        if (event.target.closest('button, a, form, input, textarea, select, [contenteditable="true"], [role=button], [role=dialog], [role=menu]') != null) return;
        if (selected) onDeselect();
        else onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && selected && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.querySelector<HTMLElement>("[data-comment-thread-select]")?.focus();
          onDeselect();
        }
      }}
    >
      <div id={messagesId} className="relative flex flex-col">
        <button
          type="button"
          data-comment-thread-select=""
          className="absolute inset-0 cursor-interaction rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          aria-expanded={selected}
          aria-label={intl.formatMessage(commentMessages.selectThread)}
          onClick={selected ? onDeselect : onSelect}
        />
        {shown.map((message, index) => (
          <Fragment key={message.id}>
            <CommentMessageView
              pageId={pageId}
              thread={thread}
              message={message}
              mentions={pageDocument.taskMentions}
              writable={writable && !resolved}
              resolved={resolved}
              hasConnector={index < shown.length - 1 || composer != null}
              hasPrevious={index > 0}
              collapsedLines={messages.length === 1 ? 6 : 3}
              canDeleteThread={index === 0 && canDeleteThread}
              onToggleSelection={selected ? onDeselect : onSelect}
              onExpand={index === 0 ? undefined : () => setExpandedFrom((current) => current ?? message.id)}
              action={
                index === 0 && writable && !resolved ? (
                  <Tooltip tooltipContent={resolveLabel}>
                    <Button aria-label={resolveLabel} color="ghost" size="composerSm" uniform onClick={() => store().setThreadState(pageId, thread.id, "resolved")}>
                      <CheckmarkMdLight16Icon />
                    </Button>
                  </Tooltip>
                ) : null
              }
            />
            {index === 0 && hiddenCount > 0 ? (
              <div className="relative flex min-h-8 items-center ps-12.5 pe-2 text-sm text-secondary">
                <span aria-hidden className="pointer-events-none absolute start-7 top-0 bottom-0 w-px bg-border-subtle" />
                <Button className="min-h-6" aria-controls={messagesId} aria-expanded={false} color="ghostMuted" size="inline" onClick={() => setExpandedFrom(messages[1]?.id ?? null)}>
                  <FormattedMessage {...commentMessages.showReplies} values={{ count: hiddenCount }} />
                </Button>
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>
      <AnimatePresence initial={false}>{composer}</AnimatePresence>
      {resolved ? (
        <div className="flex flex-wrap items-center justify-between gap-2 ps-4 pe-3 pb-2 text-sm text-tertiary select-none">
          <span>
            <FormattedMessage
              {...commentMessages.resolvedStatus}
              values={{ hasDate: String(thread.resolvedAt != null), time: thread.resolvedAt == null ? null : <CompactRelativeTime key="resolved-time" dateString={new Date(thread.resolvedAt).toISOString()} /> }}
            />
          </span>
          {writable ? (
            <Button color="ghostSecondary" size="compact" onClick={() => store().setThreadState(pageId, thread.id, "open")}>
              <FormattedMessage {...commentMessages.reopen} />
            </Button>
          ) : null}
        </div>
      ) : null}
    </CommentCard>
  );
}

/** `UA1`: collapsible section of resolved threads. */
function ResolvedSection({ children }: { children: ReactNode }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="mt-3 flex flex-col gap-1.5 border-t border-default pt-2" data-page-comment-card="">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        className="flex w-full cursor-interaction items-center justify-between rounded-lg px-2 py-2 text-start text-sm font-medium text-secondary select-none hover:bg-primary-ghost-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <FormattedMessage {...commentMessages.resolvedHeading} />
        <ChevronRightMdLight16Icon className={clsx(expanded && "rotate-90")} />
      </button>
      <div id={id} className="flex flex-col gap-1.5" hidden={!expanded}>
        {expanded ? children : null}
      </div>
    </section>
  );
}

// --- Panel --------------------------------------------------------------------------------

export interface PageCommentsProps {
  pageId: string;
  document: PageDocument;
  canComment: boolean;
  canWrite: boolean;
  activeThreadId: string | null;
  pending: PendingComment | null;
  onPendingChange: (pending: PendingComment | null) => void;
  onActiveThreadChange: (threadId: string | null) => void;
  onHighlightThread: (threadId: string | null) => void;
}

function blockOrder(document: PageDocument) {
  return new Map(document.blocks.map((block, index) => [block.id, index]));
}

/** The pending new-comment or task-prompt card. */
function PendingCard({ pageId, pending, inPanel, onPendingChange, onActiveThreadChange }: Pick<PageCommentsProps, "pageId" | "onPendingChange" | "onActiveThreadChange"> & { pending: PendingComment; inPanel: boolean }) {
  const intl = useIntl();
  const [draft, setDraft] = useState<CommentDraft>(emptyDraft);
  const store = usePageDocumentsStore.getState;
  if (pending.kind === "task") {
    return (
      <CommentCard inPanel={inPanel} selected className="p-2">
        <CommentComposer
          pageId={pageId}
          isReply={false}
          canMention={false}
          placeholder={intl.formatMessage(mentionMessages.prompt)}
          draft={draft}
          onDraftChange={setDraft}
          onCancel={() => onPendingChange(null)}
          onSubmit={() => {
            sendTaskMention(intl, pageId, pending.mentionId, draft.text.trim());
            onPendingChange(null);
            const threadId = usePageDocumentsStore.getState().documents[pageId]?.taskMentions[pending.mentionId]?.commentThreadId;
            if (threadId != null) onActiveThreadChange(threadId);
          }}
        />
      </CommentCard>
    );
  }
  const { target } = pending;
  return (
    <CommentCard inPanel={inPanel} selected className="p-2">
      <CommentComposer
        pageId={pageId}
        isReply={false}
        canMention
        draft={draft}
        onDraftChange={setDraft}
        onCancel={() => onPendingChange(null)}
        onSubmit={(body) => {
          const threadId = store().createThread(pageId, { blockId: target.blockId, quote: target.quote, author: selfAuthor, body });
          anchorCommentThread(pageId, target, threadId);
          const messageId = store().documents[pageId]?.threads.find((thread) => thread.id === threadId)?.messages[0]?.id;
          if (messageId != null) sendCommentMentions(intl, pageId, threadId, messageId, body);
          onPendingChange(null);
          onActiveThreadChange(threadId);
        }}
      />
    </CommentCard>
  );
}

/** Threads in document order, the detached ones under their quiet heading, then the resolved section. */
function ThreadList({ inPanel, ...props }: PageCommentsProps & { inPanel: boolean }) {
  const { pageId, document: pageDocument, canComment, canWrite, activeThreadId, pending, onPendingChange, onActiveThreadChange, onHighlightThread } = props;
  const order = blockOrder(pageDocument);
  const rank = (thread: PageCommentThread) => (thread.blockId == null ? Number.MAX_SAFE_INTEGER : (order.get(thread.blockId) ?? Number.MAX_SAFE_INTEGER));
  const sorted = [...pageDocument.threads].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
  const open = sorted.filter((thread) => thread.state === "open" && thread.blockId != null && order.has(thread.blockId));
  const detached = sorted.filter((thread) => thread.state === "open" && !(thread.blockId != null && order.has(thread.blockId)));
  const resolved = sorted.filter((thread) => thread.state === "resolved");
  const card = (thread: PageCommentThread) => (
    <ThreadCard
      key={thread.id}
      pageId={pageId}
      document={pageDocument}
      thread={thread}
      writable={canWrite || canComment}
      canComment={canComment}
      selected={activeThreadId === thread.id}
      inPanel={inPanel}
      onSelect={() => onActiveThreadChange(thread.id)}
      onDeselect={() => onActiveThreadChange(null)}
      onHighlight={onHighlightThread}
    />
  );
  return (
    <div className="flex flex-col gap-1.5">
      {pending == null ? null : <PendingCard key={pending.kind === "task" ? pending.mentionId : `${pending.target.blockId}:${pending.target.from}`} pageId={pageId} pending={pending} inPanel={inPanel} onPendingChange={onPendingChange} onActiveThreadChange={onActiveThreadChange} />}
      {open.map(card)}
      {detached.length > 0 ? (
        <>
          <h3 className="px-2 py-2 text-sm text-tertiary select-none">
            <FormattedMessage {...commentMessages.detached} />
          </h3>
          {detached.map(card)}
        </>
      ) : null}
      {resolved.length > 0 ? <ResolvedSection>{resolved.map(card)}</ResolvedSection> : null}
    </div>
  );
}

/** `GA1`: the comments sidebar shown in the `Rv` drawer. */
export function PageCommentsSidebar({ onClose, ...props }: PageCommentsProps & { onClose: () => void }) {
  const intl = useIntl();
  const empty = props.pending == null && props.document.threads.length === 0;
  const heading = <FormattedMessage {...commentMessages.sidebarHeading} />;
  const close = intl.formatMessage(commentMessages.closeSidebar);
  return (
    <CommentsSidebarLayout embedded labels={{ sidebar: intl.formatMessage(commentMessages.sidebar), heading, close }} header={<PanelHeader title={heading} closeLabel={close} onClose={onClose} />}>
      <div className="gemini-chat-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-4" data-page-comment-sidebar-scroll="">
        {empty ? (
          <div className="flex flex-col items-center gap-4 px-8 pt-40 text-center text-secondary select-none">
            <TextBubbleLight20Icon />
            <div className="flex flex-col gap-2">
              <p className="text-base leading-4 font-medium">
                <FormattedMessage {...commentMessages.empty} />
              </p>
              {props.canComment && (
                <p className="text-base leading-5">
                  <FormattedMessage {...commentMessages.emptyDescription} />
                </p>
              )}
            </div>
          </div>
        ) : (
          <ThreadList {...props} inPanel />
        )}
      </div>
    </CommentsSidebarLayout>
  );
}

/** Floating comments beside the document: open threads aligned with their highlighted text. */
export function PageCommentsRail(props: PageCommentsProps & { editorElement: HTMLElement | null }) {
  const { editorElement, ...rest } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const anchorId = props.pending?.kind === "comment" ? null : props.activeThreadId;
  useEffect(() => {
    const list = listRef.current;
    if (list == null || editorElement == null) return;
    const anchor = anchorId == null ? null : editorElement.querySelector(`[data-page-comment-thread="${CSS.escape(anchorId)}"]`);
    const pendingBlock = props.pending?.kind === "comment" ? editorElement.querySelector(`[data-page-block-id="${CSS.escape(props.pending.target.blockId)}"]`) : null;
    const target = anchor ?? pendingBlock;
    const container = list.offsetParent;
    if (target == null || container == null) {
      setOffset(0);
      return;
    }
    setOffset(Math.max(0, target.getBoundingClientRect().top - container.getBoundingClientRect().top));
  }, [anchorId, editorElement, props.pending]);
  return (
    <div ref={listRef} className="relative w-80" style={{ paddingTop: offset }}>
      <ThreadList {...rest} inPanel={false} />
    </div>
  );
}
