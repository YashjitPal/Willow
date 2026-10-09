import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { setDotQuietHours, setDotResearch } from '../harness/dot-runtime';
import { quietHoursOf } from '../harness/runtime/proactive';
import type { DotThread } from '../harness/thread/thread-types';
import { M3Switch } from '../m3/M3Switch';
import { M3_SCOPE } from '../m3/m3';
import './DotPacing.css';

const clockLabel = (clock: string) => {
  const [hour, minute] = clock.split(':').map(Number);
  return new Date(2000, 0, 1, hour ?? 0, minute ?? 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/**
 * How the bot paces itself, in its profile: quiet hours (when it holds what can wait and notifications stay quiet)
 * and background research (quiet moments, up to twice a day, in which it looks for ways to help without acting).
 */
export function DotPacingRows({ dotId, name, thread }: { dotId: string; name: string; thread: DotThread | undefined }) {
  const [editing, setEditing] = useState(false);
  const quiet = quietHoursOf(thread?.runtime);
  const researching = !thread?.runtime.research?.off;

  return (
    <div className={`dot-pacing ${M3_SCOPE}`}>
      <div className="spark-dots-profile__row">
        <MaterialSymbol name="bedtime" size={20} opticalSize={20} weight={320} className="spark-dots-profile__row-icon" />
        <span className="spark-dots-profile__row-copy">
          <span>Quiet hours</span>
          <button type="button" className="dot-pacing__times-button" disabled={quiet.off} aria-expanded={editing} onClick={() => setEditing((open) => !open)}>
            {quiet.off ? 'Off' : `${clockLabel(quiet.from)} – ${clockLabel(quiet.to)}`}
          </button>
        </span>
        <M3Switch selected={!quiet.off} label="Quiet hours" onToggle={(on) => setDotQuietHours(dotId, { ...quiet, off: !on })} />
      </div>
      {editing && !quiet.off && (
        <div className="dot-pacing__times">
          <label>
            <span>From</span>
            <input type="time" value={quiet.from} onChange={(event) => event.target.value && setDotQuietHours(dotId, { ...quiet, from: event.target.value })} />
          </label>
          <label>
            <span>Until</span>
            <input type="time" value={quiet.to} onChange={(event) => event.target.value && setDotQuietHours(dotId, { ...quiet, to: event.target.value })} />
          </label>
        </div>
      )}
      <div className="spark-dots-profile__row">
        <MaterialSymbol name="travel_explore" size={20} opticalSize={20} weight={320} className="spark-dots-profile__row-icon" />
        <span className="spark-dots-profile__row-copy">Background research</span>
        <M3Switch selected={researching} label="Background research" onToggle={(on) => setDotResearch(dotId, on)} />
      </div>
      <p className="spark-dots-profile__muted spark-dots-profile__note dot-pacing__note">
        {researching
          ? `Every few hours, when you're not busy, ${name} looks through what it can reach for ways to help, and plans work worth doing. Anything that acts for you still waits for your go-ahead.`
          : `${name} looks for ways to help only when you ask, or when something it watches for happens.`}
      </p>
    </div>
  );
}
