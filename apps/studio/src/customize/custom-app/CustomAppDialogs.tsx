import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { mcpServers } from '@willow/ai/mcp/mcp-store';
import { useAuth } from '@willow/auth/AuthContext';
import { LmIcon } from './LmIcon';
import {
  CUSTOM_APP_REDIRECT,
  discardCustomApp,
  isAddressConnected,
  isHttpsAddress,
  isNameTaken,
  saveCustomApp,
  stageCustomApp,
  type StagedApp,
} from './custom-app';
import './CustomAppDialogs.css';

/*
 * Gemini's three custom-app dialogs, from its bundle and from measurement: `custom-mcp-registration-dialog`
 * ("Connect to an MCP server"), `custom-mcp-app-consent-dialog` ("Connect this MCP server") and
 * `custom-mcp-app-review-dialog` ("Save your custom app").
 *
 * Next hides the first dialog (display: none, its backdrop stays) under the consent; Cancel there shows it again
 * as it was. A consent that connects closes both and opens the review, whose Connect adds the app.
 */

/** A closed dialog leaves the DOM 155ms in: its surface is gone at 75ms, its backdrop is cut off mid-fade. */
const CLOSE_MS = 155;
const HELP_LINK = 'https://support.google.com/gemini?p=lm_custom_connections';
const SPARKLE = 'https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg';
const VISIBLE_ACTIONS = 6;

/** Tab stays inside the topmost dialog, as the CDK's focus trap keeps it. */
const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
  if (event.key !== 'Tab') return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    .filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

/**
 * The dialog chrome: the CDK host and dark backdrop (`willow-gdlg-*`, so the frame rule and stacking apply), and
 * a surface that scales in from 0.8 over 150ms and fades out over 75ms.
 */
const CustomAppDialog: React.FC<{
  className: string;
  closing: boolean;
  hidden?: boolean;
  labelledBy?: string;
  label?: string;
  focusFirst?: () => HTMLElement | null;
  onDismiss: () => void;
  children: React.ReactNode;
}> = ({ className, closing, hidden = false, labelledBy, label, focusFirst, onDismiss, children }) => {
  const [shown, setShown] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  useLayoutEffect(() => {
    (focusFirst?.() ?? surfaceRef.current)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (hidden || closing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [hidden, closing, onDismiss]);
  return createPortal(
    <div className="willow-gdlg-host cad-host" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <div
        aria-hidden="true"
        className={`willow-gdlg-backdrop cad-backdrop${shown && !closing ? ' willow-gdlg-backdrop--shown' : ''}${closing ? ' is-closing' : ''}`}
        onClick={onDismiss}
      />
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        tabIndex={-1}
        className={`cad-surface ${className}${shown && !closing ? ' is-shown' : ''}${closing ? ' is-closing' : ''}`}
        style={hidden ? { display: 'none' } : undefined}
        onKeyDown={trapTab}
      >
        <div className="cad-inner">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

/** Material's outlined field, as these dialogs set it: 56px, 12px corners, the outline out of flow. */
const OutlinedField: React.FC<{
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  ariaLabel?: string;
  describedBy?: string;
  invalid?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
  suffix?: React.ReactNode;
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void;
}> = ({ id, value, onChange, placeholder, type = 'text', ariaLabel, describedBy, invalid, inputRef, className = '', suffix, onPaste }) => (
  <div className={`cad-field ${className}`}>
    <input
      ref={inputRef}
      id={id}
      className="cad-field-input"
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onPaste={onPaste}
    />
    {suffix ? <div className="cad-field-suffix">{suffix}</div> : null}
    <span aria-hidden="true" className="cad-field-outline" />
  </div>
);

/** `mat-progress-bar` in indeterminate mode, as gem-dialog shows it above its buttons while one works. */
const Progress: React.FC = () => (
  <div className="cad-progress" role="progressbar" aria-label="Loading">
    <div className="cad-progress-bar cad-progress-bar--primary"><span className="cad-progress-inner" /></div>
    <div className="cad-progress-bar cad-progress-bar--secondary"><span className="cad-progress-inner" /></div>
  </div>
);

/* ------------------------------------------------------------------------ */
/* Connect to an MCP server                                                 */
/* ------------------------------------------------------------------------ */

const RegistrationDialog: React.FC<{
  closing: boolean;
  hidden: boolean;
  url: string;
  setUrl: (url: string) => void;
  clientId: string;
  setClientId: (value: string) => void;
  clientSecret: string;
  setClientSecret: (value: string) => void;
  error: string;
  setError: (error: string) => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  onCancel: () => void;
  onNext: () => void;
}> = ({ closing, hidden, url, setUrl, clientId, setClientId, clientSecret, setClientSecret, error, setError, expanded, setExpanded, onCancel, onNext }) => {
  const servers = useStore(mcpServers);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const wasHidden = useRef(hidden);
  // Back from the consent, focus returns to what opened it.
  useLayoutEffect(() => {
    if (wasHidden.current && !hidden) nextRef.current?.focus({ preventScroll: true });
    wasHidden.current = hidden;
  }, [hidden]);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const trimmed = url.trim();
  const valid = isHttpsAddress(trimmed);
  const connected = Boolean(trimmed) && isAddressConnected(trimmed, servers);
  const canNext = valid && !connected;
  const toggle = () => setExpanded(!expanded);
  const copyRedirect = () => {
    void navigator.clipboard?.writeText(CUSTOM_APP_REDIRECT).catch(() => {});
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1000);
  };
  const feedback = trimmed && !valid
    ? <div className="cad-url-error cad-body-s">Please enter a valid URL starting with https://</div>
    : connected
      ? <div className="cad-url-error cad-body-s">This MCP server is already connected.</div>
      : error
        ? <div className="cad-url-error cad-body-s">{error}</div>
        : <div className="cad-url-helper cad-body-s">Make sure that your URL starts with https://</div>;
  return (
    <CustomAppDialog
      className="cad-registration"
      closing={closing}
      hidden={hidden}
      labelledBy="cad-registration-title"
      focusFirst={() => titleRef.current}
      onDismiss={onCancel}
    >
      <div className="cad-registration-body">
        <div className="cad-registration-header">
          <h2 id="cad-registration-title" ref={titleRef} tabIndex={-1} className="cad-headline-s cad-title">Connect to an MCP server</h2>
          <button type="button" className="cad-icon-button cad-close-button" aria-label="Close" onClick={onCancel}>
            <LmIcon name="close" size={24} />
          </button>
        </div>
        <form noValidate onSubmit={(event) => { event.preventDefault(); if (canNext) onNext(); }}>
          <div className="cad-registration-content">
            <div className="cad-field-group">
              <label htmlFor="cad-url-input" className="cad-emphasized-body-s cad-label">MCP server URL</label>
              <OutlinedField
                id="cad-url-input"
                inputRef={urlRef}
                className="cad-url-field"
                type="url"
                value={url}
                placeholder="https://your-app-link.com/mcp"
                describedBy="cad-url-feedback"
                invalid={(Boolean(trimmed) && !valid) || connected || Boolean(error)}
                onChange={(value) => { setUrl(value); setError(''); }}
                suffix={url ? (
                  <button
                    type="button"
                    className="cad-icon-button cad-clear-button"
                    aria-label="Clear URL"
                    onClick={() => { setUrl(''); setError(''); urlRef.current?.focus(); }}
                  >
                    <LmIcon name="close" size={16} />
                  </button>
                ) : null}
              />
              <div id="cad-url-feedback" aria-live="polite">{feedback}</div>
            </div>
            <div className="cad-advanced">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                className="cad-advanced-row"
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                  }
                }}
              >
                <span className="cad-body-s cad-advanced-label">Additional settings</span>
                <div className="cad-advanced-trigger">
                  <span className="cad-body-s">{expanded ? 'Show less' : 'Show more'}</span>
                  <LmIcon family="google-symbols" name={expanded ? 'unfold_less' : 'unfold_more'} size={16} className="cad-advanced-icon" />
                </div>
              </div>
              {expanded ? (
                <div className="cad-advanced-content">
                  <div className="cad-field-group">
                    <label htmlFor="cad-client-id" className="cad-body-s cad-label">Client ID</label>
                    <OutlinedField id="cad-client-id" value={clientId} placeholder="OAuth client ID" onChange={(value) => { setClientId(value); setError(''); }} />
                  </div>
                  <div className="cad-field-group">
                    <label htmlFor="cad-client-secret" className="cad-body-s cad-label">Client secret</label>
                    <OutlinedField id="cad-client-secret" type="password" value={clientSecret} placeholder="OAuth client secret" onChange={(value) => { setClientSecret(value); setError(''); }} />
                  </div>
                  <div className="cad-copy-container">
                    <button type="button" className={`cad-copy-button${copied ? ' is-copied' : ''}`} onClick={copyRedirect}>
                      <LmIcon name={copied ? 'check' : 'content_copy'} size={24} />
                      <span className="cad-body-m">{copied ? 'Link copied' : 'Copy redirect URI'}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="cad-trust">
              <div className="cad-emphasized-body-s cad-trust-heading">About custom Connected Apps</div>
              <div className="cad-body-s cad-trust-body">
                <span>By adding this app link, you’re allowing Willow to send info to a custom connected app that hasn&apos;t been reviewed by Google. Make sure that you trust this service before connecting.</span>
                <a href={HELP_LINK} target="_blank" rel="noopener noreferrer" className="cad-trust-link">Learn more about connecting custom apps</a>
              </div>
            </div>
            <div className="cad-registration-footer">
              <button type="button" className="cad-button cad-button--text cad-button--medium" onClick={onCancel}>
                <span className="cad-body-m">Cancel</span>
              </button>
              <button ref={nextRef} type="submit" className="cad-button cad-button--tonal cad-button--medium" disabled={!canNext}>
                <span className="cad-body-m">Next</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </CustomAppDialog>
  );
};

/* ------------------------------------------------------------------------ */
/* Connect this MCP server                                                  */
/* ------------------------------------------------------------------------ */

const ConsentDialog: React.FC<{
  closing: boolean;
  url: string;
  busy: boolean;
  onCancel: () => void;
  onConnect: () => void;
}> = ({ closing, url, busy, onCancel, onConnect }) => {
  const { user } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const email = user?.email ?? '';
  return (
    <CustomAppDialog className="cad-gem cad-consent" closing={closing} labelledBy="cad-consent-title" onDismiss={() => { if (!busy) onCancel(); }}>
      <div className="cad-gem-body">
        <div className="cad-gem-content">
          <div className="cad-consent-icon">
            <img alt="" aria-hidden="true" className="cad-consent-sparkle" src={SPARKLE} />
          </div>
          <h1 id="cad-consent-title" className="cad-headline-s cad-consent-title">Connect this MCP server</h1>
          <p className="cad-emphasized-body-m cad-consent-subtitle">{url}</p>
          {email ? (
            <div className="cad-consent-profile">
              <div className="cad-consent-profile-chip">
                {user?.photoURL ? (
                  <img alt="" className="cad-consent-avatar" src={user.photoURL} referrerPolicy="no-referrer" />
                ) : (
                  <LmIcon name="account_circle" size={16} className="cad-consent-avatar" />
                )}
                <span className="cad-label-m-alt cad-consent-email">{email}</span>
              </div>
            </div>
          ) : (
            <div className="cad-consent-spacer" />
          )}
          <p className="cad-title-s-emphasized cad-consent-will">To work with this custom connected app, Willow will</p>
          <ul className="cad-consent-bullets">
            <li className="cad-body-m">Execute this Model Context Protocol (MCP) server&apos;s tools to trigger and run available functions for you to handle your requests.</li>
            <li className="cad-body-m">Retrieve and manage data from this MCP server. Access, view and manage any resources, schemas and context exposed by this MCP server&apos;s endpoints, including your data, files and info.</li>
            <li className="cad-body-m">Share data with this MCP server. Willow may share any info that it has access to, like skills, tasks and websites that you’re logged in to. Depending on your settings, this may be tailored based on data in your connected apps.</li>
          </ul>
          <p className="cad-body-m">When you use Willow to interact with other connected apps and services, data retrieved from this MCP server may be shared with them to do things for you, like fulfil your request.</p>
          <div className="cad-consent-privacy">
            <h2 className="cad-title-s-emphasized">Make sure that you trust this MCP server</h2>
            <p className="cad-body-m">
              Willow does not control, monitor or secure this MCP server (shown above). Model Context Protocol (MCP) servers may request data beyond what is needed to complete your request, including data that you may consider sensitive. Supervise the MCP server. Make sure that you understand the actions that it supports and trust the provider before proceeding. You can disconnect this server and remove it from your Connected Apps page.{' '}
              <a href={HELP_LINK} target="_blank" rel="noopener noreferrer">Learn more about custom connected apps</a>.
            </p>
            <p className="cad-body-m">When you continue, you may be sharing sensitive info. Review the MCP server&apos;s privacy policy.</p>
          </div>
          <div className="cad-consent-check">
            <label className="cad-checkbox">
              <span className="cad-checkbox-box">
                <input
                  type="checkbox"
                  className="cad-checkbox-input"
                  checked={accepted}
                  disabled={busy}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span aria-hidden="true" className="cad-checkbox-state" />
                <span aria-hidden="true" className="cad-checkbox-bg">
                  <svg className="cad-checkbox-mark" viewBox="0 0 24 24" focusable="false">
                    <path fill="none" d="M1.73,12.91 8.1,19.28 22.79,4.59" />
                  </svg>
                </span>
              </span>
              <span className="cad-body-m cad-checkbox-label">I understand and accept the security and privacy risks of connecting this custom app.</span>
            </label>
          </div>
        </div>
      </div>
      <div className="cad-gem-actions">
        {busy ? <Progress /> : null}
        <button type="button" className="cad-button cad-button--text" disabled={busy} onClick={onCancel}>
          <span className="cad-body-m">Cancel</span>
        </button>
        <button type="button" className="cad-button cad-button--tonal" disabled={busy || !accepted} onClick={onConnect}>
          <span className="cad-body-m">Connect</span>
        </button>
      </div>
    </CustomAppDialog>
  );
};

/* ------------------------------------------------------------------------ */
/* Save your custom app                                                     */
/* ------------------------------------------------------------------------ */

const ReviewDialog: React.FC<{
  closing: boolean;
  app: StagedApp;
  takenTitles: readonly string[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}> = ({ closing, app, takenTitles, busy, error, onCancel, onSave }) => {
  const [name, setName] = useState(app.name);
  const [logoFailed, setLogoFailed] = useState(!app.logo);
  const [expanded, setExpanded] = useState(false);
  const taken = isNameTaken(name, app.serverId, takenTitles);
  const canSave = name.trim().length > 0 && !taken;
  const actions = expanded ? app.tools : app.tools.slice(0, VISIBLE_ACTIONS);
  const synced = useMemo(() => new Date(app.syncedAt).toLocaleString(), [app.syncedAt]);
  return (
    <CustomAppDialog className="cad-gem cad-review" closing={closing} label="Custom app setup" onDismiss={() => { if (!busy) onCancel(); }}>
      <div className="cad-gem-body">
        <div className="cad-gem-content">
          <div className="cad-review-title-row">
            <h2 className="cad-headline-s cad-title">Save your custom app</h2>
          </div>
          <div className="cad-review-app">
            {logoFailed ? (
              <LmIcon name="extension" size={32} className="cad-review-logo-fallback" />
            ) : (
              <img alt="" aria-hidden="true" className="cad-review-logo" src={app.logo} referrerPolicy="no-referrer" onError={() => setLogoFailed(true)} />
            )}
            <OutlinedField className="cad-review-name" value={name} ariaLabel="App name" onChange={setName} />
          </div>
          {taken ? <div role="alert" aria-live="polite" className="cad-save-error">An app with this name is already connected.</div> : null}
          {error ? <div role="alert" aria-live="polite" className="cad-save-error">{error}</div> : null}
          {app.description ? <p className="cad-body-m cad-review-description">{app.description}</p> : null}
          <hr className="cad-review-divider" />
          <div className="cad-review-actions-header">
            <span className="cad-body-s cad-review-meta">
              <span className="cad-review-meta-title">Available actions</span>
              <span className="cad-review-meta-synced">• Last synced: {synced}</span>
            </span>
            {app.tools.length > VISIBLE_ACTIONS ? (
              <button type="button" className="cad-see-all" onClick={() => setExpanded(!expanded)}>
                <span className="cad-body-m">{expanded ? 'See less' : `See all ${app.tools.length}`}</span>
                <LmIcon family="google-symbols" name={expanded ? 'collapse_all' : 'expand_all'} size={20} />
              </button>
            ) : null}
          </div>
          <ul className="cad-review-actions">
            {actions.map((tool) => (
              <li key={tool.name} className="cad-body-m cad-review-action">
                <span className="cad-review-check">
                  <LmIcon name="check" size={28} />
                </span>
                {tool.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="cad-gem-actions">
        {busy ? <Progress /> : null}
        <button type="button" className="cad-button cad-button--text" disabled={busy} onClick={onCancel}>
          <span className="cad-body-m">Cancel</span>
        </button>
        <button type="button" className="cad-button cad-button--tonal" disabled={busy || !canSave} onClick={() => onSave(name)}>
          <span className="cad-body-m">Connect</span>
        </button>
      </div>
    </CustomAppDialog>
  );
};

/* ------------------------------------------------------------------------ */
/* The flow                                                                 */
/* ------------------------------------------------------------------------ */

type Phase = 'register' | 'consent' | 'review';
/** What is fading out: the consent alone (back to the first dialog), the consent and the hidden first dialog on their way to the review, or everything. */
type Closing = 'consent' | 'to-review' | 'all';

/**
 * "+ Custom", from the first dialog to the review. `onAdded` gets the new app's server id and name once it is
 * on; `onClosed` runs when every dialog has gone. `takenTitles`: Customize's own cards, which no app may share a
 * name with.
 */
export const CustomAppFlow: React.FC<{
  takenTitles: readonly string[];
  onAdded: (serverId: string, name: string) => void;
  onClosed: () => void;
}> = ({ takenTitles, onAdded, onClosed }) => {
  const [phase, setPhase] = useState<Phase>('register');
  const [closing, setClosing] = useState<Closing | null>(null);
  const [url, setUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [app, setApp] = useState<StagedApp | null>(null);
  const consentKey = useId();
  const [consentSeq, setConsentSeq] = useState(0);
  const timers = useRef<number[]>([]);
  const alive = useRef(true);
  const returnFocus = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  const staged = useRef<string | null>(null);
  // Set again on every mount: StrictMode's rehearsal unmount runs the cleanup once, and that must not be final.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (staged.current) void discardCustomApp(staged.current);
    };
  }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const finish = () => {
    later(() => {
      onClosed();
      returnFocus.current?.focus?.({ preventScroll: true });
    }, CLOSE_MS);
  };
  const cancelAll = () => {
    if (closing) return;
    setClosing('all');
    if (staged.current) {
      void discardCustomApp(staged.current);
      staged.current = null;
    }
    finish();
  };
  const next = () => {
    setError('');
    setConsentSeq((n) => n + 1);
    setPhase('consent');
  };
  const cancelConsent = () => {
    if (busy || closing) return;
    setClosing('consent');
    later(() => {
      if (!alive.current) return;
      setClosing(null);
      setPhase('register');
    }, CLOSE_MS);
  };
  const connect = async () => {
    setBusy(true);
    const client = expanded && clientId.trim() ? { clientId: clientId.trim(), ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) } : undefined;
    const result = await stageCustomApp(url, client);
    if (!alive.current) {
      if (result.ok) void discardCustomApp(result.app.serverId);
      return;
    }
    setBusy(false);
    if (result.ok === false) {
      setError(result.error);
      if (result.expand) setExpanded(true);
      setClosing('consent');
      later(() => {
        if (!alive.current) return;
        setClosing(null);
        setPhase('register');
      }, CLOSE_MS);
      return;
    }
    staged.current = result.app.serverId;
    setApp(result.app);
    setClosing('to-review');
    later(() => {
      if (!alive.current) return;
      setClosing(null);
      setPhase('review');
    }, CLOSE_MS);
  };
  const save = async (name: string) => {
    if (!app) return;
    setBusy(true);
    setSaveError('');
    try {
      await saveCustomApp(app, name);
      staged.current = null;
      if (!alive.current) return;
      setBusy(false);
      setClosing('all');
      onAdded(app.serverId, name.trim());
      finish();
    } catch {
      if (!alive.current) return;
      setBusy(false);
      setSaveError('Couldn’t save app. Please try again.');
    }
  };
  return (
    <>
      {phase !== 'review' ? (
        <RegistrationDialog
          closing={closing === 'all' || closing === 'to-review'}
          hidden={phase === 'consent'}
          url={url}
          setUrl={setUrl}
          clientId={clientId}
          setClientId={setClientId}
          clientSecret={clientSecret}
          setClientSecret={setClientSecret}
          error={error}
          setError={setError}
          expanded={expanded}
          setExpanded={setExpanded}
          onCancel={cancelAll}
          onNext={next}
        />
      ) : null}
      {phase === 'consent' ? (
        <ConsentDialog
          key={`${consentKey}-${consentSeq}`}
          closing={closing !== null}
          url={url.trim()}
          busy={busy}
          onCancel={cancelConsent}
          onConnect={() => { void connect(); }}
        />
      ) : null}
      {phase === 'review' && app ? (
        <ReviewDialog
          closing={closing === 'all'}
          app={app}
          takenTitles={takenTitles}
          busy={busy}
          error={saveError}
          onCancel={cancelAll}
          onSave={(name) => { void save(name); }}
        />
      ) : null}
    </>
  );
};
