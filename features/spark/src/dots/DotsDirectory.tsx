import { useStore } from '@nanostores/react';
import { atom } from 'nanostores';
import { useMemo, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { goToSparkDot, goToSparkDots } from '../spark-store';
import { formatSparkRelativeTime } from '../spark-types';
import { DotAvatar } from './character/avatar/dot-avatar';
import { usePrewarmCharacterShaders } from './character/orbit/shader-prewarm';
import { transitionDotNavigation } from './dot-transition';
import { addSparkDotCategory, sparkDotLastActivity, sparkDotName, sparkDotPreview, sparkDots, type SparkDot } from './dots-store';
import { dotActivity } from './harness/dot-runtime';
import { dotThreads } from './harness/thread/thread-store';
import { openDotOnboarding } from './state/creation-store';
import './codex-dots.css';
import './dots-theme.css';
import './SparkDots.css';
import './dots-light.css';

const ALL = 'All';

export const matchesDotSearch = (dot: SparkDot, query: string) => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return sparkDotName(dot).toLocaleLowerCase().includes(needle) || (dot.category ?? '').toLocaleLowerCase().includes(needle);
};

/** A bot's saved Codex character, as the bot lists show it. */
export function SparkDotAvatar({ dotId, className }: { dotId: string; className?: string }) {
  usePrewarmCharacterShaders();
  return (
    <span className={`willow-dots spark-dots-avatar${className ? ` ${className}` : ''}`}>
      <DotAvatar className="size-full" identity={dotId} animated={false} />
    </span>
  );
}

/** The search and category the list is filtered by, kept as it moves from the tab into an open bot's left pane. */
const directoryQuery = atom('');
const directoryCategory = atom(ALL);

/**
 * The bots tab once a bot exists: a contacts list with search and categories. An open bot shows the same list,
 * squeezed into its left pane, with `selectedDotId` marked.
 */
export function DotsDirectory({ selectedDotId }: { selectedDotId?: string }) {
  const { dots, categories } = useStore(sparkDots);
  const threads = useStore(dotThreads);
  const activities = useStore(dotActivity);
  const query = useStore(directoryQuery);
  const category = useStore(directoryCategory);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState('');
  const now = Date.now();

  const visibleDots = useMemo(
    () =>
      dots
        .filter((dot) => (category === ALL || dot.category === category) && matchesDotSearch(dot, query))
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || sparkDotLastActivity(b) - sparkDotLastActivity(a)),
    // `threads` and `activities` move previews and order as conversations progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category, dots, query, threads, activities],
  );

  const commitCategory = () => {
    addSparkDotCategory(categoryDraft);
    setCategoryDraft('');
    setIsAddingCategory(false);
  };

  return (
    <section className="spark-dots" aria-label="Bots">
      <div className="spark-dots__column">
        <header className="spark-dots__header">
          <h1 className="spark-dots__heading">Bots</h1>
          <button
            type="button"
            className="spark-dots-button spark-dots-button--primary"
            onClick={() => {
              goToSparkDots();
              openDotOnboarding();
            }}
          >
            <MaterialSymbol family="luminous" name="add" size={20} opticalSize={20} />
            <span>New bot</span>
          </button>
        </header>

        <label className="spark-dots-search">
          <MaterialSymbol family="luminous" name="search" size={20} opticalSize={20} />
          <input
            className="spark-dots-search__input"
            type="search"
            value={query}
            placeholder="Search bots"
            aria-label="Search bots"
            onChange={(event) => directoryQuery.set(event.target.value)}
          />
        </label>

        <div className="spark-dots-chips" role="tablist" aria-label="Categories">
          {[ALL, ...categories].map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={category === candidate}
              className={`spark-dots-chip${category === candidate ? ' is-selected' : ''}`}
              onClick={() => directoryCategory.set(candidate)}
            >
              {candidate}
            </button>
          ))}
          {isAddingCategory ? (
            <input
              className="spark-dots-chip spark-dots-chip--input"
              value={categoryDraft}
              placeholder="Category name"
              maxLength={30}
              autoFocus
              onChange={(event) => setCategoryDraft(event.target.value)}
              onBlur={commitCategory}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitCategory();
                if (event.key === 'Escape') {
                  setCategoryDraft('');
                  setIsAddingCategory(false);
                }
              }}
            />
          ) : (
            <button type="button" className="spark-dots-chip spark-dots-chip--add" onClick={() => setIsAddingCategory(true)}>
              <MaterialSymbol family="luminous" name="add" size={18} opticalSize={18} />
              <span>New category</span>
            </button>
          )}
        </div>

        <div className="spark-dots__list" role="list" aria-label="Your bots">
          {visibleDots.map((dot) => {
            const selected = dot.id === selectedDotId;
            return (
              <button
                key={dot.id}
                type="button"
                role="listitem"
                aria-current={selected ? 'page' : undefined}
                className={`spark-dots-row${selected ? ' is-selected' : ''}`}
                // From the tab the bot slides in, as a task does; switching bots beside an open one keeps it still.
                onClick={() => (selectedDotId == null ? transitionDotNavigation(() => goToSparkDot(dot.id)) : goToSparkDot(dot.id))}
              >
                <SparkDotAvatar dotId={dot.id} className="spark-dots-row__avatar" />
                <span className="spark-dots-row__copy">
                  <span className="spark-dots-row__name">{sparkDotName(dot)}</span>
                  <span className="spark-dots-row__preview">{activities[dot.id]?.working ? 'Working…' : sparkDotPreview(dot)}</span>
                </span>
                <span className="spark-dots-row__meta">
                  {dot.pinned && (
                    <span className="spark-dots-row__pin" role="img" aria-label="Pinned" title="Pinned">
                      <MaterialSymbol family="luminous" weight={320} roundness={100} name="push_pin" size={16} opticalSize={16} />
                    </span>
                  )}
                  {dot.category && <span className="spark-dots-row__category">{dot.category}</span>}
                  <span className="spark-dots-row__time">{formatSparkRelativeTime(new Date(sparkDotLastActivity(dot)).toISOString(), now)}</span>
                </span>
              </button>
            );
          })}
          {visibleDots.length === 0 && <p className="spark-dots__empty">{query.trim() ? 'No bots match your search.' : 'No bots in this category yet.'}</p>}
        </div>
      </div>
    </section>
  );
}
