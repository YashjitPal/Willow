import clsx from "clsx";
import { useState, type ReactNode } from "react";

export interface ImageWithFallbackProps {
  alt: string;
  className?: string;
  src: string;
  fallback: ReactNode;
}

/** `kLt`: an image that renders `fallback` once it fails to load (the `monochrome` mask variant is not ported). */
export function ImageWithFallback({ alt, className, src, fallback }: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img alt={alt} className={clsx("object-contain", className)} src={src} onError={() => setFailed(true)} />;
}
