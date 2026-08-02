import React from 'react';
import {
  ChatAttachment,
  getAttachmentFormatLabel,
} from '@willow/core/attachments';
import { MaterialSymbol } from './MaterialSymbol';

interface GeminiAttachmentCardProps {
  attachment: ChatAttachment;
  variant?: 'composer' | 'message';
  onRemove?: () => void;
  onOpen?: () => void;
}

const KIND_VISUALS: Record<ChatAttachment['kind'], { symbol: string; color: string }> = {
  github: { symbol: 'code', color: '#c4eed0' },
  image: { symbol: 'image', color: '#a8c7fa' },
  pdf: { symbol: 'picture_as_pdf', color: '#f2b8b5' },
  audio: { symbol: 'audio_file', color: '#c4eed0' },
  video: { symbol: 'video_file', color: '#c2e7ff' },
  document: { symbol: 'description', color: '#a8c7fa' },
  spreadsheet: { symbol: 'table', color: '#c4eed0' },
  presentation: { symbol: 'slideshow', color: '#fdd663' },
  archive: { symbol: 'folder_zip', color: '#d7b5ff' },
  code: { symbol: 'code', color: '#c2e7ff' },
  text: { symbol: 'draft', color: '#c4c7c5' },
  generic: { symbol: 'draft', color: '#c4c7c5' },
};

export const GeminiAttachmentCard: React.FC<GeminiAttachmentCardProps> = ({
  attachment,
  variant = 'composer',
  onRemove,
  onOpen,
}) => {
  const visual = KIND_VISUALS[attachment.kind];
  const isThumbnail = attachment.kind === 'image' || attachment.kind === 'video';
  const isMessage = variant === 'message';
  const squareSize = isMessage ? 'h-28 w-28' : 'h-20 w-20';
  const cornerRadius = isMessage ? 'rounded-[20px]' : 'rounded-2xl';
  const formatLabel = getAttachmentFormatLabel(attachment);

  const githubCard = attachment.kind === 'github' ? (
    <div
      className={`flex ${isMessage ? 'h-24 w-[292px] rounded-[20px] px-4' : 'h-20 w-[232px] rounded-2xl px-3'} min-w-0 items-center gap-3 overflow-hidden bg-[#2a2a2a] text-left font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]`}
    >
      <span className={`${isMessage ? 'h-12 w-12 rounded-[14px]' : 'h-11 w-11 rounded-xl'} flex shrink-0 items-center justify-center bg-[#1e1f20] text-[#c4eed0]`}>
        <MaterialSymbol family="luminous" name="code" size={isMessage ? 26 : 24} weight={320} roundness={100} opticalSize={24} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={`${isMessage ? 'text-[15px] leading-5' : 'text-[14px] leading-[18px]'} block truncate font-normal text-[#e3e3e3]`}
          style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
          title={attachment.name}
        >
          {attachment.name}
        </span>
        <span className="block truncate text-[12px] font-normal leading-4 text-[#c4c7c5]">
          GitHub{attachment.sourceRef ? ` · ${attachment.sourceRef}` : ''}
        </span>
        {!!attachment.sourceFileCount && (
          <span className="block truncate text-[11px] font-normal leading-[14px] text-[#8e918f]">
            {attachment.sourceFileCount} files imported
          </span>
        )}
      </span>
      {isMessage && (
        <MaterialSymbol family="luminous" name="open_in_new" size={18} weight={320} roundness={100} opticalSize={18} className="shrink-0 text-[#c4c7c5]" />
      )}
    </div>
  ) : null;

  const card = githubCard || (isThumbnail ? (
    <div className={`relative ${squareSize} ${cornerRadius} overflow-hidden bg-[#2a2a2a]`}>
      {attachment.url ? (
        attachment.kind === 'video' ? (
          <video
            src={attachment.url}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ color: visual.color }}>
          <MaterialSymbol family="luminous" name={visual.symbol} size={24} weight={320} roundness={100} />
        </div>
      )}
      {attachment.kind === 'video' && (
        <>
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-black">
            <span className={`flex items-center justify-center rounded-full bg-white ${isMessage ? 'h-8 w-8' : 'h-7 w-7'}`}>
              <MaterialSymbol family="luminous" name="play_arrow" size={isMessage ? 24 : 21} weight={500} roundness={100} fill />
            </span>
          </span>
        </>
      )}
    </div>
  ) : (
    <div
      className={`relative flex ${squareSize} ${cornerRadius} min-w-0 flex-col justify-between overflow-hidden bg-[#2a2a2a] text-left font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] ${isMessage ? 'p-3' : 'p-2.5'}`}
    >
      <span className="block max-w-full truncate text-[12px] font-normal uppercase leading-4 text-[#c4c7c5]">
        {formatLabel}
      </span>
      <span className="flex items-center" style={{ color: visual.color }}>
        <MaterialSymbol family="luminous" name={visual.symbol} size={20} weight={320} roundness={100} opticalSize={20} />
      </span>
      <span
        className={`${isMessage ? 'line-clamp-3 text-[14px] leading-[18px]' : 'line-clamp-2 text-[12px] leading-4'} block max-w-full overflow-hidden font-normal text-[#e3e3e3] [overflow-wrap:anywhere]`}
        title={attachment.name}
        style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
      >
        {attachment.name}
      </span>
    </div>
  ));

  return (
    <div
      className={`group/attachment relative shrink-0 ${isMessage ? 'cursor-pointer' : ''}`}
      title={isMessage ? `Open ${attachment.name}` : attachment.name}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={`block ${cornerRadius} text-left outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa]/60`}
          aria-label={`Open ${attachment.name}`}
        >
          {card}
        </button>
      ) : card}

      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="absolute -right-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#1e1f20] text-[#c4c7c5] shadow-[0_1px_3px_rgba(0,0,0,0.55)] transition-colors hover:bg-[#333537] hover:text-[#e3e3e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          aria-label={`Remove ${attachment.name}`}
          title="Remove"
        >
          <MaterialSymbol family="luminous" name="close" size={16} weight={400} roundness={100} opticalSize={16} />
        </button>
      )}
    </div>
  );
};
