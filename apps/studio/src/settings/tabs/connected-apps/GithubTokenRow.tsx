import React, { useCallback, useState } from 'react';
import { connectorById, type ConnectorScope } from '@willow/personal';

/**
 * The GitHub card's extra control: paste a token, or see whose token is loaded.
 *
 * Every other card on this page connects with one switch, and this one cannot. GitHub
 * publishes no OAuth flow a browser can finish — the token-exchange endpoint sends no
 * CORS headers, and the device flow posts to the same endpoint — so the user creates a
 * read-only token on GitHub's site and pastes it here. `pat-token-source.ts` has the
 * full account of why there is no way around that.
 *
 * Which makes this the one place in Settings that asks the user to do real work, so it
 * is written to be finishable in one pass without leaving the page to look anything up:
 * the link goes to the exact GitHub page with the right form, and the three permissions
 * are named as GitHub names them, in the order they appear there.
 *
 * Two things are said plainly rather than buried, because both are surprises otherwise:
 * the token dies with the tab, and the permissions are chosen on GitHub's site rather
 * than requested here. The second is the honest weakness of a pasted credential next to
 * a consent screen — if the user ticks more than this list, Willow can do more than it
 * says, and nothing in the code can prevent that.
 */

/** GitHub's own permission names, from the registry, so this list cannot drift from it. */
const REQUIRED_SCOPES: ConnectorScope[] = connectorById('github')?.readScopes ?? [];

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

interface GithubTokenRowProps {
  /** The connected account's login, or null when no token is held. */
  login: string | null;
  /** Verifies the token against GitHub, stores it, and connects. False if rejected. */
  onConnect: (token: string) => Promise<boolean>;
}

export const GithubTokenRow: React.FC<GithubTokenRowProps> = ({ login, onConnect }) => {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = token.trim();
      if (!trimmed || busy) return;

      setBusy(true);
      setRejected(false);
      try {
        const ok = await onConnect(trimmed);
        // Cleared on success only. A rejected token is usually a token that was
        // pasted short, and wiping the field would make the user go back to GitHub
        // for a value they cannot see any more — GitHub shows it once.
        if (ok) setToken('');
        else setRejected(true);
      } finally {
        setBusy(false);
      }
    },
    [busy, onConnect, token],
  );

  if (login) {
    return (
      <div className="ca-token-row">
        <div className="ca-token-connected ca-body-m">
          Connected as <strong>{login}</strong>
        </div>
        <div className="ca-token-note ca-label-s">
          The token is held for this tab only and is never written to disk, so you will paste it
          again next time you open Willow.
        </div>
      </div>
    );
  }

  return (
    <form className="ca-token-row" onSubmit={submit}>
      <label className="ca-token-label ca-label-s" htmlFor="ca-github-token">
        Access token
      </label>
      <div className="ca-token-input-row">
        {/*
          A password field for a credential that is not a password, on purpose. It is
          typed once in a Settings page people screen-share and record, and there is
          nothing to check by eye — a token is unreadable either way, so hiding it
          costs the user nothing. autoComplete off keeps it out of the browser's own
          store, which would outlive the tab and defeat the point of not saving it.
        */}
        <input
          autoComplete="off"
          className="ca-token-input ca-body-m"
          disabled={busy}
          id="ca-github-token"
          onChange={(event) => {
            setToken(event.target.value);
            setRejected(false);
          }}
          placeholder="github_pat_…"
          spellCheck={false}
          type="password"
          value={token}
        />
        <button className="ca-token-submit" disabled={busy || !token.trim()} type="submit">
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </div>

      {rejected ? (
        <div className="ca-token-error ca-label-s" role="alert">
          GitHub didn’t accept that token. Check it was copied whole and hasn’t expired — GitHub
          shows a token once, so a partial copy is easy to make.
        </div>
      ) : null}

      <button
        aria-expanded={showHelp}
        className="ca-learn-more"
        onClick={() => setShowHelp((prev) => !prev)}
        type="button"
      >
        {showHelp ? 'Hide steps' : 'How to make one'}
      </button>

      {showHelp ? (
        <div className="ca-token-help">
          <ol className="ca-token-steps ca-label-s">
            <li>
              Open{' '}
              <a href={NEW_TOKEN_URL} rel="noopener noreferrer" target="_blank">
                GitHub’s fine-grained token page
              </a>
              .
            </li>
            <li>Pick the repositories Willow may see. It sees no others.</li>
            <li>Under Repository permissions, set these to Read-only:</li>
          </ol>
          <ul className="ca-token-scopes ca-label-s">
            {REQUIRED_SCOPES.map((scope) => (
              <li key={scope.url}>
                <code>{scope.url.replace('repository:', '')}</code> — {scope.summary}
              </li>
            ))}
          </ul>
          <div className="ca-token-note ca-label-s">
            Willow asks for nothing beyond these, and needs no write access at all. GitHub does
            not let an app request permissions for a token like this, though — you choose them on
            their site — so if you grant more, Willow will be able to do more than it says here.
          </div>
        </div>
      ) : null}
    </form>
  );
};
