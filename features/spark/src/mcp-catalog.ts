/**
 * Apps that connect as remote MCP servers, ready to add: what they are, where they answer, and how they sign in.
 *
 * Servers that take no sign-in, a key the user pastes or an address they copy, and — in the desktop app — servers
 * the user signs in to with OAuth, registering Willow where the server lets apps register or using an app of the
 * user's own where it does not, and programs the companion starts on this computer. Servers that admit only clients
 * they approved (Figma, Vercel) are left out.
 * Addresses and sign-in were checked against each vendor's documentation (October 2026).
 *
 * Everything a server offers reaches Spark and every bot as its tools, once the user turns it on here.
 */
import type { McpServerConfig } from '@willow/ai/mcp/mcp-store';

export type McpPresetAuth =
  | { kind: 'none' }
  /**
   * A key or token in a header: `authorization` under its `scheme` — Bearer unless the vendor says otherwise
   * (Sentry's `Sentry-Bearer`; `Basic` for an `email:token` pair, encoded here) — or `x-api-key` as it is.
   * `signIn`: the server also takes a browser sign-in and lets Willow register itself, offered instead of a key.
   */
  | { kind: 'key'; header: 'authorization' | 'x-api-key'; scheme?: 'Bearer' | 'Sentry-Bearer' | 'Basic'; optional?: boolean; signIn?: boolean; label: string; link: string }
  /** The user's own server address from the vendor's dashboard, on one of `hosts`. */
  | { kind: 'url'; hosts: string[]; label: string; link: string }
  /**
   * Signed in to in the browser (`mcp-signin.ts`), from the desktop app. Willow registers itself where the server
   * lets apps register; `ownApp` is for services that ask each user to make an app of their own, with `redirect` as
   * the address to register in it.
   */
  | { kind: 'oauth'; ownApp?: { link: string; redirect: string } }
  /**
   * A program on this computer, in the desktop app (the companion's `mcp.*`): the command that starts it, and what
   * that command comes with. `folder`: it works in a folder the user picks, given as its last argument.
   */
  | { kind: 'program'; command: string; args: string[]; comesWith: string; folder?: true };

/** The redirect address a user's own app is registered with, for any service that asks for one. */
export const OWN_APP_REDIRECT = 'http://localhost:3334/oauth/callback';

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
];

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
    return { id: preset.id, label: preset.label, kind: 'program', command: preset.auth.command, args, enabled: true };
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
