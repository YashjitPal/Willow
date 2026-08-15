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
  providerOf,
  readScopesFor,
  scopeUrls,
  writeScopesFor,
} from './connectors/registry';

export type {
  ConnectorDefinition,
  ConnectorFetch,
  ConnectorId,
  ConnectorProvider,
  ConnectorScope,
  ConnectorSignal,
} from './connectors/types';

export {
  connectionsStore,
  isConnected,
  type ConnectionsState,
} from './connectors/connections-store';

/**
 * Whether a connected product can be read *right now*.
 *
 * `connectionsStore` says what the user connected and is persistent;
 * these say whether a token is behind it, and are not. The tool surface is built
 * from `usableConnectors`, never from the raw list — see `authorization.ts`.
 */
export {
  authorizationOf,
  authorizationStore,
  expiredConnectors,
  markExpired,
  refreshAuthorizations,
  usableConnectors,
  type AuthorizationState,
} from './connectors/authorization';

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

/**
 * Spotify's half of the same job.
 *
 * `initConnectorTokenSources` is what the app should call — it installs every
 * configured provider and reports which ones are usable. The two provider-specific
 * inits stay exported for the Connected Apps tab, which asks about Google
 * separately because Google is the one that can be configured and still fail (the
 * GIS script has to load).
 *
 * `handleSpotifyCallback` runs in the popup, from `main.tsx`, before React exists.
 */
export {
  initConnectorTokenSources,
  type InstallOptions,
  type TokenSourceStatus,
} from './connectors/install';

export {
  clearSpotifyGrant,
  initSpotifyTokenSource,
  spotifyConfigured,
  spotifyRedirectUri,
} from './connectors/spotify/pkce-token-source';

export {
  handleSpotifyCallback,
  isSpotifyCallback,
} from './connectors/spotify/oauth-callback';

/**
 * GitHub's half, which is a different shape because GitHub gave it one.
 *
 * There is no `githubConfigured` and no client id, because there is no OAuth client —
 * `github/pat-token-source.ts` has the whole story, and the short version is that
 * GitHub's token-exchange endpoint sends no CORS headers, so no browser can complete
 * the flow. `saveGithubToken` is what Settings calls with a token the user pasted; it
 * verifies against GitHub before storing anything, and returns the account it belongs
 * to so the card can name it.
 */
export {
  clearGithubGrant,
  initGithubTokenSource,
  readGithubLogin,
  saveGithubToken,
  verifyGithubToken,
  type GithubIdentity,
} from './connectors/github/pat-token-source';

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

/**
 * The live read tools. Separate from the actions because they answer questions
 * rather than change anything, and separate from `retrieve_personal_data` because
 * they read the user's Google products directly instead of the stored profile.
 */
export {
  anthropicReadTools,
  connectorForRead,
  connectorReadGuidance,
  geminiReadTools,
  hasReadTools,
  openaiReadTools,
} from './tools/read-declarations';

export {
  ACTION_TOOLS,
  isPersonalActionCall,
  isPersonalReadCall,
  READ_TOOLS,
  type PersonalActions,
  type PersonalReads,
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
