import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, type Ref } from 'react';
import { DotAvatar } from './character/avatar/dot-avatar';
import { ConversationOrbitCharacter, type ConversationOrbitCharacterHandle } from './character/orbit/conversation-orbit-character';
import { DesktopSmallIcon } from './dot-icons';
import { useReducedMotion } from './lib/reduced-motion';
import './DotRoomHeader.css';

const ease = [0.23, 1, 0.32, 1] as const;
const pillTransition = { type: 'tween', duration: 0.3, ease } as const;

/** What a working bot is doing, as the pill's second line says it. */
export interface DotRoomActivity {
  label: string;
  usingComputer: boolean;
}

/** The bot's name in a pill that grows to take its live activity line and shrinks back without it (Codex's `HeaderNamePill`). */
function HeaderNamePill({ name, activity }: { name: string; activity: DotRoomActivity | null }) {
  const reducedMotion = useReducedMotion();
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const clipPath = useTransform(() => `inset(0 calc(50% - ${width.get()}px / 2) calc(100% - ${height.get()}px) round 14px)`);
  const contentRef = useRef<HTMLSpanElement>(null);
  useEffect(
    () => () => {
      width.stop();
      height.stop();
    },
    [width, height],
  );
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (element == null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry == null) return;
      const box = entry.borderBoxSize?.[0];
      const size = box ? { width: box.inlineSize, height: box.blockSize } : { width: entry.contentRect.width, height: entry.contentRect.height };
      if (reducedMotion || width.get() === 0) {
        width.jump(size.width);
        height.jump(size.height);
      } else {
        animate(width, size.width, pillTransition);
        animate(height, size.height, pillTransition);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reducedMotion, width, height]);

  return (
    <span className="spark-dots-room-header__pill">
      <motion.span className="spark-dots-room-header__pill-surface" style={{ width, height }} aria-hidden />
      <motion.span ref={contentRef} className="spark-dots-room-header__pill-content" style={{ clipPath }}>
        <span className="spark-dots-room-header__name">{name}</span>
        <span className="spark-dots-room-header__status" role={activity == null ? undefined : 'status'} aria-hidden={activity == null}>
          <AnimatePresence initial={false}>
            {activity == null ? null : (
              <motion.span
                key="activity"
                className="spark-dots-room-header__activity"
                initial={!reducedMotion && { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ ...pillTransition, duration: reducedMotion ? 0 : 0.15 }}
              >
                {activity.usingComputer ? <DesktopSmallIcon role="img" aria-hidden={false} aria-label="Using computer" /> : null}
                <span className="spark-dots-room-header__activity-label">{activity.label}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.span>
    </span>
  );
}

export interface DotRoomHeaderProps {
  dotId: string;
  name: string;
  /** While the bot works: what it is doing. */
  activity: DotRoomActivity | null;
  /** The profile is open, docked or floating, and shows the character itself: the header steps back. */
  profileOpen: boolean;
  /** The first bot's onboarding ring is flying here: it lands where the character will show. */
  flying: boolean;
  characterRef: Ref<ConversationOrbitCharacterHandle>;
  onToggleProfile: () => void;
}

/**
 * The bot's character and name floating centred over the top of its conversation, which scrolls under them, as
 * Codex's room header (`RoomHeader`) draws them. The two are one button that opens the bot's profile.
 */
export function DotRoomHeader({ dotId, name, activity, profileOpen, flying, characterRef, onToggleProfile }: DotRoomHeaderProps) {
  const reducedMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <motion.div
      className="willow-dots spark-dots-room-header"
      initial={false}
      animate={{ opacity: +!profileOpen, transform: profileOpen ? 'scale(0.92)' : 'scale(1)' }}
      transition={{ type: 'tween', duration: reducedMotion ? 0 : 0.15, ease }}
      aria-hidden={profileOpen || undefined}
      inert={profileOpen || undefined}
    >
      <div className="spark-dots-room-header__row">
        <div className={`spark-dots-room-header__profile${reducedMotion ? '' : ' can-press'}`}>
          <button
            ref={buttonRef}
            type="button"
            className="spark-dots-room-header__button"
            aria-label={profileOpen ? `Close ${name}’s profile` : `Open ${name}’s profile`}
            aria-expanded={profileOpen}
            aria-haspopup="dialog"
            onClick={onToggleProfile}
          />
          <div className="spark-dots-room-header__stack">
            <ConversationOrbitCharacter
              ref={characterRef}
              className={`spark-dots-room-header__character${flying ? ' invisible' : ''}`}
              conversationId={dotId}
              fallback={<DotAvatar className="size-full" identity={dotId} animated={false} />}
              active={!profileOpen || flying}
              interactionTarget={buttonRef}
              onClick={() => buttonRef.current?.click()}
            />
            <HeaderNamePill key={dotId} name={name} activity={activity} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
