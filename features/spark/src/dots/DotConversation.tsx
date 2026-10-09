import { useStore } from '@nanostores/react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComposerHandle } from '@willow/chat/composer/Composer';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { isDesktopApp } from '@willow/core/desktop-bridge';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { SparkComposer } from '../SparkComposer';
import { goToSparkDots } from '../spark-store';
import { DocumentTitle } from '../spaces/willow/shell/document-title';
import '../SparkTaskDetail.css';
import './DotConversation.css';
import type { ConversationOrbitCharacterHandle } from './character/orbit/conversation-orbit-character';
import { ActivityKind } from './character/orbit/engine-enums';
import { DotChat } from './chat/DotChat';
import { DotCommandCard } from './commands/DotCommands';
import { setDotOnboardingHandoffDestination } from './creation/dot-onboarding-flight';
import { closeDotComputer, dotComputers, openDotComputer, refreshDotComputer } from './computer/dot-computer-store';
import { DotHelpCard, DotMachineSetupCard } from './computer/DotComputerCards';
import { DotComputerPane } from './computer/DotComputerPane';
import { LaptopIcon } from './dot-icons';
import { useDotTheme } from './dot-tint';
import { DotMenu } from './DotMenu';
import { DotRoomHeader } from './DotRoomHeader';
import { DotsDirectory } from './DotsDirectory';
import { DotProfilePanel } from './profile/DotProfilePanel';
import { DotTriggerCard } from './triggers/DotTriggers';
import { DotEmailCard } from './email/DotEmailCard';
import { DotEditCard } from './edit/DotEditCard';
import { DotPlanCard } from './plan/DotPlanCard';
import { DotScreenCard } from './screen/DotScreenCard';
import { sparkDotComposerPrefill, sparkDotExpandRequest, sparkDotName, type SparkDot } from './dots-store';
import {
  forgetDotCommandPrefix,
  connectDotComputer,
  connectDotWholeComputer,
  disconnectDotComputer,
  dotActivity,
  dotComputerReachable,
  retryDot,
  sendDotMessage,
  startDotsRuntime,
  type DotActivity,
} from './harness/dot-runtime';
import { forgetDotAttachments, storeDotAttachments } from './harness/runtime/dot-attachments';
import { dotThreads } from './harness/thread/thread-store';
import type { DotThread } from './harness/thread/thread-types';
import { useCharacterStore } from './state/character-store';
import { useCreationStore } from './state/creation-store';

const SYMBOL_PROPS = { family: 'luminous' as const, weight: 320, roundness: 100 };

/**
 * Under the bot's name while it works, as Codex's `LiveActivityLabel` words it: its own status line, else what it
 * is doing, else "Thinking…". While it writes a message, "Typing…".
 */
const doingWords = (activity: DotActivity): string =>
  activity.typingItemId ? 'Typing…' : activity.status?.trim() || activity.label?.trim() || 'Thinking…';

/** A task's scroll edges (SparkTaskDetail.tsx): the top fades out under the header once scrolled, the bottom while more is below. */
const updateScrollFade = (scroller: HTMLElement) => {
  scroller.style.setProperty('--fade-progress', scroller.scrollTop > 0 ? '1' : '0');
  scroller.style.setProperty('--fade-bottom', scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight ? '1' : '0');
};

export interface DotConversationProps {
  dot: SparkDot;
  modelConfig?: any;
  selectedModelId?: string;
  setSelectedModelId?: (id: string) => void;
}

/**
 * An open bot, laid out as a Spark task: the bots list on the left, the conversation in the middle and the bot's
 * profile docked where the task's progress panel sits. The conversation is the bot's harness thread; the composer
 * never locks, because a message sent while the bot works steers what it is doing.
 */
export function DotConversation({ dot, modelConfig, selectedModelId, setSelectedModelId }: DotConversationProps) {
  const threads = useStore(dotThreads);
  const activities = useStore(dotActivity);
  const prefill = useStore(sparkDotComposerPrefill);
  const expandRequest = useStore(sparkDotExpandRequest);
  // A bot opened from the sidebar starts expanded; every other way in keeps the list beside it.
  const [isListCollapsed, setListCollapsed] = useState(() => sparkDotExpandRequest.get() === dot.id);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const isCompact = useCompactViewport();
  // The bot's own computer opens where a task's remote browser does: beside the chat, or full-screen when narrow.
  const desktop = isDesktopApp();
  const computer = useStore(dotComputers, { keys: [dot.id] })[dot.id];
  const hasComputer = desktop && Boolean(computer?.summary && computer.summary.state !== 'none');
  const isComputerOpen = desktop && Boolean(computer?.paneOpen);
  const isComputerSideOpen = isComputerOpen && !isCompact;
  const isComputerOverlayOpen = isComputerOpen && isCompact;
  const isLibraryCollapsed = isListCollapsed || isComputerSideOpen;
  // As a task's Progress: docked once the list is collapsed, otherwise floating from the header button.
  const isProfileDocked = isLibraryCollapsed && !isCompact && !isComputerSideOpen;
  const isProfilePopoverOpen = !isProfileDocked && isProfileOpen;
  /*
   * The computer and the docked profile are one side panel, as a task's remote browser and its
   * Progress are (SparkTaskDetail's `sidePanelHandoff`): the computer grows out of the profile's
   * 300px, and closing it hands the card back to the profile, which shrinks from the computer's width.
   */
  const sidePanel = isComputerSideOpen ? 'computer' : isProfileDocked ? 'profile' : null;
  const committedSidePanelRef = useRef<'computer' | 'profile' | null>(null);
  const previousSidePanel = committedSidePanelRef.current;
  const sidePanelHandoff = previousSidePanel && sidePanel && previousSidePanel !== sidePanel ? sidePanel : null;
  useLayoutEffect(() => {
    committedSidePanelRef.current = sidePanel;
  });
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profilePopoverRef = useRef<HTMLDivElement>(null);
  const profilePopoverId = useId();
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle | null>(null);
  const [sendProblem, setSendProblem] = useState('');
  // Files go with the words, or on their own: kept as payloads first, so the message never points at nothing.
  const send = async (prompt: string, files: File[]) => {
    setSendProblem('');
    if (!files.length) {
      await sendDotMessage(dot.id, prompt);
      return;
    }
    try {
      const attachments = await storeDotAttachments(files);
      if (!(await sendDotMessage(dot.id, prompt, attachments))) await forgetDotAttachments(attachments).catch(() => undefined);
    } catch (error) {
      setSendProblem(error instanceof Error ? error.message : String(error));
    }
  };
  const characterRef = useRef<ConversationOrbitCharacterHandle>(null);
  const flying = useCreationStore((s) => s.handoff?.conversationId === dot.id && s.handoff.phase === 'flying');
  const name = sparkDotName(dot);
  const composerTheme = useDotTheme(dot);
  const now = Date.now();
  const thread = threads[dot.id];
  const activity = activities[dot.id];
  const runtime = thread?.runtime;
  // Open, the profile shows the character itself, so the header over the conversation steps back.
  const isProfileShown = isProfileDocked || isProfilePopoverOpen;
  const roomActivity = activity?.working ? { label: doingWords(activity), usingComputer: desktop && Boolean(computer?.screen?.agentActive) } : null;
  // The message being written grows in place; the conversation follows it down.
  const typingItemId = activity?.typingItemId;
  const lastText = (typingItemId ? thread?.items.find((item) => item.id === typingItemId) : thread?.items.at(-1))?.text.length ?? 0;
  useEffect(() => startDotsRuntime(), []);

  useEffect(() => setMenuOpen(false), [dot.id]);

  useEffect(() => {
    if (desktop) void refreshDotComputer(dot.id);
  }, [desktop, dot.id]);

  // The list stays collapsed after the computer closes, as a task's does after its browser.
  useEffect(() => {
    if (isComputerSideOpen) setListCollapsed(true);
  }, [isComputerSideOpen]);

  useEffect(() => {
    if (!isComputerOverlayOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      // Taken over, the keyboard belongs to the bot's page.
      if (event.key !== 'Escape' || computer?.inControl) return;
      // Kept mounted behind another tab (`inert`), Bots leaves the Escape to the tab on show.
      if (conversationRef.current?.closest('[inert]')) return;
      closeDotComputer(dot.id);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dot.id, isComputerOverlayOpen, computer?.inControl]);

  useLayoutEffect(() => {
    if (expandRequest !== dot.id) return;
    sparkDotExpandRequest.set(null);
    setListCollapsed(true);
  }, [expandRequest, dot.id]);

  // Follows the conversation down while the user is at its end, and always for what they just sent; reacting to an
  // older message, or reading back, keeps their place.
  const pinnedRef = useRef(true);
  useEffect(() => {
    const scroller = conversationRef.current;
    if (!scroller) return undefined;
    const onScroll = () => {
      pinnedRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
      updateScrollFade(scroller);
    };
    // A new message or a resized window moves the edges without a scroll.
    const observer = new ResizeObserver(() => updateScrollFade(scroller));
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    updateScrollFade(scroller);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    pinnedRef.current = true;
  }, [dot.id]);
  const lastKind = thread?.items.at(-1)?.kind;
  useEffect(() => {
    const scroller = conversationRef.current;
    if (scroller && (pinnedRef.current || lastKind === 'user')) scroller.scrollTop = scroller.scrollHeight;
  }, [dot.id, lastText, activity?.working, thread?.items.length, lastKind]);

  useEffect(() => {
    const { setActivity, clearActivity } = useCharacterStore.getState();
    if (activity?.working) {
      const kind = activity.label === 'Searching the web' ? ActivityKind.Searching : activity.typingItemId ? ActivityKind.Working : ActivityKind.Thinking;
      setActivity(dot.id, kind);
    } else if (runtime?.status === 'error') setActivity(dot.id, ActivityKind.Error);
    else if (runtime?.status === 'paused') setActivity(dot.id, ActivityKind.Paused);
    else clearActivity(dot.id);
  }, [dot.id, activity?.working, activity?.label, activity?.typingItemId, runtime?.status]);

  useEffect(() => {
    if (prefill?.dotId !== dot.id || composerRef.current == null) return;
    composerRef.current.setPrompt(prefill.text);
    composerRef.current.focus();
    sparkDotComposerPrefill.set(null);
  }, [prefill, dot.id]);

  useEffect(() => {
    if (!isProfilePopoverOpen) return undefined;
    // The character editor opens from inside the profile, in a dialog portalled outside it.
    const isInEditor = (target: EventTarget | null) => target instanceof Element && target.closest('.willow-dots-dialog-root') != null;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (profilePopoverRef.current?.contains(target) || profileButtonRef.current?.contains(target) || isInEditor(event.target)) return;
      setProfileOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.willow-dots-dialog-root') != null) return;
      event.preventDefault();
      setProfileOpen(false);
      profileButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfilePopoverOpen]);

  // Lands the onboarding ring on the header character, as Codex's room header does.
  useLayoutEffect(() => {
    if (!flying) return;
    const frame = requestAnimationFrame(() => {
      const bounds = characterRef.current?.getPaintedBounds();
      const handoff = useCreationStore.getState().handoff;
      if (bounds == null || handoff?.phase !== 'flying' || handoff.destination != null) return;
      const { left, top, width, height } = bounds;
      if (width > 0 && height > 0) setDotOnboardingHandoffDestination(dot.id, { left, top, width, height });
    });
    return () => cancelAnimationFrame(frame);
  }, [flying, dot.id]);

  return (
    <div className={`spark-task-detail spark-dots-detail${isLibraryCollapsed ? ' is-library-collapsed' : ''}${isProfileDocked ? ' is-progress-open' : ''}${isComputerSideOpen ? ' has-remote-browser' : ''}`}>
      <DocumentTitle title={name} />
      {/* The bots tab itself, squeezed beside the open bot. */}
      <aside className="spark-task-detail__library" aria-label="Bots" aria-hidden={isLibraryCollapsed || undefined} inert={isLibraryCollapsed || undefined}>
        <DotsDirectory selectedDotId={dot.id} />
      </aside>

      <main className="spark-task-detail__workspace">
        <div className="spark-task-detail__library-divider">
          <button
            type="button"
            aria-label={isLibraryCollapsed ? 'Show bots' : 'Hide bots'}
            aria-expanded={!isLibraryCollapsed}
            title=""
            onClick={() => {
              // The list and the computer share the room: showing the list puts the computer away.
              if (isComputerSideOpen) {
                closeDotComputer(dot.id);
                setListCollapsed(false);
                return;
              }
              setListCollapsed((collapsed) => !collapsed);
            }}
          >
            <MaterialSymbol family="google-symbols" name={isLibraryCollapsed ? 'keyboard_arrow_right' : 'keyboard_arrow_left'} size={16} weight={400} opticalSize={20} />
          </button>
        </div>

        <section className="spark-task-detail__panel" aria-label={`Dot: ${name}`}>
          <header className="spark-task-detail__header">
            <button type="button" className="spark-task-detail__header-icon spark-task-detail__mobile-back" aria-label="Back to Bots" title="Back" onClick={goToSparkDots}>
              {/* Only shown at 960px and below, where the list is gone, as a task's back to Spark is. */}
              <MaterialSymbol {...SYMBOL_PROPS} name="chevron_left" size={32} opticalSize={32} />
            </button>
            <div className="spark-task-detail__header-actions">
              <span className="spark-task-detail__beta-pill spark-dots-detail__beta-pill">Beta</span>
              {hasComputer && (
                <button
                  type="button"
                  className={`spark-task-detail__header-icon${isComputerOpen ? ' is-hidden' : ''}`}
                  aria-label={`Open ${name}'s computer`}
                  aria-hidden={isComputerOpen || undefined}
                  tabIndex={isComputerOpen ? -1 : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    setProfileOpen(false);
                    openDotComputer(dot.id);
                  }}
                >
                  {/* `monitor` is absent from Willow's Luminous subset; Google Symbols has it. */}
                  <MaterialSymbol family="google-symbols" name="monitor" size={16} weight={330} roundness={100} opticalSize={16} />
                </button>
              )}
              <span className={`spark-dots-detail__profile-button${isProfileDocked ? ' is-hidden' : ''}`}>
                <button
                  ref={profileButtonRef}
                  type="button"
                  className={`spark-task-detail__header-icon${isProfilePopoverOpen ? ' is-open' : ''}`}
                  aria-label={isProfilePopoverOpen ? `Hide ${name}'s profile` : `Show ${name}'s profile`}
                  aria-haspopup="dialog"
                  aria-expanded={isProfilePopoverOpen}
                  aria-controls={isProfilePopoverOpen ? profilePopoverId : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    setProfileOpen((open) => !open);
                  }}
                >
                  <MaterialSymbol {...SYMBOL_PROPS} name="info" size={20} opticalSize={20} />
                </button>
              </span>
              <DotMenu
                dot={dot}
                open={isMenuOpen}
                onOpenChange={(open) => {
                  setMenuOpen(open);
                  if (open) setProfileOpen(false);
                }}
              />
            </div>
          </header>

          <DotRoomHeader
            dotId={dot.id}
            name={name}
            activity={roomActivity}
            profileOpen={isProfileShown}
            flying={flying}
            characterRef={characterRef}
            onToggleProfile={() => {
              setMenuOpen(false);
              setProfileOpen((open) => !open);
            }}
          />

          {isProfilePopoverOpen && !isCompact && (
            <div
              ref={profilePopoverRef}
              id={profilePopoverId}
              className="spark-task-detail__progress-popover spark-dots-profile-popover"
              role="dialog"
              aria-label={`About ${name}`}
              tabIndex={-1}
            >
              <DotProfile dot={dot} thread={thread} activity={activity} now={now} onDismiss={() => setProfileOpen(false)} />
            </div>
          )}

          {/* At 960px and below a task's Progress opens full-screen; the profile does the same. */}
          {isProfilePopoverOpen && isCompact && (
            <div ref={profilePopoverRef} id={profilePopoverId} className="spark-task-detail__progress-overlay" role="dialog" aria-modal="true" aria-label={`About ${name}`} tabIndex={-1}>
              <div className="spark-task-detail__progress-overlay-header">
                <button
                  type="button"
                  className="spark-task-detail__progress-overlay-close"
                  aria-label="Close"
                  onClick={() => {
                    setProfileOpen(false);
                    profileButtonRef.current?.focus();
                  }}
                >
                  <MaterialSymbol {...SYMBOL_PROPS} name="close" size={24} opticalSize={24} weight={300} />
                </button>
              </div>
              <div className="spark-task-detail__progress-overlay-scroll spark-dots-profile-overlay">
                <DotProfile dot={dot} thread={thread} activity={activity} now={now} onDismiss={() => setProfileOpen(false)} />
              </div>
            </div>
          )}

          <div ref={conversationRef} className="spark-task-detail__conversation-scroll gemini-chat-scrollbar">
            <div className="spark-task-detail__conversation" aria-live="polite">
              <DotChat
                dot={dot}
                name={name}
                thread={thread}
                activity={activity}
                renderCard={(item) =>
                  !thread ? null : item.kind === 'approval' ? (
                    <DotCommandCard dotId={dot.id} name={name} item={item} thread={thread} />
                  ) : item.kind === 'machine' ? (
                    <DotMachineSetupCard dotId={dot.id} name={name} item={item} thread={thread} />
                  ) : item.kind === 'help' ? (
                    <DotHelpCard dotId={dot.id} name={name} item={item} thread={thread} />
                  ) : item.kind === 'trigger-card' ? (
                    <DotTriggerCard dotId={dot.id} item={item} thread={thread} />
                  ) : item.kind === 'outgoing' ? (
                    <DotEmailCard dotId={dot.id} name={name} item={item} thread={thread} />
                  ) : item.kind === 'edit' ? (
                    <DotEditCard dotId={dot.id} name={name} item={item} thread={thread} />
                  ) : item.kind === 'plan-card' ? (
                    <DotPlanCard item={item} thread={thread} />
                  ) : item.kind === 'screen' ? (
                    <DotScreenCard dotId={dot.id} name={name} item={item} thread={thread} now={Date.now()} />
                  ) : null
                }
              />
            </div>
          </div>

          <div className="spark-task-detail__followup-zone">
            {runtime?.status === 'error' && runtime.lastError && (
              <div className="spark-dots-detail__error" role="alert">
                <span>{runtime.lastError}</span>
                <button type="button" onClick={() => retryDot(dot.id)}>
                  Try again
                </button>
              </div>
            )}
            {sendProblem && (
              <div className="spark-dots-detail__error" role="alert">
                <span>{sendProblem}</span>
              </div>
            )}
            <div className="spark-task-detail__followup-composer">
              <SparkComposer
                composerRef={composerRef}
                theme={composerTheme}
                onSubmitFiles={(prompt, files) => void send(prompt, files)}
                allowFilesOnly
                isGenerating={false}
                placeholder={`Message ${name}`}
                modelConfig={modelConfig}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
              />
            </div>
            <p className="spark-task-detail__disclaimer">Willow is AI and can make mistakes.</p>
          </div>
        </section>

        <aside className={`spark-task-detail__progress-panel spark-dots-profile${isProfileDocked ? ' is-open' : ''}${sidePanelHandoff === 'profile' ? ' is-taking-over' : ''}`} aria-hidden={!isProfileDocked} inert={!isProfileDocked || undefined} aria-label={`About ${name}`}>
          <div className="spark-task-detail__progress-panel-scroll">
            <DotProfile dot={dot} thread={thread} activity={activity} now={now} />
          </div>
        </aside>

        {/* A task's remote-browser card (`remy-side-panel.showing-computer-use`), showing the bot's own computer. */}
        {isComputerSideOpen && (
          <section className={`spark-task-detail__side-panel${sidePanelHandoff === 'computer' ? ' is-taking-over' : ''}`} aria-label={`${name}'s computer`}>
            <DotComputerPane dotId={dot.id} name={name} onClose={() => closeDotComputer(dot.id)} viewerDelayMs={265} />
          </section>
        )}

        {isComputerOverlayOpen && (
          <div className="spark-task-detail__progress-overlay" role="dialog" aria-modal="true" aria-label={`${name}'s computer`}>
            <div className="spark-task-detail__progress-overlay-header">
              <button type="button" className="spark-task-detail__progress-overlay-close" aria-label="Close panel" onClick={() => closeDotComputer(dot.id)}>
                <MaterialSymbol {...SYMBOL_PROPS} name="close" size={24} opticalSize={24} weight={300} />
              </button>
            </div>
            <section className="spark-task-detail__browser-overlay-panel">
              <DotComputerPane dotId={dot.id} name={name} onClose={() => closeDotComputer(dot.id)} compact />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * The user's own computer: off until they connect it, and then the bot may ask
 * — one approval per command — to run commands on it. The desktop app connects
 * the whole computer in one step, with no folder to pick; a browser, which
 * cannot, types the path of one folder when Willow's local companion is running.
 */
function DotComputerAccess({ dotId, name, root, whole, rules }: { dotId: string; name: string; root: string | undefined; whole?: string; rules?: string[][] }) {
  const desktop = isDesktopApp();
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [isTyping, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      void dotComputerReachable().then((ok) => {
        if (!live) return;
        setReachable(ok);
        // The desktop app starts its companion alongside the window; a browser has no reason to expect one.
        if (!ok && desktop) timer = setTimeout(check, 3_000);
      });
    };
    check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [root, desktop]);

  // A folder, or with `null` the whole computer.
  const connect = async (folder: string | null) => {
    setBusy(true);
    setProblem(null);
    const issue = folder === null ? await connectDotWholeComputer(dotId) : await connectDotComputer(dotId, folder);
    setBusy(false);
    if (issue) {
      setProblem(issue);
      return;
    }
    setTyping(false);
    setDraft('');
  };

  const choose = async () => {
    if (!desktop) {
      setTyping(true);
      return;
    }
    await connect(null);
  };

  const status = whole ? 'Your whole computer' : root ?? (reachable === false ? (desktop ? 'Starting up…' : 'Needs the Willow desktop app') : 'Not connected');

  return (
    <>
      <div className="spark-dots-profile__computer">
        <span className={`spark-dots-profile__computer-icon${root ? ' is-connected' : ''}`}>
          <LaptopIcon />
        </span>
        <span className="spark-dots-profile__computer-copy">
          <span>This computer</span>
          <span className="spark-dots-profile__muted spark-dots-profile__path" title={whole ?? root}>
            {status}
          </span>
        </span>
        {root ? (
          <button type="button" className="spark-dots-profile__toggle is-on" onClick={() => void disconnectDotComputer(dotId)}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="spark-dots-profile__toggle" disabled={busy || (desktop && reachable !== true)} onClick={() => void choose()}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
      {isTyping && !root && (
        <form
          className="spark-dots-profile__folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            void connect(draft);
          }}
        >
          <input
            className="spark-dots-profile__folder-input"
            value={draft}
            placeholder="Full path to a folder"
            aria-label={`Folder ${name} can work in`}
            autoFocus
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setTyping(false);
            }}
          />
          <button type="submit" className="spark-dots-profile__toggle" disabled={busy || !draft.trim()}>
            Connect
          </button>
        </form>
      )}
      {problem && (
        <p className="spark-dots-profile__problem" role="alert">
          {problem}
        </p>
      )}
      {root && rules?.map((rule) => (
        <div key={rule.join(' ')} className="spark-dots-profile__activity">
          <MaterialSymbol family="material-rounded" name="terminal" size={18} opticalSize={20} weight={320} className="spark-dots-profile__row-icon" />
          <span className="spark-dots-profile__activity-title"><code>{rule.join(' ')}</code></span>
          <span className="spark-dots-profile__muted">Runs without asking</span>
          <button type="button" className="spark-dots-profile__toggle" aria-label={`Ask before running ${rule.join(' ')}`} onClick={() => forgetDotCommandPrefix(dotId, rule)}>
            Remove
          </button>
        </div>
      ))}
      <p className="spark-dots-profile__muted spark-dots-profile__note">
        {whole
          ? `${name} can look at and change any file you can, and asks before every command.`
          : root
            ? `${name} can look at and edit the files in this folder, and asks before running anything else or deleting.`
            : desktop
              ? `Let ${name} work on your computer. It can change your files, and asks before every command.`
              : `Let ${name} work in a folder you choose. It edits files there, and asks before running commands.`}
      </p>
    </>
  );
}

/** The bot's profile, docked beside the conversation or floating from the header: profile/DotProfilePanel.tsx. */
function DotProfile({ dot, thread, activity, now, onDismiss }: { dot: SparkDot; thread: DotThread | undefined; activity: DotActivity | undefined; now: number; onDismiss?: () => void }) {
  return (
    <DotProfilePanel
      dot={dot}
      thread={thread}
      activity={activity}
      now={now}
      onDismiss={onDismiss}
      folderAccess={<DotComputerAccess dotId={dot.id} name={sparkDotName(dot)} root={thread?.runtime.computer?.root} whole={thread?.runtime.computer?.whole ? thread.runtime.computer.home ?? thread.runtime.computer.root : undefined} rules={thread?.runtime.computer?.rules} />}
    />
  );
}
