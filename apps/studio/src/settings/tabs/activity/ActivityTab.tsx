/**
 * Settings > Activity.
 *
 * A clone of Gemini's Activity surface. In Gemini this menu entry is not an in-app panel:
 * it opens a new browser tab at `myactivity.google.com/product/gemini`, Google's
 * account-wide My Activity page scoped to the Gemini product. That page is what this
 * reproduces, rendered inside the Willow shell instead of as a separate tab.
 *
 * Provenance — every measurement came off the live page, none of it is estimated:
 *   - geometry: `getBoundingClientRect` (tools/ui-research/captures/activity/20-containers.json)
 *   - authored CSS: CDP `CSS.getMatchedStylesForNode`, because Google's stylesheets are
 *     cross-origin and expose no `cssRules` (10-matched-styles.txt)
 *   - icon paths: 18-icons.json
 *   - column behaviour across 8 viewport widths: 18-responsive.json
 * Scrapers that produced them live in tools/ui-research/scrapers/activity/.
 *
 * Two deliberate differences from Gemini, both because Willow is local-first:
 *
 *  - **Rows come from the user's own chat history**, via `useLocalFS`. Gemini lists one
 *    row per prompt with a per-prompt timestamp; Willow stores no per-message time, only
 *    a per-chat one. Rather than invent times, each chat contributes one row: its first
 *    user prompt, at the chat's real timestamp. The row shape is otherwise identical.
 *  - **Nothing here deletes anything yet.** The controls are present and behave like
 *    Gemini's, but the destructive ones are inert pending a confirmation flow. Gemini's
 *    per-row and per-group buttons delete immediately with no confirmation, which is a
 *    behaviour worth not copying blind.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import './ActivityTab.css';

/* ---- icons, paths lifted verbatim from the page ------------------------------------- */

const CheckIcon: React.FC = () => (
  <svg className="activity-chip-icon" height="18" width="18" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M18,9l-1.4-1.4L10,14.2l-2.6-2.6L6,13l4,4L18,9z" />
  </svg>
);

const CaretIcon: React.FC<{ className?: string; size?: number }> = ({ className, size = 22 }) => (
  <svg className={className} height={size} width={size} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M0 0h24v24H0V0z" fill="none" />
    <path d="M7 10l5 5 5-5H7z" />
  </svg>
);

const AutoDeleteIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M6 6h2v9H6z" />
    <path d="M16 9V4h1V2h-5V1H6v1H1v2h1v13c0 1.1.9 2 2 2h5.68A6.999 6.999 0 0 0 23 16c0-3.87-3.13-7-7-7zm-6-3v6.43c-.63 1.05-1 2.26-1 3.57 0 .34.03.67.08 1H4V4h10v5.29c-.72.22-1.4.54-2 .96V6h-2zm6 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
    <path d="M16.5 12H15v5l3.6 2.1.8-1.2-2.9-1.7z" />
  </svg>
);

const ChevronIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M7.59 18.59L9 20l8-8-8-8-1.41 1.41L14.17 12" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
  </svg>
);

const CheckboxTick: React.FC = () => (
  <svg className="activity-checkbox-tick" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="none" d="M1.73,12.91 8.1,19.28 22.79,4.59" />
  </svg>
);

const SPARK_PATH =
  'M12 1.5c.34 3.2 1.3 5.5 2.9 7.1 1.6 1.6 3.9 2.56 7.1 2.9-3.2.34-5.5 1.3-7.1 2.9-1.6 1.6-2.56 3.9-2.9 7.1-.34-3.2-1.3-5.5-2.9-7.1-1.6-1.6-3.9-2.56-7.1-2.9 3.2-.34 5.5-1.3 7.1-2.9 1.6-1.6 2.56-3.9 2.9-7.1z';

/** 18px row mark, standing in for Gemini's `producticons/gemini.png`. */
const ProductIcon: React.FC = () => (
  <svg className="activity-row-product-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d={SPARK_PATH} fill="#8ab4f8" />
  </svg>
);

/** 24px banner mark, standing in for Gemini's `safer_with_google_dark_24px` image. */
const PrivacyIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="#8ab4f8" opacity="0.24" />
    <path d={SPARK_PATH} fill="#8ab4f8" transform="translate(12 12) scale(0.5) translate(-12 -12)" />
  </svg>
);

/* ---- date + time formatting, matching the page's own labels -------------------------- */

const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

const startOfDay = (value: number): number => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today" / "Yesterday" / "August 15" / "August 15, 2025", as the page renders them. */
const groupLabel = (at: number): string => {
  const today = startOfDay(Date.now());
  const day = startOfDay(at);
  if (day === today) return 'Today';
  if (day === today - 86_400_000) return 'Yesterday';
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
};

/* ---- menu ----------------------------------------------------------------------------- */

type MenuOption = { label: string; hint?: string; separatorBefore?: boolean };

const Menu: React.FC<{ options: MenuOption[]; single?: boolean; onClose: () => void }> = ({
  options,
  single,
  onClose,
}) => {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <ul className="activity-menu" role="menu" ref={ref}>
      {options.map((option) => (
        <React.Fragment key={option.label}>
          {option.separatorBefore && <li className="activity-menu-separator" role="separator" />}
          <li
            className={`activity-menu-item${single ? ' is-single' : ''}`}
            role="menuitem"
            tabIndex={-1}
            onClick={onClose}
          >
            <span className="activity-menu-item-label">{option.label}</span>
            {option.hint && <span className="activity-menu-item-hint">{option.hint}</span>}
          </li>
        </React.Fragment>
      ))}
    </ul>
  );
};

/* ---- rows -------------------------------------------------------------------------------- */

type ActivityEntry = { chatId: string; prompt: string; at: number };

/**
 * How many chats are read per pass. Chat bodies are the expensive read in this app —
 * `platform/storage`'s notes are explicit that scanning all of them stalls the UI — so the
 * list grows a window at a time rather than loading the whole history up front.
 */
const CHAT_PAGE = 12;

const firstUserPrompt = (messages: unknown): string | null => {
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (typeof message === 'string') {
      const trimmed = message.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (message && typeof message === 'object' && (message as any).role === 'user') {
      const content = (message as any).content;
      if (typeof content === 'string' && content.trim()) return content.trim();
    }
  }
  return null;
};

export const ActivityTab: React.FC = () => {
  const { localChats, getChatTimestamp, loadLocalFSChat } = useLocalFS();

  const [keepActivity, setKeepActivity] = useState(true);
  const [improveServices, setImproveServices] = useState(false);
  const [openMenu, setOpenMenu] = useState<'keep' | 'delete' | null>(null);

  const [limit, setLimit] = useState(CHAT_PAGE);
  const [prompts, setPrompts] = useState<Record<string, string | null>>({});
  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;

  const windowed = useMemo(() => localChats.slice(0, limit), [localChats, limit]);

  // Read bodies only for the chats currently in the window, one at a time, and abandon
  // the pass if the window changes underneath it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const chatId of windowed) {
        if (cancelled) return;
        if (chatId in promptsRef.current) continue;
        let prompt: string | null = null;
        try {
          prompt = firstUserPrompt(await loadLocalFSChat(chatId));
        } catch {
          prompt = null;
        }
        if (cancelled) return;
        setPrompts((previous) => (chatId in previous ? previous : { ...previous, [chatId]: prompt }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowed, loadLocalFSChat]);

  const groups = useMemo(() => {
    const entries: ActivityEntry[] = [];
    for (const chatId of windowed) {
      const prompt = prompts[chatId];
      if (!prompt) continue;
      entries.push({ chatId, prompt, at: getChatTimestamp(chatId) });
    }
    entries.sort((a, b) => b.at - a.at);

    const out: { label: string; entries: ActivityEntry[] }[] = [];
    for (const entry of entries) {
      const label = groupLabel(entry.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(entry);
      else out.push({ label, entries: [entry] });
    }
    return out;
  }, [windowed, prompts, getChatTimestamp]);

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 400) return;
      setLimit((current) => (current >= localChats.length ? current : current + CHAT_PAGE));
    },
    [localChats.length],
  );

  const since = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(
        new Date(),
      ),
    [],
  );

  return (
    <div className="activity-page w-full h-full overflow-y-auto" onScroll={onScroll}>
      <div className="activity-column">
        <h1 className="activity-title">Willow Apps Activity</h1>

        <div className="activity-card">
          <div className="activity-card-inner">
            <div className="activity-card-heading">
              <h2>Keep activity</h2>
            </div>

            <div className="activity-card-body">
              Keeping your activity lets you pick up chats where you left off anytime and helps
              improve Willow, including AI models. When this setting is off, Willow still saves
              chats for 72 hours to respond to you and help keep Willow safe.
            </div>

            <div className="activity-chip-row activity-menu-anchor">
              <button
                type="button"
                className="activity-chip"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'keep'}
                aria-label="Turn off your Keep Activity setting"
                onClick={() => setOpenMenu((current) => (current === 'keep' ? null : 'keep'))}
              >
                {keepActivity && <CheckIcon />}
                <span className="activity-chip-label">{keepActivity ? 'On' : 'Off'}</span>
                <CaretIcon className="activity-chip-icon" />
              </button>
              {openMenu === 'keep' && (
                <Menu
                  onClose={() => setOpenMenu(null)}
                  options={[
                    { label: 'Turn off', hint: '1 step' },
                    { label: 'Turn off and delete activity', hint: '2 steps', separatorBefore: true },
                  ]}
                />
              )}
            </div>

            <div className="activity-since">On since {since}</div>

            <div className="activity-setting-row" role="button" tabIndex={0} aria-label="Choose an auto-delete option">
              <div className="activity-setting-icon">
                <AutoDeleteIcon />
              </div>
              <div className="activity-setting-text">Choose an auto-delete option</div>
              <div className="activity-setting-trailing">
                <div className="activity-chevron">
                  <ChevronIcon />
                </div>
              </div>
            </div>

            <div
              className="activity-setting-row"
              role="checkbox"
              tabIndex={0}
              aria-checked={improveServices}
              aria-label="Improve Willow with your audio and Live videos & screenshares."
              onClick={() => setImproveServices((on) => !on)}
            >
              <div className="activity-setting-text">
                Improve Willow with your audio and Live videos &amp; screenshares.
              </div>
              <div className="activity-setting-trailing">
                <span className="activity-checkbox">
                  <span className={`activity-checkbox-box${improveServices ? ' is-checked' : ''}`}>
                    <CheckboxTick />
                  </span>
                </span>
              </div>
            </div>

            <div className="activity-card-note">
              <p>
                <a href="#" onClick={(event) => event.preventDefault()}>
                  Learn more
                </a>{' '}
                about these settings
              </p>
            </div>
          </div>
        </div>

        <div className="activity-privacy">
          <div className="activity-privacy-icon">
            <PrivacyIcon />
          </div>
          <div className="activity-privacy-text">
            <div>Willow protects your privacy and security.</div>
            <button type="button" className="activity-privacy-link">
              Manage My Activity verification
            </button>
          </div>
        </div>

        <div className="activity-delete-row activity-menu-anchor">
          <button
            type="button"
            className="activity-delete-button"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'delete'}
            onClick={() => setOpenMenu((current) => (current === 'delete' ? null : 'delete'))}
          >
            Delete
            <CaretIcon className="activity-delete-caret" size={24} />
          </button>
          {openMenu === 'delete' && (
            <Menu
              single
              onClose={() => setOpenMenu(null)}
              options={[
                { label: 'Last hour' },
                { label: 'Last day' },
                { label: 'All time' },
                { label: 'Custom range' },
              ]}
            />
          )}
        </div>

        {groups.length === 0 ? (
          <div className="activity-empty">No activity yet.</div>
        ) : (
          groups.map((group) => (
            <div className="activity-group" key={group.label}>
              <div className="activity-group-header">
                <h2>{group.label}</h2>
                <div className="activity-group-action">
                  <button
                    type="button"
                    className="activity-icon-button"
                    aria-label={`Delete all activity from ${group.label}.`}
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              {group.entries.map((entry) => (
                <div className="activity-row" key={entry.chatId}>
                  <div className="activity-row-head">
                    <div className="activity-row-product">
                      <ProductIcon />
                      <span className="activity-row-product-name">Willow Apps</span>
                    </div>
                    <div className="activity-row-action">
                      <button
                        type="button"
                        className="activity-icon-button"
                        aria-label={`Delete activity item ${entry.prompt}`}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </div>
                  <div className="activity-row-body">
                    <div className="activity-row-main">
                      <div className="activity-row-title" tabIndex={-1}>
                        Prompted {entry.prompt}
                      </div>
                      <div className="activity-row-meta">
                        {timeFormatter.format(new Date(entry.at))} &bull;{' '}
                        <button type="button" className="activity-row-details">
                          Details
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActivityTab;
