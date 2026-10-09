import clsx from "clsx";
import { type ReactNode, type RefObject, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { useIntl } from "../../lib/intl";
import { useCharacterStore } from "../../state/character-store";
import { CharacterEditorClient, type CharacterFraming, getCharacterFrameUrl, isCharacterFrameProgress, parseCharacterFrameStatus } from "./character-frame";
import { useConversationActivity } from "./conversation-character";
import { ActivityKind, type OrbitActivity } from "./engine-enums";
import { sameBytes } from "./appearance-codec";
import { trackCharacterGaze, trackCharacterGestures } from "./pointer-tracking";
import { useCharacterShadersWarm } from "./shader-prewarm";
import { characterSnapshotCache } from "./snapshot-cache";

const READY_ACTIVITY: OrbitActivity = { kind: ActivityKind.Ready, turnId: null };
/**
 * Codex gives up after 30 s. A first boot on a cold GPU shader cache takes longer than that on Windows, and removing
 * the frame mid-compile stalls Chrome's GPU process (every tab) until the orphaned compile finishes, then throws the
 * work away, so the next mount starts cold again. A renderer that cannot start reports `failed` itself.
 */
const RENDERER_TIMEOUT_MS = 180000;

type RendererStatus = "loading" | "ready" | "failed";

export interface OrbitCharacterProps {
  /** ORBAST1 appearance bytes. */
  state: Uint8Array;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  reducedMotion: boolean;
  active?: boolean;
  renderOffscreen?: boolean;
  framing?: CharacterFraming;
  /** Present for a conversation's character: drives activity animations and gaze instead of reactions. */
  conversationId?: string;
  allowDrag?: boolean;
  onReady?: (client: CharacterEditorClient) => void;
  onFailure?: () => void;
  interactionTarget?: RefObject<HTMLElement | null>;
}

const noop = () => {};
const getServerSnapshot = () => undefined;

/** The live bot character rendered by the sandboxed orbit engine frame. */
export function OrbitCharacter({
  state,
  fallback,
  loadingFallback,
  reducedMotion,
  active = true,
  renderOffscreen = false,
  framing = "content",
  conversationId,
  allowDrag = false,
  onReady,
  onFailure,
  interactionTarget,
}: OrbitCharacterProps) {
  const intl = useIntl();
  const isConversation = conversationId !== undefined;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const clientRef = useRef<CharacterEditorClient | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const rendererFailure = useCharacterStore((s) => s.rendererFailure);

  const handleReady = useEffectEvent(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (frameWindow && !clientRef.current) {
      clientRef.current = new CharacterEditorClient(frameWindow);
      onReady?.(clientRef.current);
    }
  });
  const handleFailure = useEffectEvent(() => {
    clientRef.current?.dispose();
    clientRef.current = null;
    onFailure?.();
  });

  const [status, setStatus] = useState<RendererStatus>("loading");
  const [readyState, setReadyState] = useState<Uint8Array | null>(null);
  const isReady = status === "ready" && sameBytes(readyState, state);
  const [isVisible, setIsVisible] = useState(false);
  const shown = renderOffscreen || isVisible;
  const conversationActivity = useConversationActivity(isConversation && active && shown ? (conversationId ?? null) : null);
  const activity = conversationActivity?.kind === ActivityKind.None ? READY_ACTIVITY : conversationActivity;
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const shadersWarm = useCharacterShadersWarm();
  const mounted = shadersWarm && (renderOffscreen || hasBeenVisible);

  const baseUrl = getCharacterFrameUrl();
  const src = isConversation ? `${baseUrl}?animation=activity` : baseUrl;
  const snapshotKey = JSON.stringify([src, framing, Array.from(state)]);
  const cachedSnapshot = useSyncExternalStore(characterSnapshotCache.subscribe, () => characterSnapshotCache.get(snapshotKey), getServerSnapshot);

  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!rendererFailure) return;
    setStatus("failed");
    handleFailure();
  }, [rendererFailure]);

  const cancelPointer = useEffectEvent(() => {
    if (isReady && active && shown) {
      frameRef.current?.contentWindow?.postMessage({ type: "orbit-character-pointer-cancel" }, window.location.origin);
    }
  });
  const forwardPointer = useEffectEvent((event: PointerEvent) => {
    if (!event.isPrimary || !isReady || !active || !shown) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      frameRef.current?.contentWindow?.postMessage(
        { type: "orbit-character-pointer", x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height },
        window.location.origin,
      );
    }
  });

  useEffect(() => {
    const postState = () =>
      frameRef.current?.contentWindow?.postMessage(
        { type: "orbit-character", state, reducedMotion, active: active && shown, framing, activity },
        window.location.origin,
      );
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return;
      const message = parseCharacterFrameStatus(event.data);
      if (message == null) return;
      if (message.status === "snapshot") {
        if (message.framing === framing && sameBytes(message.state, state) && message.png) characterSnapshotCache.save(snapshotKey, message.png);
        return;
      }
      if (message.status === "ready" && !sameBytes(message.state, state)) return;
      if (message.status === "loaded") postState();
      if (message.status === "ready" || message.status === "failed") {
        window.clearTimeout(timeoutRef.current);
        setStatus(message.status);
        if (message.status === "ready") {
          if (message.state != null) setReadyState(message.state);
          handleReady();
        } else {
          console.warn("Character renderer failed", message.reason, message.phase);
          handleFailure();
        }
      }
    };
    const onPointerMove = (event: PointerEvent) => forwardPointer(event);
    const onBlur = () => cancelPointer();
    window.addEventListener("message", receive);
    if (!isConversation) {
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("blur", onBlur);
    }
    postState();
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [state, reducedMotion, active, shown, mounted, framing, isConversation, activity, snapshotKey]);

  useEffect(() => {
    if (!mounted || !active || !shown || isReady || status === "failed") return;
    const restartTimeout = () => {
      window.clearTimeout(timeoutRef.current);
      if (!document.hidden) {
        timeoutRef.current = window.setTimeout(() => {
          console.warn(`Character renderer timed out after ${RENDERER_TIMEOUT_MS} ms`);
          setStatus("failed");
          handleFailure();
        }, RENDERER_TIMEOUT_MS);
      }
    };
    const onProgress = (event: MessageEvent) => {
      if (event.source === frameRef.current?.contentWindow && event.origin === window.location.origin && isCharacterFrameProgress(event.data)) restartTimeout();
    };
    document.addEventListener("visibilitychange", restartTimeout);
    window.addEventListener("message", onProgress);
    restartTimeout();
    return () => {
      window.clearTimeout(timeoutRef.current);
      document.removeEventListener("visibilitychange", restartTimeout);
      window.removeEventListener("message", onProgress);
    };
  }, [mounted, active, shown, isReady, status]);

  const activityIsReady = activity?.kind === ActivityKind.Ready;
  const interactionElement = interactionTarget?.current;
  useEffect(() => {
    const hitElement = containerRef.current;
    const target = interactionTarget?.current ?? hitElement;
    if (!isReady || !active || !shown || !hitElement || !target) return;
    const post = (message: unknown) => frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
    if (isConversation) {
      if (!activityIsReady || !frameRef.current) return undefined;
      return trackCharacterGaze(target, hitElement, frameRef.current, (message) =>
        post(message.type === "orbit-character-pointer" ? { type: message.type, x: message.x, y: message.y } : message),
      );
    }
    return trackCharacterGestures(
      target,
      hitElement,
      post,
      () => {
        clientRef.current?.request({ action: "reaction" }).catch(noop);
      },
      allowDrag,
    );
  }, [allowDrag, interactionTarget, interactionElement, isReady, active, shown, isConversation, activityIsReady]);

  const showCachedSnapshot = cachedSnapshot != null && !isReady && status !== "failed";
  const frameInset = isConversation && framing === "activity" ? "-inset-1/2" : "inset-0";

  const observeVisibility = (element: HTMLSpanElement | null) => {
    containerRef.current = element;
    if (element == null) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) {
        setIsVisible(entry.isIntersecting);
        if (entry.isIntersecting && active) setHasBeenVisible(true);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  };

  return (
    <span
      ref={observeVisibility}
      className={clsx("relative block size-full touch-none select-none", interactionTarget ? "pointer-events-none" : active && isReady && "pointer-events-auto")}
    >
      {mounted && status !== "failed" ? (
        <span className={clsx("pointer-events-none absolute", frameInset, (!isReady || showCachedSnapshot) && "opacity-0")}>
          <iframe
            ref={frameRef}
            className="size-full border-0 scheme-normal"
            src={src}
            title={intl.formatMessage({
              id: "restricted.characterPreview.frameTitle",
              defaultMessage: "Character preview",
              description: "Accessible title for the frame displaying an animated bot character avatar",
            })}
            sandbox="allow-scripts allow-same-origin"
            allow="cross-origin-isolated"
            tabIndex={-1}
            aria-hidden
          />
        </span>
      ) : null}
      <span
        className={clsx(
          "pointer-events-none relative block size-full",
          active && isReady && !showCachedSnapshot && !reducedMotion && "transition-opacity duration-basic ease-in-out",
          (showCachedSnapshot || isReady) && "opacity-0",
        )}
        aria-hidden={showCachedSnapshot || isReady || undefined}
      >
        {status === "failed" ? fallback : (loadingFallback ?? <span aria-hidden className="flex size-full items-center justify-center rounded-full bg-text/10" />)}
      </span>
      {cachedSnapshot == null ? null : (
        <span
          className={clsx(
            "pointer-events-none absolute block",
            frameInset,
            showCachedSnapshot ? "opacity-100" : "opacity-0",
            !showCachedSnapshot && !reducedMotion && "transition-opacity duration-150 ease-out",
          )}
          aria-hidden
        >
          <img className="block size-full object-contain" src={cachedSnapshot} alt="" draggable={false} />
        </span>
      )}
    </span>
  );
}
