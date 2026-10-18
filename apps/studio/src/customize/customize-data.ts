import { X_MARK } from '@willow/chat/composer/mentions/chat-apps';
import { SPOTIFY_MARK } from '../settings/tabs/connected-apps/connectedAppsData';

export interface CustomizeItem {
  id: string;
  type: 'connector' | 'skill';
  title: string;
  subtitle: string;
  slug?: string;
  category?: string;
  logoSrc?: string;
  symbol?: string;
  hasAddButton?: boolean;
  hasMoreButton?: boolean;
  description?: string;
  signInRequired?: string;
  instructions?: string;
  relatedIds?: string[];
  prompts?: string[];
  capTitle?: string;
  capabilities?: string[];
  /**
   * The MCP preset (`@willow/spark/mcp-catalog`) a connector card connects through, for an app Willow reaches as the
   * vendor's own MCP server rather than through a connector of its own. Connected means that server is added and on.
   */
  mcp?: string;
}

export interface CustomizeCategory {
  id: string;
  title: string;
  items: CustomizeItem[];
}

/**
 * Only the apps Willow can really connect, two ways:
 *
 * - **Willow's own connectors.** The card's id maps to one in
 *   `settings/tabs/connected-apps/connector-map.ts` (see `customize-connectors.ts`).
 * - **The vendor's MCP server.** The card names a preset in `mcp`, and connecting adds
 *   that server (see `customize-mcp.ts`): a sign-in for most, a server address made in
 *   Zoho MCP for Zoho's apps.
 *
 * Gemini's other cards — Search services, Photos, YouTube Music, Contacts, Gemini
 * Notebook, Google Business Profile, KBC, Verify AI — have neither: no browser-reachable
 * API, no public MCP server, or removed on purpose (see `ConnectorProvider` in
 * `@willow/personal`), so they are not listed at all. The copy says what Willow does
 * with each app, not what Gemini does.
 */
export const CONNECTORS_DATA: CustomizeItem[] = [
  {
    id: 'google-workspace',
    type: 'connector',
    title: 'Google Workspace',
    subtitle: 'Gmail, Calendar, Docs, Drive and Tasks, connected with one permission screen.',
    category: 'Productivity',
    logoSrc: 'https://www.gstatic.com/lamda/images/logo_workspace_2026_844db1cfe6c6bb65dd11a.png',
    hasAddButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'What’s on my calendar this week?',
      'What tasks do I have due?',
      'Who emailed me today?',
    ],
    capTitle: 'Using Google Workspace, Willow can:',
    capabilities: [
      'See your upcoming events, and add events when you ask',
      'See email senders, subjects and labels — and read contents only if you allow it',
      'Read what tasks you have due, and add tasks on request',
      'Create documents and save files to your Drive; it only sees files it created',
    ],
    relatedIds: ['youtube', 'github', 'spotify'],
  },
  {
    id: 'youtube',
    type: 'connector',
    title: 'YouTube',
    subtitle: 'Get recommendations from the videos you liked and the channels you subscribe to, and make playlists.',
    category: 'Media',
    logoSrc: 'https://www.gstatic.com/images/branding/productlogos/youtube/v9/192px.svg',
    hasAddButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'Recommend a film based on what I like on YouTube',
      'Which channels do I subscribe to?',
      'Make me a playlist of videos for learning to cook',
    ],
    capTitle: 'Using YouTube, Willow can:',
    capabilities: [
      'See the videos you liked and the channels you subscribe to',
      'Create playlists for you',
      'It cannot see your watch history — YouTube has no API for it',
    ],
    relatedIds: ['google-workspace', 'spotify'],
  },
  {
    id: 'canva',
    type: 'connector',
    title: 'Canva',
    subtitle: 'Search, summarize, and design digital assets with Canva.',
    category: 'Design',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_canva_27c834f6923acc1f886fe.svg',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Canva generate an Instagram story for my Barbeque party this weekend',
      '@Canva find all my presentations for Q3 QBRs and move them into the Archive folder',
    ],
    relatedIds: ['webflow', 'wix', 'dropbox'],
    mcp: 'canva',
  },
  {
    id: 'dropbox',
    type: 'connector',
    title: 'Dropbox',
    subtitle: 'This tool interacts with Dropbox through its remote MCP server',
    category: 'Productivity',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_dropbox_6a65d8dd07a7543af34ce.svg',
    hasAddButton: true,
    signInRequired: 'Required',
    relatedIds: ['google-workspace', 'canva'],
    mcp: 'dropbox',
  },
  {
    id: 'wispr',
    type: 'connector',
    title: 'Wispr Flow',
    subtitle: 'Search and summarize your recorded meetings and personal notes including key decisions, action items and specific transcripts.',
    category: 'Productivity',
    logoSrc: 'https://lh3.googleusercontent.com/EHqy23HkAnhFJOgVb4qjww2Dk-N7COry46aIsqH6mF3WyTaxZ6BixgZbI7VDDAi9Nppd',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      'What decisions came out of my most recent meetings?',
      'Find my note about the hiring plan and summarize it.',
      'Is there a pre-read for my next meeting?',
    ],
    capTitle: 'Using Wispr Flow, Willow can:',
    capabilities: [
      'Find and Review Meetings',
      'Scratchpad Note Management',
      'Meeting preparation',
      'Lookup via Wispr Links',
    ],
    relatedIds: ['granola', 'google-workspace'],
    mcp: 'wispr-flow',
  },
  {
    // Willow's connector reads metadata only, the inverse of Gemini's code-import card.
    id: 'github',
    type: 'connector',
    title: 'GitHub',
    subtitle: 'Keep track of what is waiting on you: open pull requests and issues that involve you. Willow never reads your code.',
    category: 'Productivity',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_github_dark_018b0501d5dc2dd3e532c.svg',
    hasAddButton: true,
    signInRequired: 'Access token required',
    prompts: [
      'What’s waiting on my review?',
      'What issues am I assigned?',
      'What have I been working on lately?',
    ],
    capTitle: 'Using GitHub, Willow can:',
    capabilities: [
      'List open pull requests you opened, were assigned, were mentioned in, or were asked to review',
      'List open issues assigned to you',
      'List your repositories by name, language and when they were last pushed to',
      'It never reads a file, commit or diff, and cannot change anything',
    ],
    relatedIds: ['google-workspace'],
  },
  {
    id: 'bigin',
    type: 'connector',
    title: 'Bigin',
    subtitle: 'AI-powered CRM for small businesses. Manage leads, deals, emails, calls, and WhatsApp in one place, with meaningful AI built in.',
    category: 'Business',
    logoSrc: 'https://lh3.googleusercontent.com/r2xFxVgF-O0U-l-9eLrUZ4Y_fHD0KMttpmHPxAhqrvUEuE_vd80lrtrzeQRTGM-XNO-H',
    hasAddButton: true,
    signInRequired: 'Server address required',
    prompts: [
      '@Bigin Move the Google deal from Proposal to Negotiation',
      '@Bigin Create a new contact for John Doe (john@example.com) under the Google account',
      '@Bigin Schedule a follow-up call with Sarah for tomorrow at 2 PM',
    ],
    capTitle: 'Using Bigin, Willow can:',
    capabilities: [
      'Advance a deal through the pipeline',
      'Capture a contact or company from conversation',
      'Log and schedule activities',
      'Pipeline health and reporting',
    ],
    relatedIds: ['zoho-crm', 'zoho-mail', 'google-workspace'],
    mcp: 'bigin',
  },
  {
    id: 'fever',
    type: 'connector',
    title: 'Fever',
    subtitle: 'Discover live events, concerts, immersive experiences, and local activities with Fever.',
    category: 'Entertainment',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_fever_2dda28d8d96d128169489.jpg',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Fever find popular events and immersive experiences happening in New York City this weekend',
      '@Fever search for candlelight concerts near me with tickets under $50',
      '@Fever what are the highest-rated cultural exhibitions and activities in London?',
    ],
    capTitle: 'Using Fever, Willow can:',
    capabilities: [
      'Search live entertainment, candlelight concerts, festivals, and immersive exhibitions',
      'Filter events by city, neighborhood, date range, and ticket pricing tiers',
      'Sort experiences by popularity, user ratings, distance, or next available date',
      'View event descriptions, venue locations, session schedules, and booking links',
    ],
    relatedIds: ['google-workspace', 'spotify'],
    mcp: 'fever',
  },
  {
    id: 'granola',
    type: 'connector',
    title: 'Granola',
    subtitle: 'Search, retrieve, and summarize your meeting notes, transcripts, and action items from Granola.',
    category: 'Productivity',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_granola_0704dc7792e0e2b66fe22.svg',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Granola summarize my recent meetings with Sarah from Acme Corp',
      '@Granola what action items were assigned to me in yesterday\'s product sync?',
      '@Granola search my meeting transcripts for discussions about pricing and launch blockers',
    ],
    capTitle: 'Using Granola, Willow can:',
    capabilities: [
      'Search your meeting history across topics, keywords, attendees, companies, and date ranges',
      'Retrieve and summarize meeting notes, key takeaways, and full transcripts you have access to',
      'Extract decisions, next steps, and action items from past calls',
      'Synthesize insights and answer questions across multiple meetings',
      'Check your connected Granola account and profile details',
    ],
    relatedIds: ['wispr', 'google-workspace'],
    mcp: 'granola',
  },
  {
    id: 'monday-com',
    type: 'connector',
    title: 'monday.com',
    subtitle: 'Access and manage your monday.com boards, items, and workflows.',
    category: 'Productivity',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_monday_3de539ba285fffda4ed77.svg',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      'list all of my boards',
      'Add a new task to my board.',
    ],
    relatedIds: ['zoho-projects', 'google-workspace'],
    mcp: 'monday',
  },
  {
    id: 'webflow',
    type: 'connector',
    title: 'Webflow',
    subtitle: 'The Webflow MCP server connects agents and AI tools directly to your Webflow projects. Import designs, create pages, analyze site activity, work with the CMS and more from your preferred AI environment.',
    category: 'Design',
    logoSrc: 'https://lh3.googleusercontent.com/_Nth-QrilI8VaPzyR-loCQblAhBb3ZDjXnCgO0LyB3B0tYeJFxGj9ppId4cKZ27HH9s',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      'Audit seo metadata for a Webflow site using a deterministic scoring rubric, propose improvements, and apply updates',
    ],
    capTitle: 'Using Webflow, Willow can:',
    capabilities: [
      'Create and modify a site’s visual design',
      'Build sections, containers, and grids that adapt across breakpoints',
      'Add, arrange, and remove elements like rich text, buttons, form fields, images, and media embeds, and edit their text, tags, attributes, and settings',
      'Reuse or create classes and combo classes, edit CSS properties, build styles from raw CSS, and manage styles across breakpoints',
    ],
    relatedIds: ['wix', 'canva'],
    mcp: 'webflow',
  },
  {
    id: 'wix',
    type: 'connector',
    title: 'Wix',
    subtitle: 'Build, manage, and automate websites and business solutions like eCommerce, Bookings, and Payments with Wix.',
    category: 'Design',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_wix_707cd7537d41175b605c8.png',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Wix apply a 15% discount to all products on the site Party Costume Store for 1 week starting today',
      '@Wix create a new portfolio website for a freelance photography business',
      '@Wix install the Wix Blog app on my site The Travel Writer',
    ],
    capTitle: 'Using Wix, Willow can:',
    capabilities: [
      'Create and customize business websites and headless web applications',
      'Manage eCommerce stores, inventory, and promotional discount campaigns',
      'Configure bookings, schedules, events, and business payments',
      'Install and manage Wix apps such as Blog, Stores, and Bookings',
    ],
    relatedIds: ['webflow', 'canva'],
    mcp: 'wix',
  },
  {
    id: 'zoho-crm',
    type: 'connector',
    title: 'Zoho CRM',
    subtitle: 'Zoho CRM supercharges your business with intelligent automation.',
    category: 'Business',
    logoSrc: 'https://lh3.googleusercontent.com/8u17NbWVKAuYuoTSUK6OjmBQofqPrczzl9LouojBy5Sd23YM7Jv1dfZpRZBqqVe1fsBr',
    hasAddButton: true,
    signInRequired: 'Server address required',
    prompts: [
      'Search for any leads in Zoho CRM from the company \'TechStart\' and list their names and emails.',
      'Create a new lead in Zoho CRM for Jane Doe at NewCompany Corp with the email jane.doe@newcompany.com and phone number +91 9155501234',
    ],
    capTitle: 'Using Zoho CRM, Willow can:',
    capabilities: ['automate Zoho CRM leads, deals, and contacts'],
    relatedIds: ['bigin', 'zoho-desk', 'zoho-mail'],
    mcp: 'zoho-crm',
  },
  {
    id: 'zoho-desk',
    type: 'connector',
    title: 'Zoho Desk',
    subtitle: 'Zoho Desk unifies customers, channels, and context businesses need to deliver exceptional customer service. It simplifies the routine with AI, without overriding human judgment.',
    category: 'Business',
    logoSrc: 'https://lh3.googleusercontent.com/KLovIX9qF-fUngT8AY8c6Vw4QhKfwkzGNK_W9bjOeIIPuBatMMagh576YHw8pyXDM3c',
    hasAddButton: true,
    signInRequired: 'Server address required',
    prompts: [
      '@Zoho Desk Create a high-priority ticket for user jane@example.com with subject "Unable to login to portal"',
      '@Zoho Desk Send a reply to ticket #4821 saying "We have deployed a fix to your account, please verify"',
      '@Zoho Desk Add an internal comment to ticket #3910: "Escalated to engineering team for database patch"',
    ],
    capTitle: 'Using Zoho Desk, Willow can:',
    capabilities: [
      'Ticket Creation & Resolution: Create support tickets, update priority/status, assign agents, and close tickets.',
      'Replies & Comments: Send email replies directly to customers and add internal team comments on tickets.',
      'Ticket Search & KB Lookup: Search tickets across departments and query help center solution articles.',
    ],
    relatedIds: ['zoho-crm', 'zoho-mail'],
    mcp: 'zoho-desk',
  },
  {
    id: 'zoho-mail',
    type: 'connector',
    title: 'Zoho Mail',
    subtitle: 'Zoho Mail is an enterprise-grade, secure webmail platform designed for modern business communication.',
    category: 'Business',
    logoSrc: 'https://lh3.googleusercontent.com/i42HK0zjrMWfNXrzIQ1xTJc56i0XukRWY7QHHRWfNl0PtB4oL_p5eJBMXiRmRLiPPjc',
    hasAddButton: true,
    signInRequired: 'Server address required',
    prompts: [
      '@Zoho Mail Find unread emails from TechStart from last week with attachments',
      '@Zoho Mail Draft a reply to Anil agreeing to the contract terms and asking for the final signature link',
      '@Zoho Mail Summarize my inbox for today and highlight urgent action items',
    ],
    capTitle: 'Using Zoho Mail, Willow can:',
    capabilities: [
      'Email Search & Discovery',
      'Email Drafting & Composition',
      'Mailbox and Folder Organization',
      'Inbox Triage and Daily Summary',
    ],
    relatedIds: ['zoho-crm', 'zoho-desk', 'google-workspace'],
    mcp: 'zoho-mail',
  },
  {
    id: 'zoho-projects',
    type: 'connector',
    title: 'Zoho Projects',
    subtitle: 'A powerful flexible project management software, built for modern teams. Maintain a project management lifecycle that helps teams plan, track, collaborate, and achieve project goals in a single place.',
    category: 'Productivity',
    logoSrc: 'https://lh3.googleusercontent.com/n5Oas9Z57oEnIrFRpuy02GVsZK1sR4lUtkHseoKb7Ug7T3jxwGRoYGM0lyN1nO_G4Rd7',
    hasAddButton: true,
    signInRequired: 'Server address required',
    prompts: [
      'Create a new project on @Zoho Projects called \'Q4 Marketing Campaign\' and set the start date to next Monday',
      'Add a new milestone named \'Design Phase Completion\' to the \'Website Redesign\' project on @Zoho Projects with a deadline of October 15th.',
      'Create a task list called \'Frontend Development\' under the \'Mobile App Launch\' project on @Zoho Projects',
    ],
    capTitle: 'Using Zoho Projects, Willow can:',
    capabilities: [
      'Maintain a project management lifecycle',
      'Plan, track and collaborate on team projects',
    ],
    relatedIds: ['monday-com', 'zoho-crm'],
    mcp: 'zoho-projects',
  },
  {
    // X's own MCP server, not one of Gemini's cards. Every request goes through the user's own X developer app.
    id: 'x',
    type: 'connector',
    title: 'X',
    subtitle: 'Search posts, look up accounts, and follow what’s trending and in the news on X.',
    category: 'Social',
    logoSrc: X_MARK,
    hasAddButton: true,
    signInRequired: 'X developer app required',
    description:
      'X answers through an X developer app of your own, and bills each request to that app’s credits or plan, so the app needs to be on pay-per-use or a paid plan. Its Bearer token lets Willow read X; signing in with the app lets Willow use X as you.',
    prompts: [
      'What are people on @X saying about the new iPhone?',
      'Summarize what NASA has posted on @X this week',
      'What’s trending on @X in London right now?',
    ],
    capTitle: 'Using X, Willow can:',
    capabilities: [
      'Search recent posts, and see who liked, reposted or quoted one',
      'Look up accounts, their posts and their mentions',
      'Follow the news and what’s trending in a place',
      'Signed in with your app, read your home timeline and bookmarks, and add or remove bookmarks',
      'It cannot post, reply or send messages',
    ],
    relatedIds: ['x-reader', 'youtube'],
    mcp: 'x',
  },
  {
    // Willow's own program for X (`services/local-companion/src/mcp-servers/x-reader.py`), run in the desktop app.
    id: 'x-reader',
    type: 'connector',
    title: 'X Reader',
    subtitle: 'Read posts, threads, accounts and trends on X with your own X account, at no cost.',
    category: 'Social',
    logoSrc: X_MARK,
    hasAddButton: true,
    signInRequired: 'Your X account',
    description:
      'X Reader is Willow’s own, unofficial way to read X. It runs on your computer in the Willow desktop app and reads X’s website signed in to your X account, the way a browser does, so there is no developer app and nothing to pay. It can’t post or change anything. X’s rules don’t allow reading it this way, and X can limit or suspend an account it catches, so connect one you could do without.',
    prompts: [
      'Use @X Reader to sum up what people are saying about the new iPhone',
      'What has NASA posted this week? Check @X Reader',
      'Use @X Reader to see what’s trending on X right now',
    ],
    capTitle: 'Using X Reader, Willow can:',
    capabilities: [
      'Search posts with X’s own search operators',
      'Read a post, its replies, or a whole thread',
      'Look up accounts, their posts, who follows them and who they follow',
      'Read lists, your bookmarks, and what’s trending',
      'It cannot post, reply, like, follow or send messages',
    ],
    relatedIds: ['x', 'youtube'],
    mcp: 'x-reader',
  },
  {
    // Willow's own connector, not one of Gemini's cards; copy from Connected Apps.
    id: 'spotify',
    type: 'connector',
    title: 'Spotify',
    subtitle: 'Get recommendations and playlists based on what you actually listen to. Willow reads your top artists and tracks and can build new playlists for you.',
    category: 'Media',
    logoSrc: SPOTIFY_MARK,
    hasAddButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'Describe my taste in music',
      'Make me a playlist for focusing',
      'What have I been listening to lately?',
    ],
    capTitle: 'Using Spotify, Willow can:',
    capabilities: [
      'See your top artists and tracks across your whole listening history',
      'List the music you have saved and the playlists you have made',
      'Build a new private playlist from a description, searching Spotify for each track',
      'It cannot play or control music on your devices',
    ],
    relatedIds: ['youtube'],
  },
];

const connector = (id: string): CustomizeItem => CONNECTORS_DATA.find((item) => item.id === id)!;

export const SKILLS_DATA: CustomizeItem[] = [
  {
    id: 'apple-music-playlist',
    type: 'skill',
    title: 'apple-music-playlist',
    slug: 'apple-music-playlist',
    subtitle: 'Guide for creating playlists on Apple Music. Ensures the playlist is created first before attempting to add songs.',
    category: 'Everyday tools',
    symbol: 'edit_note',
    hasMoreButton: true,
    description: 'Guide for creating playlists on Apple Music. Use when the user asks to create, build, or generate a playlist on Apple Music. Ensures the playlist is created first before attempting to add songs.',
    instructions: `# Apple Music Playlist

Instructions for creating playlists on Apple Music.

## When to Use
Use when the user requests to create, make, or set up a playlist on Apple Music (with or without a specified list of songs).

## Steps
1. **Verify Music Catalog**: Identify the songs, artists, or genres requested by the user.
2. **Create Playlist Container**: Initialize the new playlist with a descriptive title and cover metadata.
3. **Add Songs**: Append verified track identifiers sequentially.
4. **Confirm**: Provide a link or confirmation with track count and duration.`,
  },
  {
    id: 'match-writing-style',
    type: 'skill',
    title: 'Match your writing style',
    slug: 'match-my-writing-style',
    subtitle: 'Learns your voice from your real writing across Workspace apps',
    category: 'Everyday tools',
    symbol: 'draw',
    hasAddButton: true,
    description: 'Learns your voice from your real writing across Workspace apps',
    instructions: 'Always-on skill that ensures every piece of writing sounds like the user. On first activation, auto-scans the workspace to build a persistent Voice Card — sentence length, vocabulary, tone, openings, closings, punctuation quirks, and channel-specific registers from real writing samples. The card is saved in Google Drive and every future draft uses it automatically. This skill triggers on ANY writing request — emails, messages, posts, docs, memos, replies, summaries, announcements, or any other written output. The user should never have to ask to "sound like me" — it just happens.',
  },
  {
    id: 'focus-energy',
    type: 'skill',
    title: 'Focus your energy',
    slug: 'focus-my-energy',
    subtitle: 'Align your workload with your energy instead of your calendar',
    category: 'Everyday tools',
    symbol: 'target',
    hasAddButton: true,
    description: 'Align your workload with your energy instead of your calendar',
    instructions: 'Matches tasks to the user\'s current energy level — deep work when sharp, admin when fried. Classifies any task list by cognitive demand and recommends what to work on NOW based on time-of-day heuristics and self-reported energy state. Use when the user asks what to work on next, says they\'re tired or overwhelmed, or needs help prioritizing by mental bandwidth rather than deadline.',
  },
  {
    id: 'get-perspectives',
    type: 'skill',
    title: 'Get more perspectives',
    slug: 'get-more-perspectives',
    subtitle: 'Get 3-5 distinct viewpoints before you commit to a decision',
    category: 'Everyday tools',
    symbol: 'potted_plant',
    hasAddButton: true,
    description: 'Get 3-5 distinct viewpoints before you commit to a decision',
    instructions: 'Convenes a virtual advisory panel of experts — each with a distinct expertise and perspective — to weigh in on any decision, strategy, or dilemma. Default panel includes an Operator (execution), a Skeptic (risk), a Visionary (opportunity), a Customer Advocate (user impact), and a Finance Mind (numbers). Each advisor gives their take independently, then the skill synthesizes a panel recommendation. Use when the user wants multiple perspectives on a big decision, is stuck between options, or says \'what would experts think.\'',
  },
  {
    id: 'generate-ideas',
    type: 'skill',
    title: 'Generate fresh ideas',
    slug: 'generate-fresh-ideas',
    subtitle: 'Turn existing content into 5 entirely new creative concepts',
    category: 'Everyday tools',
    symbol: 'lightbulb',
    hasAddButton: true,
    description: 'Turn existing content into 5 entirely new creative concepts',
    instructions: 'Generates 5 derivative content ideas from any source material through fixed creative lenses: Contrarian Take, Personal Story Hook, Data/Evidence Angle, Practical Playbook, and What They Missed. Each remix is a genuinely new angle, not a summary or rephrase. Use when the user shares existing content (article, tweet, notes, transcript) and wants fresh content ideas, new angles, or ways to repurpose it.',
  },
  {
    id: 'prep-meetings',
    type: 'skill',
    title: 'Prep for meetings',
    slug: 'prep-for-meetings',
    subtitle: 'Prep for any meeting with a brief — including context, goals, danger zones',
    category: 'Everyday tools',
    symbol: 'whiteboard',
    hasAddButton: true,
    description: 'Prep for any meeting with a brief — including context, goals, danger zones',
    instructions: 'Scans workspace notes, tasks, and past meeting records for mentions of the user\'s name to surface what they owe, what they need to know, and what could blindside them. Produces a tight TL;DR brief (must do, must know, watch out) and a 30-second glance card. Use when the user has an upcoming meeting and asks to be prepped, or wants to know what to prepare for a specific meeting.',
  },
];

/** Discover's card for Prep for meetings words its line as Gemini's Discover does; the Skills tab keeps the dash. */
const PREP_FOR_MEETINGS: CustomizeItem = {
  ...SKILLS_DATA[5],
  subtitle: 'Prep for any meeting with a brief, including context, goals, danger zones',
};

export const DISCOVER_CATEGORIES: CustomizeCategory[] = [
  {
    id: 'everyday-tools',
    title: 'Everyday tools',
    items: [
      SKILLS_DATA[1], // Match your writing style
      SKILLS_DATA[2], // Focus your energy
      SKILLS_DATA[4], // Generate fresh ideas
      SKILLS_DATA[3], // Get more perspectives
      PREP_FOR_MEETINGS,
      connector('google-workspace'),
      connector('github'),
      connector('canva'),
      connector('dropbox'),
      connector('granola'),
    ],
  },
  {
    id: 'business-essentials',
    title: 'Business essentials',
    items: [
      SKILLS_DATA[4], // Generate fresh ideas
      SKILLS_DATA[3], // Get more perspectives
      PREP_FOR_MEETINGS,
      connector('google-workspace'),
      connector('monday-com'),
      connector('zoho-crm'),
      connector('bigin'),
      connector('wix'),
    ],
  },
  {
    id: 'media-streaming',
    title: 'Media & streaming',
    items: [
      connector('youtube'),
      connector('spotify'),
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    items: [],
  },
  {
    id: 'travel',
    title: 'Travel',
    items: [
      connector('fever'),
    ],
  },
];
