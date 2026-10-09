import React from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { connectMcpServer, mcpRuntime, mcpServers, removeMcpServer, upsertMcpServer, type McpServerConfig, type McpStatus } from '@willow/ai/mcp/mcp-store';
import { pickDirectory } from '@willow/core/desktop-bridge';
import { MCP_PRESETS, OWN_APP_REDIRECT, presetServer, presetSignInServer, type McpPreset } from './mcp-catalog';
import { canRunPrograms } from './mcp-relay';
import { canSignInHere, needsOwnApp, signInFromDesktop, signInProblem } from './mcp-signin';
import './McpCatalog.css';

const statusText = (status: McpStatus | undefined, enabled: boolean, program = false): string => {
  if (status?.state === 'ready') return `Connected · ${status.toolCount} tool${status.toolCount === 1 ? '' : 's'}`;
  if (status?.state === 'connecting') return program ? 'Starting… The first start can take a minute while it downloads.' : 'Connecting…';
  if (status?.state === 'failed') return status.message;
  return enabled ? 'Not connected yet' : 'Off';
};

const hostOf = (link: string): string => {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
};

/** Whether this window runs MCP servers that are programs on this computer: false until the companion says it does. */
export function useCanRunPrograms(): boolean {
  const [can, setCan] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void canRunPrograms().then((yes) => {
      if (live) setCan(yes);
    });
    return () => {
      live = false;
    };
  }, []);
  return can;
}

/** Whether this window signs in to apps: false until the companion says it can. */
export function useCanSignIn(): boolean {
  const [can, setCan] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void canSignInHere().then((yes) => {
      if (live) setCan(yes);
    });
    return () => {
      live = false;
    };
  }, []);
  return can;
}

type OwnClient = { clientId: string; clientSecret?: string };

/**
 * A sign-in to one server as a row shows it: under way, what went wrong, and whether the service turned out to want
 * an app of the user's own, whose details then sign in through `redirect`.
 */
export function useSignIn(server: () => McpServerConfig, redirect: string = OWN_APP_REDIRECT) {
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const [ownApp, setOwnApp] = React.useState(false);
  const start = async (client?: OwnClient): Promise<boolean> => {
    setBusy(true);
    setProblem('');
    try {
      await signInFromDesktop(server(), client ? { client, redirect } : {});
      setOwnApp(false);
      return true;
    } catch (error) {
      // The form that opens says what to do, so the error's own sentence would only repeat it.
      if (needsOwnApp(error)) setOwnApp(true);
      else setProblem(signInProblem(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, setProblem, ownApp, setOwnApp, start };
}

/** The details of an app the user made with a service that asks for one, and the redirect address to register in it. */
export function OwnAppForm({ label, link, redirect = OWN_APP_REDIRECT, busy, problem, onProblem, onSubmit }: {
  label: string;
  link?: string;
  redirect?: string;
  busy: boolean;
  problem: string;
  onProblem: (problem: string) => void;
  onSubmit: (client: OwnClient) => void;
}) {
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  return (
    <form
      className="spark-mcp-catalog__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!clientId.trim()) {
          onProblem(`Enter the client ID of your ${label} app.`);
          return;
        }
        onSubmit({ clientId: clientId.trim(), ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) });
      }}
    >
      <p>
        {label} asks you to make an app of your own
        {link ? (
          <>
            {' '}at{' '}
            <a href={link} target="_blank" rel="noreferrer">
              {hostOf(link)}
            </a>
          </>
        ) : (
          ' with the service'
        )}
        , with <code>{redirect}</code> as its redirect address. Then enter its details here; they stay on this device.
      </p>
      <label>
        <span>Client ID</span>
        <input value={clientId} autoComplete="off" spellCheck={false} onChange={(event) => { setClientId(event.target.value); onProblem(''); }} />
      </label>
      <label>
        <span>Client secret</span>
        <input type="password" value={clientSecret} autoComplete="off" spellCheck={false} onChange={(event) => { setClientSecret(event.target.value); onProblem(''); }} />
      </label>
      {problem && (
        <p className="spark-mcp-catalog__problem" role="alert">
          {problem}
        </p>
      )}
      <button type="submit" className="spark-mcp-catalog__action is-primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

/** A program from the catalog: added in a click — or, for one that works in a folder, once the folder is picked. */
function ProgramRow({ preset }: { preset: McpPreset }) {
  const servers = useStore(mcpServers);
  const runtime = useStore(mcpRuntime);
  const added = servers.find((server) => server.id === preset.id);
  const status = runtime[preset.id]?.status;
  const [problem, setProblem] = React.useState('');
  const auth = preset.auth.kind === 'program' ? preset.auth : null;
  if (!auth) return null;

  const add = async () => {
    setProblem('');
    let folder = '';
    if (auth.folder) {
      folder = (await pickDirectory(`The folder ${preset.label} may use`).catch(() => null)) ?? '';
      if (!folder) return;
    }
    const server = presetServer(preset, folder);
    if ('problem' in server) {
      setProblem(server.problem);
      return;
    }
    upsertMcpServer(server);
    void connectMcpServer(server.id);
  };
  const failed = status?.state === 'failed';
  const folder = auth.folder ? added?.args?.at(-1) : undefined;

  return (
    <li className="spark-mcp-catalog__item">
      <div className="spark-custom-app-row">
        <span className="spark-custom-app-row__icon" aria-hidden="true">
          <MaterialSymbol family="material-rounded" name={preset.icon} size={20} opticalSize={20} weight={350} />
        </span>
        <span className="spark-custom-app-row__copy">
          <strong>{preset.label}</strong>
          <span className={failed || problem ? 'spark-mcp-catalog__problem' : undefined}>
            {problem || (added ? statusText(status, added.enabled, true) : preset.description)}
          </span>
          {folder && !failed && <span className="spark-mcp-catalog__folder">{folder}</span>}
        </span>
        {added && failed ? (
          <>
            <button type="button" className="spark-mcp-catalog__action is-primary" data-action="mcp-retry" onClick={() => void connectMcpServer(preset.id)}>
              Try again
            </button>
            <button
              type="button"
              className="spark-custom-app-row__remove"
              data-action="mcp-remove"
              aria-label={`Remove ${preset.label}`}
              title="Remove"
              onClick={() => void removeMcpServer(preset.id)}
            >
              <MaterialSymbol family="material-rounded" name="delete" size={20} opticalSize={20} weight={350} />
            </button>
          </>
        ) : added ? (
          <button type="button" className="spark-mcp-catalog__action" data-action="mcp-remove" onClick={() => void removeMcpServer(preset.id)}>
            Remove
          </button>
        ) : (
          <button type="button" className="spark-mcp-catalog__action is-primary" data-action="mcp-add" onClick={() => void add()}>
            {auth.folder ? 'Choose folder' : 'Add'}
          </button>
        )}
      </div>
    </li>
  );
}

function PresetRow({ preset }: { preset: McpPreset }) {
  const servers = useStore(mcpServers);
  const runtime = useStore(mcpRuntime);
  const added = servers.find((server) => server.id === preset.id);
  const status = runtime[preset.id]?.status;
  const auth = preset.auth;
  const canSignIn = useCanSignIn();
  const ownApp = auth.kind === 'oauth' ? auth.ownApp : undefined;
  const signIn = useSignIn(() => presetSignInServer(preset), ownApp?.redirect ?? OWN_APP_REDIRECT);
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [problem, setProblem] = React.useState('');

  const signsInInstead = auth.kind === 'key' && auth.signIn === true && canSignIn;
  // Turned away for want of a sign-in: where the app signs in, that is offered again, beside removing it.
  const again = Boolean(added) && status?.state === 'failed' && status.kind === 'needs-sign-in' && (auth.kind === 'oauth' || signsInInstead);
  const ownAppForm = signIn.ownApp || (open && Boolean(ownApp));

  const toggleSignIn = () => {
    signIn.setProblem('');
    if (ownAppForm) {
      setOpen(false);
      signIn.setOwnApp(false);
      return;
    }
    if (ownApp) {
      setOpen(true);
      return;
    }
    setOpen(false);
    void signIn.start();
  };

  const connect = () => {
    const server = presetServer(preset, value);
    if ('problem' in server) {
      setProblem(server.problem);
      return;
    }
    upsertMcpServer(server);
    setOpen(false);
    setValue('');
    setProblem('');
    void connectMcpServer(server.id);
  };

  const line = signIn.busy
    ? 'Finish signing in in your browser…'
    : signIn.problem && !ownAppForm
      ? signIn.problem
      : added
        ? statusText(status, added.enabled)
        : preset.description;
  const troubled = !signIn.busy && (Boolean(signIn.problem && !ownAppForm) || status?.state === 'failed');

  const signInButton = (label: string) => (
    <button
      type="button"
      className="spark-mcp-catalog__action is-primary"
      data-action="mcp-sign-in"
      disabled={signIn.busy}
      aria-expanded={ownApp ? ownAppForm : undefined}
      onClick={toggleSignIn}
    >
      {ownAppForm ? 'Cancel' : label}
    </button>
  );

  return (
    <li className="spark-mcp-catalog__item">
      <div className="spark-custom-app-row">
        <span className="spark-custom-app-row__icon" aria-hidden="true">
          <MaterialSymbol family="material-rounded" name={preset.icon} size={20} opticalSize={20} weight={350} />
        </span>
        <span className="spark-custom-app-row__copy">
          <strong>{preset.label}</strong>
          <span className={troubled ? 'spark-mcp-catalog__problem' : undefined}>{line}</span>
        </span>
        {again ? (
          <>
            {signInButton('Sign in again')}
            <button
              type="button"
              className="spark-custom-app-row__remove"
              data-action="mcp-remove"
              aria-label={`Remove ${preset.label}`}
              title="Remove"
              onClick={() => void removeMcpServer(preset.id)}
            >
              <MaterialSymbol family="material-rounded" name="delete" size={20} opticalSize={20} weight={350} />
            </button>
          </>
        ) : added ? (
          <button type="button" className="spark-mcp-catalog__action" data-action="mcp-remove" onClick={() => void removeMcpServer(preset.id)}>
            Remove
          </button>
        ) : auth.kind === 'oauth' ? (
          signInButton('Sign in')
        ) : (
          <button
            type="button"
            className="spark-mcp-catalog__action is-primary"
            data-action="mcp-connect"
            aria-expanded={auth.kind === 'none' ? undefined : open}
            onClick={() => (auth.kind === 'none' ? connect() : setOpen((isOpen) => !isOpen))}
          >
            {open ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>
      {ownAppForm ? (
        <OwnAppForm
          label={preset.label}
          link={ownApp?.link}
          redirect={ownApp?.redirect ?? OWN_APP_REDIRECT}
          busy={signIn.busy}
          problem={signIn.problem}
          onProblem={signIn.setProblem}
          onSubmit={(client) => void signIn.start(client).then((ok) => ok && setOpen(false))}
        />
      ) : (
        open && !added && (auth.kind === 'key' || auth.kind === 'url') && (
          <form
            className="spark-mcp-catalog__form"
            onSubmit={(event) => {
              event.preventDefault();
              connect();
            }}
          >
            <label>
              <span>{auth.label}</span>
              <input
                type={auth.kind === 'key' ? 'password' : 'url'}
                value={value}
                placeholder={auth.kind === 'url' ? 'https://' : ''}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setValue(event.target.value);
                  setProblem('');
                }}
              />
            </label>
            <p>
              Get it from{' '}
              <a href={auth.link} target="_blank" rel="noreferrer">
                {hostOf(auth.link)}
              </a>
              . It stays on this device.
            </p>
            {problem && (
              <p className="spark-mcp-catalog__problem" role="alert">
                {problem}
              </p>
            )}
            <div className="spark-mcp-catalog__actions">
              <button type="submit" className="spark-mcp-catalog__action is-primary">
                {auth.kind === 'key' && auth.optional && !value.trim() ? 'Connect without a key' : 'Connect'}
              </button>
              {signsInInstead && (
                <button type="button" className="spark-mcp-catalog__action" data-action="mcp-sign-in" onClick={toggleSignIn}>
                  Sign in instead
                </button>
              )}
            </div>
          </form>
        )
      )}
    </li>
  );
}

/** Ready-made apps, above the form for any other server: each one connects in a click, with a key, or by signing in. */
export function McpCatalog() {
  // Programs only where something can start them: the desktop app, with its companion.
  const programs = useCanRunPrograms();
  const presets = MCP_PRESETS.filter((preset) => preset.auth.kind !== 'program' || programs);
  const groups = [...new Set(presets.map((preset) => preset.group))];
  return (
    <div className="spark-mcp-catalog">
      <p className="spark-mcp-catalog__intro">
        Apps your bots and Spark can use. Each one you connect gives them its tools, and a bot uses them only for what you ask of it.
      </p>
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h3 className="spark-mcp-catalog__group">{group}</h3>
          {group === 'On this computer' && (
            <p className="spark-mcp-catalog__note">
              Programs Willow starts on this computer, which run as you. They need Node.js or uv installed.
            </p>
          )}
          <ul className="spark-mcp-catalog__list">
            {presets.filter((preset) => preset.group === group).map((preset) =>
              preset.auth.kind === 'program' ? <ProgramRow key={preset.id} preset={preset} /> : <PresetRow key={preset.id} preset={preset} />,
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
