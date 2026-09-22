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
}

export interface CustomizeCategory {
  id: string;
  title: string;
  items: CustomizeItem[];
}

export const CONNECTORS_DATA: CustomizeItem[] = [
  {
    id: 'google-workspace',
    type: 'connector',
    title: 'Google Workspace',
    subtitle: 'Get personalized insights from your Workspace apps, and ask for info about your content.',
    category: 'Productivity',
    logoSrc: 'https://www.gstatic.com/lamda/images/logo_workspace_2026_844db1cfe6c6bb65dd11a.png',
    hasMoreButton: true,
    signInRequired: 'Consent required',
    prompts: [],
    capTitle: '',
    capabilities: [],
    relatedIds: ['search-services', 'google-photos', 'youtube', 'contacts'],
  },
  {
    id: 'search-services',
    type: 'connector',
    title: 'Search services',
    subtitle: 'Get personalized insights using your saved data from services like Search, Maps, Shopping, News, and Google Flights and Hotels. You can disconnect this anytime on the Connected Apps page. Your choices here don’t change Gemini’s use of public data. For example, if Search services aren’t connected, Gemini can still use public websites and videos in Search services to respond to you.',
    logoSrc: 'https://www.gstatic.com/images/branding/productlogos/googleg/v6/192px.svg',
    hasMoreButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'Show me hidden patterns in my Google searches',
      'What should my next hobby be based on my recent searches?',
      'Create a wishlist for my birthday I can share with my friends and family',
    ],
    capTitle: '',
    capabilities: [],
    relatedIds: ['google-workspace', 'google-photos', 'youtube', 'contacts'],
  },
  {
    id: 'google-photos',
    type: 'connector',
    title: 'Google Photos',
    subtitle: 'Get personalized insights based on your Photos. Find photos of a person, place, moment, and more. Photos editing and album creation are available to eligible users for limited flows.',
    category: 'Media',
    logoSrc: 'https://www.gstatic.com/images/branding/product/1x/photos_2025_64dp.png',
    hasMoreButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'Plan a vacation itinerary for me this winter, inspired by photos of my prior trips.',
      'Look at my photos and create a guide to similar hidden gems in my city',
      'Write a poem about my life based on my recent photos',
    ],
    capTitle: 'Using Google Photos, Gemini can:',
    capabilities: [
      'Personalize your experience with insights about you and others from your library',
      'Find specific photos and videos based on people, location, or a description',
      'Help with writing that\'s inspired by your photos, like caption ideas for social media',
      'Edit media and create albums (limited availability)',
    ],
    relatedIds: ['google-workspace', 'search-services', 'youtube', 'contacts'],
  },
  {
    id: 'youtube',
    type: 'connector',
    title: 'YouTube',
    subtitle: 'Get personalized insights based on your YouTube data, like video and music recommendations. You can disconnect this anytime on the Connected Apps page. When disconnected, you can still use YouTube to find and get info about public videos.',
    category: 'Media',
    logoSrc: 'https://www.gstatic.com/images/branding/productlogos/youtube/v9/192px.svg',
    hasMoreButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'Recommend a film based on my YouTube history',
      'Can you find the latest video I was watching from YouTube?',
      'How would you describe my music tastes?',
    ],
    capTitle: 'Using YouTube, Gemini can:',
    capabilities: [
      'Give you personalized recommendations for videos to learn new skills, see news from your region, and more',
      'Recommend videos and channels based on your YouTube History',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'contacts'],
  },
  {
    id: 'youtube-music',
    type: 'connector',
    title: 'YouTube Music',
    subtitle: 'Play, search, and discover your favorite songs, artists, playlists and more',
    category: 'Media',
    logoSrc: 'https://www.gstatic.com/chromecast/thirdparty/yt_music_icon.png',
    hasMoreButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'Play songs where Beyoncé and Jay-Z feature together.',
      'play some music.',
      'I\'m feeling upbeat and energetic. Find some new dance music that matches my mood.',
    ],
    capTitle: 'Using YouTube Music, Gemini can:',
    capabilities: [
      'Play songs, albums and music videos',
      'Search for songs by artist, genre or lyrics',
      'Show you your playlists and find others you might like',
      'Find similar songs by the same or different artist',
      'Start a radio based on a suggested song or artist',
      'Play music in the background for YouTube Music Premium members using an Android device',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'canva',
    type: 'connector',
    title: 'Canva',
    subtitle: 'Search, summarize, and design digital assets with Canva.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_canva_27c834f6923acc1f886fe.svg',
    hasMoreButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Canva generate an Instagram story for my Barbeque party this weekend',
      '@Canva find all my presentations for Q3 QBRs and move them into the Archive folder',
    ],
    capTitle: '',
    capabilities: [],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'dropbox',
    type: 'connector',
    title: 'Dropbox',
    subtitle: 'This tool interacts with Dropbox through its remote MCP server',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_dropbox_6a65d8dd07a7543af34ce.svg',
    hasMoreButton: true,
    signInRequired: 'Required',
    prompts: [],
    capTitle: '',
    capabilities: [],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'gemini-notebook',
    type: 'connector',
    title: 'Gemini Notebook',
    subtitle: 'Notebooks are a way to organize your projects in Gemini Apps in a dedicated, focused space. Notebooks use both Gemini Apps and Gemini Notebook and share & sync info between both products',
    logoSrc: 'https://www.gstatic.com/images/branding/productlogos/gemini_notebook/v2/192px.svg',
    hasMoreButton: true,
    prompts: [
      'Create a new notebook for my research project',
    ],
    capTitle: 'Using Gemini Notebook, Gemini can:',
    capabilities: [
      'Reference your uploaded sources when responding',
      'Create, edit, and delete notebooks',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'google-business-profile',
    type: 'connector',
    title: 'Google Business Profile',
    subtitle: 'Manage your Business Profile with Gemini. Analyze reviews, interpret performance trends, and update your storefront with ease.',
    logoSrc: 'https://www.gstatic.com/images/branding/productlogos/google_my_business/v7/web-96dp/logo_google_my_business_color_2x_web_96dp.png',
    hasMoreButton: true,
    signInRequired: 'Consent required',
    prompts: [
      'Analyze my business performance for the last 30D',
      'Help me draft a post',
      'Update my hours',
    ],
    capTitle: 'Using Google Business Profile, Gemini can:',
    capabilities: [
      'Update business details, like hours or holiday hours',
      'Analyze and summarize customer reviews and sentiment',
      'Interpret performance trends to provide strategic business insights',
      'Draft and publish engaging posts and updates for your storefront',
      'Offer "contextual help" for operational questions',
      'Upload photos to your storefront',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'kbc',
    type: 'connector',
    title: 'KBC',
    subtitle: 'Play the Kaun Banega Crorepati quiz game or the daily Sanket Suchak challenge.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_kbc_quiz_a5ffacc989962859bb07.png',
    hasMoreButton: true,
    prompts: [],
    capTitle: '',
    capabilities: [],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'verify-ai',
    type: 'connector',
    title: 'Verify AI',
    subtitle: 'Tool to verify provenance of media. Can read C2PA content credentials and detect the SynthID watermark used by Google AI.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/synth_id_logo_dark_mode_fe9c8db14b797dfadf63c.svg',
    hasMoreButton: true,
    prompts: [],
    capTitle: '',
    capabilities: [],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'wispr',
    type: 'connector',
    title: 'Wispr',
    subtitle: 'Search and summarize your recorded meetings and personal notes including key decisions, action items and specific transcripts.',
    logoSrc: 'https://lh3.googleusercontent.com/EHqy23HkAnhFJOgVb4qjww2Dk-N7COry46aIsqH6mF3WyTaxZ6BixgZbI7VDDAi9Nppd',
    hasMoreButton: true,
    signInRequired: 'Required',
    prompts: [
      'What decisions came out of my most recent meetings?',
      'Find my note about the hiring plan and summarize it.',
      'Is there a pre-read for my next meeting?',
    ],
    capTitle: 'Using Wispr, Gemini can:',
    capabilities: [
      'Find and Review Meetings',
      'Scratchpad Note Management',
      'Meeting preparation',
      'Lookup via Wispr Links',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'github',
    type: 'connector',
    title: 'GitHub',
    subtitle: 'Import code from public or private repositories, and ask questions about it.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_github_dark_018b0501d5dc2dd3e532c.svg',
    hasMoreButton: true,
    signInRequired: 'Required',
    prompts: [
      'What external libraries are used in the attached code?',
      'How can the attached code be more efficient?',
      'Write event handlers for the attached code to recommend products to users',
    ],
    capTitle: 'Using GitHub, Gemini can:',
    capabilities: [
      'Help developers better understand the codebase',
      'Answer questions about specific functions',
      'Suggest code additions and improvements',
      'Debug issues',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'contacts',
    type: 'connector',
    title: 'Contacts',
    subtitle: 'Get personalized insights and responses based on your contacts. Add or find people in your contacts, and more.',
    category: 'Communication',
    logoSrc: 'https://www.gstatic.com/images/branding/productlogos/contacts_2022/v2/192px.svg',
    hasMoreButton: true,
    signInRequired: 'Consent required',
    prompts: [],
    capTitle: 'Using Contacts, Gemini can:',
    capabilities: [
      'Add new contacts, or delete or modify your contacts',
      'Find contacts by name, number, or email in your Google Contacts or on your device',
      'Get specific answers based on your contacts',
      'Personalize responses and suggestions based on your contacts when you refer to them',
      'Remind you about important dates you’ve saved to your contacts, like birthdays',
      'Share your contacts with other apps or other contacts when you ask',
      'Suggest information to save to your contacts',
      'Suggest contacts to reach out to or add as VIPs',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'bigin',
    type: 'connector',
    title: 'Bigin',
    subtitle: 'AI-powered CRM for small businesses. Manage leads, deals, emails, calls, and WhatsApp in one place, with meaningful AI built in.',
    logoSrc: 'https://lh3.googleusercontent.com/r2xFxVgF-O0U-l-9eLrUZ4Y_fHD0KMttpmHPxAhqrvUEuE_vd80lrtrzeQRTGM-XNO-H',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Zoho Bigin Move the Google deal from Proposal to Negotiation',
      '@Zoho Bigin Create a new contact for John Doe (john@example.com) under the Google account',
      '@Zoho Bigin Schedule a follow-up call with Sarah for tomorrow at 2 PM',
    ],
    capTitle: 'Using Bigin, Gemini can:',
    capabilities: [
      'Advance a deal through the pipeline',
      'Capture a contact or company from conversation',
      'Log and schedule activities',
      'Pipeline health and reporting',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'fever',
    type: 'connector',
    title: 'Fever',
    subtitle: 'Discover live events, concerts, immersive experiences, and local activities with Fever.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_fever_2dda28d8d96d128169489.jpg',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Fever find popular events and immersive experiences happening in New York City this weekend',
      '@Fever search for candlelight concerts near me with tickets under $50',
      '@Fever what are the highest-rated cultural exhibitions and activities in London?',
    ],
    capTitle: 'Using Fever, Gemini can:',
    capabilities: [
      'Search live entertainment, candlelight concerts, festivals, and immersive exhibitions',
      'Filter events by city, neighborhood, date range, and ticket pricing tiers',
      'Sort experiences by popularity, user ratings, distance, or next available date',
      'View event descriptions, venue locations, session schedules, and booking links',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'granola',
    type: 'connector',
    title: 'Granola',
    subtitle: 'Search, retrieve, and summarize your meeting notes, transcripts, and action items from Granola.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_granola_0704dc7792e0e2b66fe22.svg',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Granola summarize my recent meetings with Sarah from Acme Corp',
      '@Granola what action items were assigned to me in yesterday\'s product sync?',
      '@Granola search my meeting transcripts for discussions about pricing and launch blockers',
    ],
    capTitle: 'Using Granola, Gemini can:',
    capabilities: [
      'Search your meeting history across topics, keywords, attendees, companies, and date ranges',
      'Retrieve and summarize meeting notes, key takeaways, and full transcripts you have access to',
      'Extract decisions, next steps, and action items from past calls',
      'Synthesize insights and answer questions across multiple meetings',
      'Check your connected Granola account and profile details',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'monday-com',
    type: 'connector',
    title: 'Monday.com',
    subtitle: 'Access and manage your Monday.com boards, items, and workflows.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_monday_3de539ba285fffda4ed77.svg',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      'list all of my boards',
      'Add a new task to my board.',
    ],
    capTitle: '',
    capabilities: [],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'webflow',
    type: 'connector',
    title: 'Webflow',
    subtitle: 'The Webflow MCP server connects agents and AI tools directly to your Webflow projects. Import designs, create pages, analyze site activity, work with the CMS and more from your preferred AI environment.',
    logoSrc: 'https://lh3.googleusercontent.com/_Nth-QrilI8VaPzyR-loCQblAhBb3ZDjXnCgO0LyB3B0tYeJFxGj9ppId4cKZ27HH9s',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      'Audit seo metadata for a Webflow site using a deterministic scoring rubric, propose improvements, and apply updates',
    ],
    capTitle: 'Using Webflow, Gemini can:',
    capabilities: [
      'Create and modify a site’s visual design',
      'Build sections, containers, and grids that adapt across breakpoints',
      'Add, arrange, and remove elements like rich text, buttons, form fields, images, and media embeds, and edit their text, tags, attributes, and settings',
      'Reuse or create classes and combo classes, edit CSS properties, build styles from raw CSS, and manage styles across breakpoints',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'wix',
    type: 'connector',
    title: 'Wix',
    subtitle: 'Build, manage, and automate websites and business solutions like eCommerce, Bookings, and Payments with Wix.',
    logoSrc: 'https://www.gstatic.com/lamda/images/tools/logo_wix_707cd7537d41175b605c8.png',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Wix apply a 15% discount to all products on the site Party Costume Store for 1 week starting today',
      '@Wix create a new portfolio website for a freelance photography business',
      '@Wix install the Wix Blog app on my site The Travel Writer',
    ],
    capTitle: 'Using Wix, Gemini can:',
    capabilities: [
      'Create and customize business websites and headless web applications',
      'Manage eCommerce stores, inventory, and promotional discount campaigns',
      'Configure bookings, schedules, events, and business payments',
      'Install and manage Wix apps such as Blog, Stores, and Bookings',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'zoho-crm',
    type: 'connector',
    title: 'Zoho CRM',
    subtitle: 'Zoho CRM supercharges your business with intelligent automation.',
    logoSrc: 'https://lh3.googleusercontent.com/8u17NbWVKAuYuoTSUK6OjmBQofqPrczzl9LouojBy5Sd23YM7Jv1dfZpRZBqqVe1fsBr',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      'Search for any leads in Zoho CRM from the company \'TechStart\' and list their names and emails.',
      'Create a new lead in Zoho CRM for Jane Doe at NewCompany Corp with the email jane.doe@newcompany.com and phone number +91 9155501234',
    ],
    capTitle: 'Using Zoho CRM, Gemini can:',
    capabilities: [
      'automate Zoho CRM leads, deals, and contacts',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'zoho-desk',
    type: 'connector',
    title: 'Zoho Desk',
    subtitle: 'Zoho Desk unifies customers, channels, and context businesses need to deliver exceptional customer service. It simplifies the routine with AI, without overriding human judgment.',
    logoSrc: 'https://lh3.googleusercontent.com/KLovIX9qF-fUngT8AY8c6Vw4QhKfwkzGNK_W9bjOeIIPuBatMMagh576YHw8pyXDM3c',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Zoho Desk Create a high-priority ticket for user jane@example.com with subject "Unable to login to portal"',
      '@Zoho Desk Send a reply to ticket #4821 saying "We have deployed a fix to your account, please verify"',
      '@Zoho Desk Add an internal comment to ticket #3910: "Escalated to engineering team for database patch"',
    ],
    capTitle: 'Using Zoho Desk, Gemini can:',
    capabilities: [
      'Ticket Creation & Resolution: Create support tickets, update priority/status, assign agents, and close tickets.',
      'Replies & Comments: Send email replies directly to customers and add internal team comments on tickets.',
      'Ticket Search & KB Lookup: Search tickets across departments and query help center solution articles.',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'zoho-mail',
    type: 'connector',
    title: 'Zoho Mail',
    subtitle: 'Zoho Mail is an enterprise-grade, secure webmail platform designed for modern business communication.',
    logoSrc: 'https://lh3.googleusercontent.com/i42HK0zjrMWfNXrzIQ1xTJc56i0XukRWY7QHHRWfNl0PtB4oL_p5eJBMXiRmRLiPPjc',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      '@Zoho Mail Find unread emails from TechStart from last week with attachments',
      '@Zoho Mail Draft a reply to Anil agreeing to the contract terms and asking for the final signature link',
      '@Zoho Mail Summarize my inbox for today and highlight urgent action items',
    ],
    capTitle: 'Using Zoho Mail, Gemini can:',
    capabilities: [
      'Email Search & Discovery',
      'Email Drafting & Composition',
      'Mailbox and Folder Organization',
      'Inbox Triage and Daily Summary',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
  {
    id: 'zoho-projects',
    type: 'connector',
    title: 'Zoho Projects',
    subtitle: 'A powerful flexible project management software, built for modern teams. Maintain a project management lifecycle that helps teams plan, track, collaborate, and achieve project goals in a single place.',
    logoSrc: 'https://lh3.googleusercontent.com/n5Oas9Z57oEnIrFRpuy02GVsZK1sR4lUtkHseoKb7Ug7T3jxwGRoYGM0lyN1nO_G4Rd7',
    hasAddButton: true,
    signInRequired: 'Required',
    prompts: [
      'Create a new project on @Zoho Projects called \'Q4 Marketing Campaign\' and set the start date to next Monday',
      'Add a new milestone named \'Design Phase Completion\' to the \'Website Redesign\' project on @Zoho projects with a deadline of October 15th.',
      'Create a task list called \'Frontend Development\' under the \'Mobile App Launch\' project on @Zoho projects',
    ],
    capTitle: 'Using Zoho Projects, Gemini can:',
    capabilities: [
      'Maintain a project management lifecycle',
      'Plan, track and collaborate on team projects',
    ],
    relatedIds: ['google-workspace', 'search-services', 'google-photos', 'youtube'],
  },
];

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
    subtitle: 'Get 3–5 distinct viewpoints before you commit to a decision',
    category: 'Everyday tools',
    symbol: 'potted_plant',
    hasAddButton: true,
    description: 'Get 3–5 distinct viewpoints before you commit to a decision',
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

export const DISCOVER_CATEGORIES: CustomizeCategory[] = [
  {
    id: 'everyday-tools',
    title: 'Everyday tools',
    items: [
      SKILLS_DATA[1], // Match your writing style
      SKILLS_DATA[2], // Focus your energy
      SKILLS_DATA[4], // Generate fresh ideas
      SKILLS_DATA[3], // Get more perspectives
      SKILLS_DATA[5], // Prep for meetings
      CONNECTORS_DATA[0], // Google Workspace
      CONNECTORS_DATA[7], // Gemini Notebook
    ],
  },
  {
    id: 'business-essentials',
    title: 'Business essentials',
    items: [
      SKILLS_DATA[4], // Generate fresh ideas
      SKILLS_DATA[3], // Get more perspectives
      SKILLS_DATA[5], // Prep for meetings
      CONNECTORS_DATA[8], // Google Business Profile
      CONNECTORS_DATA[10], // Verify AI
    ],
  },
  {
    id: 'media-streaming',
    title: 'Media & streaming',
    items: [
      CONNECTORS_DATA[3], // YouTube
      CONNECTORS_DATA[4], // YouTube Music
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
    items: [],
  },
];
