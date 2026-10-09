import { sparkPathFor } from '../../spark-routes';
import presetAppearances from '../character/orbit/preset-appearances.json';
import { create } from '../lib/create-store';
import { useDotStore, type Dot } from './dot-store';

/**
 * Codex's bot creation state (`onboarding-session`, the connector and computer
 * steps, and the ring handoff into the new bot), with the server round trips
 * mocked as in the Codex bots clone.
 */

/** `chooser-state` tint options, in order. */
export const orbitTintOptions = ['gray', 'cyan', 'yellow', 'orchid', 'lime', 'pink', 'coral', 'teal', 'blue', 'violet'] as const;
export type OrbitTint = (typeof orbitTintOptions)[number];

/** `d4(u4(null))`: the default avatar color, used for the gray tint and before a color is chosen. */
export const defaultOnboardingColor = '#BAC1D3';

/** The orbit catalog `Color` entries (`red`/`green`/`blue` channels of `orbit-catalog.json`). */
export const orbitCatalogTintColors: Record<Exclude<OrbitTint, 'gray'>, string> = {
  pink: '#FA70AB',
  orchid: '#DD6ADC',
  violet: '#A25BFF',
  blue: '#4778FF',
  cyan: '#00B1FF',
  teal: '#04BB9F',
  lime: '#B6D80B',
  yellow: '#FFCC38',
  coral: '#FF8066',
};

export interface OnboardingColor {
  tint: OrbitTint;
  color: string;
}

export const onboardingPalette: OnboardingColor[] = orbitTintOptions.map((tint) => ({
  tint,
  color: tint === 'gray' ? defaultOnboardingColor : orbitCatalogTintColors[tint],
}));

export type OnboardingStep = 'welcome' | 'connectors' | 'creating' | 'accepted' | 'complete' | 'failed' | 'unknown';

/** One onboarding attempt (`onboarding-session`). */
export interface OnboardingSession {
  step: OnboardingStep;
  flowId: string;
  color: OnboardingColor | null;
  noticeAcknowledged: boolean;
  connectorFailed: boolean;
  connectorReturnHandled: boolean;
  clientThreadId: string;
  acceptedThreadId: string | null;
}

export function createOnboardingSession(): OnboardingSession {
  return {
    step: 'welcome',
    flowId: crypto.randomUUID(),
    color: null,
    noticeAcknowledged: false,
    connectorFailed: false,
    connectorReturnHandled: false,
    clientThreadId: `dot-${crypto.randomUUID()}`,
    acceptedThreadId: null,
  };
}

/** Color customization load state of the onboarding scope (`DotOnboardingScope`). */
export type ColorLoad =
  | { status: 'loading'; attempt: number }
  | { status: 'ready'; attempt: number; colors: OnboardingColor[] }
  | { status: 'failed'; attempt: number };

export type ConnectorProvider = 'google' | 'microsoft';
export type ConnectorKind = 'email' | 'calendar' | 'contacts' | 'drive' | 'sharepoint' | 'teams';

export interface ConnectorsMock {
  status: 'checking' | 'error' | 'ready';
  provider: ConnectorProvider;
  connected: ConnectorKind[];
  disabledByAdmin: ConnectorKind[];
  /** The next plugin connection attempt fails. */
  connectFails: boolean;
}

/** Result of creating the bot (`Jp`), or `pending` to hold the creating step. */
export type CreationOutcome = 'accepted' | 'rejected' | 'unknown' | 'pending';

/**
 * Desktop connection shown on the computer step. `unavailable` is the default branch (`ya` without the
 * executors allowlist); `get-app`/`open-app` are the browser-only controls of the same step.
 */
export type ComputerAccessMock = 'unavailable' | 'disconnected' | 'connected' | 'loading' | 'error' | 'admin-disabled' | 'get-app' | 'open-app';

export interface HandoffRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `dot-onboarding-handoff-state`: the ring flying from the last onboarding step into the bot's room. */
export interface DotOnboardingHandoff {
  conversationId: string | null;
  color: string;
  phase: 'departing' | 'flying' | 'arrived';
  source?: HandoffRect;
  sourceColor?: string;
  destination?: HandoffRect | null;
}

interface CreationStore {
  /** "New bot" opened the onboarding over the user's existing bots. */
  onboardingOpen: boolean;
  /** The signed-in email ends with `@openai.com`, which shows the dogfood data-use notice. */
  internalUser: boolean;
  /** `learn_more_url` of dynamic config `588640677`; empty by default. */
  learnMoreUrl: string | null;
  session: OnboardingSession;
  colorLoad: ColorLoad;
  colorLoadFails: boolean;
  savingColor: boolean;
  connectors: ConnectorsMock;
  creationOutcome: CreationOutcome;
  computerAccess: ComputerAccessMock;
  handoff: DotOnboardingHandoff | null;
  flightElementId: string | null;
  updateSession: (update: (session: OnboardingSession) => OnboardingSession) => void;
  setHandoff: (handoff: DotOnboardingHandoff | null) => void;
}

/** Short UI delay standing in for the create, connect and request round trips. */
export const mockRoundTripMs = 1400;

export const defaultConnectorsMock: ConnectorsMock = {
  status: 'ready',
  provider: 'google',
  connected: [],
  disabledByAdmin: [],
  connectFails: false,
};

export const useCreationStore = create<CreationStore>((set) => ({
  onboardingOpen: false,
  internalUser: false,
  learnMoreUrl: null,
  session: createOnboardingSession(),
  colorLoad: { status: 'loading', attempt: 0 },
  colorLoadFails: false,
  savingColor: false,
  connectors: defaultConnectorsMock,
  creationOutcome: 'accepted',
  computerAccess: 'unavailable',
  handoff: null,
  flightElementId: null,
  updateSession: (update) => set((s) => ({ session: update(s.session) })),
  setHandoff: (handoff) => set({ handoff }),
}));

/** The steps after the welcome step, which keep the onboarding on screen until the user leaves for the new bot. */
export const isOnboardingUnderway = (step: OnboardingStep) => step !== 'welcome' && step !== 'complete';

/** "New bot": a fresh onboarding attempt over the bots list. */
export function openDotOnboarding() {
  useCreationStore.setState({ onboardingOpen: true, session: createOnboardingSession(), colorLoad: { status: 'loading', attempt: 0 } });
}

export function closeDotOnboarding() {
  useCreationStore.setState({ onboardingOpen: false, session: createOnboardingSession() });
}

/** Leaves the finished onboarding for the new bot, keeping the session's `complete` step until the next attempt. */
export function completeDotOnboarding(conversationId: string) {
  useCreationStore.setState((s) => ({
    onboardingOpen: false,
    session: s.session.acceptedThreadId === conversationId ? { ...s.session, step: 'complete' } : s.session,
  }));
}

export const orbitConversationPath = (conversationId: string) => sparkPathFor({ page: 'dots', dotId: conversationId });

const presetIds = Object.keys(presetAppearances);

/** A new orbit bot; the server would assign its character, so it starts from a random engine preset. */
export function newOrbitDot(conversationId: string, patch: Partial<Dot> = {}): Dot {
  return {
    conversationId,
    name: null,
    identity: 'orbit',
    presetId: presetIds[Math.floor(Math.random() * presetIds.length)],
    appearance: null,
    legacyAvatar: null,
    petId: null,
    runtime: 'cloud',
    status: 'creating',
    isPrimary: useDotStore.getState().dots.length === 0,
    isPinned: false,
    createdAt: Date.now(),
    ...patch,
  };
}

/** Time the new bot spends in the room's creation placeholder before it is ready. */
export const mockDotPreparationMs = 6000;

export function scheduleDotReady(conversationId: string) {
  window.setTimeout(() => {
    const dot = useDotStore.getState().dots.find((d) => d.conversationId === conversationId);
    if (dot?.status === 'creating') useDotStore.getState().updateDot(conversationId, { status: 'ready' });
  }, mockDotPreparationMs);
}
