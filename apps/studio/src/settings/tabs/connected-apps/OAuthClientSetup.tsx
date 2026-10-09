import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { clientIdProblem, setUserClientId, spotifyRedirectUri, userClientIds, type ClientIdProvider } from '@willow/personal';

/**
 * Connecting Google and Spotify apps with the user's own OAuth clients.
 *
 * The desktop build reads no environment files, so it ships without the client ids the
 * web deployment has, and without one a provider's switches cannot do anything. This is
 * where the user supplies their own — a client created for exactly this Willow, whose
 * origin (or redirect) is shown here so it can be copied rather than guessed. The steps
 * are the minimum each provider's console needs; the id is checked for shape before it
 * is kept (`clientIdProblem`), and saving reinstalls the token source at once.
 */

const STEPS: Record<ClientIdProvider, { title: string; steps: (target: string) => React.ReactNode[]; link: { href: string; label: string } }> = {
  google: {
    title: 'Connect Google apps with your own Google Cloud client',
    steps: (origin) => [
      <>In Google Cloud, create a project or pick one, and enable the APIs of the apps you will connect: Gmail, Google Calendar, Google Tasks, Google Drive, Google Docs and YouTube Data.</>,
      <>On the OAuth consent screen, choose External and add your own Google account as a test user.</>,
      <>Create an OAuth client id of type <strong>Web application</strong>, and add <code>{origin}</code> as an authorised JavaScript origin.</>,
      <>Paste the client id below.</>,
    ],
    link: { href: 'https://console.cloud.google.com/apis/credentials', label: 'Open Google Cloud credentials' },
  },
  spotify: {
    title: 'Connect Spotify with your own Spotify app',
    steps: (redirect) => [
      <>In Spotify's developer dashboard, create an app with the Web API.</>,
      <>Add <code>{redirect}</code> as a redirect URI.</>,
      <>Paste its client id below.</>,
    ],
    link: { href: 'https://developer.spotify.com/dashboard', label: 'Open the Spotify dashboard' },
  },
};

function ProviderSetup({ provider, configured }: { provider: ClientIdProvider; configured: boolean }) {
  const supplied = useStore(userClientIds)[provider];
  const [open, setOpen] = useState(!configured);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const copy = STEPS[provider];
  const target = provider === 'google' ? window.location.origin : spotifyRedirectUri();

  // Configured by the deployment itself: nothing for the user to set.
  if (configured && !supplied) return null;

  if (configured && supplied && !open) {
    return (
      <div className="ca-client-setup is-compact">
        <MaterialSymbol className="ca-banner-icon" family="google-symbols" name="key" size={20} weight={400} />
        <div className="ca-body-m ca-client-setup__summary">
          {provider === 'google' ? 'Google apps' : 'Spotify'} connect through your own client ({supplied.slice(0, 12)}…).
        </div>
        <button type="button" className="ca-client-setup__link" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
    );
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const issue = clientIdProblem(provider, draft);
    setProblem(issue);
    if (issue) return;
    setUserClientId(provider, draft);
    setDraft('');
    setOpen(false);
  };

  return (
    <section className="ca-client-setup" aria-label={copy.title}>
      <div className="ca-client-setup__heading">
        <MaterialSymbol className="ca-banner-icon" family="google-symbols" name="key" size={20} weight={400} />
        <h2 className="ca-title-s">{copy.title}</h2>
      </div>
      <ol className="ca-client-setup__steps ca-body-m">
        {copy.steps(target).map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      <a className="ca-client-setup__link" href={copy.link.href} target="_blank" rel="noopener noreferrer">
        {copy.link.label}
      </a>
      <form className="ca-client-setup__form" onSubmit={save}>
        <input
          className="ca-client-setup__input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(null);
          }}
          placeholder={provider === 'google' ? '…apps.googleusercontent.com' : '32-character client id'}
          aria-label={`${provider === 'google' ? 'Google' : 'Spotify'} client id`}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="ca-client-setup__save" disabled={!draft.trim()}>
          Save
        </button>
        {supplied && (
          <button
            type="button"
            className="ca-client-setup__link"
            onClick={() => {
              setUserClientId(provider, null);
              setOpen(true);
            }}
          >
            Remove
          </button>
        )}
      </form>
      {problem && (
        <p className="ca-client-setup__problem ca-body-m" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** One setup card per provider the build cannot connect on its own, and a line for each the user set up. */
export function OAuthClientSetup({ setup }: { setup: Record<'google' | 'spotify', boolean | null> }) {
  return (
    <>
      <ProviderSetup provider="google" configured={setup.google !== false} />
      <ProviderSetup provider="spotify" configured={setup.spotify !== false} />
    </>
  );
}
