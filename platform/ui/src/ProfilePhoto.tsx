import React, { useEffect, useState } from 'react';
import { useThemeMode } from '@willow/core/theme-mode';

/** The figure a profile without a photo shows: a head and shoulders on a grey disc, as Instagram
 *  draws one, in the theme's greys. Clipped to a circle by whatever holds it. */
export const ProfileSilhouette: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isLight } = useThemeMode();
  const [disc, figure] = isLight ? ['#dbdbdb', '#ffffff'] : ['#4a4a4a', '#a8a8a8'];
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <rect width="40" height="40" fill={disc} />
      <circle cx="20" cy="15" r="7.5" fill={figure} />
      <ellipse cx="20" cy="37" rx="14" ry="11" fill={figure} />
    </svg>
  );
};

/** How long a photo that failed waits for its one retry: long enough for "too many requests" to pass. */
const RETRY_MS = 1500;

/**
 * A person's profile photo, with the silhouette in its place while it loads and wherever it cannot
 * load — never the browser's broken-image glyph and its alt text.
 *
 * Google's photo URLs (lh3.googleusercontent.com) turn requests away now and then: with a Referer
 * from some origins (403), and when one browser asks for the same photo too often, as every reload
 * of every view that shows it does (429). No referrer answers the first, one retry a moment later
 * rides out the second, and the silhouette covers what is left.
 */
export const ProfilePhoto: React.FC<{
  src?: string | null;
  /** What it is, for a screen reader; empty where the photo only decorates something named already. */
  alt?: string;
  /** Size and anything else for the round frame, which clips the photo and the silhouette alike. */
  className?: string;
  style?: React.CSSProperties;
}> = ({ src, alt = 'Profile photo', className = '', style }) => {
  const url = src?.trim() || null;
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setWaiting(false);
    setFailed(false);
  }, [url]);

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setTimeout(() => {
      setWaiting(false);
      setAttempt((count) => count + 1);
    }, RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  return (
    <span
      {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
      className={`relative inline-block shrink-0 overflow-hidden rounded-full ${className}`}
      style={style}
    >
      <ProfileSilhouette className="absolute inset-0 h-full w-full" />
      {url && !waiting && !failed && (
        <img
          key={attempt}
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => (attempt === 0 ? setWaiting(true) : setFailed(true))}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
};

export default ProfilePhoto;
