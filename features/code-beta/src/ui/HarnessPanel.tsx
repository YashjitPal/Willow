import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Package, ShieldOff } from 'lucide-react';
import { Badge, Button, IconButton, Tooltip, cn, useCopy } from './primitives';
import { getHarnessProfile } from '../harness/overlay/profile';
import { OverlayAnchorError } from '../harness/overlay/prompt-overlay';
import { DENIED_TOOLS } from '../harness/overlay/tool-policy';
import { UPSTREAM } from '../harness/upstream-assets';

/**
 * A window into the harness itself.
 *
 * Code Beta's whole premise is "upstream Codex, plus a declared overlay". That
 * claim is only checkable if you can see which upstream commit is pinned, which
 * overlay operations applied, and what prompt actually went to the model — so
 * this panel shows all three. It is also the first place to look after an
 * upstream bump: a missing anchor surfaces here as a readable error rather than
 * as strange model behaviour three turns later.
 */
export function HarnessPanel() {
  const [tab, setTab] = useState<'overview' | 'prompt'>('overview');

  const result = useMemo(() => {
    try {
      return { profile: getHarnessProfile(), error: null as Error | null };
    } catch (error) {
      return { profile: null, error: error as Error };
    }
  }, []);

  if (result.error) return <AnchorFailure error={result.error} />;

  const profile = result.profile!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[hsl(var(--cb-line))] px-3">
        <h2 className="text-xs font-medium text-[hsl(var(--cb-ink))]">Harness</h2>
        <div className="flex items-center gap-0.5 rounded-lg bg-[hsl(var(--cb-ink)/0.05)] p-0.5">
          {(['overview', 'prompt'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              aria-pressed={tab === entry}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition-colors duration-150',
                tab === entry
                  ? 'bg-[hsl(var(--cb-surface))] text-[hsl(var(--cb-ink))]'
                  : 'text-[hsl(var(--cb-ink-faint))] hover:text-[hsl(var(--cb-ink))]',
              )}
            >
              {entry}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Badge tone="outline">{profile.upstream.ref}</Badge>
      </header>

      <div className="cb-scroll min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' ? <Overview profile={profile} /> : <PromptView prompt={profile.systemPrompt} />}
      </div>
    </div>
  );
}

function Overview({ profile }: { profile: ReturnType<typeof getHarnessProfile> }) {
  const manifest = UPSTREAM.manifest;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <section>
        <SectionTitle>Upstream</SectionTitle>
        <div className="rounded-lg border border-[hsl(var(--cb-line))] bg-[hsl(var(--cb-surface))] p-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--cb-ink)/0.06)]">
              <Package size={15} className="text-[hsl(var(--cb-ink-faint))]" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[hsl(var(--cb-ink))]">openai/codex</p>
              <p className="mt-0.5 text-[11px] text-[hsl(var(--cb-ink-faint))]">
                {manifest.ref} · {manifest.commit.slice(0, 12)} · {manifest.license}
              </p>
              <p className="mt-0.5 text-[11px] text-[hsl(var(--cb-ink-ghost))]">
                Vendored {new Date(manifest.fetchedAt).toLocaleDateString()}. Run{' '}
                <code className="font-mono">npm run codex:check</code> to compare against the
                latest release.
              </p>
            </div>
            <a
              href={manifest.repository}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-[hsl(var(--cb-ink-ghost))] transition-colors hover:text-[hsl(var(--cb-ink))]"
              aria-label="Open the upstream repository"
            >
              <ExternalLink size={13} />
            </a>
          </div>

          <ul className="mt-3 space-y-1 border-t border-[hsl(var(--cb-line-subtle))] pt-2.5">
            {manifest.files.map((file) => (
              <li key={file.local} className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono text-[hsl(var(--cb-ink-muted))]">{file.local}</span>
                <span className="min-w-0 flex-1 truncate text-[hsl(var(--cb-ink-ghost))]">{file.role}</span>
                <span className="cb-tabular shrink-0 text-[hsl(var(--cb-ink-ghost))]">{file.bytes} B</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <SectionTitle>Overlay</SectionTitle>
        <p className="mb-2 text-[11px] leading-relaxed text-[hsl(var(--cb-ink-faint))]">
          Operations applied to the vendored prompt. Upstream files are never edited;
          everything Willow changes is declared in{' '}
          <code className="font-mono">overlay/prompt-overlay.ts</code>.
        </p>
        <ul className="space-y-1">
          {profile.overlay.applied.map((entry) => {
            const [verb, ...rest] = entry.split(/\s+/);
            return (
              <li
                key={entry}
                className="flex items-baseline gap-2 rounded-md bg-[hsl(var(--cb-surface))] px-2.5 py-1.5 text-[11px]"
              >
                <Badge tone={verb === 'drop' ? 'negative' : verb === 'append' ? 'positive' : 'warning'}>
                  {verb}
                </Badge>
                <span className="text-[hsl(var(--cb-ink-muted))]">{rest.join(' ')}</span>
              </li>
            );
          })}
          {profile.overlay.skipped.map((entry) => (
            <li
              key={`skipped-${entry}`}
              className="flex items-baseline gap-2 rounded-md bg-[hsl(var(--cb-surface))] px-2.5 py-1.5 text-[11px]"
            >
              <Badge tone="neutral">skipped</Badge>
              <span className="text-[hsl(var(--cb-ink-ghost))]">
                {entry} — optional anchor not present upstream
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>Tools</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {profile.tools.map((tool) => (
            <Badge key={tool} tone="accent">
              <code className="font-mono">{tool}</code>
            </Badge>
          ))}
        </div>

        <div
          className={cn(
            'mt-3 rounded-lg border border-[hsl(var(--cb-line))] bg-[hsl(var(--cb-surface))] p-3',
          )}
        >
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--cb-ink-muted))]">
            <ShieldOff size={12} className="text-[hsl(var(--cb-ink-faint))]" />
            Refused, by design
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-[hsl(var(--cb-ink-ghost))]">
            Code Beta writes files and nothing else. These names return a specific
            refusal so the model can recover in the same turn rather than stalling.
          </p>
          <div className="flex flex-wrap gap-1">
            {DENIED_TOOLS.flatMap((denied) => denied.aliases).map((alias) => (
              <code
                key={alias}
                className="rounded bg-[hsl(var(--cb-ink)/0.06)] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--cb-ink-ghost))] line-through"
              >
                {alias}
              </code>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function PromptView({ prompt }: { prompt: string }) {
  const [copied, copy] = useCopy();

  return (
    <div className="relative">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[hsl(var(--cb-line-subtle))] bg-[hsl(var(--cb-surface)/0.95)] px-3 py-1.5 backdrop-blur-sm">
        <span className="cb-tabular text-[11px] text-[hsl(var(--cb-ink-ghost))]">
          {prompt.length.toLocaleString()} characters · sent as the system prompt on every turn
        </span>
        <Tooltip content={copied ? 'Copied' : 'Copy prompt'}>
          <IconButton size="xs" label="Copy prompt" onClick={() => copy(prompt)}>
            {copied ? <Check size={12} className="text-[hsl(var(--cb-positive))]" /> : <Copy size={12} />}
          </IconButton>
        </Tooltip>
      </div>
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-[1.65] text-[hsl(var(--cb-ink-muted))]">
        {prompt}
      </pre>
    </div>
  );
}

/**
 * Shown when the overlay cannot find an anchor it requires.
 *
 * This is the intended failure mode after an upstream reorganisation, and it is
 * loud on purpose: the alternative is a prompt that silently tells the model it
 * has a shell.
 */
function AnchorFailure({ error }: { error: Error }) {
  const missing = error instanceof OverlayAnchorError ? error.missing : [];

  return (
    <div className="cb-scroll h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl rounded-lg border border-[hsl(var(--cb-negative)/0.35)] bg-[hsl(var(--cb-negative-soft)/0.4)] p-4">
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--cb-negative))]">
          <AlertTriangle size={13} />
          Harness overlay failed
        </p>

        {missing.length > 0 && (
          <ul className="mb-3 space-y-1">
            {missing.map((entry) => (
              <li key={entry} className="font-mono text-[11px] text-[hsl(var(--cb-ink))]">
                {entry}
              </li>
            ))}
          </ul>
        )}

        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-[hsl(var(--cb-ink-muted))]">
          {error.message}
        </pre>

        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.open('https://github.com/openai/codex', '_blank', 'noopener')}
          >
            Open upstream
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--cb-ink-ghost))]">
      {children}
    </h3>
  );
}
