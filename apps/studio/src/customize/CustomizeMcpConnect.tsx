import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { connectMcpServer, mcpRuntime, mcpServers } from '@willow/ai/mcp/mcp-store';
import { isDesktopApp } from '@willow/core/desktop-bridge';
import { presetOwnApp, presetServer, presetSignsIn, sessionEntry, type McpPreset } from '@willow/spark/mcp-catalog';
import { canRunPrograms } from '@willow/spark/mcp-relay';
import { canSignInHere } from '@willow/spark/mcp-signin';
import { canSignInToSitesHere } from '@willow/spark/site-sign-in';
import {
  $mcpCardSignIns,
  addMcpCard,
  cancelMcpCardSignIn,
  mcpCardServer,
  mcpCardSignsIn,
  mcpStatusText,
  signInMcpCard,
  signInMcpSession,
} from './customize-mcp';

/**
 * The control on an MCP card's page (`customize-mcp.ts`): how it connects, what it is doing, and what went wrong.
 * Drawn with the GitHub token row's classes, inside `.connected-apps-container`, so every connect control on these
 * pages looks alike. A card whose service takes a sign-in only with an app of the user's own (X) has a second form,
 * for that app's details, under its token's. A program that reads a site as the user (X Reader) signs in to that site
 * in a browser window the companion opens, or takes the site's cookies pasted, a field for each.
 */

/** Whether this window can sign in to apps: the desktop app, with its companion up. */
export const useMcpSignIn = (): boolean => {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    void canSignInHere().then((yes) => {
      if (live) setCan(yes);
    });
    return () => {
      live = false;
    };
  }, []);
  return can;
};

/** Whether this window can open a site's sign-in for a program (X Reader): the desktop app, with its companion up. */
export const useSiteSignIn = (): boolean => {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    void canSignInToSitesHere().then((yes) => {
      if (live) setCan(yes);
    });
    return () => {
      live = false;
    };
  }, []);
  return can;
};

/** Whether this window can start programs on this computer: the desktop app, with a companion that runs them. Null until it knows. */
const useMcpPrograms = (): boolean | null => {
  const [can, setCan] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void canRunPrograms().then((yes) => {
      if (live) setCan(yes);
    });
    return () => {
      live = false;
    };
  }, []);
  return can;
};

interface CustomizeMcpConnectProps {
  /** The card's name, as its page is headed. */
  title: string;
  preset: McpPreset;
  canSignIn: boolean;
  /** Whether a program that reads a site as the user (X Reader) can sign in to it here (`useSiteSignIn`). */
  canSignInToSites: boolean;
  /** The consent dialog the card's own Connect opens; `connect` runs from its Connect button. */
  onConsent: (connect: () => void) => void;
  /** Changes when the page's Connect means "type it here", and focuses the field. */
  focusRequest: number;
}

export const CustomizeMcpConnect: React.FC<CustomizeMcpConnectProps> = ({ title, preset, canSignIn, canSignInToSites, onConsent, focusRequest }) => {
  const servers = useStore(mcpServers);
  const runtime = useStore(mcpRuntime);
  const signIn = useStore($mcpCardSignIns)[preset.id] ?? {};
  const server = mcpCardServer(preset, servers);
  const status = runtime[preset.id]?.status;
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // The own-app form's, kept here so a sign-in that fails comes back to what was typed.
  const [withOwnApp, setWithOwnApp] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // A program's session: one field per cookie it needs, behind "Paste its cookies instead" where it can sign in.
  const [cookieFields, setCookieFields] = useState<string[]>([]);
  const [pasteCookies, setPasteCookies] = useState(false);
  const canRunHere = useMcpPrograms();
  const inputRef = useRef<HTMLInputElement>(null);
  const added = Boolean(server);
  const auth = preset.auth;

  // Servers connect when something needs them. This page shows one's state, so it does.
  useEffect(() => {
    const state = mcpRuntime.get()[preset.id]?.status.state;
    if (added && (state === undefined || state === 'idle')) void connectMcpServer(preset.id);
  }, [added, preset.id]);

  useEffect(() => {
    if (focusRequest) inputRef.current?.focus();
  }, [focusRequest]);

  const usage = (
    <div className="ca-token-note ca-label-s">
      Name it in a chat — “@{title}” — and Willow uses it to answer. Spark and your bots can use it too.
    </div>
  );

  if (signIn.busy) {
    const site = auth.kind === 'program' ? auth.session : undefined;
    return (
      <div className="ca-token-row">
        <div className="ca-token-connected ca-body-m">
          {site ? `Finish signing in to ${site.name} in the window Willow opened…` : 'Finish signing in in your browser…'}
        </div>
        <div className="ca-token-note ca-label-s">
          {site
            ? `Willow closes it and connects ${title} as soon as you’re signed in. Closing it yourself cancels.`
            : `${title}’s sign-in page opened in your browser. Willow connects as soon as you allow it there.`}
        </div>
        <button className="ca-learn-more" onClick={() => cancelMcpCardSignIn(preset)} type="button">
          Cancel
        </button>
      </div>
    );
  }

  if (server) {
    const failed = status?.state === 'failed' ? status : null;
    const lapsed = failed?.kind === 'needs-sign-in';
    // A pasted token has no sign-in behind it to renew (X's Bearer token): turned down, it is replaced.
    const keyOnly = auth.kind === 'key' && !presetSignsIn(preset) && !server.oauth;
    return (
      <div className="ca-token-row">
        <div className="ca-token-connected ca-body-m">{failed ? `${title} didn’t connect` : mcpStatusText(status, auth.kind === 'program')}</div>
        {failed ? <div className="ca-token-error ca-label-s" role="alert">{failed.message}</div> : null}
        {signIn.problem ? <div className="ca-token-error ca-label-s" role="alert">{signIn.problem}</div> : null}
        {failed && lapsed && keyOnly ? (
          <div className="ca-token-note ca-label-s">
            {title} turned that {auth.label} down. Disconnect {title}, then connect it again with a new one.
          </div>
        ) : failed && lapsed && !canSignIn ? (
          <div className="ca-token-note ca-label-s">Signing in again works in the Willow desktop app.</div>
        ) : failed ? (
          <div className="ca-token-input-row">
            <button
              className="ca-token-submit"
              onClick={() => void (lapsed ? signInMcpCard(preset, { server }) : connectMcpServer(preset.id))}
              type="button"
            >
              {lapsed ? 'Sign in again' : 'Try again'}
            </button>
          </div>
        ) : null}
        {usage}
      </div>
    );
  }

  const desktop = isDesktopApp();

  // A sign-in, or a key for a server that answers only the desktop app (monday.com, X): nothing to do in a browser tab.
  if (auth.kind === 'oauth' || (auth.kind === 'key' && !desktop)) {
    return (
      <div className="ca-token-row">
        {signIn.problem ? <div className="ca-token-error ca-label-s" role="alert">{signIn.problem}</div> : null}
        <div className="ca-token-note ca-label-s">
          {!desktop
            ? `${title} connects in the Willow desktop app, which can finish its sign-in on your computer and reach its server. Open this page there to connect it.`
            : canSignIn
              ? `Connect opens ${title}’s sign-in in your browser. Once you allow Willow there, it connects.`
              : 'Signing in needs Willow’s companion, which isn’t running yet. Try again in a moment.'}
        </div>
      </div>
    );
  }

  const fieldId = `customize-mcp-${preset.id}`;

  // A program on this computer: the companion starts it, so only the desktop app can.
  if (auth.kind === 'program') {
    const session = auth.session;
    if (desktop && canRunHere === null) return null;
    if (!desktop || !canRunHere) {
      return (
        <div className="ca-token-row">
          <div className="ca-token-note ca-label-s">
            {!desktop
              ? `${title} runs on your computer, in the Willow desktop app. Open this page there to connect it.`
              : `${title} runs on your computer through Willow’s companion, which isn’t running yet. Try again in a moment.`}
          </div>
        </div>
      );
    }
    if (!session) return <div className="ca-token-row">{usage}</div>;
    const entry = sessionEntry(session, cookieFields);
    const submitSession = (event: React.FormEvent) => {
      event.preventDefault();
      const checked = presetServer(preset, entry);
      if ('problem' in checked) {
        setProblem(checked.problem);
        return;
      }
      setProblem(null);
      onConsent(() => {
        const failed = addMcpCard(preset, entry);
        if (failed) setProblem(failed);
        else setCookieFields([]);
      });
    };
    const last = session.cookies.length - 1;
    const some = session.cookies.length === 2 ? 'two' : 'these';
    const risk = (
      <div className="ca-token-note ca-label-s">
        {session.site}’s rules don’t allow reading it this way, and it can limit or suspend an account it catches, so connect one you
        could do without. {title} needs{' '}
        {auth.comesWith === 'uv' ? (
          <a href="https://docs.astral.sh/uv/getting-started/installation/" rel="noopener noreferrer" target="_blank">
            uv
          </a>
        ) : (
          auth.comesWith
        )}{' '}
        on this computer.
      </div>
    );
    const cookieForm = (
      <form className="ca-token-row" onSubmit={submitSession}>
        <div className="ca-token-note ca-label-s">
          {canSignInToSites
            ? `Or paste ${some} of ${session.site}’s cookies from a browser you’re signed in to.`
            : `${title} reads ${session.site} with your browser’s session. Paste ${some} of its cookies here.`}{' '}
          They sign in as you, so keep them to yourself.
        </div>
        {session.cookies.map((name, index) => (
          <React.Fragment key={name}>
            <label className="ca-token-label ca-label-s" htmlFor={`${fieldId}-${name}`}>
              {name}
            </label>
            <div className="ca-token-input-row">
              <input
                autoComplete="off"
                className="ca-token-input ca-body-m"
                id={`${fieldId}-${name}`}
                onChange={(event) => {
                  const next = [...cookieFields];
                  next[index] = event.target.value;
                  setCookieFields(next);
                  setProblem(null);
                }}
                ref={index === 0 ? inputRef : undefined}
                spellCheck={false}
                type="password"
                value={cookieFields[index] ?? ''}
              />
              {index === last ? (
                <button className="ca-token-submit" disabled={!entry} type="submit">
                  Connect
                </button>
              ) : null}
            </div>
          </React.Fragment>
        ))}
        {problem ? (
          <div className="ca-token-error ca-label-s" role="alert">
            {problem}
          </div>
        ) : null}
        <button aria-expanded={showHelp} className="ca-learn-more" onClick={() => setShowHelp((open) => !open)} type="button">
          {showHelp ? 'Hide steps' : 'Where to find them'}
        </button>
        {showHelp ? (
          <div className="ca-token-help">
            <ol className="ca-token-steps ca-label-s">
              <li>
                Open{' '}
                <a href={`https://${session.site}`} rel="noopener noreferrer" target="_blank">
                  {session.site}
                </a>{' '}
                in your browser, signed in to the account {title} should read as.
              </li>
              <li>
                Open the browser’s developer tools (F12, or ⌥⌘I on a Mac), then Application → Cookies → https://{session.site}. In
                Firefox it’s Storage → Cookies.
              </li>
              <li>
                Copy the Value of{' '}
                {session.cookies.map((name, index) => (
                  <React.Fragment key={name}>
                    {index > 0 ? ' and of ' : null}
                    <code>{name}</code>
                  </React.Fragment>
                ))}{' '}
                into the fields here.
              </li>
            </ol>
            <div className="ca-token-note ca-label-s">
              They stop working when you log out of {session.site} in that browser. Willow keeps them with its settings, as it does your
              API keys, and forgets them when you disconnect.
            </div>
          </div>
        ) : null}
        {canSignInToSites ? null : risk}
      </form>
    );
    if (!canSignInToSites) return cookieForm;
    return (
      <>
        <div className="ca-token-row">
          <div className="ca-token-note ca-label-s">
            Sign in to {session.name} in a window Willow opens, and {title} reads {session.site} as you. It’s a sign-in of its own,
            which {session.name} lists among your account’s sessions, and Willow forgets it when you disconnect.
          </div>
          <div className="ca-token-input-row">
            <button className="ca-token-submit" onClick={() => onConsent(() => void signInMcpSession(preset))} type="button">
              Sign in to {session.name}
            </button>
          </div>
          {signIn.problem ? (
            <div className="ca-token-error ca-label-s" role="alert">
              {signIn.problem}
            </div>
          ) : null}
          <button aria-expanded={pasteCookies} className="ca-learn-more" onClick={() => setPasteCookies((open) => !open)} type="button">
            {pasteCookies ? 'Hide the cookie fields' : 'Paste its cookies instead'}
          </button>
          {risk}
        </div>
        {pasteCookies ? cookieForm : null}
      </>
    );
  }

  if (auth.kind !== 'key' && auth.kind !== 'url') return <div className="ca-token-row">{usage}</div>;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const checked = presetServer(preset, value);
    if ('problem' in checked) {
      setProblem(checked.problem);
      return;
    }
    setProblem(null);
    onConsent(() => {
      const failed = addMcpCard(preset, value);
      if (failed) setProblem(failed);
      else setValue('');
    });
  };

  const ownApp = canSignIn ? presetOwnApp(preset) : undefined;
  const signInWithApp = (event: React.FormEvent) => {
    event.preventDefault();
    const id = clientId.trim();
    if (!id) return;
    const secret = clientSecret.trim();
    onConsent(() => void signInMcpCard(preset, { client: { clientId: id, ...(secret ? { clientSecret: secret } : {}) } }));
  };
  // A sign-in that went wrong says so in the form it was started from.
  const tokenProblem = problem ?? (ownApp && withOwnApp ? undefined : signIn.problem);

  const tokenForm = (
    <form className="ca-token-row" onSubmit={submit}>
      {auth.kind === 'key' && mcpCardSignsIn(preset, canSignIn) ? (
        <div className="ca-token-note ca-label-s">Connect signs you in with your browser. Or paste your {auth.label} here instead.</div>
      ) : null}
      <label className="ca-token-label ca-label-s" htmlFor={fieldId}>
        {auth.label}
      </label>
      <div className="ca-token-input-row">
        {/* A Zoho server's address carries its key, so it is hidden as a key is. */}
        <input
          autoComplete="off"
          className="ca-token-input ca-body-m"
          id={fieldId}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          placeholder={auth.kind === 'url' ? 'https://…zohomcp.com/mcp/message?key=…' : ''}
          ref={inputRef}
          spellCheck={false}
          type="password"
          value={value}
        />
        <button className="ca-token-submit" disabled={!value.trim()} type="submit">
          Connect
        </button>
      </div>
      {tokenProblem ? (
        <div className="ca-token-error ca-label-s" role="alert">
          {tokenProblem}
        </div>
      ) : null}
      <button aria-expanded={showHelp} className="ca-learn-more" onClick={() => setShowHelp((open) => !open)} type="button">
        {showHelp ? 'Hide steps' : auth.kind === 'url' ? 'How to make one' : 'Where to find it'}
      </button>
      {showHelp ? (
        <div className="ca-token-help">
          {auth.kind === 'url' ? (
            <ol className="ca-token-steps ca-label-s">
              <li>
                Open{' '}
                <a href={auth.link} rel="noopener noreferrer" target="_blank">
                  Zoho MCP
                </a>{' '}
                and sign in with your Zoho account.
              </li>
              <li>Make a server, and add {title}’s tools to it.</li>
              <li>On the server’s Connect page, copy its address — the one ending in a key — and paste it here.</li>
            </ol>
          ) : (
            <ol className="ca-token-steps ca-label-s">
              <li>
                Open{' '}
                <a href={auth.link} rel="noopener noreferrer" target="_blank">
                  {title}’s developer settings
                </a>
                .
              </li>
              <li>Copy your {auth.label}, and paste it here.</li>
            </ol>
          )}
          <div className="ca-token-note ca-label-s">
            Anyone with {auth.kind === 'url' ? 'that address' : 'it'} can use {title} as you, so keep it to yourself. Willow keeps it on this
            computer, and forgets it when you disconnect.
          </div>
        </div>
      ) : null}
    </form>
  );

  if (auth.kind !== 'key' || !ownApp) return tokenForm;

  const appField = `${fieldId}-app`;
  return (
    <>
      {tokenForm}
      {withOwnApp ? (
        <form className="ca-token-row" onSubmit={signInWithApp}>
          <div className="ca-token-note ca-label-s">
            Sign in with your {title} developer app to use {title} as yourself. Its details stay on this computer, with the sign-in.
          </div>
          <label className="ca-token-label ca-label-s" htmlFor={`${appField}-id`}>
            Client ID
          </label>
          <div className="ca-token-input-row">
            <input
              autoComplete="off"
              className="ca-token-input ca-body-m"
              id={`${appField}-id`}
              onChange={(event) => setClientId(event.target.value)}
              spellCheck={false}
              value={clientId}
            />
          </div>
          <label className="ca-token-label ca-label-s" htmlFor={`${appField}-secret`}>
            Client secret — only a Web App has one
          </label>
          <div className="ca-token-input-row">
            <input
              autoComplete="off"
              className="ca-token-input ca-body-m"
              id={`${appField}-secret`}
              onChange={(event) => setClientSecret(event.target.value)}
              spellCheck={false}
              type="password"
              value={clientSecret}
            />
            <button className="ca-token-submit" disabled={!clientId.trim()} type="submit">
              Sign in
            </button>
          </div>
          {signIn.problem ? <div className="ca-token-error ca-label-s" role="alert">{signIn.problem}</div> : null}
          <div className="ca-token-help">
            <ol className="ca-token-steps ca-label-s">
              <li>
                Open your app in{' '}
                <a href={ownApp.link} rel="noopener noreferrer" target="_blank">
                  {title}’s developer console
                </a>
                .
              </li>
              <li>
                Under User authentication settings, set it up as a Native App, with <code>{ownApp.redirect}</code> as its callback
                address.
              </li>
              <li>Copy its OAuth 2.0 Client ID, paste it here, and sign in.</li>
            </ol>
          </div>
          <button
            className="ca-learn-more"
            onClick={() => {
              setWithOwnApp(false);
              $mcpCardSignIns.setKey(preset.id, {});
            }}
            type="button"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="ca-token-row">
          <div className="ca-token-note ca-label-s">
            A {auth.label} uses {title} as your app. To use it as yourself, sign in with that app instead.
          </div>
          <button className="ca-learn-more" onClick={() => setWithOwnApp(true)} type="button">
            Sign in with your app
          </button>
        </div>
      )}
    </>
  );
};
