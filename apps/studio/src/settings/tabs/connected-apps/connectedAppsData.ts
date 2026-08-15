/**
 * Connected Apps catalogue.
 *
 * Card copy, logo URLs and capability lists were extracted from Gemini's live
 * Connected Apps page (gemini.google.com/apps) so the clone matches it closely.
 * Product-name mentions in the copy are rebranded to Willow; everything else is
 * verbatim.
 *
 * Closely, not exactly. Six of Gemini's cards were dropped on purpose — Google
 * Photos, Google Business Profile, KBC, Contacts, Verify AI and Wix — so this list
 * is shorter than theirs and that is not an extraction that went wrong. Five of the
 * six were inert here: catalogue entries with no connector behind them, drawing a
 * dead switch for a product Willow was never going to reach. Contacts was the one
 * that worked, and it went with them; `connectors/types.ts` records what its reader
 * did, so there is something to read before anyone builds it a second time.
 *
 * Logos are hotlinked from www.gstatic.com. There is no CSP in this app and the
 * same approach is already used for the Google product icons in
 * features/spark/src/SparkCustomisePages.tsx.
 */

export interface ChildApp {
  id: string;
  name: string;
  handle?: string;
  logo: string;
}

export interface ConnectedApp {
  id: string;
  name: string;
  /** Rendered under the name, e.g. "@GitHub". Most Google apps have none. */
  handle?: string;
  logo: string;
  description: string;
  /** The large prompt tile pinned to the bottom of a collapsed card. */
  heroPrompt?: string;
  /** "Using the X app, Willow can:" — omitted when Gemini shows no list. */
  can?: string[];
  /** "Using the X app, Willow cannot:" */
  cannot?: string[];
  /** Pill buttons under "Prompts to try" in the expanded state. */
  prompts?: string[];
  /** Workspace is the one card that spans the full grid width. */
  children?: ChildApp[];
  /**
   * Whether Google ships this app connected by default on Gemini's own page.
   *
   * Captured data, not state: Willow's switches read `connectionsStore`. See the
   * note at the bottom of this file for why that distinction cost a bug.
   */
  defaultConnected: boolean;
}

export interface AppCategory {
  id: string;
  name: string;
  apps: ConnectedApp[];
}

const LOGOS = {
  workspace: 'https://www.gstatic.com/lamda/images/logo_workspace_2026_844db1cfe6c6bb65dd11a.png',
  gmail:
    'https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web-96dp/logo_gmail_2026_color_2x_web_96dp.png',
  calendar:
    'https://www.gstatic.com/images/branding/productlogos/calendar_2026/v2/web-96dp/logo_calendar_2026_color_2x_web_96dp.png',
  docs:
    'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png',
  drive:
    'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-96dp/logo_drive_2026_color_2x_web_96dp.png',
  keep:
    'https://www.gstatic.com/images/branding/productlogos/keep_2026/v2/web-96dp/logo_keep_2026_color_2x_web_96dp.png',
  tasks:
    'https://www.gstatic.com/images/branding/productlogos/tasks_2026/v2/web-96dp/logo_tasks_2026_color_2x_web_96dp.png',
  googleG: 'https://www.gstatic.com/images/branding/productlogos/googleg/v6/192px.svg',
  youtube: 'https://www.gstatic.com/images/branding/productlogos/youtube/v9/192px.svg',
  youtubeMusic: 'https://www.gstatic.com/chromecast/thirdparty/yt_music_icon.png',
  github: 'https://www.gstatic.com/lamda/images/tools/logo_github_dark_018b0501d5dc2dd3e532c.svg',
  canva: 'https://www.gstatic.com/lamda/images/tools/logo_canva_27c834f6923acc1f886fe.svg',
} as const;

export const LEARN_MORE_URL = 'https://support.google.com/gemini?p=lm_gpi_apps';
export const PRIVACY_HUB_URL = 'https://support.google.com/gemini?p=privacy_help';
export const SUBSCRIPTIONS_URL = 'https://myaccount.google.com/subscriptions?utm_source=gemini';

/**
 * Spotify's mark, drawn here rather than hotlinked.
 *
 * Every other logo on this page comes from www.gstatic.com because every other app
 * on this page is one Gemini shows, so Google hosts the artwork. Spotify is Willow's
 * own addition, so there is no equivalent URL — and pointing at Spotify's CDN would
 * make a settings screen depend on a third party's asset paths staying put.
 *
 * Built with `encodeURIComponent` instead of a hand-encoded data URI. The escaping a
 * data URI needs (`#` in particular) makes the markup unreadable, and unreadable
 * markup is markup nobody will ever correct.
 */
const SPOTIFY_MARK = `data:image/svg+xml,${encodeURIComponent(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">',
    '<circle cx="48" cy="48" r="48" fill="#1ED760"/>',
    '<g fill="none" stroke="#000" stroke-linecap="round">',
    '<path d="M25 35c15-4 33-3 46 4" stroke-width="9"/>',
    '<path d="M29 50c12-3 27-2 38 4" stroke-width="7.5"/>',
    '<path d="M32 63c10-2 21-1 29 3" stroke-width="6"/>',
    '</g></svg>',
  ].join(''),
)}`;

const FROM_GOOGLE: ConnectedApp[] = [
  {
    id: 'workspace',
    name: 'Google Workspace',
    logo: LOGOS.workspace,
    description:
      'Get personalized insights from your Workspace apps, and ask for info about your content.',
    defaultConnected: true,
    children: [
      { id: 'gmail', name: 'Gmail', logo: LOGOS.gmail },
      { id: 'calendar', name: 'Google Calendar', logo: LOGOS.calendar },
      { id: 'docs', name: 'Google Docs', logo: LOGOS.docs },
      { id: 'drive', name: 'Google Drive', logo: LOGOS.drive },
      { id: 'keep', name: 'Google Keep', logo: LOGOS.keep },
      { id: 'tasks', name: 'Google Tasks', logo: LOGOS.tasks },
    ],
  },
  {
    id: 'search-services',
    name: 'Search services',
    logo: LOGOS.googleG,
    description:
      'Get personalized insights using your saved data from services like Search, Maps, Shopping, News, and Google Flights and Hotels. You can disconnect this anytime on the Connected Apps page. Your choices here don’t change Willow’s use of public data. For example, if Search services aren’t connected, Willow can still use public websites and videos in Search services to respond to you.',
    heroPrompt: 'Show me hidden patterns in my Google searches',
    prompts: [
      'Find my hidden search patterns',
      'What should be my next hobby?',
      'Create my birthday wishlist',
    ],
    defaultConnected: true,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    logo: LOGOS.youtube,
    description:
      'Get personalized insights based on your YouTube data, like video and music recommendations. You can disconnect this anytime on the Connected Apps page. When disconnected, you can still use YouTube to find and get info about public videos.',
    heroPrompt: 'Recommend a film based on my YouTube history',
    can: [
      'Give you personalized recommendations for videos to learn new skills, see news from your region, and more',
      'Recommend videos and channels based on your YouTube History',
    ],
    cannot: [
      'Show your complete watch history, liked videos, your saved playlists, and subscribed channels',
      'Take actions that impact your YouTube experience, like saving a video to a playlist or adding comments',
    ],
    prompts: ['Recommend a film I’d like', 'Find the last video I watched', 'Describe my music tastes'],
    defaultConnected: true,
  },
  {
    id: 'youtube-music',
    name: 'YouTube Music',
    handle: '@YouTube Music',
    logo: LOGOS.youtubeMusic,
    description: 'Play, search, and discover your favorite songs, artists, playlists and more',
    heroPrompt: 'Play songs where Beyoncé and Jay-Z feature together.',
    can: [
      'Play songs, albums and music videos',
      'Search for songs by artist, genre or lyrics',
      'Show you your playlists and find others you might like',
      'Find similar songs by the same or different artist',
      'Start a radio based on a suggested song or artist',
      'Play music in the background for YouTube Music Premium members using an Android device',
    ],
    cannot: [
      'Like a song or save it to a playlist',
      'Search for songs, artists, and lyrics when asked in a language other than English',
      'Operate playback and volume controls on iOS devices',
    ],
    prompts: ['Search for songs', 'Discover music you\'d love', 'Play a radio for any mood'],
    defaultConnected: true,
  },
];

const OTHER: ConnectedApp[] = [
  /*
   * Not one of Gemini's cards. Willow's own, and the first non-Google connector
   * here, which is why its copy is written rather than captured.
   *
   * The lists below describe what the code actually does — `create_spotify_playlist`
   * really does search for each title and really does make the playlist private, and
   * the cannot list is the set of things that were considered and are absent. Worth
   * keeping honest: this is the only place the user finds out that a playlist Willow
   * makes is private, or that it cannot touch a playlist they already had.
   */
  {
    id: 'spotify',
    name: 'Spotify',
    handle: '@Spotify',
    logo: SPOTIFY_MARK,
    description:
      'Get recommendations and playlists based on what you actually listen to. Willow reads your top artists and tracks and can build new playlists for you. Spotify has not reviewed this app yet, so it only works for accounts the app owner has added by hand.',
    heroPrompt: 'Make me a playlist based on what I’ve been listening to',
    can: [
      'See your top artists and tracks across your whole listening history',
      'List the music you have saved and the playlists you have made',
      'Build a new private playlist from a description, searching Spotify for each track',
      'Describe your taste in music using the genres of the artists you listen to most',
    ],
    cannot: [
      'Play, pause, or control what is playing on any of your devices',
      'Show your full listening history — Spotify publishes no API for it',
      'Change, rename, or delete a playlist you already had',
      'See your email address, country, or subscription tier',
    ],
    prompts: [
      'Describe my taste in music',
      'Make me a playlist for focusing',
      'What have I been listening to lately?',
    ],
    defaultConnected: false,
  },
  /*
   * Also written rather than captured, and the rewrite mattered here more than most.
   *
   * Gemini has a GitHub card and it describes a different product: theirs imports a
   * repository and answers questions about the code, and its "cannot" list says in so
   * many words that it cannot retrieve pull requests or other metadata. Willow's
   * connector is the exact inverse — metadata only, no file contents anywhere — so
   * keeping Gemini's copy would have told the user the opposite of the truth in both
   * directions at once.
   *
   * `defaultConnected: false`, like Spotify's, because this switch is real. The
   * catalogue's `true` means "Gemini shows this on", which is fine for a card that
   * cannot be connected and wrong for one that can.
   */
  {
    id: 'github',
    name: 'GitHub',
    handle: '@GitHub',
    logo: LOGOS.github,
    description:
      'Keep track of what is waiting on you. Willow reads open pull requests and issues that involve you, and the names and languages of your repositories. It never reads your code. GitHub has no browser sign-in, so this one needs an access token you create and paste, and it is kept for this tab only.',
    heroPrompt: 'What pull requests are waiting on my review?',
    can: [
      'List open pull requests you opened, were assigned, were mentioned in, or were asked to review',
      'List open pull requests waiting on someone else’s review',
      'List open issues assigned to you',
      'List your repositories by name, language and when they were last pushed to',
      'Note which languages you work in most, as part of your profile',
    ],
    cannot: [
      'Read any file, commit or diff — Willow only ever sees names and counts',
      'Open, merge, comment on, close or review a pull request',
      'Create, edit or close an issue',
      'See a repository you did not select when you created the token',
      'Keep working after you close the tab — the token is deliberately not saved to disk',
    ],
    prompts: [
      'What’s waiting on my review?',
      'What issues am I assigned?',
      'What have I been working on lately?',
    ],
    defaultConnected: false,
  },
  {
    id: 'canva',
    name: 'Canva',
    handle: '@Canva',
    logo: LOGOS.canva,
    description: 'Search, summarize, and design digital assets with Canva.',
    heroPrompt: '@Canva generate an Instagram story for my Barbeque party this weekend',
    prompts: ['Create a new design', 'Managing assets'],
    defaultConnected: true,
  },
];

export const APP_CATEGORIES: AppCategory[] = [
  { id: 'from-google', name: 'From Google', apps: FROM_GOOGLE },
  { id: 'other', name: 'Other', apps: OTHER },
];

/*
 * There is deliberately no DEFAULT_CONNECTIONS export.
 *
 * There used to be one, built from `defaultConnected` above, and it was what the
 * tab seeded its switches from — so the page opened with nearly every app shown
 * as connected while Willow held no token for any of them. Connection state now
 * comes from `connectionsStore`, which records a product only once Google has
 * actually granted its scopes.
 *
 * `defaultConnected` stays on each entry because it is part of what was captured
 * from Gemini's page — it says which apps Google turns on for you by default —
 * but it must never again be read as "connected here".
 */
