import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import { useDotTint } from '../dot-tint';
import type { SparkDot } from '../dots-store';
import { reactToDotMessage, stopDotScreen, type DotActivity } from '../harness/dot-runtime';
import { dotAttachmentBlob } from '../harness/runtime/dot-attachments';
import type { ScreenState } from '../harness/runtime/screen-control';
import type { DotAttachmentRef, DotItem, DotThread } from '../harness/thread/thread-types';
import { M3_SCOPE } from '../m3/m3';
import { appOfCall, type DotAppMark } from './app-marks';
import { chatRows, type MessageRow } from './chat-rows';
import './DotChat.css';

/** The row a long press or the react button opens with; "more" shows the rest of the picker. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
/** The rest of the user's picker. The bot is not limited to these: it reacts with whatever emoji fits. */
const MORE_REACTIONS = [
  '👍', '👎', '❤️', '😂', '🤣', '😊', '😍', '🥰', '😘', '😮', '😢', '😭', '😡', '🤔', '🙏', '👏',
  '🙌', '🤝', '💪', '👀', '🔥', '✨', '🎉', '💯', '✅', '❌', '⭐', '💡', '🚀', '🫡', '😅', '🙃',
  '😎', '🤯', '🥳', '😴', '🤗', '🤞', '👌', '✌️', '🫶', '💀',
];
const LONG_PRESS_MS = 450;
const timeLabel = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Opens the picker on a touch press held still, as a messenger does; mouse and pen keep their text selection. */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const pointerType = useRef('');
  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      pointerType.current = event.pointerType;
      if (event.pointerType !== 'touch') return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        clear();
        navigator.vibrate?.(8);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (event: ReactMouseEvent) => {
      if (pointerType.current === 'touch') event.preventDefault();
    },
  };
}

function ReactionPicker({
  anchorRef,
  current,
  onPick,
  onCopy,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  current: string | null;
  onPick: (emoji: string | null) => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [placement, setPlacement] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Above the bubble when it fits, else below it, else over its top; always inside the visible conversation.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const picker = ref.current;
    if (!anchor || !picker) return;
    const bubble = (anchor.querySelector('.dot-chat__bubble') ?? anchor).getBoundingClientRect();
    const frame = anchor.getBoundingClientRect();
    const area = (anchor.closest('.spark-task-detail__conversation-scroll') ?? document.documentElement).getBoundingClientRect();
    // Layout size, not the box: the picker scales in as it opens.
    const width = picker.offsetWidth;
    const height = picker.offsetHeight;
    const margin = 8;
    const gap = 6;
    const minTop = Math.max(area.top, 0) + margin;
    const maxTop = Math.min(area.bottom, window.innerHeight) - height - margin;
    let top = bubble.top - height - gap;
    let below = false;
    if (top < minTop) {
      below = true;
      top = bubble.bottom + gap <= maxTop ? bubble.bottom + gap : Math.max(minTop, Math.min(bubble.top + margin, maxTop));
    }
    const right = Math.min(area.right, window.innerWidth) - margin;
    const left = Math.max(Math.max(area.left, 0) + margin, Math.min(bubble.left, right - width));
    // Offsets from the bubble's frame, so a transformed column moves the picker with it.
    setPlacement({ top: Math.round(top - frame.top), left: Math.round(left - frame.left), below });
  }, [anchorRef, expanded]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      close.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    const frame = requestAnimationFrame(() => (ref.current?.querySelector('md-icon-button') as HTMLElement | null)?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef]);

  // The user's current reaction is always in the quick row, where they can see it and take it back.
  const quick = current && !QUICK_REACTIONS.includes(current) ? [current, ...QUICK_REACTIONS.slice(0, QUICK_REACTIONS.length - 1)] : QUICK_REACTIONS;
  const choices = expanded ? MORE_REACTIONS : quick;
  return (
    <div
      ref={ref}
      className={`dot-chat__picker${placement ? (placement.below ? ' is-below' : '') : ' is-unplaced'}${expanded ? ' is-expanded' : ''}`}
      style={placement ? { top: placement.top, left: placement.left } : undefined}
      role="dialog"
      aria-label="React to this message"
    >
      <md-elevation />
      <div className="dot-chat__picker-grid" role="group" aria-label="Reactions">
        {choices.map((emoji) => (
          <md-icon-button
            key={emoji}
            data-reaction={emoji}
            className={emoji === current ? 'is-selected' : undefined}
            aria-label={emoji === current ? `Remove your ${emoji}` : `React with ${emoji}`}
            onClick={() => onPick(emoji === current ? null : emoji)}
          >
            <span className="dot-chat__picker-emoji">{emoji}</span>
          </md-icon-button>
        ))}
        {!expanded && (
          <md-icon-button data-action="more" aria-label="More reactions" onClick={() => setExpanded(true)}>
            <MaterialSymbol name="add_reaction" size={22} opticalSize={24} weight={350} />
          </md-icon-button>
        )}
      </div>
      <md-divider />
      <div className="dot-chat__picker-actions">
        <md-text-button hasIcon onClick={onCopy}>
          <span slot="icon" className="dot-chat__button-icon">
            <MaterialSymbol name="content_copy" size={18} opticalSize={20} weight={350} />
          </span>
          Copy text
        </md-text-button>
      </div>
    </div>
  );
}

const copyText = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined);

/**
 * A message's reactions as a messenger shows them: each emoji in a small round notch cut out of the bubble's inner
 * bottom corner, several overlapping, the same whoever reacted. Nothing but the emoji shows; a label the bot gave
 * its reaction is the group's accessible name. The user's own opens the picker, to change or take back the reaction.
 */
function ReactionPill({ emoji, label, onClick }: { emoji: string[]; label: string; onClick?: () => void }) {
  const faces = emoji.map((face, index) => (
    <span key={`${face}-${index}`} className="dot-chat__reaction-emoji" aria-hidden="true">
      {face}
    </span>
  ));
  if (!onClick) {
    return (
      <span className="dot-chat__reaction-pill" role="img" aria-label={label}>
        {faces}
      </span>
    );
  }
  return (
    <button type="button" className="dot-chat__reaction-pill is-yours" aria-label={label} onClick={onClick}>
      <md-focus-ring />
      {faces}
    </button>
  );
}

function DotMessage({
  dot,
  name,
  row,
  pickerOpen,
  onPickerChange,
}: {
  dot: SparkDot;
  name: string;
  row: MessageRow;
  pickerOpen: boolean;
  onPickerChange: (open: boolean) => void;
}) {
  const { item, userReaction, joinedAbove, joinedBelow } = row;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const streaming = Boolean(item.streaming);
  const longPress = useLongPress(() => !streaming && onPickerChange(true));

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const pick = (emoji: string | null) => {
    onPickerChange(false);
    void reactToDotMessage(dot.id, item.id, emoji);
  };
  const copy = () => {
    void copyText(item.text);
    setCopied(true);
    onPickerChange(false);
  };

  return (
    <article
      className={`dot-chat__row is-dot${joinedAbove ? ' is-joined-above' : ''}${joinedBelow ? ' is-joined-below' : ''}`}
      aria-label={`${name}, ${timeLabel(item.at)}`}
    >
      <div className="dot-chat__stack">
        <div ref={wrapRef} className={`dot-chat__bubble-wrap${pickerOpen ? ' is-picking' : ''}`}>
          <div className={`dot-chat__bubble-frame${userReaction ? ' has-reaction' : ''}`}>
            <div
              className="dot-chat__bubble"
              tabIndex={streaming ? -1 : 0}
              aria-haspopup="dialog"
              onKeyDown={(event) => {
                if (streaming || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                onPickerChange(!pickerOpen);
              }}
              {...longPress}
            >
              <md-focus-ring />
              <StreamingMarkdown text={item.text} isStreaming={streaming} animate={streaming} reveal={streaming} />
            </div>
            {userReaction && (
              <ReactionPill emoji={[userReaction]} label={`You reacted ${userReaction}. Change or remove it`} onClick={() => onPickerChange(!pickerOpen)} />
            )}
          </div>
          {!streaming && (
            <div className="dot-chat__actions">
              <md-icon-button data-action="react" aria-label="React" aria-expanded={pickerOpen} onClick={() => onPickerChange(!pickerOpen)}>
                <MaterialSymbol name="add_reaction" size={20} opticalSize={20} weight={350} />
              </md-icon-button>
              <md-icon-button data-action="copy" aria-label={copied ? 'Copied' : 'Copy text'} onClick={copy}>
                <MaterialSymbol name={copied ? 'check' : 'content_copy'} size={18} opticalSize={20} weight={350} />
              </md-icon-button>
            </div>
          )}
          {pickerOpen && <ReactionPicker anchorRef={wrapRef} current={userReaction} onPick={pick} onCopy={copy} onClose={() => onPickerChange(false)} />}
        </div>
        {!joinedBelow && <span className="dot-chat__meta">{timeLabel(item.at)}</span>}
      </div>
    </article>
  );
}

/** Where the user wrote a message, when not here: said before its time. */
const writtenOn = (item: DotItem): string => {
  if (item.via === 'telegram') return 'Telegram · ';
  if (item.via !== 'discord') return '';
  return item.discord?.guildId ? `${item.discord.where?.match(/^#[^\s(]+/)?.[0] ?? 'A server'} on Discord · ` : 'Discord · ';
};

const isPicture = (file: DotAttachmentRef): boolean => file.type === 'image' || /^image\//.test(file.mimeType ?? '');

const FileChip = ({ file }: { file: DotAttachmentRef }) => (
  <span className="dot-chat__attachment">
    <MaterialSymbol name={isPicture(file) ? 'image' : 'attach_file'} size={16} opticalSize={20} weight={350} />
    {file.name}
  </span>
);

/** A picture the user sent, as itself — drawn from its stored bytes, held at its size while they load. */
function SentPicture({ file }: { file: DotAttachmentRef }) {
  const [url, setUrl] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    void dotAttachmentBlob(file)
      .then((blob) => {
        if (!live) return;
        if (!blob) {
          setGone(true);
          return;
        }
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => live && setGone(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.id]);
  if (gone) return <FileChip file={file} />;
  return url ? <img className="dot-chat__picture" src={url} alt={file.name} /> : <span className="dot-chat__picture is-loading" role="img" aria-label={file.name} />;
}

function UserMessage({ name, row, seen }: { name: string; row: MessageRow; seen: boolean }) {
  const { item, dotReactions, joinedAbove, joinedBelow } = row;
  const files = item.attachments ?? [];
  const pictures = files.filter(isPicture);
  const others = files.filter((file) => !isPicture(file));
  return (
    <div className={`dot-chat__row is-user${joinedAbove ? ' is-joined-above' : ''}${joinedBelow ? ' is-joined-below' : ''}`}>
      <div className="dot-chat__stack">
        <div className={`dot-chat__bubble-frame${dotReactions.length ? ' has-reaction' : ''}`}>
          {pictures.length > 0 && (
            <div className={`dot-chat__pictures${pictures.length > 1 ? ' is-several' : ''}`}>
              {pictures.map((file) => (
                <SentPicture key={file.id} file={file} />
              ))}
            </div>
          )}
          {(item.text || others.length > 0) && (
            <div className="dot-chat__bubble">
              {item.text}
              {others.length > 0 && (
                <span className="dot-chat__attachments">
                  {others.map((file) => (
                    <FileChip key={file.id} file={file} />
                  ))}
                </span>
              )}
            </div>
          )}
          {dotReactions.length > 0 && (
            <ReactionPill
              emoji={dotReactions.map((reaction) => reaction.emoji!)}
              label={`${name} reacted ${dotReactions.map((reaction) => `${reaction.emoji}${reaction.label ? ` (${reaction.label})` : ''}`).join(', ')}`}
            />
          )}
        </div>
        {(seen || !joinedBelow) && <span className="dot-chat__meta">{seen ? `Seen · ${writtenOn(item)}${timeLabel(item.at)}` : `${writtenOn(item)}${timeLabel(item.at)}`}</span>}
      </div>
    </div>
  );
}

/** "Connecting to <logo> <app>" while the bot's call to an app runs, as Willow's chat says it; "Connected to" after. */
function AppMark({ mark, live }: { mark: DotAppMark; live: boolean }) {
  return (
    <p className={`dot-chat__mark${live ? ' is-live' : ''}`} data-mark="app">
      <span className="dot-chat__mark-text">{live ? 'Connecting to' : 'Connected to'}</span>{' '}
      {mark.logo ? (
        <img className="dot-chat__mark-logo" src={mark.logo} alt="" />
      ) : (
        <span className="dot-chat__mark-icon" aria-hidden="true">
          <MaterialSymbol name={mark.symbol ?? 'apps'} size={16} opticalSize={20} weight={400} />
        </span>
      )}{' '}
      <span className="dot-chat__mark-text">{mark.label}</span>
    </p>
  );
}

const SCREEN_MARKS: Record<Exclude<ScreenState, 'pending'>, (name: string) => string> = {
  allowed: (name) => `${name} is using your screen`,
  ended: (name) => `${name} used your screen`,
  stopped: (name) => `You took your screen back from ${name}`,
  declined: (name) => `You didn’t let ${name} use your screen`,
};

/** The user's screen in the bot's hands, as a line of the conversation, with Stop while it lasts. */
function ScreenMark({ dotId, name, state }: { dotId: string; name: string; state: Exclude<ScreenState, 'pending'> }) {
  return (
    <p className={`dot-chat__mark${state === 'allowed' ? ' is-live' : ''}`} data-mark="screen">
      <span className="dot-chat__mark-icon" aria-hidden="true">
        <MaterialSymbol name={state === 'allowed' ? 'screen_share' : 'desktop_windows'} size={16} opticalSize={20} weight={400} />
      </span>
      <span className="dot-chat__mark-text">{SCREEN_MARKS[state](name)}</span>{' '}
      {state === 'allowed' && (
        <button type="button" className="dot-chat__mark-action" data-action="screen-stop" onClick={() => stopDotScreen(dotId)}>
          Stop
        </button>
      )}
    </p>
  );
}

/** The bot writing a message to the user: three dots where the message will be, as a person's typing shows. */
function TypingBubble({ name }: { name: string }) {
  return (
    <div className="dot-chat__row is-dot is-typing" aria-busy="true">
      <div className="dot-chat__stack">
        <div className="dot-chat__bubble-wrap">
          <div className="dot-chat__bubble dot-chat__typing" role="status" aria-label={`${name} is typing…`}>
            <span className="dot-chat__typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface DotChatProps {
  dot: SparkDot;
  name: string;
  thread: DotThread | undefined;
  activity: DotActivity | undefined;
  /** A request card the bot made — a command to approve, its computer to set up, help it needs, a trigger it set. */
  renderCard: (item: DotItem) => ReactNode;
}

/**
 * A bot's conversation as a messenger draws it, in Material 3: the user's bubbles on the right in the
 * bot's colour, the bot's on the left with no face beside them (it is in the header), reactions hanging
 * under both, and a typing bubble while it writes a message. The user reacts to the bot's messages from the bubble —
 * hover, keyboard or a long press — and the bot hears it through its harness (`reactToDotMessage`).
 */
export function DotChat({ dot, name, thread, activity, renderCard }: DotChatProps) {
  const tint = useDotTint(dot);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // A screen in the bot's hands ends by going quiet, not by a new item: the marks look at the clock now and then.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const rows = useMemo(() => chatRows(thread, Date.now(), appOfCall), [thread, tick]);
  const messages = rows.filter((row): row is MessageRow => row.type === 'message');
  const last = messages.at(-1);
  const working = Boolean(activity?.working);
  // The turn under way, whose app calls without a result yet are still connecting.
  const liveTurn = useMemo(() => (working ? [...(thread?.items ?? [])].reverse().find((item) => item.turnId)?.turnId : undefined), [thread, working]);
  // "Typing…" is the message being written, as in a messenger: it shows while the bot writes, the message whole once
  // written. Working without writing shows under its name in the header, not here.
  const typing = working ? activity?.typingItemId ?? null : null;
  // A messenger's read receipt: the model has the user's latest message in hand — it has begun on a request that
  // carried it — whether or not it has answered yet.
  const readThrough = thread?.runtime.readSeq ?? thread?.runtime.lastActedSeq ?? 0;
  const seenKey = last?.from === 'user' && readThrough >= last.item.seq ? last.key : null;

  return (
    <div className={`dot-chat ${M3_SCOPE}`} style={tint}>
      {rows.map((row) => {
        if (row.type === 'day') {
          return (
            <div key={row.key} className="dot-chat__day" role="separator" aria-label={row.label}>
              <md-divider />
              <span>{row.label}</span>
              <md-divider />
            </div>
          );
        }
        if (row.type === 'card') {
          return (
            <div key={row.key} className="dot-chat__card">
              {renderCard(row.item)}
            </div>
          );
        }
        if (row.type === 'app') return <AppMark key={row.key} mark={row.mark} live={row.pending && row.turnId === liveTurn} />;
        if (row.type === 'screen') return <ScreenMark key={row.key} dotId={dot.id} name={name} state={row.state} />;
        if (row.from === 'dot' && row.item.streaming && row.item.id === typing) return <TypingBubble key={row.key} name={name} />;
        return row.from === 'user' ? (
          <UserMessage key={row.key} name={name} row={row} seen={row.key === seenKey} />
        ) : (
          <DotMessage
            key={row.key}
            dot={dot}
            name={name}
            row={row}
            pickerOpen={pickerFor === row.key}
            onPickerChange={(open) => setPickerFor(open ? row.key : null)}
          />
        );
      })}
    </div>
  );
}
