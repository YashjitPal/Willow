import { useStore } from '@nanostores/react';
import { skillLibrary } from '@willow/core/skill-library';
import { CONNECTORS, connectionsStore } from '@willow/personal';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { goToSparkApps, goToSparkSkills } from '../../spark-store';
import { stopDotEmailingWithoutAsking } from '../harness/dot-runtime';
import type { DotSendPermission } from '../harness/thread/thread-types';
import '../m3/m3';

/**
 * The profile's "Skills and apps": what the bot works with — the user's skills, which it reads with `use_skill`
 * when work fits them, and the apps connected to Willow, whose tools it has — each opening the Spark page that
 * manages it.
 */
export function DotSkillsAndAppsSection({ dotId, name, sendTo }: { dotId: string; name: string; sendTo?: DotSendPermission[] }) {
  const skills = useStore(skillLibrary).filter((skill) => skill.enabled);
  const { enabled } = useStore(connectionsStore);
  const apps = CONNECTORS.filter((connector) => enabled.includes(connector.id));

  return (
    <section className="spark-task-detail__progress-panel-section">
      <div className="spark-task-detail__progress-panel-header is-static">
        <span className="spark-task-detail__progress-panel-title-wrapper">
          <span className="spark-task-detail__progress-panel-title">Skills and apps</span>
        </span>
      </div>
      <div className="spark-task-detail__progress-panel-content">
        <button type="button" className="spark-dots-profile__activity spark-dots-profile__activity--link" onClick={goToSparkSkills}>
          <MaterialSymbol family="luminous" name="contract" size={20} opticalSize={20} weight={320} roundness={100} className="spark-dots-profile__row-icon" />
          <span className="spark-dots-profile__activity-title" title={skills.map((skill) => skill.name).join(', ')}>
            {skills.length ? skills.slice(0, 3).map((skill) => skill.name).join(', ') : 'Skills'}
          </span>
          <span className="spark-dots-profile__muted">{skills.length ? `${skills.length} on` : 'None yet'}</span>
        </button>
        <button type="button" className="spark-dots-profile__activity spark-dots-profile__activity--link" onClick={goToSparkApps}>
          <MaterialSymbol name="apps" size={20} opticalSize={20} weight={320} className="spark-dots-profile__row-icon" />
          <span className="spark-dots-profile__activity-title" title={apps.map((app) => app.label).join(', ')}>
            {apps.length ? apps.map((app) => app.label).join(', ') : 'Connected apps'}
          </span>
          <span className="spark-dots-profile__muted">{apps.length ? `${apps.length} connected` : 'None connected'}</span>
        </button>
        {sendTo?.map((entry) => (
          <div key={entry.address} className="spark-dots-profile__activity">
            <MaterialSymbol name="forward_to_inbox" size={20} opticalSize={20} weight={320} className="spark-dots-profile__row-icon" />
            <span className="spark-dots-profile__activity-title">{entry.address}</span>
            <span className="spark-dots-profile__muted">Emails without asking</span>
            <md-icon-button aria-label={`Ask before emailing ${entry.address}`} data-action="email-revoke" onClick={() => stopDotEmailingWithoutAsking(dotId, entry.address)}>
              <MaterialSymbol name="close" size={18} opticalSize={20} weight={350} />
            </md-icon-button>
          </div>
        ))}
        <p className="spark-dots-profile__muted spark-dots-profile__note">
          {name} uses your skills when work fits them and can read your connected apps, acting on them only with your go-ahead.
        </p>
      </div>
    </section>
  );
}
