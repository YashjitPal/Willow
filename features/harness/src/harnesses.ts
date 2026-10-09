/**
 * The coding agents Willow's desktop app runs through T3 Code's server (vendor/t3code), each a
 * tab of its own on the rail. `driver` is T3's provider driver kind (`ProviderDriverKind`), which
 * scopes a tab to that agent's threads, models and settings.
 */
export type HarnessId = 'claude-code' | 'codex' | 'cursor' | 'grok' | 'opencode' | 'antigravity' | 'pi';

export type HarnessDriver = 'claudeAgent' | 'codex' | 'cursor' | 'grok' | 'opencode' | 'antigravity' | 'pi';

export interface Harness {
  id: HarnessId;
  driver: HarnessDriver;
  label: string;
  /** On the rail until unpinned; the rest wait in its "…", from where they can be pinned. */
  pinnedByDefault: boolean;
  /** Its mark's colour, which the tab's colours come from (harness-theme.ts); null for a monochrome mark. */
  mark: string | null;
}

export const HARNESSES: readonly Harness[] = [
  { id: 'claude-code', driver: 'claudeAgent', label: 'Claude Code', pinnedByDefault: true, mark: '#d97757' },
  // Willow's Blue swatch.
  { id: 'codex', driver: 'codex', label: 'Codex', pinnedByDefault: true, mark: '#3b82f6' },
  { id: 'cursor', driver: 'cursor', label: 'Cursor', pinnedByDefault: true, mark: null },
  { id: 'grok', driver: 'grok', label: 'Grok Build', pinnedByDefault: false, mark: null },
  { id: 'opencode', driver: 'opencode', label: 'OpenCode', pinnedByDefault: false, mark: null },
  { id: 'antigravity', driver: 'antigravity', label: 'Antigravity', pinnedByDefault: false, mark: '#4285f4' },
  { id: 'pi', driver: 'pi', label: 'Pi', pinnedByDefault: false, mark: null },
];

export const isHarnessId = (id: string): id is HarnessId => HARNESSES.some((harness) => harness.id === id);

export const harnessById = (id: HarnessId): Harness => HARNESSES.find((harness) => harness.id === id) ?? HARNESSES[0];
