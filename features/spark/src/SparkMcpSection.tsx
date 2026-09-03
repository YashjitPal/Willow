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
 * callout sits above the form rather than below it.
 */

import React from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  connectMcpServer,
  mcpRuntime,
  mcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  suggestMcpServerId,
  upsertMcpServer,
  type McpServerKind,
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

export const SparkMcpSection: React.FC = () => {
  const servers = useStore(mcpServers);
  const runtime = useStore(mcpRuntime);

  const [adding, setAdding] = React.useState(false);
  const [kind, setKind] = React.useState<McpServerKind>('http');
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [token, setToken] = React.useState('');
  const [script, setScript] = React.useState('');
  const [error, setError] = React.useState('');

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
    } else if (!script.trim()) {
      setError('Paste the server script.');
      return;
    }

    upsertMcpServer({
      id: suggestMcpServerId(label),
      label,
      kind,
      url: kind === 'http' ? url.trim() : undefined,
      headers:
        kind === 'http' && token.trim() ? { authorization: `Bearer ${token.trim()}` } : undefined,
      script: kind === 'worker' ? script : undefined,
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
        <h2 id="spark-apps-mcp-heading">MCP servers</h2>
      </header>

      {/* The limits, before the form. See the note at the top of this file. */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: 16,
          marginBottom: 16,
          borderRadius: 16,
          border: '1px solid rgba(255, 193, 7, 0.25)',
          background: 'rgba(255, 193, 7, 0.07)',
        }}
      >
        <span aria-hidden="true" style={{ color: '#ffcb45', flexShrink: 0, marginTop: 1 }}>
          <MaterialSymbol family="luminous" name="warning" size={20} weight={320} roundness={100} />
        </span>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: '#c4c7c5' }}>
          <strong style={{ display: 'block', color: '#ffdd8a', marginBottom: 6 }}>
            Most MCP servers will not work here, and it is worth knowing why first
          </strong>
          <p style={{ margin: '0 0 8px' }}>
            Willow runs in a browser tab. Most MCP servers — including the popular
            filesystem, git, database and browser-automation ones — are programs that a
            desktop app starts on your computer. A web page is not allowed to start a
            program, so those cannot be reached from here at all.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: '#e3e3e3' }}>Servers at a web address</strong> work only
            if their owner has allowed requests from web pages. Many have not — if one
            refuses to connect, that is a setting at their end and there is nothing you can
            change here to fix it.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: '#e3e3e3' }}>Servers written in JavaScript</strong> run
            inside this tab with nothing to install, as long as they need nothing from your
            operating system.
          </p>
          <p style={{ margin: 0, color: '#9a9b9c' }}>
            The rest need a small companion app on your computer. That is not built yet;
            it is written up in <code>HELPER-APP.md</code> at the top of the repo.
          </p>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="spark-custom-app-empty">
          <span className="spark-custom-app-empty__icon" aria-hidden="true">
            <MaterialSymbol family="luminous" name="extension" size={28} weight={320} roundness={100} />
          </span>
          <span className="spark-custom-app-empty__copy">
            <strong>No MCP servers yet</strong>
            <span>Add one to give the Code tab&apos;s Agent extra tools.</span>
          </span>
        </div>
      ) : (
        <div className="spark-custom-app-list">
          {servers.map((server) => {
            const status = runtime[server.id]?.status ?? { state: 'idle' as const };

            return (
              <article key={server.id} className="spark-custom-app-row">
                <span className="spark-custom-app-row__icon" aria-hidden="true">
                  <MaterialSymbol
                    family="luminous"
                    name={server.kind === 'http' ? 'public' : 'code'}
                    size={22}
                    weight={320}
                    roundness={100}
                  />
                </span>
                <span className="spark-custom-app-row__copy">
                  <strong>{server.label}</strong>
                  <span>{server.kind === 'http' ? server.url : 'Runs in this tab'}</span>

                  {/*
                    * Status, and when it failed, the reason in full.
                    *
                    * The browser reports a CORS refusal, a wrong address and an
                    * offline host identically, so `McpError` exists to turn one
                    * opaque failure into a sentence someone can act on.
                    */}
                  <span className="spark-custom-app-row__status">
                    {status.state === 'connecting' && 'Connecting…'}
                    {status.state === 'ready' &&
                      `${status.toolCount} tool${status.toolCount === 1 ? '' : 's'} available` +
                        (status.serverName ? ` · ${status.serverName}` : '')}
                    {status.state === 'idle' && (server.enabled ? 'Not connected' : 'Saved · Off')}
                    {status.state === 'failed' && 'Could not connect'}
                  </span>

                  {status.state === 'failed' && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: 6,
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255, 76, 69, 0.2)',
                        background: 'rgba(255, 76, 69, 0.07)',
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: '#ffb4b0',
                      }}
                    >
                      {status.message}
                      {status.detail && (
                        <span
                          style={{
                            display: 'block',
                            marginTop: 4,
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 11,
                            color: '#9a9b9c',
                            wordBreak: 'break-all',
                          }}
                        >
                          {status.detail}
                        </span>
                      )}
                    </span>
                  )}
                </span>

                {server.enabled && (
                  <button
                    type="button"
                    className="spark-custom-app-row__remove"
                    aria-label={`Reconnect ${server.label}`}
                    title="Reconnect"
                    onClick={() => void connectMcpServer(server.id)}
                  >
                    <MaterialSymbol family="luminous" name="refresh" size={20} weight={320} roundness={100} />
                  </button>
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
            );
          })}
        </div>
      )}

      {adding ? (
        <form className="spark-custom-app-card" onSubmit={submit}>
          <label htmlFor="spark-mcp-name">Add an MCP server</label>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(
              [
                ['http', 'At a web address', 'public'],
                ['worker', 'JavaScript, in this tab', 'code'],
              ] as const
            ).map(([value, text, icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 12,
                  fontSize: 13,
                  cursor: 'pointer',
                  color: kind === value ? '#e3e3e3' : '#9a9b9c',
                  background: kind === value ? 'rgba(227, 227, 227, 0.08)' : 'transparent',
                  border: `1px solid ${kind === value ? 'rgba(255,255,255,0.2)' : '#171717'}`,
                }}
              >
                <MaterialSymbol family="luminous" name={icon} size={18} weight={320} roundness={100} />
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

          {kind === 'http' ? (
            <>
              <div className="spark-custom-app-card__row" style={{ marginTop: 8 }}>
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
              <div className="spark-custom-app-card__row" style={{ marginTop: 8 }}>
                <input
                  type="password"
                  aria-label="Access token, optional"
                  placeholder="Access token (only if required)"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9a9b9c' }}>
                The server&apos;s MCP endpoint, not its home page or documentation.
              </p>
            </>
          ) : (
            <>
              <textarea
                aria-label="Server script"
                placeholder="JavaScript module that answers MCP messages"
                rows={7}
                value={script}
                onChange={(event) => {
                  setScript(event.target.value);
                  setError('');
                }}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid #171717',
                  background: '#1e1f20',
                  color: '#e3e3e3',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 12,
                  resize: 'vertical',
                }}
              />
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9a9b9c' }}>
                Runs in a background thread with no access to this page. It can still reach
                the network, so only paste a script you trust.
              </p>
            </>
          )}

          {error && (
            <p className="spark-custom-app-card__error" role="alert">
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit">Add server</button>
            <button
              type="button"
              onClick={reset}
              style={{ background: 'transparent', color: '#9a9b9c' }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="spark-custom-app-card">
          <button type="button" onClick={() => setAdding(true)}>
            Add an MCP server
          </button>
        </div>
      )}
    </section>
  );
};
