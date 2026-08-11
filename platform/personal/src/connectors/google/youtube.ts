/**
 * YouTube.
 *
 * Watch history is not available. Google removed the API in 2016 and there is no
 * replacement — the `watchHistory` playlist id that `channels.list` still returns
 * has been unreadable for years. Any card promising "based on what you watch" is
 * promising something no OAuth scope grants.
 *
 * What *is* available is better suited to a profile anyway:
 *
 * - **Liked videos**, via `videos.list?myRating=like`. An explicit signal the
 *   user sent on purpose, which is a stronger statement of taste than a watch a
 *   recommendation autoplayed into.
 * - **Subscriptions**, via `subscriptions.list?mine=true`. Sustained interest
 *   rather than a single click.
 *
 * Categories, not titles. "Likes videos about home espresso" is a fact about the
 * person; a list of the last fifty videos they liked is a viewing log, and
 * storing that in a file to be read into every future prompt is not what the user
 * connected YouTube for.
 */

import { paginate, query } from '../google-fetch';
import type { ConnectorFetch, ConnectorReader, ConnectorSignal } from '../types';

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

const PAGE_SIZE = 50;
const MAX_PAGES = 2;

/** A topic needs this many likes before it is a preference rather than a click. */
const TOPIC_THRESHOLD = 3;

interface Video {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    categoryId?: string;
    tags?: string[];
  };
}

interface Subscription {
  snippet?: {
    title?: string;
    resourceId?: { channelId?: string };
  };
}

/**
 * YouTube's fixed category ids.
 *
 * Hardcoded rather than fetched from `videoCategories.list`: the list is stable,
 * region-dependent in ways that do not matter here, and one fewer request in a
 * background job. Only the categories that say something about a person are
 * mapped — "Music" and "Entertainment" are on almost everyone's likes and
 * distinguish nobody.
 */
const CATEGORY_INTERESTS: Record<string, string> = {
  '17': 'sports',
  '19': 'travel',
  '20': 'gaming',
  '22': 'video blogs and personal channels',
  '23': 'comedy',
  '25': 'news and politics',
  '26': 'how-to and DIY',
  '27': 'educational content',
  '28': 'science and technology',
};

const countBy = <T,>(items: T[], key: (item: T) => string | undefined): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

const topEntries = (counts: Map<string, number>, limit: number, minimum = 1): [string, number][] =>
  [...counts.entries()]
    .filter(([, count]) => count >= minimum)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

export const readYouTubeSignals = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<ConnectorSignal[]> => {
  const liked = await paginate<Video>(async (pageToken) => {
    const url = `${YOUTUBE_API}/videos${query({
      part: 'snippet',
      myRating: 'like',
      maxResults: PAGE_SIZE,
      pageToken,
    })}`;
    const page = await fetchJson<{ items?: Video[]; nextPageToken?: string }>(url, { signal });
    if (!page) return null;
    return { items: page.items ?? [], nextPageToken: page.nextPageToken };
  }, MAX_PAGES);

  const subscriptions = await paginate<Subscription>(async (pageToken) => {
    const url = `${YOUTUBE_API}/subscriptions${query({
      part: 'snippet',
      mine: true,
      maxResults: PAGE_SIZE,
      order: 'relevance',
      pageToken,
    })}`;
    const page = await fetchJson<{ items?: Subscription[]; nextPageToken?: string }>(url, { signal });
    if (!page) return null;
    return { items: page.items ?? [], nextPageToken: page.nextPageToken };
  }, 1);

  const signals: ConnectorSignal[] = [];

  const categories = countBy(liked, (video) => CATEGORY_INTERESTS[video.snippet?.categoryId ?? '']);
  for (const [interest, count] of topEntries(categories, 3, TOPIC_THRESHOLD)) {
    signals.push({
      section: 'interests',
      text: `Watches ${interest} on YouTube`,
      source: 'YouTube',
      evidence: `Liked ${count} videos in this category across their YouTube likes.`,
    });
  }

  // A channel liked repeatedly is a specific, checkable interest — more useful
  // than the category it sits in, and the reason the threshold applies.
  const channels = countBy(liked, (video) => video.snippet?.channelTitle?.trim());
  for (const [channel, count] of topEntries(channels, 3, TOPIC_THRESHOLD)) {
    signals.push({
      section: 'interests',
      text: `Follows the YouTube channel ${channel}`,
      source: 'YouTube',
      evidence: `Liked ${count} videos from ${channel}.`,
    });
  }

  if (subscriptions.length > 0) {
    const named = subscriptions
      .map((entry) => entry.snippet?.title?.trim())
      .filter((title): title is string => Boolean(title))
      .slice(0, 6);
    if (named.length >= 3) {
      signals.push({
        section: 'interests',
        text: `Subscribes to YouTube channels including ${named.slice(0, 3).join(', ')}`,
        source: 'YouTube',
        evidence: `Subscribed to ${subscriptions.length} channels; the most relevant are ${named.join(', ')}.`,
      });
    }
  }

  return signals;
};

export const youtubeConnector: ConnectorReader = {
  id: 'youtube',
  readSignals: readYouTubeSignals,
};
