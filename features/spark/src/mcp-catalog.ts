/**
 * Apps that connect as remote MCP servers, ready to add: what they are, where they answer, and how they sign in.
 *
 * Servers that take no sign-in, a key the user pastes or an address they copy, and — in the desktop app — servers
 * the user signs in to with OAuth, registering Willow where the server lets apps register or using an app of the
 * user's own where it does not, and programs the companion starts on this computer. Servers that admit only clients
 * they approved (Figma, Vercel) are left out.
 * Addresses and sign-in were checked against each vendor's documentation (October 2026); for Canva, Dropbox, Webflow,
 * Wix, Granola, Fever, Wispr Flow and monday.com, Willow's own registration request was also sent and accepted. X's
 * server names its sign-in but registers no apps, so it takes a token, or a sign-in with an app of the user's own.
 * X Reader is Willow's own program for X, read with the session of the user's browser: no app, no cost, no writing.
 *
 * Everything a server offers reaches Spark and every bot as its tools, once the user turns it on here. The apps
 * Gemini lists as cards are cards in Customize → Connectors too (`apps/studio/src/customize/customize-mcp.ts`), and
 * Chat offers a server's tools on a turn that names its app (`features/chat/src/mcp-chat.ts`).
 */
import type { McpServerConfig } from '@willow/ai/mcp/mcp-store';

/**
 * An app the user makes with a service that does not let apps register themselves: where they make it, the redirect
 * address to register in it, and — for a server that names every scope its API has — the scopes a sign-in asks for.
 */
export interface McpOwnApp {
  link: string;
  redirect: string;
  scopes?: string[];
}

export type McpPresetAuth =
  | { kind: 'none' }
  /**
   * A key or token in a header: `authorization` under its `scheme` — Bearer unless the vendor says otherwise
   * (Sentry's `Sentry-Bearer`; `Basic` for an `email:token` pair, encoded here) — or `x-api-key` as it is.
   * `signIn`: the server also takes a browser sign-in and lets Willow register itself, offered instead of a key.
   * `ownApp`: the server also takes a sign-in with an app of the user's own, offered beside the key.
   */
  | { kind: 'key'; header: 'authorization' | 'x-api-key'; scheme?: 'Bearer' | 'Sentry-Bearer' | 'Basic'; optional?: boolean; signIn?: boolean; ownApp?: McpOwnApp; label: string; link: string }
  /** The user's own server address from the vendor's dashboard, on one of `hosts`. */
  | { kind: 'url'; hosts: string[]; label: string; link: string }
  /**
   * Signed in to in the browser (`mcp-signin.ts`), from the desktop app. Willow registers itself where the server
   * lets apps register; `ownApp` is for services that ask each user to make an app of their own.
   */
  | { kind: 'oauth'; ownApp?: McpOwnApp }
  /**
   * A program on this computer, in the desktop app (the companion's `mcp.*`): the command that starts it, and what
   * that command comes with. `folder`: it works in a folder the user picks, given as its last argument. `bundled`:
   * one Willow ships, which the companion runs from its own copy, so `command` and `args` only say what runs.
   * `session`: it reads a site as the user, with that site's cookies.
   */
  | { kind: 'program'; command: string; args: string[]; comesWith: string; folder?: true; bundled?: string; session?: McpSession };

/**
 * A site's sign-in that a program reads the site with: the cookies it needs from `site`, and the variable they reach it
 * in, written as a Cookie header writes them (`auth_token=…; ct0=…`). In the desktop app the user signs in to the site
 * in a browser window the companion opens, which hands the cookies back (`site-sign-in.ts`); or they paste them from
 * their own browser. `name` is the site's, as a button says it ("Sign in to X").
 */
export interface McpSession {
  site: string;
  name: string;
  cookies: string[];
  env: string;
}

/** The redirect address a user's own app is registered with, for any service that asks for one. */
export const OWN_APP_REDIRECT = 'http://localhost:3334/oauth/callback';

/**
 * X's own-app sign-in. X matches a callback exactly and asks for a loopback one as 127.0.0.1, not localhost. Its
 * server names every scope its API has, direct messages, blocks and the developer account's billing among them; a
 * sign-in asks for reading, and for bookmarks, which its tools also change.
 */
const X_APP: McpOwnApp = {
  link: 'https://console.x.com',
  redirect: 'http://127.0.0.1:3334/oauth/callback',
  scopes: ['tweet.read', 'users.read', 'follows.read', 'like.read', 'list.read', 'bookmark.read', 'bookmark.write', 'offline.access'],
};

/** Where Zoho's MCP servers answer, one domain per data centre (`https://<server>.zohomcp.<domain>/mcp/message?key=…`). */
const ZOHO_MCP_HOSTS = ['zohomcp.com', 'zohomcp.eu', 'zohomcp.in', 'zohomcp.com.au', 'zohomcp.com.cn', 'zohomcp.jp', 'zohomcp.sa', 'zohomcp.ae'];
const zohoServer = (app: string): McpPresetAuth => ({ kind: 'url', hosts: ZOHO_MCP_HOSTS, label: `Your Zoho MCP server address, with ${app}'s tools in it`, link: 'https://mcp.zoho.com' });

export interface McpPreset {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: string;
  url: string;
  auth: McpPresetAuth;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'zapier',
    label: 'Zapier',
    description: 'Thousands of apps — Slack, Google Sheets, Notion, HubSpot, Trello and more — through your Zapier account.',
    icon: 'hub',
    group: 'Connect many apps at once',
    url: '',
    auth: { kind: 'url', hosts: ['zapier.com'], label: 'Your Zapier MCP server address', link: 'https://zapier.com/mcp' },
  },
  {
    id: 'composio',
    label: 'Composio',
    description: 'Hundreds of apps — Gmail, Slack, Notion, Linear, Jira and more — through your Composio account.',
    icon: 'device_hub',
    group: 'Connect many apps at once',
    url: '',
    auth: { kind: 'url', hosts: ['composio.dev'], label: 'Your Composio MCP server address', link: 'https://mcp.composio.dev' },
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Repositories, issues, pull requests, Actions and code search.',
    icon: 'code',
    group: 'Code',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: { kind: 'key', header: 'authorization', label: 'Personal access token', link: 'https://github.com/settings/personal-access-tokens/new' },
  },
  {
    id: 'context7',
    label: 'Context7',
    description: 'Up-to-date documentation and examples for code libraries.',
    icon: 'menu_book',
    group: 'Code',
    url: 'https://mcp.context7.com/mcp',
    auth: { kind: 'key', header: 'authorization', optional: true, label: 'API key (optional, for higher limits)', link: 'https://context7.com/dashboard' },
  },
  {
    id: 'deepwiki',
    label: 'DeepWiki',
    description: 'Ask questions about any public GitHub repository.',
    icon: 'school',
    group: 'Code',
    url: 'https://mcp.deepwiki.com/mcp',
    auth: { kind: 'none' },
  },
  {
    id: 'microsoft-learn',
    label: 'Microsoft Learn',
    description: 'Microsoft and Azure documentation and code samples.',
    icon: 'library_books',
    group: 'Code',
    url: 'https://learn.microsoft.com/api/mcp',
    auth: { kind: 'none' },
  },
  {
    id: 'hugging-face',
    label: 'Hugging Face',
    description: 'Models, datasets, papers and Spaces.',
    icon: 'neurology',
    group: 'Code',
    url: 'https://huggingface.co/mcp',
    auth: { kind: 'key', header: 'authorization', label: 'Access token', link: 'https://huggingface.co/settings/tokens' },
  },
  {
    id: 'exa',
    label: 'Exa',
    description: 'Web search built for agents, with page contents.',
    icon: 'travel_explore',
    group: 'Search and research',
    url: 'https://mcp.exa.ai/mcp',
    auth: { kind: 'key', header: 'x-api-key', optional: true, label: 'API key (optional, for higher limits)', link: 'https://dashboard.exa.ai/api-keys' },
  },
  {
    id: 'tavily',
    label: 'Tavily',
    description: 'Web search, page extraction and site crawling.',
    icon: 'manage_search',
    group: 'Search and research',
    url: 'https://mcp.tavily.com/mcp/',
    auth: { kind: 'key', header: 'authorization', label: 'API key', link: 'https://app.tavily.com/home' },
  },
  {
    id: 'sentry',
    label: 'Sentry',
    description: 'Errors, issues, traces and releases from your Sentry projects.',
    icon: 'bug_report',
    group: 'Code',
    url: 'https://mcp.sentry.dev/mcp',
    auth: { kind: 'key', header: 'authorization', signIn: true, scheme: 'Sentry-Bearer', label: 'User auth token', link: 'https://sentry.io/settings/account/api/auth-tokens/' },
  },
  {
    id: 'neon',
    label: 'Neon',
    description: 'Serverless Postgres: projects, branches, schema changes and SQL.',
    icon: 'database',
    group: 'Code',
    url: 'https://mcp.neon.tech/mcp',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'API key', link: 'https://console.neon.tech/app/settings/api-keys' },
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Projects, tables, SQL, edge functions and logs — for development data, not production.',
    icon: 'stacks',
    group: 'Code',
    url: 'https://mcp.supabase.com/mcp',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'Personal access token', link: 'https://supabase.com/dashboard/account/tokens' },
  },
  {
    id: 'postman',
    label: 'Postman',
    description: 'Workspaces, collections, requests and API specifications.',
    icon: 'api',
    group: 'Code',
    url: 'https://mcp.postman.com/minimal',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'API key', link: 'https://web.postman.co/settings/me/api-keys' },
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    description: 'Your Cloudflare account: Workers, DNS, storage and the rest of its API.',
    icon: 'cloud',
    group: 'Code',
    url: 'https://mcp.cloudflare.com/mcp',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'API token', link: 'https://dash.cloudflare.com/profile/api-tokens' },
  },
  {
    id: 'cloudflare-docs',
    label: 'Cloudflare Docs',
    description: 'Up-to-date Cloudflare documentation, searchable.',
    icon: 'description',
    group: 'Code',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    auth: { kind: 'none' },
  },
  {
    id: 'aws-knowledge',
    label: 'AWS Knowledge',
    description: 'AWS documentation, code samples and which APIs each region offers.',
    icon: 'cloud_circle',
    group: 'Code',
    url: 'https://knowledge-mcp.global.api.aws',
    auth: { kind: 'none' },
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    description: 'Search the web, and read or crawl any site as clean text.',
    icon: 'local_fire_department',
    group: 'Search and research',
    url: 'https://mcp.firecrawl.dev/v2/mcp',
    auth: { kind: 'key', header: 'authorization', optional: true, label: 'API key (optional, for every tool and higher limits)', link: 'https://www.firecrawl.dev/app/api-keys' },
  },
  {
    id: 'jina',
    label: 'Jina AI',
    description: 'Read web pages and PDFs, search the web and arXiv, and rank what comes back.',
    icon: 'chrome_reader_mode',
    group: 'Search and research',
    url: 'https://mcp.jina.ai/v1',
    auth: { kind: 'key', header: 'authorization', optional: true, label: 'API key (optional, for search and higher limits)', link: 'https://jina.ai' },
  },
  {
    id: 'apify',
    label: 'Apify',
    description: 'Thousands of ready-made scrapers for social media, maps, shops and any website.',
    icon: 'web',
    group: 'Search and research',
    url: 'https://mcp.apify.com',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'API token', link: 'https://console.apify.com/settings/integrations' },
  },
  {
    id: 'fever',
    label: 'Fever',
    description: 'Live events, concerts and experiences in your city, with dates, prices and where to book.',
    icon: 'local_activity',
    group: 'Search and research',
    url: 'https://data-search.apigw.feverup.com/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'x',
    label: 'X',
    description: 'Posts, accounts, trends and news on X, through an X developer app of your own, which X bills for each request.',
    icon: 'alternate_email',
    group: 'Search and research',
    url: 'https://api.x.com/mcp',
    // The app's Bearer token reads; signing in with the app reads as the user, and keeps their bookmarks.
    auth: { kind: 'key', header: 'authorization', label: 'Bearer token', link: 'https://console.x.com', ownApp: X_APP },
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Issues, projects, cycles and comments in your Linear workspace.',
    icon: 'task_alt',
    group: 'Work and projects',
    url: 'https://mcp.linear.app/mcp',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'Personal API key', link: 'https://linear.app/settings/account/security' },
  },
  {
    id: 'atlassian',
    label: 'Atlassian',
    description: 'Jira, Confluence, Jira Service Management and Bitbucket — once your admin allows API token sign-in.',
    icon: 'workspaces',
    group: 'Work and projects',
    url: 'https://mcp.atlassian.com/v2/mcp',
    auth: { kind: 'key', header: 'authorization', signIn: true, scheme: 'Basic', label: 'Your Atlassian email and API token, as email:token', link: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
  },
  {
    id: 'monday',
    label: 'monday.com',
    description: 'Boards, items, updates and docs in your monday.com account.',
    icon: 'calendar_view_week',
    group: 'Work and projects',
    url: 'https://mcp.monday.com/mcp',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'Personal API token', link: 'https://developer.monday.com/api-reference/docs/mcp-api-token' },
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Pages, databases and comments in your Notion workspace.',
    icon: 'note_stack',
    group: 'Work and projects',
    url: 'https://mcp.notion.com/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'asana',
    label: 'Asana',
    description: 'Tasks, projects, goals and portfolios in Asana.',
    icon: 'checklist',
    group: 'Work and projects',
    url: 'https://mcp.asana.com/v2/mcp',
    auth: { kind: 'oauth', ownApp: { link: 'https://app.asana.com/0/my-apps', redirect: OWN_APP_REDIRECT } },
  },
  {
    id: 'granola',
    label: 'Granola',
    description: 'Your Granola meeting notes, transcripts and action items.',
    icon: 'event_note',
    group: 'Work and projects',
    url: 'https://mcp.granola.ai/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'wispr-flow',
    label: 'Wispr Flow',
    description: 'Your Wispr Flow meetings and notes, to search and summarise. It only reads.',
    icon: 'mic',
    group: 'Work and projects',
    url: 'https://api.wisprflow.ai/connect/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    description: 'Files and folders in your Dropbox: find, read, organise and share them.',
    icon: 'folder_shared',
    group: 'Work and projects',
    url: 'https://mcp.dropbox.com/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'zoho-projects',
    label: 'Zoho Projects',
    description: 'Projects, milestones, task lists and tasks in Zoho Projects, through a server you make in Zoho MCP.',
    icon: 'view_kanban',
    group: 'Work and projects',
    url: '',
    auth: zohoServer('Zoho Projects'),
  },
  {
    id: 'stripe',
    label: 'Stripe',
    description: 'Payments, customers, invoices and subscriptions, and Stripe’s documentation.',
    icon: 'payments',
    group: 'Business',
    url: 'https://mcp.stripe.com',
    auth: { kind: 'key', header: 'authorization', signIn: true, label: 'Agent API key', link: 'https://dashboard.stripe.com/apikeys' },
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    description: 'Contacts, companies, deals, tickets and notes in your HubSpot CRM.',
    icon: 'groups',
    group: 'Business',
    url: 'https://mcp.hubspot.com',
    auth: { kind: 'oauth', ownApp: { link: 'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server', redirect: OWN_APP_REDIRECT } },
  },
  {
    id: 'zoho-crm',
    label: 'Zoho CRM',
    description: 'Leads, contacts, deals and accounts in Zoho CRM, through a server you make in Zoho MCP.',
    icon: 'contacts',
    group: 'Business',
    url: '',
    auth: zohoServer('Zoho CRM'),
  },
  {
    id: 'bigin',
    label: 'Bigin',
    description: 'Pipelines, deals, contacts and activities in Bigin by Zoho CRM, through a server you make in Zoho MCP.',
    icon: 'handshake',
    group: 'Business',
    url: '',
    auth: zohoServer('Bigin'),
  },
  {
    id: 'zoho-desk',
    label: 'Zoho Desk',
    description: 'Tickets, replies, comments and help centre articles in Zoho Desk, through a server you make in Zoho MCP.',
    icon: 'support_agent',
    group: 'Business',
    url: '',
    auth: zohoServer('Zoho Desk'),
  },
  {
    id: 'zoho-mail',
    label: 'Zoho Mail',
    description: 'Your Zoho Mail inbox: search, draft and organise email, through a server you make in Zoho MCP.',
    icon: 'mail',
    group: 'Business',
    url: '',
    auth: zohoServer('Zoho Mail'),
  },
  {
    id: 'canva',
    label: 'Canva',
    description: 'Designs, folders and brand templates in your Canva account: find, make and export designs.',
    icon: 'palette',
    group: 'Design and websites',
    url: 'https://mcp.canva.com/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'webflow',
    label: 'Webflow',
    description: 'Sites, pages, styles and CMS collections in your Webflow workspace.',
    icon: 'design_services',
    group: 'Design and websites',
    url: 'https://mcp.webflow.com/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'wix',
    label: 'Wix',
    description: 'Your Wix sites and what runs on them: stores, bookings, blogs and payments.',
    icon: 'storefront',
    group: 'Design and websites',
    url: 'https://mcp.wix.com/mcp',
    auth: { kind: 'oauth' },
  },
  // Programs, started on this computer from the desktop app; each started and listed its tools here (October 2026).
  {
    id: 'playwright',
    label: 'Playwright',
    description: 'A browser of its own that opens pages, clicks, types, fills in forms and reads what is there. From Microsoft.',
    icon: 'web',
    group: 'On this computer',
    url: '',
    auth: { kind: 'program', command: 'npx', args: ['-y', '@playwright/mcp@latest'], comesWith: 'Node.js' },
  },
  {
    id: 'chrome-devtools',
    label: 'Chrome DevTools',
    description: 'Chrome with its developer tools: a page’s console, network requests and performance. From Google.',
    icon: 'developer_mode_tv',
    group: 'On this computer',
    url: '',
    auth: { kind: 'program', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], comesWith: 'Node.js' },
  },
  {
    id: 'filesystem',
    label: 'Files',
    description: 'Read, write, move and search the files in a folder you choose.',
    icon: 'folder_open',
    group: 'On this computer',
    url: '',
    auth: { kind: 'program', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], comesWith: 'Node.js', folder: true },
  },
  {
    id: 'git',
    label: 'Git',
    description: 'Status, diffs, history, branches and commits of the repositories on this computer.',
    icon: 'commit',
    group: 'On this computer',
    url: '',
    auth: { kind: 'program', command: 'uvx', args: ['mcp-server-git'], comesWith: 'uv' },
  },
  {
    id: 'fetch',
    label: 'Fetch',
    description: 'Any web page, read as text a part at a time.',
    icon: 'article',
    group: 'On this computer',
    url: '',
    auth: { kind: 'program', command: 'uvx', args: ['mcp-server-fetch'], comesWith: 'uv' },
  },
  {
    // Willow's own (`services/local-companion/src/mcp-servers/x-reader.py`): X's web app as the user's browser reads it.
    id: 'x-reader',
    label: 'X Reader',
    description: 'Posts, replies, threads, accounts, lists, bookmarks and trends on X, read with your own X account, at no cost. Unofficial and read only.',
    icon: 'alternate_email',
    group: 'On this computer',
    url: '',
    auth: {
      kind: 'program',
      command: 'uv',
      args: ['run', '--script', 'x-reader.py'],
      comesWith: 'uv',
      bundled: 'x-reader',
      session: { site: 'x.com', name: 'X', cookies: ['auth_token', 'ct0'], env: 'X_COOKIES' },
    },
  },
];

/** The site sign-in a preset's program reads with, where it reads one. */
export const presetSession = (preset: McpPreset): McpSession | undefined => (preset.auth.kind === 'program' ? preset.auth.session : undefined);

/** A cookie's value as RFC 6265 has it: no spaces, quotes, commas, semicolons or backslashes. */
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,4096}$/;

/**
 * The cookies a session needs, from what was pasted: `name=value` pairs or a whole Cookie header, other cookies among
 * them allowed, the last of a name counting. As the header the program reads, or what is missing or wrong.
 */
export const sessionCookies = (session: McpSession, entered: string): { header: string } | { problem: string } => {
  const found = new Map<string, string>();
  for (const part of entered.replace(/^\s*cookie:/i, '').split(';')) {
    const at = part.indexOf('=');
    const name = at > 0 ? part.slice(0, at).trim() : '';
    const value = part.slice(at + 1).trim().replace(/^"(.*)"$/, '$1');
    if (session.cookies.includes(name) && value) found.set(name, value);
  }
  const missing = session.cookies.filter((name) => !found.has(name));
  if (missing.length > 0) return { problem: `Paste the ${missing.join(' and ')} ${missing.length === 1 ? 'cookie' : 'cookies'} from ${session.site}.` };
  const wrong = session.cookies.find((name) => !COOKIE_VALUE.test(found.get(name)!));
  if (wrong) return { problem: `That ${wrong} is not a cookie’s value. Copy its Value again from ${session.site}’s cookies.` };
  return { header: session.cookies.map((name) => `${name}=${found.get(name)}`).join('; ') };
};

/**
 * What a session form's fields make, one field per cookie in `session.cookies` order: each holds that cookie's value,
 * or cookie text pasted whole, whose cookies a value typed into its own field still overrides.
 */
export const sessionEntry = (session: McpSession, fields: readonly string[]): string => {
  const pasted = (field: string) => session.cookies.some((name) => new RegExp(`(?:^|[;\\s])${name}=`).test(field));
  const texts = fields.map((field) => field.trim());
  return [
    ...texts.filter((field) => field && pasted(field)),
    ...session.cookies.flatMap((name, index) => (texts[index] && !pasted(texts[index]) ? [`${name}=${texts[index]}`] : [])),
  ].join('; ');
};

/** An `email:token` pair as HTTP Basic credentials, UTF-8 safe. */
const basicCredentials = (pair: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(pair)));

const onHost = (url: URL, hosts: string[]): boolean => hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));

/**
 * The MCP server a preset makes with what the user entered — a key, or their own address — or what is wrong with
 * it. On when made: adding an app from here is the deliberate act that turning a custom server on is.
 */
export const presetServer = (preset: McpPreset, entered: string): McpServerConfig | { problem: string } => {
  const value = entered.trim();
  if (preset.auth.kind === 'program') {
    if (preset.auth.folder && !value) return { problem: `Choose the folder ${preset.label} may use.` };
    const args = preset.auth.folder ? [...preset.auth.args, value] : [...preset.auth.args];
    const server: McpServerConfig = {
      id: preset.id,
      label: preset.label,
      kind: 'program',
      command: preset.auth.command,
      args,
      ...(preset.auth.bundled ? { bundled: preset.auth.bundled } : {}),
      enabled: true,
    };
    if (!preset.auth.session) return server;
    // A program that reads a site as the user: what was entered is that site's cookies.
    const cookies = sessionCookies(preset.auth.session, value);
    return 'problem' in cookies ? cookies : { ...server, env: { [preset.auth.session.env]: cookies.header } };
  }
  const base = { id: preset.id, label: preset.label, kind: 'http' as const, enabled: true };
  // A server signed in to gets its tokens from the sign-in itself (`mcp-signin.ts`), not from what was typed.
  if (preset.auth.kind === 'none' || preset.auth.kind === 'oauth') return { ...base, url: preset.url };
  if (preset.auth.kind === 'key') {
    const scheme = preset.auth.scheme ?? 'Bearer';
    // A pasted header keeps only its credential: "Bearer x" or "Sentry-Bearer x" is never doubled.
    const key = value.replace(/^(?:Sentry-Bearer|Bearer|Basic)\s+/i, '');
    if (!key) return preset.auth.optional ? { ...base, url: preset.url } : { problem: `Paste your ${preset.label} ${preset.auth.label.toLowerCase()}.` };
    if (/\s/.test(key)) return { problem: 'A key has no spaces in it. Copy it again.' };
    if (preset.auth.header === 'x-api-key') return { ...base, url: preset.url, headers: { 'x-api-key': key } };
    if (scheme === 'Basic') {
      // Either the pair itself, or the pair already encoded as the vendor's own guide shows.
      const decoded = /^[A-Za-z0-9+/]+={0,2}$/.test(key) ? (() => { try { return atob(key); } catch { return ''; } })() : '';
      const pair = key.includes(':') ? key : decoded.includes(':') ? decoded : '';
      if (!/^[^:\s]+:\S+$/.test(pair)) return { problem: `Enter your ${preset.label} email, a colon, then the API token.` };
      return { ...base, url: preset.url, headers: { authorization: `Basic ${pair === key ? basicCredentials(pair) : key}` } };
    }
    return { ...base, url: preset.url, headers: { authorization: `${scheme} ${key}` } };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { problem: `Paste the address from ${preset.label}, starting with https://.` };
  }
  if (url.protocol !== 'https:' || !onHost(url, preset.auth.hosts)) return { problem: `That is not a ${preset.label} address. Copy it from ${preset.auth.link}.` };
  return { ...base, url: url.href };
};

/** Whether a preset can be signed in to in the browser: always for `oauth`, and for keys the server also takes a sign-in for. */
export const presetSignsIn = (preset: McpPreset): boolean => preset.auth.kind === 'oauth' || (preset.auth.kind === 'key' && preset.auth.signIn === true);

/** The server a preset signs in to: its address alone, the tokens coming from the sign-in. */
export const presetSignInServer = (preset: McpPreset): McpServerConfig => ({ id: preset.id, label: preset.label, kind: 'http', url: preset.url, enabled: true });

/** The app of the user's own a preset signs in with, where its service asks for one. */
export const presetOwnApp = (preset: McpPreset): McpOwnApp | undefined =>
  preset.auth.kind === 'oauth' || preset.auth.kind === 'key' ? preset.auth.ownApp : undefined;

/** The app a server was signed in with, to sign in with again once that sign-in runs out. */
export const signedInClient = (server: Pick<McpServerConfig, 'oauth'> | null | undefined): { clientId: string; clientSecret?: string } | undefined =>
  server?.oauth ? { clientId: server.oauth.clientId, ...(server.oauth.clientSecret ? { clientSecret: server.oauth.clientSecret } : {}) } : undefined;
