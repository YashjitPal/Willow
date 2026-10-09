/**
 * How a bot asks the user's leave, and what became of it, in one shape for every kind of ask — their screen, a
 * command, an email or a post, a change to their files, its own computer, a hand at it: a glyph for what it is about,
 * the ask in a sentence, the bot's reason set apart as its own words, what it would do, and the choice, the go-ahead
 * filled. A card waiting on the user wears a wash of the bot's colour and arrives softly; once settled it goes quiet.
 */
import type { ReactNode } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { M3_SCOPE } from '../m3/m3';
import './DotAskCard.css';

/** `ask`: waiting on the user. `busy`: under way. `live`: in force now. Then `done`, `off` (declined, withdrawn), `error`. */
export type DotAskTone = 'ask' | 'busy' | 'live' | 'done' | 'off' | 'error';

export interface DotAskCardProps {
  /** What it asks about, for `data-card`. */
  kind: string;
  tone: DotAskTone;
  /** The glyph in the tile; a spinner takes its place while the card is `busy`. */
  icon: ReactNode;
  /** A word or two over the title: what kind of ask this is. */
  kicker?: string;
  title: ReactNode;
  label: string;
  /** Why, in the bot's own words. */
  reason?: string;
  /** At the end of the heading: a time, a button. */
  aside?: ReactNode;
  children?: ReactNode;
  /** The choice, or what is left to do. */
  footer?: ReactNode;
}

export function DotAskCard({ kind, tone, icon, kicker, title, label, reason, aside, children, footer }: DotAskCardProps) {
  return (
    <article className={`dot-ask is-${tone} ${M3_SCOPE}`} data-card={kind} aria-label={label} aria-busy={tone === 'busy' ? 'true' : undefined}>
      <div className="dot-ask__head">
        <span className="dot-ask__glyph" aria-hidden="true">
          {tone === 'busy' ? <md-circular-progress indeterminate /> : icon}
        </span>
        <div className="dot-ask__heading">
          {kicker && <span className="dot-ask__kicker">{kicker}</span>}
          <span className="dot-ask__title">{title}</span>
        </div>
        {aside}
      </div>
      {reason && <p className="dot-ask__reason">{reason}</p>}
      {children}
      {footer && <div className="dot-ask__footer">{footer}</div>}
    </article>
  );
}

/** What the go-ahead lets the bot do, each with its glyph. */
export function DotAskFacts({ facts }: { facts: { icon: string; text: ReactNode }[] }) {
  return (
    <ul className="dot-ask__facts">
      {facts.map((fact, index) => (
        <li key={index} className="dot-ask__fact">
          <MaterialSymbol name={fact.icon} size={18} opticalSize={20} weight={350} className="dot-ask__fact-icon" />
          <span>{fact.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A line of where or how: a folder, a page. */
export function DotAskMeta({ icon, title, children }: { icon: string; title?: string; children: ReactNode }) {
  return (
    <p className="dot-ask__meta" title={title}>
      <MaterialSymbol name={icon} size={16} opticalSize={20} weight={350} />
      <span>{children}</span>
    </p>
  );
}

export function DotAskNote({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return <p className={`dot-ask__note${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>{children}</p>;
}

/** "Always allow …" beside the choice: going ahead with it ticked lets the bot do the same again without asking. */
export function DotAskAlways({ checked, onChange, action, children }: { checked: boolean; onChange: (checked: boolean) => void; action: string; children: ReactNode }) {
  return (
    <label className="dot-ask__always">
      <input type="checkbox" data-action={action} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
