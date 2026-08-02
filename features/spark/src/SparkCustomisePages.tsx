import React, { useEffect, useId, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type {
  SparkConnectedAppId,
  SparkCustomApp,
  SparkSchedule,
  SparkSkill,
} from './spark-types';
import { formatSparkRelativeTime } from './spark-types';
import { useSparkNow } from './useSparkNow';
import './SparkCustomisePages.css';

const formatScheduleRunLabel = (schedule: SparkSchedule, now: number): string | undefined => {
  if (schedule.lastRunLabel === 'Running...' || schedule.lastRunLabel === 'Waiting for approval') {
    return schedule.lastRunLabel;
  }
  if (!schedule.lastRunAt) return schedule.lastRunLabel;
  const relativeTime = formatSparkRelativeTime(schedule.lastRunAt, now);
  if (schedule.lastRunLabel === 'Failed' || schedule.lastRunLabel === 'Skipped') {
    return `${schedule.lastRunLabel} \u00b7 ${relativeTime}`;
  }
  return `Last run ${relativeTime}`;
};

interface SparkToggleProps {
  checked: boolean;
  className?: string;
  label: string;
  onChange: () => void;
}

const SparkToggle: React.FC<SparkToggleProps> = ({ checked, className = '', label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`spark-app-toggle${checked ? ' spark-app-toggle--checked' : ''} ${className}`.trim()}
    onClick={onChange}
  >
    <span className="spark-app-toggle__thumb" />
  </button>
);

interface SparkPreferenceControlProps {
  appName: string;
  checked: boolean;
  className?: string;
  onChange: () => void;
}

const SparkPreferenceControl: React.FC<SparkPreferenceControlProps> = ({
  appName,
  checked,
  className = '',
  onChange,
}) => (
  <span className={`spark-preference-control ${className}`.trim()}>
    <span className="spark-preference-control__label">Use as context</span>
    <SparkToggle
      checked={checked}
      label={`${checked ? 'Stop using' : 'Use'} ${appName} as preference context`}
      onChange={onChange}
    />
  </span>
);

interface SparkRowActionMenuProps {
  deleteLabel: string;
  menuLabel: string;
  onDelete: () => void;
  onSecondaryAction?: () => void;
  secondaryIcon?: string;
  secondaryLabel?: string;
}

const SparkRowActionMenu: React.FC<SparkRowActionMenuProps> = ({
  deleteLabel,
  menuLabel,
  onDelete,
  onSecondaryAction,
  secondaryIcon,
  secondaryLabel,
}) => {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasSecondaryAction = Boolean(onSecondaryAction && secondaryIcon && secondaryLabel);
  const menuItemCount = hasSecondaryAction ? 2 : 1;

  useEffect(() => {
    if (!open) return;

    const focusFrame = window.requestAnimationFrame(() => menuItemRefs.current[0]?.focus());

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const handleMenuItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? menuItemCount - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % menuItemCount
          : (index - 1 + menuItemCount) % menuItemCount;
    menuItemRefs.current[nextIndex]?.focus();
  };

  return (
    <div ref={menuRef} className="spark-row-action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="spark-row-action-menu__trigger"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((visible) => !visible)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <MaterialSymbol family="luminous" name="more_horiz" size={20} weight={320} roundness={100} />
      </button>
      {open && (
        <div
          id={menuId}
          className="spark-row-action-menu__popover"
          role="menu"
          aria-label={menuLabel}
        >
          {hasSecondaryAction && (
            <button
              ref={(element) => { menuItemRefs.current[0] = element; }}
              type="button"
              role="menuitem"
              onKeyDown={(event) => handleMenuItemKeyDown(event, 0)}
              onClick={() => {
                setOpen(false);
                onSecondaryAction?.();
              }}
            >
              <MaterialSymbol
                family="luminous"
                name={secondaryIcon!}
                size={20}
                weight={320}
                roundness={100}
              />
              <span>{secondaryLabel}</span>
            </button>
          )}
          <button
            ref={(element) => { menuItemRefs.current[hasSecondaryAction ? 1 : 0] = element; }}
            type="button"
            role="menuitem"
            className="is-danger"
            onKeyDown={(event) => handleMenuItemKeyDown(event, hasSecondaryAction ? 1 : 0)}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <MaterialSymbol family="luminous" name="delete" size={20} weight={320} roundness={100} />
            <span>{deleteLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface SparkDeleteDialogProps {
  itemName: string;
  itemType: 'custom app' | 'schedule' | 'skill';
  onCancel: () => void;
  onConfirm: () => void;
}

const SparkDeleteDialog: React.FC<SparkDeleteDialogProps> = ({ itemName, itemType, onCancel, onConfirm }) => {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeys);
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, []);

  return (
    <div
      className="spark-customise-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="spark-customise-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={headingId}>Delete {itemType}?</h2>
        <p id={descriptionId}>&ldquo;{itemName}&rdquo; will be permanently removed.</p>
        <div className="spark-customise-delete-dialog__actions">
          <button type="button" autoFocus onClick={onCancel}>Cancel</button>
          <button type="button" className="is-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
};

interface SparkPageBaseProps {
  className?: string;
  onLearnMore?: () => void;
  onCreateWithGemini?: () => void;
  onCreateManually?: () => void;
}

interface SparkPageHeaderProps {
  description: string;
  headingId: string;
  onLearnMore?: () => void;
  title: string;
}

const SparkPageHeader: React.FC<SparkPageHeaderProps> = ({
  description,
  headingId,
  onLearnMore,
  title,
}) => (
  <header className="spark-customise-header">
    <h1 id={headingId}>{title}</h1>
    <p>
      {description}
      {onLearnMore && (
        <>
          {' '}
          <button type="button" className="spark-inline-link" onClick={onLearnMore}>
            Learn more
          </button>
        </>
      )}
    </p>
  </header>
);

interface SparkActionButtonProps {
  children: React.ReactNode;
  icon: string;
  onClick?: () => void;
  primary?: boolean;
}

const SparkActionButton: React.FC<SparkActionButtonProps> = ({
  children,
  icon,
  onClick,
  primary = false,
}) => (
  <button
    type="button"
    className={`spark-page-action${primary ? ' spark-page-action--primary' : ''}`}
    disabled={!onClick}
    onClick={onClick}
  >
    <MaterialSymbol
      family={icon.startsWith('edit_') ? 'material-rounded' : 'luminous'}
      name={icon}
      size={20}
      weight={330}
      roundness={100}
      opticalSize={20}
    />
    <span>{children}</span>
  </button>
);

export interface SchedulesPageProps extends SparkPageBaseProps {
  schedules: readonly SparkSchedule[];
  onDeleteSchedule: (scheduleId: string) => void;
  onOpenSchedule: (scheduleId: string) => void;
  onScheduleEnabledChange: (scheduleId: string, enabled: boolean) => void;
}

export const SchedulesPage: React.FC<SchedulesPageProps> = ({
  className = '',
  onCreateManually,
  onCreateWithGemini,
  onDeleteSchedule,
  onLearnMore,
  onOpenSchedule,
  onScheduleEnabledChange,
  schedules,
}) => {
  const headingId = useId();
  const ongoingHeadingId = useId();
  const now = useSparkNow();
  const [scheduleToDelete, setScheduleToDelete] = useState<SparkSchedule | null>(null);

  return (
    <main
      className={`spark-customise-page spark-customise-page--narrow ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <div className="spark-customise-page__narrow-inner">
        <SparkPageHeader
          headingId={headingId}
          title="Schedules"
          description="Get proactive help with tasks scheduled to run on repeat, respond to events or continuously monitor and react."
          onLearnMore={onLearnMore}
        />

        <div className="spark-page-actions" aria-label="Create a schedule">
          <SparkActionButton icon="edit_rectangle" primary onClick={onCreateWithGemini}>
            Create with Gemini
          </SparkActionButton>
          <SparkActionButton icon="edit_note" onClick={onCreateManually}>
            Create manually
          </SparkActionButton>
        </div>

        <section className="spark-schedules-section" aria-labelledby={ongoingHeadingId}>
          <h2 id={ongoingHeadingId}>Ongoing</h2>
          <div className="spark-schedule-list">
            {schedules.map((schedule) => {
              const runLabel = formatScheduleRunLabel(schedule, now);
              return (
                <div key={schedule.id} className="spark-schedule-row">
                  <button
                    type="button"
                    className="spark-schedule-card"
                    aria-label={`Open schedule: ${schedule.title}`}
                    onClick={() => onOpenSchedule(schedule.id)}
                  >
                    <span className="spark-schedule-card__icon" aria-hidden="true">
                      <MaterialSymbol
                        family="luminous"
                        name="chat_bubble"
                        size={24}
                        weight={330}
                        roundness={100}
                        opticalSize={24}
                      />
                    </span>
                    <span className="spark-schedule-card__copy">
                      <span className="spark-schedule-card__title">{schedule.title}</span>
                      <span className="spark-schedule-card__detail">
                        {schedule.frequency}{schedule.frequency === 'Weekly' && schedule.weekdays.length
                          ? ` on ${schedule.weekdays.join(', ')}`
                          : ''}{` around ${schedule.time}`}
                      </span>
                    </span>
                    {runLabel && <span className="spark-schedule-card__last-run">{runLabel}</span>}
                    {!schedule.enabled && <span className="spark-schedule-card__paused">Paused</span>}
                  </button>
                  <div className="spark-schedule-row__actions">
                    <SparkRowActionMenu
                      menuLabel={`Schedule options for ${schedule.title}`}
                      deleteLabel="Delete"
                      secondaryIcon={schedule.enabled ? 'pause_circle' : 'play_circle'}
                      secondaryLabel={schedule.enabled ? 'Pause' : 'Resume'}
                      onSecondaryAction={() => onScheduleEnabledChange(schedule.id, !schedule.enabled)}
                      onDelete={() => setScheduleToDelete(schedule)}
                    />
                  </div>
                </div>
              );
            })}
            {schedules.length === 0 && (
              <div className="spark-schedules-empty">
                <span className="spark-schedules-empty__icon" aria-hidden="true">
                  <MaterialSymbol family="luminous" name="schedule" size={28} weight={320} roundness={100} />
                </span>
                <span className="spark-schedules-empty__copy">
                  <strong>No ongoing schedules</strong>
                  <span>Create a schedule to run recurring Spark tasks automatically.</span>
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
      {scheduleToDelete && (
        <SparkDeleteDialog
          itemName={scheduleToDelete.title}
          itemType="schedule"
          onCancel={() => setScheduleToDelete(null)}
          onConfirm={() => {
            onDeleteSchedule(scheduleToDelete.id);
            setScheduleToDelete(null);
          }}
        />
      )}
    </main>
  );
};

interface RecommendedSkill {
  description: string;
  title: string;
}

const RECOMMENDED_SKILLS: readonly RecommendedSkill[] = [
  {
    title: 'Match your writing style',
    description: 'Learns your voice from your real writing across Workspace apps',
  },
  {
    title: 'Focus your energy',
    description: 'Align your workload with your energy instead of your calendar',
  },
  {
    title: 'Get more perspectives',
    description: 'Get 3\u20135 distinct viewpoints before you commit to a decision',
  },
  {
    title: 'Generate fresh ideas',
    description: 'Turn existing content into 5 entirely new creative concepts',
  },
  {
    title: 'Write clearer updates',
    description: 'Turn rough notes into concise, audience-ready project updates',
  },
  {
    title: 'Challenge your assumptions',
    description: 'Surface risks, counterarguments and missing evidence before you decide',
  },
  {
    title: 'Prepare for meetings',
    description: 'Create a focused brief with context, questions and desired outcomes',
  },
  {
    title: 'Turn feedback into action',
    description: 'Organise feedback into themes, priorities and concrete next steps',
  },
] as const;

export interface SkillsPageProps extends SparkPageBaseProps {
  skills: readonly SparkSkill[];
  onDeleteSkill: (skillId: string) => void;
  onOpenSkill: (skillId: string) => void;
  onRecommendedSkillSelect?: (title: string) => void;
  onUploadSkill?: (file: File) => Promise<void> | void;
}

export const SkillsPage: React.FC<SkillsPageProps> = ({
  className = '',
  onCreateManually,
  onCreateWithGemini,
  onDeleteSkill,
  onLearnMore,
  onOpenSkill,
  onRecommendedSkillSelect,
  onUploadSkill,
  skills,
}) => {
  const headingId = useId();
  const activeHeadingId = useId();
  const recommendedHeadingId = useId();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [skillToDelete, setSkillToDelete] = useState<SparkSkill | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const uploadInFlightRef = useRef(false);

  const selectUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || uploadInFlightRef.current) return;

    uploadInFlightRef.current = true;
    setIsUploading(true);
    setUploadError('');
    try {
      if (!onUploadSkill) throw new Error('Skill import is unavailable');
      await onUploadSkill(file);
    } catch {
      setUploadError(`Couldn't import ${file.name}`);
    } finally {
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
  };

  return (
    <main
      className={`spark-customise-page spark-customise-page--skills ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <div className="spark-customise-page__narrow-inner">
        <SparkPageHeader
          headingId={headingId}
          title="Skills"
          description="Create custom, reusable instructions for more helpful responses. Gemini uses relevant skills automatically, or you can apply them using /."
          onLearnMore={onLearnMore}
        />

        <div className="spark-page-actions spark-skills-actions" aria-label="Add a skill">
          <SparkActionButton icon="edit_rectangle" primary onClick={onCreateWithGemini}>
            Create with Gemini
          </SparkActionButton>
          <SparkActionButton icon="edit_note" onClick={onCreateManually}>
            Create manually
          </SparkActionButton>
          <button
            type="button"
            className="spark-page-action spark-page-action--icon-only"
            aria-label="Upload skill"
            aria-busy={isUploading}
            title={!onUploadSkill ? 'Skill upload is unavailable' : isUploading ? 'Importing skill' : 'Upload skill'}
            disabled={isUploading || !onUploadSkill}
            onClick={() => uploadInputRef.current?.click()}
          >
            <MaterialSymbol
              family="luminous"
              name={isUploading ? 'progress_activity' : 'upload'}
              size={24}
              weight={330}
              roundness={100}
              opticalSize={24}
            />
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".zip,.md,.txt"
            hidden
            disabled={isUploading || !onUploadSkill}
            onChange={selectUpload}
          />
        </div>
        {uploadError && (
          <p className="spark-skills-upload-error" role="alert">{uploadError}</p>
        )}
      </div>

      <section className="spark-skills-library" aria-labelledby={activeHeadingId}>
        <h2 id={activeHeadingId}>Active</h2>
        {skills.length === 0 ? (
          <div className="spark-skills-active-empty">
            <span className="spark-skills-active-empty__icon" aria-hidden="true">
              <MaterialSymbol
                family="luminous"
                name="extension"
                size={28}
                weight={320}
                roundness={100}
                opticalSize={28}
              />
            </span>
            <span className="spark-skills-active-empty__copy">
              <strong>No active skills</strong>
              <span>Create or upload a skill to reuse its instructions in Spark.</span>
            </span>
          </div>
        ) : (
          <div className="spark-skills-library__list">
            {skills.map((skill) => (
              <div key={skill.id} className="spark-skill-row">
                <button
                  type="button"
                  className="spark-skill-card"
                  onClick={() => onOpenSkill(skill.id)}
                >
                  <span className="spark-skill-card__icon" aria-hidden="true">
                    <MaterialSymbol family="luminous" name="extension" size={24} weight={320} roundness={100} />
                  </span>
                  <span className="spark-skill-card__copy">
                    <span className="spark-skill-card__title">{skill.name}</span>
                    <span className="spark-skill-card__description">
                      {skill.description || 'Custom reusable instructions'}
                    </span>
                  </span>
                  <MaterialSymbol family="luminous" name="chevron_right" size={24} weight={320} roundness={100} />
                </button>
                <div className="spark-skill-row__actions">
                  <SparkRowActionMenu
                    menuLabel={`Skill options for ${skill.name}`}
                    deleteLabel="Delete"
                    onDelete={() => setSkillToDelete(skill)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="spark-recommended-skills" aria-labelledby={recommendedHeadingId}>
        <h2 id={recommendedHeadingId}>Recommended</h2>
        <div className="spark-recommended-skills__grid">
          {RECOMMENDED_SKILLS.slice(0, showAllRecommendations ? undefined : 4).map((skill) => (
            <button
              key={skill.title}
              type="button"
              className="spark-recommended-skill"
              disabled={!onRecommendedSkillSelect}
              onClick={() => onRecommendedSkillSelect?.(skill.title)}
            >
              <span className="spark-recommended-skill__copy">
                <h3 className="spark-recommended-skill__title">{skill.title}</h3>
                <p className="spark-recommended-skill__description">{skill.description}</p>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="spark-show-more"
          aria-expanded={showAllRecommendations}
          onClick={() => setShowAllRecommendations((visible) => !visible)}
        >
          <span>{showAllRecommendations ? 'Show less' : 'Show more'}</span>
          <MaterialSymbol
            family="luminous"
            name={showAllRecommendations ? 'expand_less' : 'expand_more'}
            size={20}
            weight={320}
            roundness={100}
            opticalSize={20}
          />
        </button>
      </section>
      {skillToDelete && (
        <SparkDeleteDialog
          itemName={skillToDelete.name}
          itemType="skill"
          onCancel={() => setSkillToDelete(null)}
          onConfirm={() => {
            onDeleteSkill(skillToDelete.id);
            setSkillToDelete(null);
          }}
        />
      )}
    </main>
  );
};

type ConnectedAppId = SparkConnectedAppId;

interface ConnectedAppDefinition {
  capabilities: readonly string[];
  description: string;
  handle?: string;
  icon: string;
  id: Exclude<ConnectedAppId, 'workspace'>;
  name: string;
  prompt?: string;
}

const GOOGLE_PRODUCT_ICONS = {
  workspace: 'https://www.gstatic.com/lamda/images/logo_workspace_2026_844db1cfe6c6bb65dd11a.png',
  gmail:
    'https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web-96dp/logo_gmail_2026_color_2x_web_96dp.png',
  docs:
    'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png',
  drive:
    'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-96dp/logo_drive_2026_color_2x_web_96dp.png',
  keep:
    'https://www.gstatic.com/images/branding/productlogos/keep_2026/v2/web-96dp/logo_keep_2026_color_2x_web_96dp.png',
  youtubeMusic: 'https://www.gstatic.com/chromecast/thirdparty/yt_music_icon.png',
  contacts: 'https://www.gstatic.com/images/branding/productlogos/contacts_2022/v2/192px.svg',
  openTable: 'https://www.gstatic.com/lamda/images/tools/logo_opentable_b1bb46b2fc3d4d4c69217.svg',
} as const;

const WORKSPACE_APPS = [
  { name: 'Gmail', icon: GOOGLE_PRODUCT_ICONS.gmail },
  { name: 'Google Docs', icon: GOOGLE_PRODUCT_ICONS.docs },
  { name: 'Google Drive', icon: GOOGLE_PRODUCT_ICONS.drive },
  { name: 'Google Keep', icon: GOOGLE_PRODUCT_ICONS.keep },
] as const;

const GOOGLE_CONNECTED_APPS: readonly ConnectedAppDefinition[] = [
  {
    id: 'youtube-music',
    name: 'YouTube Music',
    handle: '@YouTube Music',
    icon: GOOGLE_PRODUCT_ICONS.youtubeMusic,
    description: 'Play, search, and discover your favorite songs, artists, playlists and more',
    prompt: 'Play songs where Beyonc\u00e9 and Jay-Z feature together.',
    capabilities: ['Search for songs', 'Discover music you\'d love', 'Play a radio for any mood'],
  },
] as const;

const OTHER_CONNECTED_APPS: readonly ConnectedAppDefinition[] = [
  {
    id: 'contacts',
    name: 'Contacts',
    icon: GOOGLE_PRODUCT_ICONS.contacts,
    description:
      'Get personalized insights and responses based on your contacts. Add or find people in your contacts, and more.',
    capabilities: ['Add new contacts', 'Find contact details', 'Update existing contacts'],
  },
  {
    id: 'opentable',
    name: 'OpenTable',
    handle: '@OpenTable',
    icon: GOOGLE_PRODUCT_ICONS.openTable,
    description: 'Discover and book a reservation at the best restaurants for every occasion.',
    prompt: 'Reserve a table for 2 at La Pecora Bianca SoHo on Friday at 7:30 PM.',
    capabilities: ['Find available table times', 'Book restaurant reservations', 'Cancel a reservation'],
  },
] as const;

interface ConnectedAppCardProps {
  app: ConnectedAppDefinition;
  checked: boolean;
  onPromptSelect: (prompt: string, appId: SparkConnectedAppId) => void;
  onToggle: () => void;
}

const ConnectedAppCard: React.FC<ConnectedAppCardProps> = ({ app, checked, onPromptSelect, onToggle }) => (
  <article className="spark-connected-app-card">
    <div className="spark-connected-app-card__opt-in">
      <img src={app.icon} alt="" aria-hidden="true" />
      <SparkPreferenceControl
        appName={app.name}
        checked={checked}
        onChange={onToggle}
      />
    </div>

    <h3>{app.name}</h3>
    {app.handle && <p className="spark-connected-app-card__handle">{app.handle}</p>}
    <p className="spark-connected-app-card__description">{app.description}</p>
    <a
      className="spark-connected-app-card__learn-more"
      href="https://support.google.com/gemini?p=lm_gpi_apps"
      target="_blank"
      rel="noreferrer"
    >
      Learn more
    </a>

    {app.prompt && (
      <button
        type="button"
        className="spark-connected-app-card__prompt"
        disabled={!checked}
        title={checked ? undefined : `Connect ${app.name} to use this prompt`}
        onClick={() => onPromptSelect(app.prompt!, app.id)}
      >
        {app.prompt}
      </button>
    )}

    <div className="spark-connected-app-card__capabilities">
      <p>With a supported {app.name} integration, Spark can:</p>
      <ul>
        {app.capabilities.map((capability) => (
          <li key={capability}>
            <MaterialSymbol
              family="luminous"
              name="check"
              size={20}
              weight={350}
              roundness={100}
              opticalSize={20}
            />
            <span>{capability}</span>
          </li>
        ))}
      </ul>
    </div>
  </article>
);

export interface ConnectedAppsPageProps {
  className?: string;
  connections: Record<ConnectedAppId, boolean>;
  customApps: readonly SparkCustomApp[];
  onAddCustomApp: (url: string) => boolean;
  onConnectionChange: (appId: ConnectedAppId, connected: boolean) => void;
  onCustomAppConnectionChange: (appId: string, connected: boolean) => void;
  onDeleteCustomApp: (appId: string) => void;
  onPhotosSettings?: () => void;
  onPromptSelect: (prompt: string, appId: SparkConnectedAppId) => void;
}

export const ConnectedAppsPage: React.FC<ConnectedAppsPageProps> = ({
  className = '',
  connections,
  customApps,
  onAddCustomApp,
  onConnectionChange,
  onCustomAppConnectionChange,
  onDeleteCustomApp,
  onPhotosSettings,
  onPromptSelect,
}) => {
  const headingId = useId();
  const customAppUrlId = useId();
  const customAppErrorId = useId();
  const [customAppUrl, setCustomAppUrl] = useState('');
  const [customAppError, setCustomAppError] = useState('');
  const [customAppToDelete, setCustomAppToDelete] = useState<SparkCustomApp | null>(null);

  const toggleConnection = (appId: ConnectedAppId) => {
    const connected = !connections[appId];
    onConnectionChange(appId, connected);
  };

  const submitCustomApp = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onAddCustomApp(customAppUrl)) {
      setCustomAppError('Enter a valid app link');
      return;
    }
    setCustomAppUrl('');
    setCustomAppError('');
  };

  return (
    <main
      className={`spark-customise-page spark-customise-page--apps ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <div className="spark-connected-page__inner">
        <header className="spark-connected-header">
          <h1 id={headingId}>Connected apps</h1>
          <p>
            Choose which apps Spark may consider as preference context. Willow does not sign in to or read app
            data unless a supported integration supplies it.{' '}
            <a href="https://support.google.com/gemini?p=lm_gpi_apps" target="_blank" rel="noreferrer">
              Learn more
            </a>
          </p>
        </header>

        <div className="spark-photos-notice" role="status">
          <MaterialSymbol
            family="luminous"
            name="info"
            size={24}
            weight={350}
            roundness={100}
            opticalSize={24}
            className="spark-photos-notice__icon"
          />
          <span className="spark-photos-notice__copy">
            Google Photos is not connected through Willow.{' '}
            {onPhotosSettings ? (
              <button type="button" onClick={onPhotosSettings}>
                Review your settings in Photos
              </button>
            ) : (
              <span>Photos settings are unavailable here.</span>
            )}
          </span>
        </div>

        <nav className="spark-app-categories" aria-label="App categories">
          {([
            ['spark-apps-from-google', 'From Google'],
            ['spark-apps-other', 'Other'],
            ['spark-apps-custom', 'Custom apps'],
          ] as const).map(([category, label]) => (
            <a
              key={category}
              className="spark-app-category"
              href={`#${category}`}
            >
              {label}
            </a>
          ))}
        </nav>

        <section
            id="spark-apps-from-google"
            className="spark-connected-app-section"
            aria-labelledby="spark-apps-from-google-heading"
          >
            <header className="spark-connected-app-section__header">
              <h2 id="spark-apps-from-google-heading">From Google</h2>
            </header>

            <div className="spark-connected-app-grid">
              <article className="spark-workspace-card">
                <div className="spark-workspace-card__opt-in">
                  <img src={GOOGLE_PRODUCT_ICONS.workspace} alt="" aria-hidden="true" />
                  <SparkPreferenceControl
                    appName="Google Workspace"
                    checked={connections.workspace}
                    onChange={() => toggleConnection('workspace')}
                  />
                </div>

                <div className="spark-workspace-card__content">
                  <div className="spark-workspace-card__summary">
                    <h3>Google Workspace</h3>
                    <p>Use authorised Workspace content when a supported integration is available.</p>
                  </div>

                  <div className="spark-workspace-card__products" aria-label="Google Workspace apps">
                    {WORKSPACE_APPS.map((app) => (
                      <article key={app.name} className="spark-workspace-product">
                        <img src={app.icon} alt="" aria-hidden="true" />
                        <div>
                          <h4>{app.name}</h4>
                          <a
                            href="https://support.google.com/gemini?p=lm_gpi_apps"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Learn more
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </article>

              {GOOGLE_CONNECTED_APPS.map((app) => (
                <ConnectedAppCard
                  key={app.id}
                  app={app}
                  checked={connections[app.id]}
                  onPromptSelect={onPromptSelect}
                  onToggle={() => toggleConnection(app.id)}
                />
              ))}
            </div>
        </section>

        <section
            id="spark-apps-other"
            className="spark-connected-app-section"
            aria-labelledby="spark-apps-other-heading"
          >
            <header className="spark-connected-app-section__header">
              <h2 id="spark-apps-other-heading">Other</h2>
            </header>

            <div className="spark-connected-app-grid">
              {OTHER_CONNECTED_APPS.map((app) => (
                <ConnectedAppCard
                  key={app.id}
                  app={app}
                  checked={connections[app.id]}
                  onPromptSelect={onPromptSelect}
                  onToggle={() => toggleConnection(app.id)}
                />
              ))}
            </div>
        </section>

        <section
            id="spark-apps-custom"
            className="spark-connected-app-section spark-connected-app-section--custom"
            aria-labelledby="spark-apps-custom-heading"
          >
            <header className="spark-connected-app-section__header">
              <h2 id="spark-apps-custom-heading">Custom apps for Spark</h2>
            </header>

            {customApps.length === 0 ? (
              <div className="spark-custom-app-empty">
                <span className="spark-custom-app-empty__icon" aria-hidden="true">
                  <MaterialSymbol family="luminous" name="extension" size={28} weight={320} roundness={100} />
                </span>
                <span className="spark-custom-app-empty__copy">
                  <strong>No custom apps yet</strong>
                  <span>Save an app link to make it available as preference context.</span>
                </span>
              </div>
            ) : (
              <div className="spark-custom-app-list">
                {customApps.map((app) => (
                  <article key={app.id} className="spark-custom-app-row">
                    <span className="spark-custom-app-row__icon" aria-hidden="true">
                      <MaterialSymbol family="luminous" name="language" size={22} weight={320} roundness={100} />
                    </span>
                    <span className="spark-custom-app-row__copy">
                      <strong>{app.name}</strong>
                      <span>{app.url}</span>
                      <span className="spark-custom-app-row__status">
                        {app.connected ? 'Preference context enabled' : 'Saved link · Off'}
                      </span>
                    </span>
                    <SparkPreferenceControl
                      appName={app.name}
                      checked={app.connected}
                      className="spark-custom-app-row__toggle"
                      onChange={() => onCustomAppConnectionChange(app.id, !app.connected)}
                    />
                    <button
                      type="button"
                      className="spark-custom-app-row__remove"
                      aria-label={`Remove ${app.name}`}
                      title="Remove app"
                      onClick={() => setCustomAppToDelete(app)}
                    >
                      <MaterialSymbol family="luminous" name="delete" size={20} weight={320} roundness={100} />
                    </button>
                  </article>
                ))}
              </div>
            )}

            <form className="spark-custom-app-card" onSubmit={submitCustomApp}>
              <label htmlFor={customAppUrlId}>Save a custom app link</label>
              <div className="spark-custom-app-card__row">
                <input
                  id={customAppUrlId}
                  type="url"
                  aria-label="Custom app link"
                  aria-describedby={customAppError ? customAppErrorId : undefined}
                  value={customAppUrl}
                  aria-invalid={Boolean(customAppError)}
                  placeholder="https://example.com"
                  onChange={(event) => {
                    setCustomAppUrl(event.target.value);
                    setCustomAppError('');
                  }}
                />
                <button type="submit" disabled={!customAppUrl.trim()}>Add</button>
              </div>
              {customAppError && (
                <p id={customAppErrorId} className="spark-custom-app-card__error" role="alert">
                  {customAppError}
                </p>
              )}
            </form>
        </section>

        <aside className="spark-premium-content" aria-labelledby="spark-premium-content-heading">
          <MaterialSymbol
            family="luminous"
            name="extension"
            size={24}
            weight={300}
            roundness={100}
            opticalSize={24}
          />
          <div>
            <h2 id="spark-premium-content-heading">Your premium content</h2>
            <p>
              Subscription settings are managed by your Google Account. Willow does not currently read or prioritise
              paid subscription content.
            </p>
            <a href="https://myaccount.google.com/subscriptions" target="_blank" rel="noreferrer">
              Manage subscriptions linked to your Google Account
            </a>
          </div>
        </aside>

        <aside className="spark-apps-privacy-note">
          <MaterialSymbol
            family="luminous"
            name="info"
            size={24}
            weight={350}
            roundness={100}
            opticalSize={24}
          />
          <p>
            Learn how Gemini apps use data and communicate with supported integrations in the{' '}
            <a href="https://support.google.com/gemini?p=privacy_help" target="_blank" rel="noreferrer">
              Gemini Apps Privacy Hub
            </a>
          </p>
        </aside>
      </div>
      {customAppToDelete && (
        <SparkDeleteDialog
          itemName={customAppToDelete.name}
          itemType="custom app"
          onCancel={() => setCustomAppToDelete(null)}
          onConfirm={() => {
            onDeleteCustomApp(customAppToDelete.id);
            setCustomAppToDelete(null);
          }}
        />
      )}
    </main>
  );
};
