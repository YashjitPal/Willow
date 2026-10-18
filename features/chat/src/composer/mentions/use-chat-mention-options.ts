import { useEffect, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { authorizationStore, connectionsStore, profileStore, usableConnectors } from '@willow/personal';
import { collectSavedModelsInCatalogOrder, isChatCapableModel } from '@willow/core/model-catalog';
import { ensureSkillsHydrated, skillLibrary } from '@willow/core/skill-library';
import { mcpServers } from '@willow/ai/mcp/mcp-store';
import { chatReachesMcpServer } from '../../mcp-chat';
import { CHAT_APPS, chatApp, mcpAppId } from './chat-apps';
import type { MentionOption } from './mentions';

/** The model pill's own shortening ("Gemini 3.1 Pro" -> "3.1 Pro"), as `use-composer-models` does it. */
const shortModelName = (name: string): string => {
  if (!name) return 'Model';
  if (name.includes('2.5 Flash Lite')) return '2.5 Lite';
  return name
    .replace(/Gemini\s+/gi, '')
    .replace(/Claude\s+/gi, '')
    .replace(/GPT\s+/gi, '')
    .replace(/\s+Extended$/gi, '')
    .trim();
};

/**
 * What the chat composer's menus list. "@": the saved models (Gemini lists its own three, and
 * picking one switches to it), then the apps this turn would be given the tools of: connected
 * with a live token, and Personal Intelligence on, outside a temporary chat (`personal-tools.ts`),
 * then the MCP apps that are on, outside a temporary chat — naming one is what brings its tools
 * to the turn (`mcp-chat.ts`). Gemini also lists the apps it cannot reach, dimmed; Willow leaves
 * them out. "/": the enabled skills in the shared library, so with none installed "/" opens nothing.
 */
export const useChatMentionOptions = ({ modelConfig, scopeId, personalize }: {
  modelConfig: unknown;
  /** The storage scope the skill library loads for. */
  scopeId: string;
  /** False in a temporary chat, which reaches no app. */
  personalize: boolean;
}): MentionOption[] => {
  const connections = useStore(connectionsStore);
  const authorization = useStore(authorizationStore);
  const profile = useStore(profileStore);
  const skills = useStore(skillLibrary);
  const servers = useStore(mcpServers);
  useEffect(() => {
    if (scopeId) ensureSkillsHydrated(scopeId);
  }, [scopeId]);

  return useMemo(() => {
    const models: MentionOption[] = collectSavedModelsInCatalogOrder(modelConfig)
      .filter(isChatCapableModel)
      .map((model) => ({
        id: `model:${model.id}`,
        trigger: '@',
        kind: 'model',
        value: model.id,
        label: shortModelName(model.name),
        icon: { kind: 'glyph', name: 'spark_outline', size: 20 },
      }));
    const reachable = new Set(personalize && profile.enabled ? usableConnectors() : []);
    const apps: MentionOption[] = CHAT_APPS.filter((app) => reachable.has(app.id)).map((app) => ({
      id: `app:${app.id}`,
      trigger: '@',
      kind: 'app',
      value: app.id,
      label: app.label,
      icon: { kind: 'img', src: app.logo },
    }));
    const mcpApps: MentionOption[] = (personalize ? servers : [])
      .filter(chatReachesMcpServer)
      .flatMap((server) => {
        const app = chatApp(mcpAppId(server.id));
        return app ? [{ id: `app:${app.id}`, trigger: '@' as const, kind: 'app' as const, value: app.id, label: app.label, icon: { kind: 'img' as const, src: app.logo } }] : [];
      });
    const skillOptions: MentionOption[] = skills
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        id: `skill:${skill.id}`,
        trigger: '/',
        kind: 'skill',
        value: skill.id,
        label: skill.name,
        icon: { kind: 'glyph', name: 'contract', size: 16 },
        description: skill.shortDescription || skill.description || undefined,
      }));
    return [...models, ...apps, ...mcpApps, ...skillOptions];
    // `connections` and `authorization` are read through `usableConnectors()`; they re-run it.
  }, [modelConfig, connections, authorization, profile.enabled, personalize, skills, servers]);
};
