import React from 'react';
import type { ComposerAttachment } from '@willow/core/attachments';
import { fileTypeIcon } from '@willow/core/gemini-file-icon';
import {
  fileTypeOf,
  formatLabel,
  showsExtensionLabel,
  tileDisplayName,
  tileShape,
} from '@willow/core/gemini-file-info';
import { MaterialSymbol } from './MaterialSymbol';

interface GeminiAttachmentCardProps {
  attachment: ComposerAttachment;
  variant?: 'composer' | 'message';
  onRemove?: () => void;
  onOpen?: () => void;
}

/** Tile geometry is identical in the composer strip and the sent-message block. */
const TILE_FONT: React.CSSProperties = {
  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
  fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
};

/** 112x112, 20px corners, 12% white surface. Children inherit the tile font. */
const TILE_CLASS = 'group/tile relative h-28 w-28 shrink-0 overflow-hidden rounded-[20px] bg-[rgba(255,255,255,0.12)]';

/**
 * An attachment tile, matching Gemini's composer and prompt-bubble spec.
 *
 * Which shape a file gets is decided by its EXTENSION through `tileShape`, never by mime
 * alone — a PNG served as `application/octet-stream` still gets a cover-cropped thumbnail,
 * and an `image/png` named `report` does not. Everything else routes to the generic tile,
 * which shows either a format label or a vendored Drive icon depending on the file type.
 *
 * The full filename (extension included) is the `title`, so `GlobalTooltips` renders it in
 * Gemini's tooltip style. The visible label is truncated; the tooltip is not.
 */
export const GeminiAttachmentCard: React.FC<GeminiAttachmentCardProps> = ({
  attachment,
  variant = 'composer',
  onRemove,
  onOpen,
}) => {
  const shape = tileShape(attachment.name);
  const fileType = fileTypeOf(attachment.mimeType, attachment.name);
  const displayName = tileDisplayName(attachment.name, fileType);
  const interactive = onOpen ? { onClick: onOpen, role: 'button', tabIndex: 0 } : {};

  // White 20x20 pill, black 16px Luminous `close` glyph.
  //
  // Its corner offset is NOT the tile's corner: Gemini nests the button inside
  // `.gem-attachment-content`, whose inset differs by shape — 8px over a thumbnail, 12px on
  // a generic tile. Measured: image tile 594+112-20-8 = 678, generic 834+112-20-12 = 914.
  //
  // Hidden by `visibility` and revealed on tile hover with `transition: all 0s` — Gemini
  // snaps it in, so a fade here would be wrong. Sent messages can't be edited, so the
  // message variant has no button at all.
  const closeButton = variant === 'composer' && onRemove ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className={`invisible absolute ${
        shape === 'image' || shape === 'video' ? 'right-2 top-2' : 'right-3 top-3'
      } flex h-5 w-5 items-center justify-center rounded-full bg-white text-black group-focus-within/tile:visible group-hover/tile:visible`}
      aria-label={`Remove ${attachment.name}`}
    >
      <MaterialSymbol family="luminous" name="close" size={16} weight={330} />
    </button>
  ) : null;

  // Image and video both fill the tile edge to edge, cropped to cover. Gemini defines a
  // bottom scrim for this variant but does not emit it on live tiles, so it is omitted.
  if ((shape === 'image' || shape === 'video') && attachment.url) {
    return (
      <div className={TILE_CLASS} style={TILE_FONT} title={attachment.name} {...interactive}>
        {shape === 'image' ? (
          <img
            src={attachment.url}
            alt={attachment.name}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
        ) : (
          <video
            src={attachment.url}
            className="absolute inset-0 h-full w-full object-cover object-center"
            muted
            playsInline
            preload="metadata"
          />
        )}
        {closeButton}
      </div>
    );
  }

  // Generic tile: a 12px-inset content box with the name bottom-anchored, and either the
  // format label or a 24px file-type icon in the box's top-left corner. Gemini shows the
  // label only for the four types whose icon says no more than the word does.
  const showLabel = showsExtensionLabel(fileType);

  return (
    <div className={TILE_CLASS} style={TILE_FONT} title={attachment.name} {...interactive}>
      {showLabel ? (
        <span className="absolute left-3 right-9 top-3 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[17px] text-[rgb(196,199,197)]">
          {formatLabel({ name: attachment.name, mimeType: attachment.mimeType, fileType })}
        </span>
      ) : (
        <img
          src={fileTypeIcon({ name: attachment.name, mimeType: attachment.mimeType, fileType })}
          alt=""
          className="absolute left-3 top-3 h-6 w-6"
        />
      )}
      <span
        className="absolute inset-x-3 bottom-3 line-clamp-3 text-[13px] leading-[17px] text-[rgb(227,227,227)]"
        style={{ whiteSpace: 'pre-wrap', textOverflow: 'ellipsis', wordBreak: 'auto-phrase' } as React.CSSProperties}
      >
        {displayName}
      </span>
      {closeButton}
    </div>
  );
};
