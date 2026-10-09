import clsx from "clsx";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Skeleton } from "../../codex-ui/skeleton";
import { PhotoLight20Icon } from "../../codex-icons/photo-light-20";
import type { CharacterEditorClient, CharacterEditorPreview } from "../orbit/character-frame";

const PREVIEW_CANVAS_SIZE = 384;
const ignore = () => {};

export interface PresetTileProps {
  preset: CharacterEditorPreview["presets"][number];
  client?: CharacterEditorClient;
  /** Plays the engine's live preview while hovered or focused. */
  active: boolean;
  reducedMotion: boolean;
  onFrame?: () => void;
  onError?: () => void;
}

/** A preset's thumbnail, upgraded to a live engine preview while active (`YeComponent`). */
export function PresetTile({ preset, client, active, reducedMotion, onFrame, onError }: PresetTileProps) {
  const tileRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [loadedThumbnail, setLoadedThumbnail] = useState<string>();
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const { id, thumbnail } = preset;
  const thumbnailFailed = thumbnail !== undefined && (thumbnail == null || failedThumbnail === thumbnail);
  const thumbnailLoaded = !thumbnailFailed && thumbnail != null && loadedThumbnail === thumbnail;
  const showsPreview = active && !reducedMotion && previewing;
  const handleFrame = useEffectEvent(() => onFrame?.());
  const handleError = useEffectEvent(() => onError?.());

  useEffect(() => {
    const tile = tileRef.current;
    if (!tile || !client) return;
    let visible = false;
    const observer = new IntersectionObserver((entries) => {
      const isVisible = entries.at(-1)?.isIntersecting ?? false;
      if (visible !== isVisible) {
        visible = isVisible;
        client.request({ action: "preset-thumbnail", value: id, visible }).catch(ignore);
      }
    });
    observer.observe(tile);
    return () => {
      observer.disconnect();
      if (visible) client.request({ action: "preset-thumbnail", value: id, visible: false }).catch(ignore);
    };
  }, [client, id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !client || !active || reducedMotion || typeof MessageChannel === "undefined") return;
    let target: HTMLCanvasElement | undefined;
    let channel: MessageChannel | undefined;
    let renderer: ImageBitmapRenderingContext | null = null;
    let failed = false;
    const stop = () => {
      if (!target) return;
      renderer?.transferFromImageBitmap(null);
      renderer = null;
      target.width = target.height = 0;
      target = undefined;
      channel?.port1.close();
      channel?.port2.close();
      channel = undefined;
      setPreviewing(false);
      client.request({ action: "preset-preview-stop", value: id }).catch(ignore);
    };
    const fail = () => {
      failed = true;
      stop();
      handleError();
    };
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      if (!entry.isIntersecting) {
        stop();
        return;
      }
      if (target || failed) return;
      canvas.width = canvas.height = PREVIEW_CANVAS_SIZE;
      target = canvas;
      try {
        const context = canvas.getContext("bitmaprenderer");
        renderer = context;
        if (!context) {
          fail();
          return;
        }
        const previewChannel = new MessageChannel();
        channel = previewChannel;
        let started = false;
        previewChannel.port1.onmessage = ({ data }) => {
          if (data == null) {
            if (channel === previewChannel) fail();
            return;
          }
          if (data instanceof ImageBitmap) {
            if (channel !== previewChannel) {
              data.close();
              return;
            }
            try {
              context.transferFromImageBitmap(data);
              previewChannel.port1.postMessage(null);
              if (!started) {
                started = true;
                setPreviewing(true);
              }
              handleFrame();
            } catch {
              data.close();
              fail();
            }
          }
        };
        client.request({ action: "preset-preview", value: id, port: previewChannel.port2 }).catch(() => {
          if (channel === previewChannel) fail();
        });
      } catch {
        fail();
      }
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [active, client, id, reducedMotion]);

  return (
    <span ref={tileRef} className="relative block size-full" aria-busy={!showsPreview && !thumbnailLoaded && !thumbnailFailed}>
      <span className={clsx("block size-full", showsPreview && "invisible")}>
        {!thumbnailLoaded && (
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            {thumbnailFailed ? <PhotoLight20Icon className="text-tertiary" /> : <Skeleton className="size-full rounded-full" variant="prominent" animate={!reducedMotion} />}
          </span>
        )}
        {thumbnail && !thumbnailFailed && (
          <img
            key={thumbnail}
            className={clsx(
              "size-full object-contain",
              !reducedMotion && "transition-opacity duration-basic ease-in-out motion-reduce:transition-none starting:opacity-0",
              !thumbnailLoaded && "opacity-0",
            )}
            src={thumbnail}
            loading="lazy"
            alt=""
            onLoad={() => setLoadedThumbnail(thumbnail)}
            onError={() => setFailedThumbnail(thumbnail)}
          />
        )}
      </span>
      <canvas ref={canvasRef} className={clsx("pointer-events-none absolute -inset-4 block size-24", !showsPreview && "invisible")} width={0} height={0} tabIndex={-1} aria-hidden="true" />
    </span>
  );
}
