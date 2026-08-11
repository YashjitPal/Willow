/**
 * The four headings a profile is allowed to have, and how much fits under each.
 *
 * Fixed rather than model-chosen, and that is the single mechanism that bounds
 * this feature. A summarizer told "write down what you learned about the user"
 * invents a new heading per run and the file grows without limit; a summarizer
 * told "fill these four sections, at most N bullets each" produces a file whose
 * size is set by this table and nothing else. Someone who has used Willow for a
 * year has the same size profile as someone who has used it for a week — a
 * better one, not a longer one.
 *
 * The headings themselves are Gemini's, kept word for word, because they are a
 * genuinely good partition: three of them hold facts that stay true for years,
 * and the fourth holds the ones that go stale, which is why only the fourth
 * expires.
 */

export type ProfileSectionId = 'demographics' | 'interests' | 'relationships' | 'events';

export interface ProfileSection {
  id: ProfileSectionId;
  /** Rendered as `## <heading>` in the prompt block and as the settings group. */
  heading: string;
  /** Shown under the heading in Settings, and given to the summarizer verbatim. */
  guidance: string;
  /**
   * Hard cap. On overflow the merge keeps the best-evidenced bullets and drops
   * the rest — see `pickWithinCap` in ../builder/merge.
   */
  cap: number;
  /**
   * Days after a bullet's `date` before it is dropped as stale, or `null` to
   * keep it indefinitely.
   *
   * Only `events` expires. "Lives in Florida" does not become false because it
   * was observed eight months ago, but "flying to Delhi on the 14th" is actively
   * misleading in March — a model that still believes it will plan around a trip
   * that already happened.
   */
  expiresAfterDays: number | null;
}

export const PROFILE_SECTIONS: readonly ProfileSection[] = [
  {
    id: 'demographics',
    heading: 'Demographics Information',
    guidance:
      'Stable facts about who the user is: where they live, what they do, what they are studying, what languages they use, what devices and tools they work on.',
    cap: 8,
    expiresAfterDays: null,
  },
  {
    id: 'interests',
    heading: 'Interests & Preferences',
    guidance:
      'What the user likes, avoids, and expects — subjects they return to, tastes in music, film, food and games, and the way they prefer answers to be written.',
    cap: 14,
    expiresAfterDays: null,
  },
  {
    id: 'relationships',
    heading: 'Relationships',
    guidance:
      'People and organisations the user refers to repeatedly, and who they are to the user. Only include someone the user has actually named more than once.',
    cap: 6,
    expiresAfterDays: null,
  },
  {
    id: 'events',
    heading: 'Dated Events, Projects & Plans',
    guidance:
      'Things happening at a particular time: trips, deadlines, exams, launches, and projects currently underway. Every bullet here needs a date.',
    cap: 10,
    // Roughly two months past the date on the bullet. Long enough that a user
    // asking "how did the trip go" the week after still gets context; short
    // enough that the section does not silently become a diary.
    expiresAfterDays: 60,
  },
] as const;

/** Total bullets a profile can hold once every section is full. */
export const PROFILE_BULLET_CAP = PROFILE_SECTIONS.reduce((total, section) => total + section.cap, 0);

const SECTION_BY_ID = new Map(PROFILE_SECTIONS.map((section) => [section.id, section]));

export const getProfileSection = (id: ProfileSectionId): ProfileSection | undefined =>
  SECTION_BY_ID.get(id);

/**
 * Coerce whatever the summarizer put in the `section` field to a real section.
 *
 * Models produce the heading text, a lowercase slug, a plural, or a near-miss
 * ("interests and preferences", "Dated Events"). All of those mean something
 * obvious; throwing the bullet away over the label would lose real content for a
 * formatting slip. Anything genuinely unrecognisable returns `null` and the
 * caller drops the bullet — a bullet with no section has nowhere to render.
 */
export const normalizeSectionId = (value: unknown): ProfileSectionId | null => {
  if (typeof value !== 'string') return null;
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return null;
  if (key.startsWith('demographic')) return 'demographics';
  if (key.startsWith('interest') || key.includes('preference')) return 'interests';
  if (key.startsWith('relationship') || key.startsWith('people')) return 'relationships';
  if (key.includes('event') || key.includes('project') || key.includes('plan')) return 'events';
  return null;
};
