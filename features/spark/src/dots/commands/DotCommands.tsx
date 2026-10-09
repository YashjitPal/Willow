import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { approveDotCommand, declineDotCommand, stopDotJob } from '../harness/dot-runtime';
import type { DotItem, DotThread } from '../harness/thread/thread-types';
import { commandFolder, commandGroups, commandReport, commandState, type CommandState } from './dot-commands';
import '../DotConversation.css';
import './DotCommands.css';

const HEADINGS: Record<CommandState, (name: string, background: boolean) => string> = {
  pending: (name, background) => (background ? `${name} wants to start a background job` : `${name} wants to run a command`),
  running: () => 'Running',
  background: () => 'Running in the background',
  done: (_name, background) => (background ? 'Ended' : 'Ran'),
  failed: (_name, background) => (background ? 'Ended with a problem' : 'Ran with a problem'),
  declined: () => 'You declined this',
  withdrawn: () => 'Withdrawn',
};

const timeLabel = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * A command on the user's computer: what, where and why, with Approve and Deny until answered, then how it went.
 * The chat shows it while it waits for the user; Activity keeps it after.
 */
export function DotCommandCard({ dotId, name, item, thread, showTime = false }: { dotId: string; name: string; item: DotItem; thread: DotThread; showTime?: boolean }) {
  const [isOutputOpen, setOutputOpen] = useState(false);
  const request = item.approval!;
  const background = Boolean(request.background);
  const state = commandState(thread, item);
  const report = commandReport(thread, item);

  return (
    <article className={`spark-dots-approval is-${state}`} aria-label={HEADINGS[state](name, background)}>
      <div className="spark-dots-approval__heading">
        {state === 'running' || state === 'background' ? (
          <MaterialSymbol family="luminous" weight={320} roundness={100} name="progress_activity" size={18} opticalSize={18} className="spark-dots-approval__spinner" />
        ) : (
          // The Luminous subset has no `terminal` glyph; the full Material Symbols family does.
          <MaterialSymbol family="material-rounded" name="terminal" size={18} opticalSize={20} weight={320} />
        )}
        <span>{HEADINGS[state](name, background)}</span>
        {showTime && <time className="dot-commands__time" dateTime={new Date(item.at).toISOString()}>{timeLabel(item.at)}</time>}
        {state === 'background' && (
          <button type="button" className="spark-dots-approval__toggle spark-dots-approval__stop" onClick={() => void stopDotJob(dotId, item.id)}>
            Stop
          </button>
        )}
      </div>
      <p className="spark-dots-approval__reason">{request.reason}</p>
      <pre className="spark-dots-approval__command"><code>{request.command}</code></pre>
      <p className="spark-dots-approval__where" title={request.root}>
        In {commandFolder(request)}
      </p>
      {state === 'pending' && (
        <div className="spark-dots-approval__actions">
          <button type="button" className="spark-dots-approval__deny" onClick={() => declineDotCommand(dotId, item.id)}>
            Deny
          </button>
          {request.prefix && (
            <button type="button" className="spark-dots-approval__deny" data-action="approve-always" onClick={() => void approveDotCommand(dotId, item.id, true)}>
              Always allow <code>{request.prefix.join(' ')}</code>
            </button>
          )}
          <button type="button" className="spark-dots-approval__approve" onClick={() => void approveDotCommand(dotId, item.id)}>
            Approve
          </button>
        </div>
      )}
      {report && (
        <div className="spark-dots-approval__outcome">
          <span>{report.summary}</span>
          {report.details && (
            <button type="button" className="spark-dots-approval__toggle" aria-expanded={isOutputOpen ? 'true' : 'false'} onClick={() => setOutputOpen((open) => !open)}>
              {isOutputOpen ? 'Hide output' : 'Show output'}
            </button>
          )}
        </div>
      )}
      {report && isOutputOpen && report.details && <pre className="spark-dots-approval__output">{report.details}</pre>}
    </article>
  );
}

/** One Activity entry opened: every command of that stretch, in the order they ran. */
export function DotCommandsPage({ dotId, name, thread, groupKey }: { dotId: string; name: string; thread: DotThread | undefined; groupKey: string }) {
  const group = commandGroups(thread).find((candidate) => candidate.key === groupKey);
  if (!thread || !group) {
    return <p className="dot-commands__gone">These commands are no longer in the conversation.</p>;
  }
  return (
    <div className="dot-commands">
      {group.items.map((item) => (
        <DotCommandCard key={item.id} dotId={dotId} name={name} item={item} thread={thread} showTime />
      ))}
    </div>
  );
}
