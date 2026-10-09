import clsx from "clsx";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FormattedMessage } from "../../lib/intl";
import { useReducedMotion } from "../../lib/reduced-motion";
import { useCharacterStore } from "../../state/character-store";
import { useDotStore } from "../../state/dot-store";
import { normalizeDotName } from "../appearance-picker/dot-names";
import { DEFAULT_AVATAR_SRC } from "../avatar/legacy-avatars";
import { decodeCharacterState, encodeAppearanceManifest } from "../orbit/appearance-codec";
import type { CharacterEditorClient, CharacterEditorPreview, CharacterEditorRequest } from "../orbit/character-frame";
import { getDotState } from "../orbit/conversation-character";
import { OrbitCharacter } from "../orbit/orbit-character";
import type { CodexPet } from "../pets/codex-pets";
import { AvatarChooser } from "./avatar-chooser";
import { CharacterFeatures } from "./character-features";
import { type RingColor, asRingColor, customStarterAppearance, ringAppearance } from "./chooser-state";
import { CharacterEditorLayout } from "./editor-layout";
import { EditorPlaceholder } from "./editor-placeholder";
import { PetArtwork } from "./pet-chooser";
import { saveCharacter } from "./save-character";

export interface CharacterEditorSnapshot extends CharacterEditorPreview {
  busy: boolean;
  error: boolean;
  unavailable: boolean;
}

/** Tracks the engine's editor preview and whether edits are in flight (`De`). */
class CharacterEditorSession {
  readonly client: CharacterEditorClient;
  #snapshot: CharacterEditorSnapshot;
  #pendingRequests = 0;
  #disposed = false;
  #listeners = new Set<() => void>();
  #unsubscribe: () => void;

  constructor(client: CharacterEditorClient, preview: CharacterEditorPreview) {
    this.client = client;
    this.#snapshot = { ...preview, busy: preview.preparation.pending, error: preview.preparation.failed, unavailable: false };
    this.#unsubscribe = client.subscribe((next) => this.#update(next));
  }

  getSnapshot = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  edit(request: CharacterEditorRequest) {
    if (this.#disposed) return;
    this.#pendingRequests++;
    this.#publish({ ...this.#snapshot, busy: true, error: false });
    this.client
      .request(request)
      .then(
        (response) => {
          this.#pendingRequests--;
          if (!response.preview) throw Error("Character update unavailable");
          this.#update(response.preview, response.rejected);
        },
        () => {
          this.#pendingRequests--;
          throw Error("Character update unavailable");
        },
      )
      .catch(() => {
        if (!this.#disposed) this.#publish({ ...this.#snapshot, busy: this.#pendingRequests > 0, error: true, unavailable: true });
      });
  }

  dispose() {
    this.#disposed = true;
    this.#unsubscribe();
    this.#listeners.clear();
  }

  #update(preview: CharacterEditorPreview, rejected = false) {
    if (this.#disposed) return;
    this.#publish({ ...preview, busy: this.#pendingRequests > 0 || preview.preparation.pending, error: rejected || preview.preparation.failed, unavailable: false });
  }

  #publish(snapshot: CharacterEditorSnapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

export interface CharacterEditorHandle {
  /** Remembers the edited custom character without saving the bot. */
  saveCustom: () => void;
  /** Saves the edited character (and `name`, when given) to the bot. */
  save: (name?: string) => Promise<void>;
}

export interface CharacterEditorProps {
  conversationId: string;
  ref?: Ref<CharacterEditorHandle>;
  /** Whether the editor can save right now. */
  onReady: (ready: boolean) => void;
  disabled?: boolean;
  title?: ReactNode;
  footer?: ReactNode;
  pet?: CodexPet | null;
  onSelectPet?: (pet: CodexPet | null) => void;
  onCreatePet?: () => void;
}

interface EditorProfile {
  id: string;
  /** The avatar is an orbit character (`rendered-interactive`) rather than a pet or image. */
  renderedInteractive: boolean;
  /** The character's appearance; `null` when its manifest can't be read. */
  state: Uint8Array | null;
  avatarUrl: string | null;
}

/** Loads a bot's profile and edits its character (`CharacterEditor` in the editor chunk). */
export function CharacterEditor({ conversationId, ref, onReady, disabled, title, footer, pet, onSelectPet, onCreatePet }: CharacterEditorProps) {
  const dot = useDotStore((s) => s.dots.find((d) => d.conversationId === conversationId));
  const avatarUrl = useCharacterStore((s) => s.savedImages[conversationId]?.src ?? null);
  const profileLoad = useCharacterStore((s) => s.editorLoad);
  if (dot == null || profileLoad !== "default") {
    return <EditorPlaceholder title={title} footer={footer} error={dot == null || profileLoad === "error"} onCreatePet={onCreatePet} />;
  }
  const renderedInteractive = dot.identity === "orbit" && dot.petId == null;
  const profile: EditorProfile = { id: conversationId, renderedInteractive, state: renderedInteractive ? getDotState(dot) : null, avatarUrl };
  return (
    <CharacterEditorSessionView
      key={profile.id}
      ref={ref}
      profile={profile}
      conversationId={conversationId}
      onReady={onReady}
      disabled={disabled}
      title={title}
      footer={footer}
      pet={pet}
      onSelectPet={onSelectPet}
      onCreatePet={onCreatePet}
    />
  );
}

const subscribeToNothing = () => () => {};
const getNoSnapshot = () => null;
const ignore = () => {};

interface CharacterEditorSessionViewProps extends Omit<CharacterEditorProps, "conversationId"> {
  conversationId: string;
  profile: EditorProfile;
}

/** `JeComponent` */
function CharacterEditorSessionView({ profile, conversationId, ref, onReady, disabled, title, footer, pet, onSelectPet, onCreatePet }: CharacterEditorSessionViewProps) {
  const reducedMotion = useReducedMotion();
  const setCustomCharacter = useCharacterStore((s) => s.setCustomCharacter);
  const [initialProfile] = useState(profile);
  const [savedState] = useState(() => (initialProfile.renderedInteractive ? initialProfile.state : ringAppearance("gray")));
  const [characterState, setCharacterState] = useState(() => savedState ?? ringAppearance("gray"));
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const failedAttemptRef = useRef<number | null>(null);
  const pendingClientRef = useRef<CharacterEditorClient | null>(null);
  const [customState, setCustomState] = useState<Uint8Array | null>(() => {
    const appearance = decodeCharacterState(characterState);
    if ((appearance.shape !== "circle" || appearance.eyes !== "none") && !appearance.hereCharacter) return characterState;
    const stored = useCharacterStore.getState().customCharacter;
    return stored && encodeAppearanceManifest({ schema_version: 1, appearance: stored });
  });
  const [mode, setMode] = useState<"chooser" | "custom">("chooser");
  const [session, setSession] = useState<CharacterEditorSession | null>(null);
  const [rendererFailed, setRendererFailed] = useState(false);
  const editedRef = useRef(savedState == null);
  const showsPlaceholderRing = (savedState == null || rendererAttempt > 0) && session == null;

  const handleRendererFailure = () => {
    if (failedAttemptRef.current != null && failedAttemptRef.current >= rendererAttempt) return;
    failedAttemptRef.current = rendererAttempt;
    const pendingClient = pendingClientRef.current;
    pendingClientRef.current = null;
    session?.dispose();
    pendingClient?.dispose();
    setSession(null);
    setCustomState(null);
    setMode("chooser");
    editedRef.current = true;
    onReady(false);
    if (rendererAttempt === 0) {
      setCharacterState(ringAppearance("gray"));
      setRendererAttempt(1);
    } else {
      setRendererFailed(true);
    }
  };

  const snapshot = useSyncExternalStore(
    session == null
      ? subscribeToNothing
      : (notify) =>
          session.subscribe(() => {
            const next = session.getSnapshot();
            if (next.unavailable) {
              handleRendererFailure();
              return;
            }
            onReady(!next.busy && !rendererFailed);
            notify();
          }),
    session == null ? getNoSnapshot : session.getSnapshot,
    getNoSnapshot,
  );
  const busy = snapshot?.busy ?? false;
  const appearance = useMemo(() => snapshot && decodeCharacterState(snapshot.state), [snapshot]);
  const isRing = appearance?.shape === "circle" && appearance.eyes === "none";
  const isCustom = appearance != null && !isRing && !appearance.hereCharacter;
  let selectedTint: RingColor | null = showsPlaceholderRing ? "gray" : null;
  if (isRing) selectedTint = asRingColor(appearance.color === "authored" ? "gray" : appearance.color);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pendingClientRef.current = null;
      abortRef.current?.abort();
    },
    [],
  );
  useEffect(() => () => session?.dispose(), [session]);

  const rememberCustom = (state: Uint8Array) => setCustomCharacter(decodeCharacterState(state));
  useImperativeHandle(ref, () => ({
    saveCustom() {
      const state = isCustom && snapshot && !busy ? snapshot.state : customState;
      if (state) rememberCustom(state);
    },
    save(name) {
      const current = session?.getSnapshot();
      if (pet == null && (!session || !current || current.busy || current.unavailable || rendererFailed)) return Promise.reject(Error("Character is not ready"));
      if (!editedRef.current && pet == null && name == null) return Promise.resolve();
      const controller = new AbortController();
      abortRef.current = controller;
      return saveCharacter({
        conversationId,
        controller,
        name: name == null ? undefined : normalizeDotName(name),
        pet,
        client: pet == null && editedRef.current ? session?.client : undefined,
      })
        .then(() => {
          const state = isCustom ? current?.state : customState;
          if (state) rememberCustom(state);
        })
        .finally(() => {
          abortRef.current = null;
        });
    },
  }));

  const edit = (request: CharacterEditorRequest) => {
    if (!session || disabled || rendererFailed) return;
    if (request.action !== "quality" && request.action !== "constrained") onSelectPet?.(null);
    editedRef.current = true;
    session.edit(request);
  };
  const keepCustom = () => {
    if (isCustom && snapshot) {
      setCustomState(snapshot.state);
      session?.client.request({ action: "custom-thumbnail", state: snapshot.state }).catch(ignore);
    }
  };

  let status: ReactNode;
  if (busy && !rendererFailed) {
    status = (
      <FormattedMessage
        id="restricted.characterEditor.updating"
        defaultMessage="Updating character…"
        description="Status while the renderer prepares and applies a selected character appearance"
      />
    );
  } else if (session == null && !rendererFailed && !initialProfile.avatarUrl && !showsPlaceholderRing) {
    status = <FormattedMessage id="restricted.characterEditor.loading" defaultMessage="Loading character…" description="Status while the assistant's character renderer loads" />;
  }

  const preview = (
    <div className="relative aspect-square h-30 max-h-full max-w-full">
      {pet != null && (
        <div className="absolute inset-0">
          <PetArtwork pet={pet} />
        </div>
      )}
      <div className={clsx("absolute top-1/2 left-1/2 size-60 -translate-1/2", (pet != null || showsPlaceholderRing) && "opacity-0")} inert={pet != null}>
        {!rendererFailed && (
          <OrbitCharacter
            key={rendererAttempt}
            state={characterState}
            reducedMotion={reducedMotion}
            framing="activity"
            renderOffscreen
            allowDrag
            fallback={initialProfile.avatarUrl ? <img className="block size-full scale-50 object-contain" src={initialProfile.avatarUrl} alt="" /> : null}
            onFailure={handleRendererFailure}
            onReady={(client) => {
              if (failedAttemptRef.current != null && failedAttemptRef.current >= rendererAttempt) return;
              pendingClientRef.current = client;
              const saved = decodeCharacterState(characterState);
              client
                .request({
                  action: "catalog",
                  customState: customState ?? undefined,
                  savedSelections: [[saved.shape], [saved.color], [saved.eyes], [saved.eyewear], saved.accessories],
                })
                .then((response) => {
                  if (pendingClientRef.current !== client) return;
                  if (!response.preview || response.preview.preparation.failed) throw Error("Character catalog unavailable");
                  setSession(new CharacterEditorSession(client, response.preview));
                  onReady(!response.preview.preparation.pending);
                })
                .catch(() => {
                  if (pendingClientRef.current === client) handleRendererFailure();
                });
            }}
          />
        )}
      </div>
      {pet == null && showsPlaceholderRing && <img className="block size-full object-contain" src={DEFAULT_AVATAR_SRC} alt="" />}
    </div>
  );

  const controls = (
    <div className="flex min-h-0 flex-1 flex-col">
      {mode === "chooser" ? (
        <AvatarChooser
          preview={snapshot}
          client={session?.client}
          reducedMotion={reducedMotion}
          disabled={disabled || session == null || rendererFailed}
          selectedTint={pet == null ? selectedTint : null}
          selectedPreset={pet == null ? (appearance?.hereCharacter?.id ?? null) : null}
          customSelected={pet == null && isCustom}
          hasCustomCharacter={customState != null}
          onTint={(color) => {
            keepCustom();
            edit({ action: "restore", state: ringAppearance(color) });
          }}
          onPreset={(value) => {
            keepCustom();
            edit({ action: "preset", value });
          }}
          onSelectCustom={() => {
            if (customState != null) edit({ action: "restore", state: customState });
          }}
          onCustomize={() => {
            edit({ action: "restore", state: customState ?? customStarterAppearance() });
            setMode("custom");
          }}
          pet={pet}
          onSelectPet={(next) => {
            keepCustom();
            onSelectPet?.(next);
          }}
          onCreatePet={onCreatePet}
          petDisabled={disabled}
        />
      ) : (
        <CharacterFeatures
          preview={snapshot}
          backDisabled={disabled}
          disabled={disabled || session == null || rendererFailed}
          onEdit={edit}
          onBack={() => {
            keepCustom();
            setMode("chooser");
          }}
        />
      )}
      {pet == null && snapshot?.error && !snapshot.unavailable && !rendererFailed && (
        <p role="alert" className="px-6 pb-4 text-sm text-danger">
          <FormattedMessage
            id="restricted.characterEditor.changeRejected"
            defaultMessage="That change couldn’t be applied. Your previous appearance is still selected"
            description="Error when a character edit is rejected and the native engine preserves or restores the previous appearance"
          />
        </p>
      )}
    </div>
  );

  return <CharacterEditorLayout title={title} footer={footer} loadingLabel={pet == null ? status : undefined} preview={preview} controls={controls} />;
}
