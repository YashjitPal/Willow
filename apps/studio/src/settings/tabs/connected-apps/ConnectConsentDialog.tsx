import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@willow/auth/AuthContext';
import { launchMaterialRipple } from '@willow/chat/material-ripple';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import { ProfilePhoto } from '@willow/ui/ProfilePhoto';
import willowLogo from '@willow/assets/brand/logo.png';
import {
  CONSENT_LINKS,
  GENERIC_CONSENT_APPS,
  WORKSPACE_CONSENT_LOGOS,
  consentButtons,
  consentTitle,
  consentVariant,
} from './connect-consent';
import './ConnectConsentDialog.css';

/**
 * The popup Gemini raises before it connects an app — `tool-consent-dialog` on
 * gemini.google.com/apps — for every card here that has a connector. See
 * `connect-consent.ts` for which of Gemini's three layouts each card takes.
 *
 * Measured motion: the backdrop fades in over 400ms on cubic-bezier(.25,.8,.25,1) while the
 * dialog fades in over 150ms (linear) and scales from 0.8 on cubic-bezier(0,0,.2,1). Closing
 * fades and shrinks the dialog over 75ms on the same curves, and the overlay goes ~225ms in,
 * part-way through the backdrop's fade. Escape, a click on the backdrop and the cancel
 * button all close it the same way.
 */

const EXIT_MS = 225;

export interface ConnectConsentRequest {
  cardId: string;
  appName: string;
  appLogo: string;
}

interface ConnectConsentDialogProps extends ConnectConsentRequest {
  /** Called from inside the Connect click, so a provider's sign-in popup is not blocked. */
  onConfirm: () => void;
  onCancel: () => void;
  /** After the exit, when the dialog can unmount. */
  onClosed: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled])';

/** Gemini's `gem-button`: a pressed Material ripple from the pointer, over the state layer. */
const DialogButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tonal?: boolean }> = ({
  tonal = false,
  children,
  className,
  ...props
}) => {
  const hostRef = useRef<HTMLSpanElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const release = () => {
    releaseRef.current?.();
    releaseRef.current = null;
  };
  return (
    <button
      {...props}
      className={`cc-button${tonal ? ' cc-button--tonal' : ''}${className ? ` ${className}` : ''}`}
      onPointerCancel={release}
      onPointerDown={(event) => {
        if (event.button !== 0 || !hostRef.current) return;
        release();
        releaseRef.current = launchMaterialRipple(hostRef.current, 'cc-ripple', event.clientX, event.clientY);
      }}
      onPointerLeave={release}
      onPointerUp={release}
      type="button"
    >
      <span aria-hidden="true" className="cc-button-ripples" ref={hostRef} />
      <span className="cc-button-label">{children}</span>
    </button>
  );
};

const AccountPill: React.FC<{ withPhoto: boolean; firstParty: boolean }> = ({ withPhoto, firstParty }) => {
  const { user, userProfile } = useAuth();
  const email = user?.email ?? '';
  if (!email) return null;
  const photo = userProfile?.photoURL ?? user?.photoURL ?? null;
  const initial = (userProfile?.displayName || email).charAt(0).toUpperCase();
  return (
    <div className="cc-account">
      <div className="cc-account-pill">
        {withPhoto ? (
          <span className="cc-account-picture">
            {photo ? <ProfilePhoto src={photo} alt="" className="h-4 w-4" /> : <span className="cc-account-initial">{initial}</span>}
          </span>
        ) : null}
        <span className={`cc-account-email${firstParty ? ' cc-account-email--first-party' : ''}`}>{email}</span>
      </div>
    </div>
  );
};

const ExternalLink: React.FC<{ href: string; ariaLabel?: string; children: React.ReactNode }> = ({
  href,
  ariaLabel,
  children,
}) => (
  <a aria-label={ariaLabel} className="cc-link" href={href} rel="noopener" target="_blank">
    {children}
  </a>
);

const WorkspaceContent: React.FC<{ titleId: string; logoFilter: string }> = ({ titleId, logoFilter }) => (
  <div className="cc-first-party">
    <div className="cc-banner cc-banner--first-party">
      <span className="cc-banner-items">
        <img alt="Willow" className="cc-banner-logo" src={willowLogo} style={{ filter: logoFilter }} />
        <span className="cc-banner-line" />
        {WORKSPACE_CONSENT_LOGOS.map((logo) => (
          <img alt={logo.name} className="cc-banner-logo" key={logo.src} src={logo.src} />
        ))}
      </span>
    </div>
    <h2 className="cc-first-party-title" id={titleId} tabIndex={-1}>
      {consentTitle('workspace', 'Google Workspace')}
    </h2>
    <AccountPill firstParty withPhoto />
    <div className="cc-content">
      <span className="cc-subheader cc-subheader--first-party">To complete your requests, Willow will:</span>
      <ul className="cc-list cc-list--first-party">
        <li className="cc-list-item">Access and manage items from Google Workspace, like your emails and documents</li>
        <li className="cc-list-item">
          Share parts of your conversation, and other relevant info, with Google Workspace, which may be used to
          improve its services
        </li>
      </ul>
      <p className="cc-text">
        When Willow responds using other connected apps, your Google Workspace content may be shared if it’s included
        in your conversation
      </p>
      <h3 className="cc-subheader cc-subheader--first-party cc-subheader--heading">How Willow respects your privacy:</h3>
      <div className="cc-text">
        <span>
          Your Google Workspace content is not used to improve Willow. You can turn off Google Workspace from the
          Connected Apps page.
        </span>{' '}
        <ExternalLink href={CONSENT_LINKS.workspacePrivacy}>Learn how your content is used.</ExternalLink>
      </div>
    </div>
  </div>
);

const GithubContent: React.FC<{ titleId: string }> = ({ titleId }) => (
  <>
    <h1 className="cc-title" id={titleId} tabIndex={-1}>
      {consentTitle('github', 'GitHub')}
    </h1>
    <AccountPill firstParty={false} withPhoto />
    <div className="cc-content">
      <p className="cc-subheader cc-subheader--small">
        To complete requests with private repositories, link your GitHub account and Willow will:
      </p>
      <ul className="cc-list">
        <li className="cc-list-item">Access repositories available to your account</li>
        <li className="cc-list-item">Retrieve and read the requested content</li>
      </ul>
      <h3 className="cc-subheader cc-subheader--small">How Willow respects your privacy:</h3>
      <p className="cc-text">
        Learn how Willow helps you share data safely. See{' '}
        <ExternalLink ariaLabel="Read the Google Privacy Policy" href={CONSENT_LINKS.googlePrivacy}>
          Google Privacy Policy
        </ExternalLink>{' '}
        and{' '}
        <ExternalLink ariaLabel="Read the Google Terms of Service" href={CONSENT_LINKS.googleTerms}>
          Google Terms of Service
        </ExternalLink>{' '}
        .
      </p>
      <p className="cc-text">
        Your GitHub content is not used to improve Willow. You can turn off GitHub from the Connected Apps page.{' '}
        <ExternalLink ariaLabel="Learn more about how your content is used" href={CONSENT_LINKS.contentUse}>
          Learn how your content is used
        </ExternalLink>
        . Public repositories are not subject to this permission.
      </p>
    </div>
  </>
);

const GenericContent: React.FC<{ titleId: string; cardId: string; appName: string }> = ({ titleId, cardId, appName }) => {
  const app = GENERIC_CONSENT_APPS[cardId];
  return (
    <>
      <h1 className="cc-title cc-title--generic" id={titleId} tabIndex={-1}>
        {consentTitle('generic', appName)}
      </h1>
      <div className="cc-content">
        <h2 className="cc-subheader cc-subheader--block">To complete your requests, Willow will:</h2>
        <ul className="cc-list">
          <li className="cc-list-item">
            Access and manage items from {appName}
            {app ? `, like ${app.items}` : ''}.
          </li>
          <li className="cc-list-item">
            Share parts of your conversation and other relevant information with {appName}, which may be used by{' '}
            {appName} according to its{' '}
            {app ? <ExternalLink href={app.privacyUrl}>Privacy Policy</ExternalLink> : 'Privacy Policy'}.
          </li>
        </ul>
        <p className="cc-text">
          When Willow uses other apps, your {appName} data may be shared if it&apos;s included in your conversation.
        </p>
        <h2 className="cc-subheader cc-subheader--block">How Willow respects your privacy</h2>
        <p className="cc-text">You can disconnect {appName} from the Connected Apps page any time.</p>
        <div className="cc-text">
          <p>
            <ExternalLink href={CONSENT_LINKS.contentUse}>Learn how your content is used</ExternalLink>
          </p>
        </div>
      </div>
    </>
  );
};

export const ConnectConsentDialog: React.FC<ConnectConsentDialogProps> = ({
  cardId,
  appName,
  appLogo,
  onConfirm,
  onCancel,
  onClosed,
}) => {
  const { workspaceColor } = useAuth();
  const titleId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<'enter' | 'open' | 'exit'>('enter');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const variant = consentVariant(cardId);
  const buttons = consentButtons(variant);
  const logoFilter = getWorkspaceTheme(workspaceColor).logoFilter;

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // One frame after mount, so the transition has its closed state to run from.
    const raf = requestAnimationFrame(() => setPhase('open'));
    surfaceRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(titleId)}"]`)?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(raf);
  }, [titleId]);

  const close = useCallback((action: () => void) => {
    if (phaseRef.current === 'exit') return;
    action();
    setPhase('exit');
    window.setTimeout(() => {
      onClosed();
      returnFocusRef.current?.focus({ preventScroll: true });
    }, EXIT_MS);
  }, [onClosed]);

  const cancel = useCallback(() => close(onCancel), [close, onCancel]);
  const confirm = useCallback(() => close(onConfirm), [close, onConfirm]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key !== 'Tab' || !surfaceRef.current) return;
      const items = [...surfaceRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && surfaceRef.current.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancel]);

  const shown = phase === 'open';
  const closing = phase === 'exit';
  return createPortal(
    <div className="cc-host">
      <div
        aria-hidden="true"
        className={`cc-backdrop${shown ? ' cc-backdrop--shown' : ''}${closing ? ' cc-backdrop--closing' : ''}`}
        onClick={cancel}
      />
      <div className="cc-pane">
        <div className={`cc-inner${shown ? ' cc-inner--shown' : ''}${closing ? ' cc-inner--closing' : ''}`}>
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className="cc-surface"
            ref={surfaceRef}
            role="alertdialog"
          >
            <div className="cc-container">
              {variant !== 'workspace' ? (
                <div className="cc-banner">
                  <span className="cc-banner-items">
                    <img alt="Willow" className="cc-banner-logo" src={willowLogo} style={{ filter: logoFilter }} />
                    <span className="cc-banner-line" />
                    <img alt={appName} className="cc-banner-logo" src={appLogo} />
                  </span>
                </div>
              ) : null}
              {variant === 'workspace' ? <WorkspaceContent logoFilter={logoFilter} titleId={titleId} /> : null}
              {variant === 'github' ? <GithubContent titleId={titleId} /> : null}
              {variant === 'generic' ? <GenericContent appName={appName} cardId={cardId} titleId={titleId} /> : null}
              <div className="cc-actions">
                <DialogButton
                  aria-label="Cancel (Closes dialog box and does not give consent)"
                  onClick={cancel}
                  title="Cancel consent dialog"
                >
                  {buttons.cancel}
                </DialogButton>
                <DialogButton onClick={confirm} tonal>
                  {buttons.confirm}
                </DialogButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
