/**
 * The MCP servers connector panel.
 *
 * Lives in its own file rather than inside `ConnectorsTab.tsx` because that
 * file is already 29 KB of six connectors, and this one carries a form, a
 * status list and per-server error reporting. `ConnectorsTab` adds a card and a
 * branch; everything else is here.
 *
 * ## The callout is the most important thing on this screen
 *
 * Most of what people mean by "an MCP server" cannot work in a browser. The
 * popular ones — filesystem, git, sqlite, puppeteer — are npm and Python
 * packages that a client starts as a subprocess, and a web page cannot start a
 * process. That is not a gap to be closed later with more code; it is the
 * boundary the browser exists to enforce.
 *
 * So the panel opens by saying so, before the "Add server" button. A user who
 * reads it once will not spend an afternoon on a URL that was never going to
 * work, and that afternoon is the entire cost of getting this wrong.
 */

import React from 'react';
import { useStore } from '@nanostores/react';
import {
  AlertTriangle,
  ChevronLeft,
  Globe,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Check,
  Code2,
} from 'lucide-react';
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
} from '@willow/ai/mcp/mcp-store';

interface McpConnectorProps {
  onBack: () => void;
}

export const McpConnector: React.FC<McpConnectorProps> = ({ onBack }) => {
  const servers = useStore(mcpServers);
  const runtime = useStore(mcpRuntime);

  const [adding, setAdding] = React.useState(false);
  const [kind, setKind] = React.useState<McpServerKind>('http');
  const [label, setLabel] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [token, setToken] = React.useState('');
  const [script, setScript] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  /*
   * Connect anything enabled but idle when the panel opens.
   *
   * After a reload the config is restored from storage but nothing is
   * connected, so without this the panel would show "Not connected" against
   * every server the user had switched on and offer no explanation. Only `idle`
   * servers are touched, so opening the panel never re-runs a live connection
   * or retries one that already failed — a failure keeps its message until the
   * user asks again.
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
    setLabel('');
    setUrl('');
    setToken('');
    setScript('');
    setFormError(null);
  };

  const submit = async (): Promise<void> => {
    const name = label.trim();
    if (!name) {
      setFormError('Give the server a name.');
      return;
    }

    if (kind === 'http') {
      const address = url.trim();
      if (!address) {
        setFormError('Enter the server address.');
        return;
      }
      // Checked here rather than left to the connection attempt, because
      // "failed to fetch" would be a needlessly mysterious answer to a typo.
      let parsed: URL;
      try {
        parsed = new URL(address);
      } catch {
        setFormError('That is not a valid web address. It should start with https://');
        return;
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        setFormError('The address must start with https:// or http://');
        return;
      }
    } else if (!script.trim()) {
      setFormError('Paste the server script.');
      return;
    }

    const config: McpServerConfig = {
      id: suggestMcpServerId(name),
      label: name,
      kind,
      url: kind === 'http' ? url.trim() : undefined,
      headers:
        kind === 'http' && token.trim() ? { authorization: `Bearer ${token.trim()}` } : undefined,
      script: kind === 'worker' ? script : undefined,
      // Off on arrival. Turning a server on is a separate, deliberate act —
      // see the approval note in `mcp-store.ts`.
      enabled: false,
    };

    upsertMcpServer(config);
    reset();
  };

  return (
    <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[13px] text-zinc-400 hover:text-white transition-colors mb-8"
      >
        <ChevronLeft size={16} />
        <span>Connectors</span>
      </button>

      <div className="flex items-center gap-4 mb-2">
        <Plug size={22} className="text-white" />
        <h1 className="text-[24px] font-bold text-white">MCP servers</h1>
      </div>
      <p className="text-[14px] text-zinc-400 mb-8 max-w-2xl">
        Connect an MCP server to give the Code tab&apos;s Agent extra tools.
      </p>

      {/*
        * The callout. Deliberately before the button.
        *
        * Amber rather than red: nothing is broken and nothing is dangerous —
        * the user is about to hit a limit that is not their fault and cannot be
        * configured away, and they deserve to know before they try.
        */}
      <div className="mb-10 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="space-y-3 text-[13px] leading-relaxed text-zinc-300">
            <p className="text-[14px] font-bold text-amber-200">
              Most MCP servers will not work here, and it is worth knowing why first
            </p>
            <p>
              Willow runs in a browser tab. Most MCP servers — including the popular
              filesystem, git, sqlite and browser-automation ones — are programs that a
              desktop app starts on your computer. A web page is not allowed to start a
              program, so those cannot be reached from here at all.
            </p>
            <p className="font-medium text-zinc-200">Two kinds do work:</p>
            <ul className="space-y-1.5 pl-1">
              <li className="flex gap-2">
                <Globe size={14} className="mt-[3px] shrink-0 text-zinc-500" />
                <span>
                  <span className="font-medium text-zinc-200">Servers at a web address.</span>{' '}
                  These work only if the server&apos;s owner has allowed requests from web
                  pages. Many have not — if one refuses to connect, that is a setting at
                  their end and there is nothing you can change here to fix it.
                </span>
              </li>
              <li className="flex gap-2">
                <Code2 size={14} className="mt-[3px] shrink-0 text-zinc-500" />
                <span>
                  <span className="font-medium text-zinc-200">Servers written in JavaScript.</span>{' '}
                  These run inside this tab, with nothing to install. Only servers with no
                  need for your operating system will work — anything written in Python, or
                  that needs to run a command, will not.
                </span>
              </li>
            </ul>
            <p className="text-zinc-400">
              Support for the rest needs a small companion app running on your computer.
              That is not built yet; it is written up in{' '}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px] text-zinc-300">
                HELPER-APP.md
              </code>{' '}
              at the top of the repo.
            </p>
          </div>
        </div>
      </div>

      {/* Configured servers */}
      <div className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-white">Your servers</h2>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/10"
            >
              <Plus size={14} />
              Add server
            </button>
          )}
        </div>

        {servers.length === 0 && !adding && (
          <div className="rounded-xl border border-white/5 bg-[#272729] p-8 text-center">
            <p className="text-[13px] text-zinc-400">
              No servers yet. Add one to give the Agent extra tools.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {servers.map((server) => {
            const status = runtime[server.id]?.status ?? { state: 'idle' as const };

            return (
              <div
                key={server.id}
                className="rounded-xl border border-white/5 bg-[#272729] p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {server.kind === 'http' ? (
                      <Globe size={18} className="mt-0.5 shrink-0 text-zinc-400" />
                    ) : (
                      <Code2 size={18} className="mt-0.5 shrink-0 text-zinc-400" />
                    )}
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold text-white">{server.label}</div>
                      <div className="truncate text-[12px] text-zinc-500">
                        {server.kind === 'http' ? server.url : 'Runs in this tab'}
                      </div>

                      {/*
                        * Status, and when it failed, the reason in full.
                        *
                        * The message is the whole point of `McpError` — the
                        * browser reports a CORS refusal, a bad address and an
                        * offline server identically, so guessing would be
                        * worse than useless.
                        */}
                      <div className="mt-2 text-[12px]">
                        {status.state === 'connecting' && (
                          <span className="inline-flex items-center gap-1.5 text-zinc-400">
                            <Loader2 size={12} className="animate-spin" />
                            Connecting…
                          </span>
                        )}
                        {status.state === 'ready' && (
                          <span className="inline-flex items-center gap-1.5 text-emerald-400">
                            <Check size={12} />
                            {status.toolCount} tool{status.toolCount === 1 ? '' : 's'} available
                            {status.serverName ? ` · ${status.serverName}` : ''}
                          </span>
                        )}
                        {status.state === 'idle' && (
                          <span className="text-zinc-500">
                            {server.enabled ? 'Not connected' : 'Off'}
                          </span>
                        )}
                        {status.state === 'failed' && (
                          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.07] p-3">
                            <div className="flex items-start gap-2">
                              <AlertTriangle
                                size={13}
                                className="mt-0.5 shrink-0 text-red-400"
                              />
                              <div className="space-y-1">
                                <p className="text-[12px] leading-relaxed text-red-200">
                                  {status.message}
                                </p>
                                {status.detail && (
                                  <p className="break-all font-mono text-[11px] text-zinc-500">
                                    {status.detail}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {server.enabled && (
                      <button
                        onClick={() => void connectMcpServer(server.id)}
                        title="Reconnect"
                        className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => void removeMcpServer(server.id)}
                      title="Remove"
                      className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => void setMcpServerEnabled(server.id, !server.enabled)}
                      className={`relative h-5 w-9 rounded-full border border-white/5 p-0.5 transition-colors ${
                        server.enabled ? 'bg-emerald-500/80' : 'bg-zinc-800'
                      }`}
                      title={server.enabled ? 'Turn off' : 'Turn on'}
                    >
                      <div
                        className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          server.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="mb-12 rounded-xl border border-white/5 bg-[#272729] p-5">
          <h3 className="mb-4 text-[14px] font-bold text-white">Add a server</h3>

          <div className="mb-4 flex gap-2">
            {(
              [
                ['http', 'At a web address', Globe],
                ['worker', 'JavaScript, in this tab', Code2],
              ] as const
            ).map(([value, text, Icon]) => (
              <button
                key={value}
                onClick={() => setKind(value)}
                className={`flex flex-1 items-center gap-2 rounded-lg border p-3 text-[13px] transition-colors ${
                  kind === value
                    ? 'border-white/20 bg-white/10 text-white'
                    : 'border-white/5 bg-transparent text-zinc-400 hover:bg-white/5'
                }`}
              >
                <Icon size={15} />
                {text}
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-[13px] font-medium text-white">Name</label>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="My server"
            className="mb-4 w-full rounded-lg border border-white/5 bg-[#1e1e20] px-3 py-2 text-[13px] text-white outline-none placeholder:text-zinc-600 focus:border-white/20"
          />

          {kind === 'http' ? (
            <>
              <label className="mb-1.5 block text-[13px] font-medium text-white">
                Server address
              </label>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                className="mb-1.5 w-full rounded-lg border border-white/5 bg-[#1e1e20] px-3 py-2 font-mono text-[13px] text-white outline-none placeholder:text-zinc-600 focus:border-white/20"
              />
              <p className="mb-4 text-[12px] text-zinc-500">
                The server&apos;s MCP endpoint, not its home page or documentation.
              </p>

              <label className="mb-1.5 block text-[13px] font-medium text-white">
                Access token <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                type="password"
                placeholder="Only if the server requires one"
                className="mb-4 w-full rounded-lg border border-white/5 bg-[#1e1e20] px-3 py-2 text-[13px] text-white outline-none placeholder:text-zinc-600 focus:border-white/20"
              />
            </>
          ) : (
            <>
              <label className="mb-1.5 block text-[13px] font-medium text-white">
                Server script
              </label>
              <textarea
                value={script}
                onChange={(event) => setScript(event.target.value)}
                rows={8}
                placeholder="JavaScript module that answers MCP messages"
                className="mb-1.5 w-full resize-y rounded-lg border border-white/5 bg-[#1e1e20] px-3 py-2 font-mono text-[12px] text-white outline-none placeholder:text-zinc-600 focus:border-white/20"
              />
              <p className="mb-4 text-[12px] text-zinc-500">
                Runs in a background thread with no access to the page. It can still reach
                the network, so only paste a script you trust.
              </p>
            </>
          )}

          {formError && (
            <p className="mb-4 text-[12px] text-red-400">{formError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void submit()}
              className="rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-black transition-opacity hover:opacity-90"
            >
              Add server
            </button>
            <button
              onClick={reset}
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-zinc-400 transition-colors hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
