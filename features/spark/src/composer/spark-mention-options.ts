import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { mcpRuntime, mcpServers } from '@willow/ai/mcp/mcp-store';
import { authorizationStore, connectionsStore, usableConnectors, type ConnectorId } from '@willow/personal';
import { CONNECTOR_APPS } from '../spark-connectors';
import { sparkState } from '../spark-store';
import type { MentionOption } from './spark-mentions';

/**
 * The logos Gemini's "@" menu draws. Gmail's is not the one its timeline rows use: the menu has
 * the 2020 SVG, the rows the 2026 PNG. Calendar, Tasks, YouTube and GitHub are not in the
 * reference account's menu, so they carry the logos its Connected apps cards do.
 */
const MENU_LOGOS: Partial<Record<ConnectorId, string>> = {
  docs: 'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png',
  drive: 'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-96dp/logo_drive_2026_color_2x_web_96dp.png',
  gmail: 'https://www.gstatic.com/images/branding/productlogos/gmail_2020q4/v11/192px.svg',
  calendar: 'https://www.gstatic.com/images/branding/productlogos/calendar_2026/v2/web-96dp/logo_calendar_2026_color_2x_web_96dp.png',
  tasks: 'https://www.gstatic.com/images/branding/productlogos/tasks_2026/v2/web-96dp/logo_tasks_2026_color_2x_web_96dp.png',
  youtube: 'https://www.gstatic.com/images/branding/productlogos/youtube/v9/192px.svg',
  github: 'https://www.gstatic.com/lamda/images/tools/logo_github_dark_018b0501d5dc2dd3e532c.svg',
};

/** Gemini's menu order for the apps both have: Docs and Drive near the top, Gmail after. */
const APP_ORDER: ConnectorId[] = ['docs', 'drive', 'calendar', 'tasks', 'youtube', 'gmail', 'spotify', 'github'];

/** "@" lists the apps, connected first; "/" lists the skills. */
export const useSparkMentionOptions = (): MentionOption[] => {
  const { skills, connections } = useStore(sparkState);
  const connected = useStore(connectionsStore);
  const authorization = useStore(authorizationStore);
  const servers = useStore(mcpServers);
  const runtime = useStore(mcpRuntime);

  return useMemo(() => {
    const usable = new Set(usableConnectors());
    const apps: MentionOption[] = APP_ORDER.map((id) => {
      const app = CONNECTOR_APPS[id];
      const logo = MENU_LOGOS[id];
      return {
        id: `app:${app.app}`,
        trigger: '@' as const,
        label: app.label,
        icon: logo ? { kind: 'img' as const, src: logo } : { kind: 'glyph' as const, name: 'music_note', family: 'google-symbols' as const },
        dimmed: !usable.has(id) || (app.workspace === true && connections.workspace === false),
      };
    });
    const mcp: MentionOption[] = servers
      .filter((server) => server.enabled && runtime[server.id]?.status.state === 'ready')
      .map((server) => ({
        id: `mcp:${server.id}`,
        trigger: '@' as const,
        label: server.label,
        icon: { kind: 'glyph' as const, name: 'extension', family: 'google-symbols' as const },
      }));
    const skillOptions: MentionOption[] = skills.map((skill) => ({
      id: `skill:${skill.id}`,
      trigger: '/' as const,
      label: skill.name,
      icon: { kind: 'glyph' as const, name: 'contract', family: 'luminous' as const },
      description: skill.description,
      disabledSkill: skill.enabled === false,
    }));
    return [...apps.filter((app) => !app.dimmed), ...mcp, ...apps.filter((app) => app.dimmed), ...skillOptions];
    // `connected` and `authorization` are read through `usableConnectors()`; they are here so a change re-runs it.
  }, [skills, connections, connected, authorization, servers, runtime]);
};
