/**
 * The MCP servers section of the Connected apps page.
 *
 * Its own file so that `SparkCustomisePages.tsx` — already 1,400 lines of five
 * pages — gains three lines rather than a form, a status list and a callout.
 *
 * ## Why it reads the store directly
 *
 * Every other section of that page is presentational: `ConnectedAppsPage` takes
 * `customApps`, `connections` and a set of callbacks, and `SparkWorkspace`
 * threads them down from Spark's task state.
 *
 * MCP servers are not Spark state. They are app-level — the Code tab's Agent
 * uses the same list, and Chat is the next likely consumer — so they live in
 * `@willow/ai/mcp/mcp-store` and this component subscribes to it. Threading
 * them through Spark's task-shaped props would make Spark the owner of
 * something it does not own.
 *
 * ## The callout is not decoration
 *
 * Most of what people mean by "an MCP server" cannot work in a browser: the
 * popular ones are programs a desktop client starts as a subprocess, and a web
 * page is not allowed to start a program. A user who does not read that first
 * will spend an afternoon on an address that was never going to connect, so the
 * callout sits above the form rather than below it. In the desktop app the
 * companion starts those programs and reaches every address, so there the
 * callout says what each kind is instead, and that a program runs as the user.
 */

import React from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { McpCatalog, OwnAppForm, useCanRunPrograms, useCanSignIn, useSignIn } from './McpCatalog';
import { MCP_PRESETS } from './mcp-catalog';
import { commandLine, parseEnvLines, splitCommand } from './mcp-program-input';
import {
  connectMcpServer,
  mcpRuntime,
  mcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  suggestMcpServerId,
  upsertMcpServer,
  type McpServerConfig,
  type McpServerKind,
  type McpStatus,
} from '@willow/ai/mcp/mcp-store';

/** Spark's toggle, lifted so this section matches the rows above it. */
interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

const McpToggle: React.FC<ToggleProps> = ({ label, checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className="spark-custom-app-row__toggle spark-mcp-toggle"
    onClick={onChange}
    style={{
      width: 40,
      height: 22,
      borderRadius: 999,
      border: 'none',
      padding: 2,
      cursor: 'pointer',
      background: checked ? 'var(--spark-accent, #1f3b9b)' : '#3c4043',
      transition: 'background 150ms ease',
      flexShrink: 0,
    }}
  >
    <span
      style={{
        display: 'block',
        width: 18,
        height: 18,
        borderRadius: 999,
        background: checked ? '#e3e3e3' : '#8e918f',
        transform: checked ? 'translateX(18px)' : 'translateX(0)',
        transition: 'transform 150ms ease, background 150ms ease',
      }}
    />
  </button>
);

/**
 * One server the user added. In the desktop app, one that turns Willow away for want of a sign-in offers it: Willow
 * registers itself where the server lets apps register, and asks for an app of the user's own where it does not.
 */
const McpServerRow: React.FC<{ server: McpServerConfig; status: McpStatus }> = ({ server, status }) => {
  const canSignIn = useCanSignIn();
  const signIn = useSignIn(() => ({ ...server, enabled: true }));
  const wantsSignIn = canSignIn && server.kind === 'http' && status.state === 'failed' && status.kind === 'needs-sign-in';

  return (
    <div className="spark-mcp-server">
      <article className="spark-custom-app-row">
        <span className="spark-custom-app-row__icon" aria-hidden="true">
          {server.kind === 'program' ? (
            <MaterialSymbol family="material-rounded" name="terminal" size={20} opticalSize={20} weight={350} />
          ) : (
            <MaterialSymbol
              family="luminous"
              name={server.kind === 'http' ? 'public' : 'code'}
              size={22}
              weight={320}
              roundness={100}
            />
          )}
        </span>
        <span className="spark-custom-app-row__copy">
          <strong>{server.label}</strong>
          <span className={server.kind === 'program' ? 'spark-mcp-server__command' : undefined}>
            {server.kind === 'http' ? server.url : server.kind === 'program' ? commandLine(server.command ?? '', server.args) : 'Runs in this tab'}
          </span>

          {/*
            * Status, and when it failed, the reason in full.
            *
            * The browser reports a CORS refusal, a wrong address and an
            * offline host identically, so `McpError` exists to turn one
            * opaque failure into a sentence someone can act on.
            */}
          <span className="spark-custom-app-row__status">
            {signIn.busy && 'Finish signing in in your browser…'}
            {!signIn.busy && status.state === 'connecting' &&
              (server.kind === 'program' ? 'Starting… The first start can take a minute while it downloads.' : 'Connecting…')}
            {!signIn.busy && status.state === 'ready' &&
              `${status.toolCount} tool${status.toolCount === 1 ? '' : 's'} available` +
                (status.serverName ? ` · ${status.serverName}` : '')}
            {!signIn.busy && status.state === 'idle' && (server.enabled ? 'Not connected' : 'Saved · Off')}
            {!signIn.busy && status.state === 'failed' && 'Could not connect'}
          </span>

          {status.state === 'failed' && !signIn.busy && (
            <span className="spark-mcp-server__failure">
              {status.message}
              {status.detail && <span className="spark-mcp-server__detail">{status.detail}</span>}
            </span>
          )}

          {signIn.problem && !signIn.ownApp && (
            <span className="spark-mcp-server__failure" role="alert">
              {signIn.problem}
            </span>
          )}
        </span>

        {wantsSignIn ? (
          <button
            type="button"
            className="spark-mcp-catalog__action is-primary"
            data-action="mcp-sign-in"
            disabled={signIn.busy}
            aria-expanded={signIn.ownApp}
            onClick={() => {
              signIn.setProblem('');
              if (signIn.ownApp) signIn.setOwnApp(false);
              else void signIn.start();
            }}
          >
            {signIn.ownApp ? 'Cancel' : server.oauth ? 'Sign in again' : 'Sign in'}
          </button>
        ) : (
          server.enabled && (
            <button
              type="button"
              className="spark-custom-app-row__remove"
              aria-label={`Reconnect ${server.label}`}
              title="Reconnect"
              onClick={() => void connectMcpServer(server.id)}
            >
              <MaterialSymbol family="luminous" name="refresh" size={20} weight={320} roundness={100} />
            </button>
          )
        )}

        <McpToggle
          label={`${server.enabled ? 'Turn off' : 'Turn on'} ${server.label}`}
          checked={server.enabled}
          onChange={() => void setMcpServerEnabled(server.id, !server.enabled)}
        />

        <button
          type="button"
          className="spark-custom-app-row__remove"
          aria-label={`Remove ${server.label}`}
          title="Remove server"
          onClick={() => void removeMcpServer(server.id)}
        >
          <MaterialSymbol family="luminous" name="delete" size={20} weight={320} roundness={100} />
        </button>
      </article>

      {wantsSignIn && signIn.ownApp && (
        <OwnAppForm
          label={server.label}
          busy={signIn.busy}
          problem={signIn.problem}
          onProblem={signIn.setProblem}
          onSubmit={(client) => void signIn.start(client)}
        />
      )}
    </div>
  );
};

export const SparkMcpSection: React.FC = () => {
  // Apps added from the catalog show there, with their status; this list is for every other server.
  const servers = useStore(mcpServers).filter((server) => !MCP_PRESETS.some((preset) => preset.id === server.id));
  const runtime = useStore(mcpRuntime);

  const [adding, setAdding] = React.useState(false);
  const [kind, setKind] = React.useState<McpServerKind>('http');
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [token, setToken] = React.useState('');
  const [script, setScript] = React.useState('');
  const [command, setCommand] = React.useState('');
  const [envText, setEnvText] = React.useState('');
  const [error, setError] = React.useState('');
  const programs = useCanRunPrograms();
  const kinds: Array<[McpServerKind, string, string]> = [
    ['http', 'At a web address', 'public'],
    ...(programs ? [['program', 'A program on this computer', 'terminal'] as [McpServerKind, string, string]] : []),
    ['worker', programs ? 'JavaScript, in this window' : 'JavaScript, in this tab', 'code'],
  ];

  /*
   * Bring up anything enabled but idle when the page opens.
   *
   * Config survives a reload and connections do not, so without this every
   * server the user had switched on would read "Not connected" with no
   * explanation. Only idle servers are touched, so a failure keeps its message
   * instead of being retried into the same failure on every visit.
   */
  React.useEffect(() => {
    for (const server of mcpServers.get()) {
      if (!server.enabled) continue;
      const state = mcpRuntime.get()[server.id]?.status.state;
      if (state === undefined || state === 'idle') void connectMcpServer(server.id);
    }
  }, []);

  const reset = (): void => {
    setAdding(false);
    setKind('http');
    setName('');
    setUrl('');
    setToken('');
    setScript('');
    setCommand('');
    setEnvText('');
    setError('');
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();

    const label = name.trim();
    if (!label) {
      setError('Give the server a name.');
      return;
    }

    if (kind === 'http') {
      const address = url.trim();
      if (!address) {
        setError('Enter the server address.');
        return;
      }
      // Checked here rather than left to the connection attempt, because
      // "could not reach the server" is a poor answer to a typo.
      try {
        const parsed = new URL(address);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          setError('The address must start with https:// or http://');
          return;
        }
      } catch {
        setError('That is not a valid web address. It should start with https://');
        return;
      }
    } else if (kind === 'worker' && !script.trim()) {
      setError('Paste the server script.');
      return;
    }

    const words = kind === 'program' ? splitCommand(command) : [];
    const variables = kind === 'program' ? parseEnvLines(envText) : { env: {} };
    if ('problem' in words) {
      setError(words.problem);
      return;
    }
    if ('problem' in variables) {
      setError(variables.problem);
      return;
    }
    const { env } = variables;

    upsertMcpServer({
      // Never a catalog app's id, or the server would be taken for that app.
      id: suggestMcpServerId(label, MCP_PRESETS.map((preset) => preset.id)),
      label,
      kind,
      url: kind === 'http' ? url.trim() : undefined,
      headers:
        kind === 'http' && token.trim() ? { authorization: `Bearer ${token.trim()}` } : undefined,
      script: kind === 'worker' ? script : undefined,
      ...(kind === 'program'
        ? { command: words[0], args: words.slice(1), ...(Object.keys(env).length ? { env } : {}) }
        : {}),
      // Off on arrival. An MCP server is third-party code whose output the model
      // reads, so switching it on is a separate, deliberate act.
      enabled: false,
    });
    reset();
  };

  return (
    <section
      id="spark-apps-mcp"
      className="spark-connected-app-section spark-connected-app-section--custom"
      aria-labelledby="spark-apps-mcp-heading"
    >
      <header className="spark-connected-app-section__header">
        <h2 id="spark-apps-mcp-heading">More apps</h2>
      </header>

      <McpCatalog />

      {/* What can be added, before the form: in the desktop app, any server; in a browser, much less. */}
      {programs ? (
        <div className="spark-mcp-callout">
          <span aria-hidden="true" className="spark-mcp-callout__icon">
            <MaterialSymbol family="material-rounded" name="info" size={20} weight={320} />
          </span>
          <div>
            <strong>Any MCP server can be added here</strong>
            <p>
              <b>At a web address:</b> reached through Willow on this computer, whether or not the server allows web
              pages.
            </p>
            <p>
              <b>A program on this computer:</b> started with its command, such as <code>npx</code> or{' '}
              <code>uvx</code>, while it is on. It runs as you, with your files and accounts, so add only programs you
              trust.
            </p>
            <p>
              <b>JavaScript, in this window:</b> nothing to install, for a server that needs nothing from your
              operating system.
            </p>
          </div>
        </div>
      ) : (
        <div className="spark-mcp-callout spark-mcp-callout--warning">
          <span aria-hidden="true" className="spark-mcp-callout__icon">
            {/* The Luminous subset has no `warning` glyph; the full Material Symbols family does. */}
            <MaterialSymbol family="material-rounded" name="warning" size={20} weight={320} />
          </span>
          <div>
            <strong>Most MCP servers will not work here, and it is worth knowing why first</strong>
            <p>
              Willow runs in a browser tab. Most MCP servers — including the popular filesystem, git, database and
              browser-automation ones — are programs that a desktop app starts on your computer. A web page is not
              allowed to start a program, so those cannot be reached from here at all.
            </p>
            <p>
              <b>Servers at a web address</b> work only if their owner has allowed requests from web pages. Many have
              not — if one refuses to connect, that is a setting at their end and there is nothing you can change here
              to fix it.
            </p>
            <p>
              <b>Servers written in JavaScript</b> run inside this tab with nothing to install, as long as they need
              nothing from your operating system.
            </p>
            <p className="spark-mcp-callout__aside">
              Willow&apos;s desktop app runs the rest, and reaches every server at a web address; how is written up in{' '}
              <code>HELPER-APP.md</code> at the top of the repo.
            </p>
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="spark-custom-app-empty">
          <span className="spark-custom-app-empty__icon" aria-hidden="true">
            <MaterialSymbol family="luminous" name="extension" size={28} weight={320} roundness={100} />
          </span>
          <span className="spark-custom-app-empty__copy">
            <strong>No MCP servers yet</strong>
            <span>Add one to give your bots, Spark and the Code tab more tools.</span>
          </span>
        </div>
      ) : (
        <div className="spark-custom-app-list">
          {servers.map((server) => (
            <McpServerRow key={server.id} server={server} status={runtime[server.id]?.status ?? { state: 'idle' }} />
          ))}
        </div>
      )}

      {adding ? (
        <form className="spark-custom-app-card spark-mcp-add" onSubmit={submit}>
          <label htmlFor="spark-mcp-name">Add an MCP server</label>

          <div className="spark-mcp-kinds" role="group" aria-label="Where the server is">
            {kinds.map(([value, text, icon]) => (
              <button
                key={value}
                type="button"
                className="spark-mcp-kind"
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setError('');
                }}
              >
                <MaterialSymbol family="material-rounded" name={icon} size={18} opticalSize={20} weight={350} />
                {text}
              </button>
            ))}
          </div>

          <div className="spark-custom-app-card__row">
            <input
              id="spark-mcp-name"
              type="text"
              aria-label="Server name"
              placeholder="Server name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
            />
          </div>

          {kind === 'http' && (
            <>
              <div className="spark-custom-app-card__row">
                <input
                  type="url"
                  aria-label="Server address"
                  placeholder="https://example.com/mcp"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setError('');
                  }}
                />
              </div>
              <div className="spark-custom-app-card__row">
                <input
                  type="password"
                  aria-label="Access token, optional"
                  placeholder="Access token (only if required)"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              <p className="spark-mcp-note">
                The server&apos;s MCP endpoint, not its home page or documentation.
                {programs && ' One that wants you to sign in offers it once it is on.'}
              </p>
            </>
          )}

          {kind === 'program' && (
            <>
              <div className="spark-custom-app-card__row">
                <input
                  type="text"
                  className="spark-mcp-mono"
                  aria-label="Command"
                  placeholder="npx -y @modelcontextprotocol/server-memory"
                  value={command}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setCommand(event.target.value);
                    setError('');
                  }}
                />
              </div>
              <textarea
                className="spark-mcp-field spark-mcp-mono"
                aria-label="Variables, optional"
                placeholder={'Variables it needs, one per line (optional)\nNAME=value'}
                rows={3}
                value={envText}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setEnvText(event.target.value);
                  setError('');
                }}
              />
              <p className="spark-mcp-note">
                The command from the server&apos;s instructions. It starts when you turn the server on and runs as you,
                so add only programs you trust.
              </p>
            </>
          )}

          {kind === 'worker' && (
            <>
              <textarea
                className="spark-mcp-field spark-mcp-mono"
                aria-label="Server script"
                placeholder="JavaScript module that answers MCP messages"
                rows={7}
                value={script}
                onChange={(event) => {
                  setScript(event.target.value);
                  setError('');
                }}
              />
              <p className="spark-mcp-note">
                Runs in a background thread with no access to this page. It can still reach the network, so only paste
                a script you trust.
              </p>
            </>
          )}

          {error && (
            <p className="spark-custom-app-card__error" role="alert">
              {error}
            </p>
          )}

          <div className="spark-mcp-catalog__actions spark-mcp-add__actions">
            <button type="submit" className="spark-mcp-catalog__action is-primary">
              Add server
            </button>
            <button type="button" className="spark-mcp-catalog__action" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="spark-mcp-catalog__action is-primary spark-mcp-add__open" onClick={() => setAdding(true)}>
          Add an MCP server
        </button>
      )}
    </section>
  );
};
