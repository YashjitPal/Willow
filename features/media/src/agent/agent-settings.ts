// The Media agent's settings: its standing instructions and whether it asks before generating.
// Per user, not per project, and in `settings.json` too (`media.agent`, ../media-settings.ts).

export interface AgentInstruction {
  id: string;
  title: string;
  isActive: boolean;
  content: string;
  referenceName?: string;
  referenceId?: string;
  isEditingTitle?: boolean;
}

export interface AgentSettings {
  confirmBeforeGenerating: boolean;
  instructions: AgentInstruction[];
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { confirmBeforeGenerating: false, instructions: [] };

export const AGENT_SETTINGS_CHANGED_EVENT = 'willow:media-agent-settings-changed';

/* Keyed by the account half of the scope only, so connecting a folder (which changes the
   root half) does not make a user's standing instructions vanish. */
export const agentSettingsKey = (scopeId: string) => `willow:mediaAgent:settings:v1:${(scopeId || 'signed-out').split('::')[0]}`;

const storage = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

/** Settings from storage or from the file, which is the user's to edit; null for anything that isn't settings. */
export function narrowAgentSettings(raw: unknown): AgentSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = raw as { confirmBeforeGenerating?: unknown; instructions?: unknown };
  return {
    confirmBeforeGenerating: parsed.confirmBeforeGenerating === true,
    instructions: Array.isArray(parsed.instructions)
      ? parsed.instructions
          .filter((i: any) => i && typeof i.id === 'string')
          .map((i: any) => ({
            id: i.id,
            title: String(i.title ?? ''),
            isActive: i.isActive !== false,
            content: String(i.content ?? ''),
            ...(typeof i.referenceName === 'string' ? { referenceName: i.referenceName } : {}),
            ...(typeof i.referenceId === 'string' ? { referenceId: i.referenceId } : {}),
          }))
      : [],
  };
}

/** What the account saved, or null when it never saved any. */
export function readSavedAgentSettings(scopeId: string): AgentSettings | null {
  try {
    const raw = storage()?.getItem(agentSettingsKey(scopeId));
    return raw ? narrowAgentSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export const readAgentSettings = (scopeId: string): AgentSettings => readSavedAgentSettings(scopeId) ?? DEFAULT_AGENT_SETTINGS;

/** The settings as saved: without what only the page's state holds. */
export const agentSettingsText = (settings: AgentSettings): string => JSON.stringify({
  confirmBeforeGenerating: settings.confirmBeforeGenerating,
  instructions: settings.instructions.map(({ isEditingTitle: _editing, ...rest }) => rest),
});

export function writeAgentSettings(scopeId: string, settings: AgentSettings): void {
  try {
    const text = agentSettingsText(settings);
    const store = storage();
    if (!store || store.getItem(agentSettingsKey(scopeId)) === text) return;
    store.setItem(agentSettingsKey(scopeId), text);
  } catch {
    // Quota or privacy mode: settings still apply for this session.
    return;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AGENT_SETTINGS_CHANGED_EVENT));
}

/** Calls `listener` whenever saved settings may have changed, here or in another tab. */
export function onAgentSettingsChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith('willow:mediaAgent:settings:')) listener();
  };
  window.addEventListener(AGENT_SETTINGS_CHANGED_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(AGENT_SETTINGS_CHANGED_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
