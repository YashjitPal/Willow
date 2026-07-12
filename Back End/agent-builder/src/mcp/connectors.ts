/**
 * Hosted / third-party MCP connector catalog — mirrors the connector list the
 * Agent Builder UI presents. Entries with a real public MCP endpoint have
 * `url` set; the rest require the user to paste their tenant-specific URL
 * (the UI's Connect form allows editing it).
 */

import type { McpConnectorCatalogEntry } from '../domain/types.ts';

export const MCP_CONNECTOR_CATALOG: McpConnectorCatalogEntry[] = [
  // --- Hosted (OpenAI-style connector registry equivalents) ---
  {
    key: 'gmail',
    name: 'Gmail',
    tier: 'hosted',
    features: ['Read and draft emails', 'Search your inbox', 'Send messages'],
    authHint: 'oauth',
  },
  {
    key: 'google_calendar',
    name: 'Google Calendar',
    tier: 'hosted',
    features: ['Read events', 'Create and update events', 'Check availability'],
    authHint: 'oauth',
  },
  {
    key: 'google_drive',
    name: 'Google Drive',
    tier: 'hosted',
    features: ['Search files', 'Read documents', 'List folders'],
    authHint: 'oauth',
  },
  {
    key: 'outlook_email',
    name: 'Outlook Email',
    tier: 'hosted',
    features: ['Read and draft emails', 'Search your inbox', 'Send messages'],
    authHint: 'oauth',
  },
  {
    key: 'outlook_calendar',
    name: 'Outlook Calendar',
    tier: 'hosted',
    features: ['Read events', 'Create and update events', 'Check availability'],
    authHint: 'oauth',
  },
  {
    key: 'sharepoint',
    name: 'Sharepoint',
    tier: 'hosted',
    features: ['Search sites', 'Read documents', 'List libraries'],
    authHint: 'oauth',
  },
  {
    key: 'microsoft_teams',
    name: 'Microsoft Teams',
    tier: 'hosted',
    features: ['Read channels', 'Send messages', 'Search conversations'],
    authHint: 'oauth',
  },
  {
    key: 'dropbox',
    name: 'Dropbox',
    tier: 'hosted',
    features: ['Search files', 'Read documents', 'List folders'],
    authHint: 'oauth',
  },

  // --- Third-party official servers (public endpoints where they exist) ---
  {
    key: 'zapier',
    name: 'Zapier',
    tier: 'third-party',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    features: ['Run Zaps', 'Access 8000+ app actions'],
    authHint: 'token',
  },
  {
    key: 'shopify',
    name: 'Shopify',
    tier: 'third-party',
    features: ['Manage products', 'Query orders', 'Update inventory'],
    authHint: 'token',
  },
  {
    key: 'intercom',
    name: 'Intercom',
    tier: 'third-party',
    url: 'https://mcp.intercom.com/mcp',
    features: ['Search conversations', 'Manage contacts', 'Reply to threads'],
    authHint: 'oauth',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    tier: 'third-party',
    url: 'https://mcp.stripe.com',
    features: ['Query payments', 'Manage customers', 'Create invoices'],
    authHint: 'token',
  },
  {
    key: 'square',
    name: 'Square',
    tier: 'third-party',
    url: 'https://mcp.squareup.com/sse',
    features: ['Query payments', 'Manage catalog', 'Track orders'],
    authHint: 'token',
  },
  {
    key: 'cloudflare_browser',
    name: 'Cloudflare Browser',
    tier: 'third-party',
    url: 'https://browser.mcp.cloudflare.com/sse',
    features: ['Render web pages', 'Take screenshots', 'Extract content'],
    authHint: 'oauth',
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    tier: 'third-party',
    url: 'https://mcp.hubspot.com/anthropic',
    features: ['Manage contacts', 'Query deals', 'Update CRM records'],
    authHint: 'token',
  },
  {
    key: 'pipedream',
    name: 'Pipedream',
    tier: 'third-party',
    url: 'https://remote.mcp.pipedream.net',
    features: ['Run workflows', 'Access 2500+ integrations'],
    authHint: 'token',
  },
  {
    key: 'paypal',
    name: 'PayPal',
    tier: 'third-party',
    url: 'https://mcp.paypal.com/mcp',
    features: ['Query transactions', 'Create invoices', 'Manage disputes'],
    authHint: 'oauth',
  },
];

export function findConnector(key: string): McpConnectorCatalogEntry | undefined {
  const k = key.toLowerCase().replace(/\s+/g, '_');
  return MCP_CONNECTOR_CATALOG.find(
    (c) => c.key === k || c.name.toLowerCase().replace(/\s+/g, '_') === k,
  );
}
