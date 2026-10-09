import clsx from "clsx";
import { type ReactNode, useEffect, useState } from "react";
import { legacyAvatarImage } from "./legacy-avatars";

/** A legacy avatar artwork, or the default ring (`QYa1Component`). */
export function LegacyAvatarImage({ className, avatar }: { className?: string; avatar: string | null | undefined }) {
  return <img className={clsx("block object-contain", className)} alt="" aria-hidden draggable={false} src={legacyAvatarImage(avatar).src} />;
}

type DecodeStatus = "pending" | "success" | "error";

/** Decodes `src` before it is shown, like the original's `orbit-avatar-image-ready` query. */
function useImageDecode(src: string | null): DecodeStatus | null {
  const [result, setResult] = useState<{ src: string; status: DecodeStatus } | null>(null);
  useEffect(() => {
    if (src == null) return;
    let cancelled = false;
    const image = new Image();
    image.src = src;
    image.decode().then(
      () => !cancelled && setResult({ src, status: "success" }),
      () => !cancelled && setResult({ src, status: "error" }),
    );
    return () => {
      cancelled = true;
      image.src = "";
    };
  }, [src]);
  if (src == null) return null;
  return result?.src === src ? result.status : "pending";
}

export interface AvatarImageProps {
  className?: string;
  /** Conversation (or draft marker) the image belongs to. */
  identity: string;
  imageUrl: string | null;
  imageVersion?: number | string | null;
  inlineSrc?: string;
  fallback: ReactNode;
  loadingFallback?: ReactNode;
}

/** A bot's saved avatar image (`avatar_url`), falling back when missing or broken (`KYa`). */
export function AvatarImage({ className, identity, imageUrl, imageVersion = null, inlineSrc, fallback, loadingFallback }: AvatarImageProps) {
  const src = inlineSrc ?? imageUrl;
  const cacheSource = src?.startsWith("data:") ? null : src;
  const readyKey = JSON.stringify(["orbit-avatar-image-ready", identity, cacheSource, imageVersion]);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const decodeStatus = useImageDecode(loadingFallback != null ? (src ?? null) : null);
  if (loadingFallback != null && src != null && decodeStatus === "pending") return loadingFallback;
  if (src != null && (loadingFallback == null || decodeStatus !== "error") && failedKey !== readyKey) {
    return <img key={readyKey} className={clsx("block object-contain", className)} alt="" aria-hidden draggable={false} src={src} onError={() => setFailedKey(readyKey)} />;
  }
  return fallback;
}
