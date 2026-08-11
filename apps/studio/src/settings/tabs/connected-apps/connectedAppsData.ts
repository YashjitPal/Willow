/**
 * Connected Apps catalogue.
 *
 * Card copy, logo URLs and capability lists were extracted from Gemini's live
 * Connected Apps page (gemini.google.com/apps) so the clone matches it exactly.
 * Product-name mentions in the copy are rebranded to Willow; everything else is
 * verbatim.
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
  photos: 'https://www.gstatic.com/images/branding/product/1x/photos_2025_64dp.png',
  youtube: 'https://www.gstatic.com/images/branding/productlogos/youtube/v9/192px.svg',
  youtubeMusic: 'https://www.gstatic.com/chromecast/thirdparty/yt_music_icon.png',
  businessProfile:
    'https://www.gstatic.com/images/branding/productlogos/google_my_business/v7/web-96dp/logo_google_my_business_color_2x_web_96dp.png',
  kbc: 'https://www.gstatic.com/lamda/images/tools/logo_kbc_quiz_a5ffacc989962859bb07.png',
  github: 'https://www.gstatic.com/lamda/images/tools/logo_github_dark_018b0501d5dc2dd3e532c.svg',
  canva: 'https://www.gstatic.com/lamda/images/tools/logo_canva_27c834f6923acc1f886fe.svg',
  contacts: 'https://www.gstatic.com/images/branding/productlogos/contacts_2022/v2/192px.svg',
  verifyAi: 'https://www.gstatic.com/lamda/images/tools/synth_id_logo_dark_mode_fe9c8db14b797dfadf63c.svg',
  wix: 'https://www.gstatic.com/lamda/images/tools/logo_wix_707cd7537d41175b605c8.png',
} as const;

export const LEARN_MORE_URL = 'https://support.google.com/gemini?p=lm_gpi_apps';
export const PRIVACY_HUB_URL = 'https://support.google.com/gemini?p=privacy_help';
export const SUBSCRIPTIONS_URL = 'https://myaccount.google.com/subscriptions?utm_source=gemini';

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
    id: 'photos',
    name: 'Google Photos',
    logo: LOGOS.photos,
    description:
      'Get personalized insights based on your Photos. Find photos of a person, place, moment, and more.',
    heroPrompt: 'Plan a vacation itinerary for me this winter, inspired by photos of my prior trips.',
    can: [
      'Personalize your experience with insights about you and others from your library',
      'Find specific photos and videos based on people, location, or a description',
      'Help with writing that’s inspired by your photos, like caption ideas for social media',
    ],
    cannot: ['Use Photos editing features', 'Add labels, like names or locations', 'Create new albums or edit existing ones'],
    prompts: ['Plan a trip based on my photos', 'Find hidden gems in my city', 'Write a poem about my life'],
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
  {
    id: 'business-profile',
    name: 'Google Business Profile',
    handle: '@Google Business Profile',
    logo: LOGOS.businessProfile,
    description:
      'Manage your Business Profile with Willow. Analyze reviews, interpret performance trends, and update your storefront with ease.',
    heroPrompt: 'Analyze my business performance for the last 30D',
    can: [
      'Update business details, like hours or holiday hours',
      'Analyze and summarize customer reviews and sentiment',
      'Interpret performance trends to provide strategic business insights',
      'Draft and publish engaging posts and updates for your storefront',
      'Offer "contextual help" for operational questions',
      'Upload photos to your storefront',
    ],
    prompts: ['Analyze performance', 'Attract customers', 'Keep information up to date'],
    defaultConnected: true,
  },
  {
    id: 'kbc',
    name: 'KBC',
    handle: '@KBC',
    logo: LOGOS.kbc,
    description: 'Play the Kaun Banega Crorepati quiz game.',
    defaultConnected: true,
  },
];

const OTHER: ConnectedApp[] = [
  {
    id: 'github',
    name: 'GitHub',
    handle: '@GitHub',
    logo: LOGOS.github,
    description: 'Import code from public or private repositories, and ask questions about it.',
    heroPrompt: 'What external libraries are used in the attached code?',
    can: [
      'Help developers better understand the codebase',
      'Answer questions about specific functions',
      'Suggest code additions and improvements',
      'Debug issues',
    ],
    cannot: [
      'Retrieve commit history, PRs, or other metadata',
      'Read a repository by including a GitHub URL in the prompt',
      'Write to a code repository',
    ],
    prompts: ['Understand code', 'Improve code', 'Generate code'],
    defaultConnected: true,
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
  {
    id: 'contacts',
    name: 'Contacts',
    logo: LOGOS.contacts,
    description:
      'Get personalized insights and responses based on your contacts. Add or find people in your contacts, and more.',
    can: [
      'Add new contacts, or delete or modify your contacts',
      'Find contacts by name, number, or email in your Google Contacts or on your device',
      'Get specific answers based on your contacts',
      'Personalize responses and suggestions based on your contacts when you refer to them',
      'Remind you about important dates you’ve saved to your contacts, like birthdays',
      'Share your contacts with other apps or other contacts when you ask',
      'Suggest information to save to your contacts',
      'Suggest contacts to reach out to or add as VIPs',
    ],
    prompts: [
      'Look up a contact’s phone number',
      'Draft an email to a contact',
      'Schedule a meeting with a contact',
    ],
    defaultConnected: true,
  },
  {
    id: 'verify-ai',
    name: 'Verify AI',
    handle: '@Verify AI',
    logo: LOGOS.verifyAi,
    description:
      'Tool to verify provenance of media. Can read C2PA content credentials and detect the SynthID watermark used by Google AI.',
    defaultConnected: true,
  },
  {
    id: 'wix',
    name: 'Wix',
    handle: '@Wix',
    logo: LOGOS.wix,
    description: 'Modular Conversational Website Design.',
    defaultConnected: false,
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
