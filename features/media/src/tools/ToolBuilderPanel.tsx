/**
 * Flow's `flow-applet-chat-sidebar`, the Tool Builder: its header (title, the debug menu, Close),
 * the chat and its prompt box. The conversation is `builder-session.ts`; the page owns sending
 * and restoring, which need its model settings and re-run the tool.
 *
 * Per message, as Flow draws them: a prompt in a right-hand bubble; a reply with its thought chip,
 * its markdown, Flow's action bar (Good response, Bad response, Copy, Flag) and Restore when the
 * turn made a version; a failure as Flow's error card, whose button shows on the last one only;
 * a Restore as "Restored from" with the prompt it went back to. A quota error replaces the prompt
 * box with its card.
 */
import React from 'react';
import { useStore } from '@nanostores/react';
import type { StoredToolChatMessage } from '@willow/storage/media-tools';
import { FlowMatMenu, FlowMatMenuItem, FlowSpinner } from '../scenes/flow-ui';
import { showSnack } from '../scenes/scene-store';
import { describeBuilderError, isQuotaError, MOCK_ERRORS, thoughtChip, type BuilderError } from './builder-errors';
import { builderSession } from './builder-session';
import { openReport } from './ToolDialogs';
import { ToolMarkdown } from './ToolMarkdown';
import { cx, FlowButton, FlowIconButton, MatIcon, useTooltip } from './ui';

/* ------------------------------------------------------------------ *
 * flow-applet-prompt-box
 * ------------------------------------------------------------------ */

export interface PromptBoxHandle {
  setText(text: string): void;
  focus(): void;
}

/** Enter sends, Shift+Enter breaks the line; while a turn runs the send button is Stop. */
export const AppletPromptBox = React.forwardRef<PromptBoxHandle, {
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}>(function AppletPromptBox({ isStreaming, disabled = false, placeholder = 'What do you want to create?', onSubmit, onCancel }, ref) {
  const [text, setText] = React.useState('');
  const areaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(ref, () => ({
    setText: (next) => setText(next),
    focus: () => areaRef.current?.focus(),
  }), []);
  React.useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const blocked = disabled || isStreaming || !text.trim();
  const submit = () => {
    const prompt = text.trim();
    if (!prompt || blocked) return;
    onSubmit(prompt);
    setText('');
  };
  return (
    <div className="ng-flow-applet-prompt-box">
      <div className="applet-prompt-box">
        <div className={cx('prompt-top-row', text.length > 0 && 'has-clear-button')}>
          <textarea
            ref={areaRef}
            rows={1}
            className="cdk-textarea-autosize prompt-textarea"
            aria-label="Ask applet agent to make changes"
            placeholder={placeholder}
            disabled={disabled}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        {text.length > 0 && (
          <div className="top-right-actions">
            <FlowIconButton icon="close" label="Clear prompt" className="clear-button" iconClassName="clear-icon" onClick={() => setText('')} />
          </div>
        )}
        <div className="prompt-box-actions">
          {isStreaming
            ? (
              <div className="ng-flow-stop-icon-button">
                <FlowIconButton icon="stop" label="Stop" variant="secondary" className="stop-icon-button stop-button" iconClassName="flow-icon-s" fill onClick={onCancel} />
              </div>
            )
            : <FlowIconButton icon="arrow_forward" label="Send message" variant="primary" className="submit-button" iconClassName="mat-icon-rtl-mirror" disabled={blocked} onClick={submit} />}
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * Chat pieces: scroller, bubble, thought chip, thinking dots, error card, action bar
 * ------------------------------------------------------------------ */

/** Stays at the bottom while the user is within 16px of it, as Flow's scroller does. */
const ChatScroller: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const lastTop = React.useRef(0);
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const follow = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    const resize = new ResizeObserver(follow);
    resize.observe(el);
    for (const child of Array.from(el.children)) resize.observe(child);
    const mutation = new MutationObserver((records) => {
      for (const record of records) for (const node of Array.from(record.addedNodes)) if (node instanceof HTMLElement && node.parentElement === el) resize.observe(node);
      follow();
    });
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    el.scrollTop = el.scrollHeight;
    return () => { resize.disconnect(); mutation.disconnect(); };
  }, []);
  return (
    <div className={cx('ng-flow-chat-scroller', className)}>
      <div aria-hidden="true" className={cx('top-gradient', scrolled && 'visible')} />
      <div
        ref={viewportRef}
        tabIndex={0}
        className="scroll-viewport"
        onScroll={(e) => {
          const el = e.currentTarget;
          setScrolled(el.scrollTop > 0);
          if (el.scrollHeight - el.scrollTop - el.clientHeight <= 16) stick.current = true;
          else if (el.scrollTop < lastTop.current) stick.current = false;
          lastTop.current = el.scrollTop;
        }}
      >
        {children}
      </div>
    </div>
  );
};

const ChatBubble: React.FC<{ user?: boolean; className?: string; children: React.ReactNode }> = ({ user, className, children }) => (
  <div className={cx('ng-flow-chat-bubble', className)}>
    <div className={user ? 'user-bubble' : 'agent-bubble'}>{children}</div>
  </div>
);

const EventChip: React.FC<{ label: string; detail?: string }> = ({ label, detail }) => {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="ng-flow-agent-event-chip thought-chip">
      <div className="agent-event-chip-container">
        <button
          type="button"
          className="agent-event-chip-header"
          disabled={!detail}
          aria-expanded={detail ? expanded : undefined}
          onClick={() => { if (detail) setExpanded((v) => !v); }}
        >
          <span className="agent-event-chip-label">{label || 'Show thinking'}</span>
          {detail && <MatIcon name="arrow_forward_ios" className={cx('agent-event-chip-chevron mat-icon-rtl-mirror', expanded && 'expanded')} />}
        </button>
        {detail && (
          <div className={cx('agent-event-chip-detail-container', expanded && 'expanded')}>
            <div className="agent-event-chip-detail-inner">
              <div className="agent-event-chip-detail"><ToolMarkdown text={detail} /></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ThinkingIndicator: React.FC = () => (
  <div className="ng-flow-chat-thinking-indicator">
    <div role="status" aria-label="Thinking" className="thinking-indicator">
      <div aria-hidden="true" className="thinking-indicator-dot" />
      <div aria-hidden="true" className="thinking-indicator-dot" />
      <div aria-hidden="true" className="thinking-indicator-dot" />
    </div>
  </div>
);

const ErrorCard: React.FC<{ error: BuilderError; showButton: boolean; onClick: () => void }> = ({ error, showButton, onClick }) => (
  <div className="ng-flow-chat-error-card">
    <div className="chat-error-card">
      <div className="error-header">
        <MatIcon name="error" className="error-icon" />
        <div className="error-text">{error.message}</div>
      </div>
      {showButton && error.button && (
        <FlowButton variant="secondary" size="medium" className="try-again-button" onClick={onClick}>{error.button}</FlowButton>
      )}
    </div>
  </div>
);

interface ChatAction {
  icon: string;
  label: string;
  active?: boolean;
  run: () => void;
}

const ActionBar: React.FC<{ actions: ChatAction[] }> = ({ actions }) => (
  <div className="ng-flow-chat-message-action-bar">
    <div className="action-group">
      {actions.map((a) => (
        <FlowIconButton
          key={a.label}
          icon={a.icon}
          label={a.label}
          className="action-button"
          iconClassName={cx('action-icon flow-icon-s', a.active && 'action-icon-active')}
          fill={a.active}
          onClick={a.run}
        />
      ))}
    </div>
  </div>
);

/* ------------------------------------------------------------------ *
 * flow-applet-debug-menu
 * ------------------------------------------------------------------ */

const DebugMenu: React.FC<{ mock: string | null; onPick: (code: string | null) => void }> = ({ mock, onPick }) => {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  return (
    <div className="ng-flow-applet-debug-menu">
      <FlowIconButton
        ref={buttonRef}
        icon="bug_report"
        label="Debug Menu (Mock Error)"
        menuTrigger
        className={cx('debug-menu-trigger', mock !== null && 'has-active-mock')}
        onClick={() => setOpen((v) => !v)}
      />
      <FlowMatMenu
        open={open}
        onClose={() => setOpen(false)}
        anchor={open && buttonRef.current ? { kind: 'below', rect: buttonRef.current.getBoundingClientRect() } : null}
        ignoreRefs={[buttonRef]}
        ariaLabel="Mock Error on Next Send"
      >
        <div className="wt-debug-menu-header" onClick={(e) => e.stopPropagation()}>Mock Error on Next Send</div>
        {MOCK_ERRORS.map((m) => (
          <FlowMatMenuItem
            key={m.label}
            icon={mock === m.code ? 'radio_button_checked' : 'radio_button_unchecked'}
            label={m.label}
            onSelect={() => onPick(m.code)}
          />
        ))}
      </FlowMatMenu>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * The sidebar
 * ------------------------------------------------------------------ */

const copyText = (text: string) => {
  navigator.clipboard.writeText(text).catch(() => {
    showSnack({ icon: 'error', text: 'Failed to copy text.', actions: [{ label: 'Dismiss' }], tone: 'error' });
  });
};

const HeaderClose: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const tip = useTooltip('Close');
  return (
    <button
      type="button"
      aria-label="Close assistant"
      className="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger header-close-button mat-unthemed"
      onClick={onClick}
      onMouseEnter={tip.onMouseEnter}
      onMouseLeave={tip.onMouseLeave}
      onMouseDown={tip.onMouseDown}
    >
      <span className="mat-mdc-button-persistent-ripple mdc-icon-button__ripple" />
      <MatIcon name="close" className="header-close-icon" />
      <span className="mat-focus-indicator" />
      <span className="mat-mdc-button-touch-target" />
    </button>
  );
};

export const ToolBuilderPanel: React.FC<{
  toolId: string;
  /** The tool's version now: its reply's Restore is disabled. */
  currentVersionId: string | undefined;
  onClose: () => void;
  onSend: (text: string) => void;
  onRestore: (messageId: string) => void;
  /** An error card's Back to gallery. */
  onNavigateAway: () => void;
  onOpenSettings: () => void;
}> = ({ toolId, currentVersionId, onClose, onSend, onRestore, onNavigateAway, onOpenSettings }) => {
  const session = builderSession(toolId);
  const messages = useStore(session.$messages);
  const live = useStore(session.$live);
  const restoring = useStore(session.$restoring);
  const mock = useStore(session.$mockError);
  const quota = useStore(session.$quotaError);
  const promptRef = React.useRef<PromptBoxHandle>(null);
  const [usedButtons, setUsedButtons] = React.useState<ReadonlySet<string>>(() => new Set());
  React.useEffect(() => { void session.load(); }, [session]);
  const streaming = live !== null;

  const onErrorButton = (message: StoredToolChatMessage, error: BuilderError) => {
    setUsedButtons((prev) => new Set(prev).add(message.id));
    switch (error.action) {
      case 'RETRY': {
        const prompt = session.retryPrompt(message.id);
        if (prompt) { promptRef.current?.setText(prompt); promptRef.current?.focus(); }
        break;
      }
      case 'FEEDBACK':
        session.setFeedback(message.id, 'down');
        showSnack({ icon: 'check_circle', text: 'Thank you for your feedback', actions: [{ label: 'Dismiss' }] });
        break;
      case 'NAVIGATE':
        onNavigateAway();
        break;
      case 'SETTINGS':
        onOpenSettings();
        break;
      case 'NONE':
        break;
    }
  };

  const lastIndex = messages.length - 1;
  const items = messages.map((m, i) => {
    if (m.role === 'user') {
      return (
        <div key={m.id} className="user-bubble-container">
          <ChatBubble user><span className="message-text">{m.text}</span></ChatBubble>
        </div>
      );
    }
    if (m.role === 'reverted') {
      return (
        <div key={m.id} className="reverted-container">
          <div className="reverted-header">
            <span
              role="button"
              tabIndex={0}
              className="mat-icon notranslate google-symbols mat-icon-no-color reverted-flag-icon"
              onClick={openReport}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openReport(); } }}
            >
              flag
            </span>
            <span>Restored from</span>
          </div>
          {m.restoredPrompt && <div className="reverted-prompt-pill">{m.restoredPrompt}</div>}
        </div>
      );
    }
    const chip = thoughtChip(m.thoughts);
    const failed = m.status === 'error';
    const reply = (m.text || chip) && (
      <ChatBubble key={m.id} className="agent-chat-bubble">
        {chip && <EventChip label={chip.label} detail={chip.detail} />}
        <ToolMarkdown text={m.text} />
        <div className="message-action-row">
          <ActionBar
            actions={[
              { icon: 'thumb_up', label: 'Good response', active: m.feedback === 'up', run: () => session.setFeedback(m.id, 'up') },
              { icon: 'thumb_down', label: 'Bad response', active: m.feedback === 'down', run: () => session.setFeedback(m.id, 'down') },
              { icon: 'content_copy', label: 'Copy', run: () => { if (m.text) copyText(m.text); } },
              { icon: 'flag', label: 'Flag', run: openReport },
            ]}
          />
          {m.versionId && (
            <FlowButton
              variant="outlined"
              size="small"
              className="restore-button"
              aria-label="Restore tool to this version"
              tooltip="Restore from this point"
              disabled={streaming || restoring !== null || m.versionId === currentVersionId}
              icon="undo"
              iconClassName="mat-icon-rtl-mirror"
              leading={restoring === m.id ? <FlowSpinner size={18} className="restore-button-spinner" /> : undefined}
              wrapLabel
              onClick={() => onRestore(m.id)}
            >
              Restore
            </FlowButton>
          )}
        </div>
      </ChatBubble>
    );
    if (!failed) return reply || null;
    if (isQuotaError(m.error)) return reply || null;
    const error = describeBuilderError(m.error);
    return (
      <React.Fragment key={m.id}>
        {reply}
        <ErrorCard error={error} showButton={i === lastIndex && !usedButtons.has(m.id)} onClick={() => onErrorButton(m, error)} />
      </React.Fragment>
    );
  });

  const liveChip = live ? thoughtChip(live.thoughts) : null;
  const empty = messages.length === 0 && !streaming;
  return (
    <div className="ng-flow-applet-chat-sidebar">
      <div className="applet-chat-sidebar">
        <div className="sidebar-header">
          <h3 className="header-title">Tool Builder</h3>
          <div className="header-actions">
            <DebugMenu mock={mock} onPick={(code) => session.setMockError(code)} />
            <HeaderClose onClick={onClose} />
          </div>
        </div>
        <div className="chat-fade-overlay" />
        <ChatScroller className="chat-content">
          {empty && <div className="empty-state"><p className="empty-description">Describe how you want to edit this tool.</p></div>}
          {!empty && items}
          {live && (live.text || liveChip) && (
            <ChatBubble className="agent-chat-bubble">
              {liveChip && <EventChip label={liveChip.label} detail={liveChip.detail} />}
              <ToolMarkdown text={live.text} />
            </ChatBubble>
          )}
          {live && !live.text && !liveChip && <ChatBubble><ThinkingIndicator /></ChatBubble>}
        </ChatScroller>
        <div className="sidebar-footer">
          {quota
            ? <div className="quota-error-card"><span className="quota-error-text">{describeBuilderError(quota).message}</span></div>
            : <AppletPromptBox ref={promptRef} isStreaming={streaming} onSubmit={onSend} onCancel={() => session.stop()} />}
        </div>
      </div>
    </div>
  );
};
