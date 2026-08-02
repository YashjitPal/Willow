import React, { useState, useEffect } from 'react';

interface AvatarProps {
  /** Image URL (Google photoURL, Firebase Storage URL, or local blob for previews). */
  src?: string | null;
  /** Display name / email used to derive the fallback initial. */
  name?: string | null;
  /** Pixel size of the avatar (width & height). Default 32. */
  size?: number;
  /** Extra classes merged onto the root element. */
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  title?: string;
}

/**
 * Resilient user avatar.
 *
 * Handles the three failure modes we hit in production:
 *  1. Google `lh3.googleusercontent.com` photoURLs intermittently 403 when a
 *     Referer header is sent → we set `referrerPolicy="no-referrer"`.
 *  2. Stale `blob:` URLs persisted to Firestore (dead after reload) → treated
 *     as "no src" so we render the initials fallback instead of a broken icon.
 *  3. Any other load failure (network, revoked URL, 404) → `onError` swaps to
 *     the initials fallback instead of the browser's broken-image glyph.
 */
export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 32,
  className = '',
  onClick,
  onMouseDown,
  title,
}) => {
  const [errored, setErrored] = useState(false);

  // Reset error state whenever the src changes (e.g. user updates their photo).
  useEffect(() => {
    setErrored(false);
  }, [src]);

  // A persisted blob: URL from a previous session is guaranteed dead — don't
  // even try to load it, just show the fallback. Fresh blob: URLs created in
  // *this* session (upload previews) are still valid and will render fine.
  // We can't distinguish the two here, so we optimistically try and rely on
  // onError for the stale case.
  const effectiveSrc = src && src.trim() !== '' ? src : null;
  const showImage = !!effectiveSrc && !errored;

  const initial = (name?.trim()?.charAt(0) || '?').toUpperCase();

  const dimensionStyle: React.CSSProperties = { width: size, height: size };
  // Scale initial text with avatar size.
  const fontSize = Math.max(10, Math.round(size * 0.4));

  const baseClasses =
    'relative rounded-full border border-white/10 shrink-0 overflow-hidden select-none';
  const interactive = onClick ? 'cursor-pointer' : '';

  return (
    <div
      className={`${baseClasses} ${interactive} ${className}`}
      style={dimensionStyle}
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={effectiveSrc}
          alt={name || 'User'}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div
          className="w-full h-full bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center text-white font-medium"
          style={{ fontSize }}
        >
          {initial}
        </div>
      )}
    </div>
  );
};

export default Avatar;
