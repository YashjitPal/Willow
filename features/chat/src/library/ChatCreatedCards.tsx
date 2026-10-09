import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { ConfirmationCard } from '@willow/ui/ConfirmationCard';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { skillLibrary } from '@willow/core/skill-library';
import { requestSparkLocation } from '@willow/core/shell-request';
import {
  formatScheduleDue,
  librarySchedules,
  skillCardBody,
  sparkLibraryWriter,
} from '@willow/core/spark-library';
import type { ChatCreatedItem } from './library-tools';
import './ChatCreatedCards.css';

type ScheduleItem = Extract<ChatCreatedItem, { kind: 'schedule' }>;
type SkillItem = Extract<ChatCreatedItem, { kind: 'skill' }>;

/**
 * Gemini's chat says this of its own scheduled actions, which it prepares ahead of time.
 * Willow's run in the open app, at about their time, so this says that instead.
 */
export const SCHEDULED_ACTION_INFO = 'Scheduled actions run at about this time while Willow is open, using the info available then.';

/* -------------------------------------------------------------------------- */
/* Popups                                                                     */
/* -------------------------------------------------------------------------- */

const EDGE = 8;

/** Closes on a press outside `inside`, on Escape, and when the page scrolls or resizes under it. */
const useDismiss = (open: boolean, inside: Array<React.RefObject<HTMLElement | null>>, onDismiss: () => void) => {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && inside.some((ref) => ref.current?.contains(target))) return;
      dismiss.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss.current();
    };
    const onMove = () => dismiss.current();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // `inside` is a fresh array each render; its refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
};

/**
 * Gemini's `xap-inline-dialog`: above the info icon, its caret on the icon, 14px of it to
 * the icon's left. Kept on screen at a phone's width, and below the icon when there is no
 * room above.
 */
const InfoPopup: React.FC<{ anchor: HTMLElement; popupRef: React.RefObject<HTMLDivElement | null> }> = ({ anchor, popupRef }) => {
  const [place, setPlace] = useState<{ left: number; top: number; caret: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const icon = anchor.getBoundingClientRect();
    // Layout size: the box is mid scale-in, so its rect is the shrunken one.
    const { offsetWidth: width, offsetHeight: height } = popup;
    const left = Math.max(EDGE, Math.min(icon.left - 14, window.innerWidth - width - EDGE));
    const below = icon.top - 10 - height < EDGE;
    setPlace({
      left,
      top: below ? icon.bottom + 10 : icon.top - 10 - height,
      caret: icon.left + icon.width / 2 - left,
      below,
    });
  }, [anchor, popupRef]);
  return createPortal(
    <div
      ref={popupRef}
      role="tooltip"
      className={`chat-scheduled-action-info${place?.below ? ' is-below' : ''}`}
      style={place
        ? { left: place.left, top: place.top, ['--caret-x' as string]: `${place.caret}px` }
        : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {SCHEDULED_ACTION_INFO}
    </div>,
    document.body,
  );
};

/** Gemini's `task-actions-menu`: 208px, under the button and level with its left edge. */
const ActionsMenu: React.FC<{
  anchor: HTMLElement;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ anchor, menuRef, onEdit, onDelete }) => {
  const [place, setPlace] = useState<{ left: number; top: number; upward: boolean } | null>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const button = anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const left = button.left + width > window.innerWidth - EDGE ? Math.max(EDGE, button.right - width) : button.left;
    const upward = button.bottom + height > window.innerHeight - EDGE && button.top - height >= EDGE;
    setPlace({ left, top: upward ? button.top - height : button.bottom, upward });
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [anchor, menuRef]);
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={`chat-scheduled-action-menu${place?.upward ? ' is-upward' : ''}`}
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <button type="button" role="menuitem" className="chat-scheduled-action-menu__item" onClick={onEdit}>
        <MaterialSymbol name="edit" family="google-symbols" size={20} weight={400} />
        <span>Edit</span>
      </button>
      <button type="button" role="menuitem" className="chat-scheduled-action-menu__item" onClick={onDelete}>
        <MaterialSymbol name="delete" family="google-symbols" size={20} weight={400} />
        <span>Delete</span>
      </button>
    </div>,
    document.body,
  );
};

/* -------------------------------------------------------------------------- */
/* The scheduled action                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Gemini chat's scheduled-action card (`live-prompt-card` / `scheduled-task-card`): when it
 * is due, its name and its request, with an on/off switch and Edit / Delete. It reads the
 * Spark schedule live, so switching it off in Spark shows here, and a deleted one says so.
 */
export const ScheduledActionCard: React.FC<{ item: ScheduleItem; scopeId: string }> = ({ item, scopeId }) => {
  const schedules = useStore(librarySchedules);
  const writer = sparkLibraryWriter();
  // Until Spark's schedules are loaded the mirror is empty, which would read as deleted.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!writer) return;
    writer.hydrate(scopeId);
    setLoaded(true);
  }, [scopeId, writer]);

  const live = schedules.find((schedule) => schedule.id === item.recordId);
  const deleted = loaded && !live;
  const schedule = live ?? item;
  const enabled = live ? live.enabled : !deleted;

  const infoRef = useRef<HTMLButtonElement>(null);
  const infoPopupRef = useRef<HTMLDivElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  useDismiss(infoOpen, [infoRef, infoPopupRef], () => setInfoOpen(false));

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuOpen, [menuButtonRef, menuRef], closeMenu);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const toggle = () => {
    if (!writer || !live) return;
    writer.setScheduleEnabled(scopeId, live.id, !live.enabled);
  };

  return (
    <div className={`chat-scheduled-action${deleted ? ' is-deleted' : ''}`} data-test-id="chat-scheduled-action">
      <div className="chat-scheduled-action__task">
        <div className={`chat-scheduled-action__icon${enabled ? '' : ' is-paused'}`} aria-hidden="true">
          <MaterialSymbol name="schedule_auto" family="luminous" size={20} weight={400} />
        </div>
        <div className="chat-scheduled-action__details">
          <span className="chat-scheduled-action__when">
            <span>{deleted ? 'Deleted' : formatScheduleDue(schedule)}</span>
            {!deleted && (
              <button
                ref={infoRef}
                type="button"
                className="chat-scheduled-action__info"
                aria-label="About scheduled actions"
                aria-expanded={infoOpen}
                onClick={() => setInfoOpen((open) => !open)}
              >
                <MaterialSymbol name="info" family="google-symbols" size={16} weight={400} />
              </button>
            )}
          </span>
          <div className="chat-scheduled-action__title">{schedule.title}</div>
          <div className="chat-scheduled-action__prompt">{schedule.instructions}</div>
        </div>
      </div>
      {!deleted && (
        <div className="chat-scheduled-action__actions">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={enabled ? 'Turn off this scheduled action' : 'Turn on this scheduled action'}
            className={`chat-scheduled-action__switch${enabled ? ' is-on' : ''}`}
            disabled={!live}
            onClick={toggle}
          >
            <span className="chat-scheduled-action__switch-handle" />
          </button>
          <button
            ref={menuButtonRef}
            type="button"
            className="chat-scheduled-action__more"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={!live}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MaterialSymbol name="more_vert" family="google-symbols" size={20} weight={400} />
          </button>
        </div>
      )}
      {infoOpen && infoRef.current && <InfoPopup anchor={infoRef.current} popupRef={infoPopupRef} />}
      {menuOpen && menuButtonRef.current && (
        <ActionsMenu
          anchor={menuButtonRef.current}
          menuRef={menuRef}
          onEdit={() => {
            closeMenu();
            requestSparkLocation({ page: 'schedule-editor', scheduleId: item.recordId });
          }}
          onDelete={() => {
            closeMenu();
            setConfirmingDelete(true);
          }}
        />
      )}
      {confirmingDelete && (
        <GeminiDialog
          headingAs="h1"
          title="Delete scheduled action?"
          width={512}
          message
          onDismiss={() => setConfirmingDelete(false)}
          actions={(
            <>
              <GeminiDialogPill onClick={() => setConfirmingDelete(false)}>Cancel</GeminiDialogPill>
              <GeminiDialogPill
                onClick={() => {
                  writer?.deleteSchedule(scopeId, item.recordId);
                  setConfirmingDelete(false);
                }}
              >
                Delete
              </GeminiDialogPill>
            </>
          )}
        >
          <p>
            &ldquo;{schedule.title}&rdquo; will stop running and be removed from Spark&apos;s Schedules. This chat stays as it is.
          </p>
        </GeminiDialog>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* The skill                                                                  */
/* -------------------------------------------------------------------------- */

/** Gemini chat's skill card: the confirmation card, titled with the skill's name. */
export const SkillCreatedCard: React.FC<{ item: SkillItem }> = ({ item }) => {
  const skills = useStore(skillLibrary);
  const skill = skills.find((candidate) => candidate.id === item.recordId) ?? item;
  return (
    <div className="chat-created-skill" data-test-id="chat-created-skill">
      <ConfirmationCard title={skill.name} body={skillCardBody(skill)} />
    </div>
  );
};

export const ChatCreatedCard: React.FC<{ item: ChatCreatedItem; scopeId: string }> = ({ item, scopeId }) => (
  item.kind === 'schedule'
    ? <ScheduledActionCard item={item} scopeId={scopeId} />
    : <SkillCreatedCard item={item} />
);
