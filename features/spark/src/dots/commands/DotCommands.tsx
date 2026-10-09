import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DotAskAlways, DotAskCard, DotAskMeta, type DotAskTone } from '../ask/DotAskCard';
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

const TONES: Record<CommandState, DotAskTone> = { pending: 'ask', running: 'busy', background: 'busy', done: 'done', failed: 'error', declined: 'off', withdrawn: 'off' };
const GLYPHS: Record<CommandState, string> = { pending: 'terminal', running: 'terminal', background: 'terminal', done: 'check_circle', failed: 'error', declined: 'block', withdrawn: 'undo' };

/**
 * A command on the user's computer: what, where and why, with Run and Don't run until answered, then how it went.
 * The chat shows it while it waits for the user; Activity keeps it after.
 */
export function DotCommandCard({ dotId, name, item, thread, showTime = false }: { dotId: string; name: string; item: DotItem; thread: DotThread; showTime?: boolean }) {
  const [isOutputOpen, setOutputOpen] = useState(false);
  const [always, setAlways] = useState(false);
  const request = item.approval!;
  const background = Boolean(request.background);
  const state = commandState(thread, item);
  const report = commandReport(thread, item);
  const heading = HEADINGS[state](name, background);

  return (
    <DotAskCard
      kind="command"
      tone={TONES[state]}
      // The Luminous subset has no `terminal` glyph; the full Material Symbols family does.
      icon={<MaterialSymbol family="material-rounded" name={GLYPHS[state]} size={22} opticalSize={24} weight={350} />}
      kicker={background ? 'Background job' : 'Command'}
      title={heading}
      label={heading}
      reason={request.reason}
      aside={
        <>
          {showTime && <time className="dot-ask__time" dateTime={new Date(item.at).toISOString()}>{timeLabel(item.at)}</time>}
          {state === 'background' && (
            <button type="button" className="dot-ask__chip is-stop" data-action="job-stop" onClick={() => void stopDotJob(dotId, item.id)}>
              Stop
            </button>
          )}
        </>
      }
      footer={
        state === 'pending' ? (
          <>
            {request.prefix && (
              <DotAskAlways action="approve-always" checked={always} onChange={setAlways}>
                Always allow <code>{request.prefix.join(' ')}</code>
              </DotAskAlways>
            )}
            <md-text-button data-action="command-deny" onClick={() => declineDotCommand(dotId, item.id)}>
              {background ? 'Don’t start' : 'Don’t run'}
            </md-text-button>
            <md-filled-button data-action="command-approve" onClick={() => void approveDotCommand(dotId, item.id, always)}>
              {background ? 'Start' : 'Run'}
            </md-filled-button>
          </>
        ) : undefined
      }
    >
      <pre className="dot-ask__code"><code>{request.command}</code></pre>
      <DotAskMeta icon="folder" title={request.root}>
        In {commandFolder(request)}
      </DotAskMeta>
      {report && (
        <div className="dot-ask__outcome">
          <span>{report.summary}</span>
          {report.details && (
            <button type="button" className="dot-ask__chip" aria-expanded={isOutputOpen ? 'true' : 'false'} onClick={() => setOutputOpen((open) => !open)}>
              {isOutputOpen ? 'Hide output' : 'Show output'}
            </button>
          )}
        </div>
      )}
      {report && isOutputOpen && report.details && <pre className="dot-ask__output">{report.details}</pre>}
    </DotAskCard>
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
