import React from 'react';
import { ProfilePhoto } from './ProfilePhoto';

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
 * Resilient user avatar: the photo through `ProfilePhoto` — no Referer (Google's
 * `lh3.googleusercontent.com` photos intermittently 403 with one), one retry, and the
 * silhouette while it loads and wherever it cannot load (a stale `blob:` URL persisted
 * from another session included) — or the initial when there is no photo at all.
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
  const effectiveSrc = src && src.trim() !== '' ? src : null;

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
      {effectiveSrc ? (
        <ProfilePhoto src={effectiveSrc} alt={name || 'User'} className="h-full w-full" />
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
