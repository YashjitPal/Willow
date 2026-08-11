/**
 * `@willow/personal` — the public surface.
 *
 * Personal Intelligence is four separate things that only meet here: a stored
 * profile, an offline builder that writes it, connectors that read the user's
 * Google products, and a retrieval tool the model can call. Consumers should
 * import from this file rather than reaching into subdirectories, because the
 * layering inside is load-bearing — `builder/` may import `profile/` and nothing
 * above may import `builder/`, and a deep import is how that quietly stops being
 * true.
 *
 * Deliberately NOT exported: the GIS token source's internals, the per-product
 * Google modules, and the extract prompt. Those are implementation, and a caller
 * that needs them is a caller doing something this package should be doing
 * itself.
 */

// ---------------------------------------------------------------------------
// Profile — the stored facts, and the switch that governs them.
// ---------------------------------------------------------------------------

export {
  PROFILE_SECTIONS,
  PROFILE_BULLET_CAP,
  getProfileSection,
  normalizeSectionId,
  type ProfileSection,
  type ProfileSectionId,
} from './profile/sections';

export {
  bulletFingerprint,
  PROFILE_DEFAULTS,
  type CandidateBullet,
  type ProfileBullet,
  type ProfileState,
} from './profile/types';

export {
  addUserBullet,
  adoptProfileState,
  attachProfileDisk,
  clearProfile,
  commitBuildResult,
  profileRevision,
  profileStore,
  removeBullet,
  setProfileEnabled,
  updateBullet,
  type ProfileDisk,
} from './profile/profile-store';

/**
 * The prompt pieces. `profileBlock` is the one the chat model calls every turn;
 * the two constants are the instructions that tell it what to do with the block
 * and when to reach for the tool.
 */
export {
  groupBulletsBySection,
  PERSONAL_DATA_LADDER,
  PERSONAL_RETRIEVAL_GUIDANCE,
  PROFILE_HEADER,
  profileBlock,
} from './profile/profile-prompt';

// ---------------------------------------------------------------------------
// Connectors — the user's Google products.
// ---------------------------------------------------------------------------

export {
  CONNECTORS,
  canProvideSignals,
  connectorById,
  scopeUrls,
  writeScopesFor,
} from './connectors/registry';

export type {
  ConnectorDefinition,
  ConnectorFetch,
  ConnectorId,
  ConnectorScope,
  ConnectorSignal,
} from './connectors/types';

export {
  connectionsStore,
  isConnected,
  isSignalSource,
  setFeedsProfile,
  type ConnectionsState,
} from './connectors/connections-store';

/** The connect flow. The only exported functions that can open a popup, and so
 *  the only ones that must be called from a click. */
export {
  authorizeWrites,
  connectProduct,
  connectProducts,
  disconnectProduct,
  type ConnectOutcome,
} from './connectors/connect';

export {
  connectorsConfigured,
  initBrowserTokenSource,
  type GisOptions,
} from './connectors/gis-token-source';

export { NO_TOKENS, setTokenSource, tokenSource, type TokenSource } from './connectors/token-source';

export { collectConnectorSignals, activeSignalConnectors } from './connectors/signals';

// ---------------------------------------------------------------------------
// Tools — what the model can call.
// ---------------------------------------------------------------------------

export {
  anthropicPersonalTool,
  geminiPersonalTool,
  isPersonalToolCall,
  openaiPersonalTool,
  RETRIEVE_PERSONAL_DATA,
} from './tools/declarations';

export {
  anthropicActionTools,
  connectorForAction,
  geminiActionTools,
  openaiActionTools,
} from './tools/action-declarations';

export {
  ACTION_TOOLS,
  isPersonalActionCall,
  type PersonalActions,
  type ToolCallResult,
} from './tools/executor';

// ---------------------------------------------------------------------------
// Retrieval and the builder's own types, for callers that drive them directly.
// ---------------------------------------------------------------------------

export {
  invalidatePersonalIndex,
  personalIndexState,
  retrievePersonalData,
  type RetrieveResult,
} from './retrieval/personal-context';

export type { ChatSource, RebuildOutcome } from './builder/rebuild';
export { resolveExtractModel } from './builder/llm';
export {
  CHANGE_THRESHOLD,
  FIRST_BUILD_THRESHOLD,
  IDLE_DELAY_MS,
  shouldRebuild,
  type ScheduleDecision,
} from './builder/schedule';

// ---------------------------------------------------------------------------
// The runtime — what the app actually calls.
// ---------------------------------------------------------------------------

export {
  attachPersonalRuntime,
  buildDecision,
  buildProfileNow,
  detachPersonalRuntime,
  isBuildRunning,
  runPersonalTool,
  schedulePersonalBuild,
  searchPersonalData,
  type PersonalRuntimeDeps,
} from './runtime';
