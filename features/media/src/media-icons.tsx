// Hand-drawn SVG icons for the Media app's rail and toolbars.
//
// These are inline SVGs rather than lucide-react imports because each one is a
// custom glyph with a hand-tuned viewBox — the vinyl record, the film-strip
// scenes marker, the aspect-ratio rectangles. Presentational only: no state, no
// data access, no imports beyond React.
import React from 'react';

/** A rectangle whose proportions match the given aspect ratio string. */
export const RatioIcon = ({ ratio, className = "text-white" }: { ratio: string, className?: string }) => {
  const getProps = () => {
    switch (ratio) {
      case '16:9': return { x: 2, y: 6, width: 20, height: 12, rx: 2 };
      case '4:3':  return { x: 4, y: 5, width: 16, height: 14, rx: 2 };
      case '1:1':  return { x: 5, y: 5, width: 14, height: 14, rx: 2 };
      case '3:4':  return { x: 5, y: 4, width: 14, height: 16, rx: 2 };
      case '9:16': return { x: 6, y: 2, width: 12, height: 20, rx: 2 };
      default:     return { x: 2, y: 6, width: 20, height: 12, rx: 2 };
    }
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect {...getProps()} />
    </svg>
  );
};

export const AllMediaIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="-4 -4 113 113" fill="currentColor" className={className}>
    <path d="M0,0 H35 V45 H0 Z M10,10 V35 H25 V10 Z M50,0 H105 V45 H50 Z M60,10 V35 H95 V10 Z M0,60 H55 V105 H0 Z M10,70 V95 H45 V70 Z M70,60 H105 V105 H70 Z M80,70 V95 H95 V70 Z" />
  </svg>
);

export const ImagesIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="8 8 109 109" fill="currentColor" className={className}>
    <path d="M12 27 A15 15 0 0 1 27 12 h71 a15 15 0 0 1 15 15 v71 a15 15 0 0 1 -15 15 H27 A15 15 0 0 1 12 98 Z M23 27 V98 A4 4 0 0 0 27 102 H98 A4 4 0 0 0 102 98 V27 A4 4 0 0 0 98 23 H27 A4 4 0 0 0 23 27 Z M32 91 L48 63 L64 91 Z M54 91 L74 49 L94 91 Z" />
  </svg>
);

export const VideoIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="6 8 116 116" fill="currentColor" className={className}>
    <path d="M28 26h44a16 16 0 0 1 16 16v44a16 16 0 0 1-16 16H28A16 16 0 0 1 12 86V42A16 16 0 0 1 28 26z M28 35a7 7 0 0 0-7 7v44a7 7 0 0 0 7 7h44a7 7 0 0 0 7-7V42a7 7 0 0 0-7-7H28z M87 64l33-26v52z" />
  </svg>
);

export const UploadsIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="10 10 80 80" fill="none" stroke="currentColor" className={className}>
    <path d="M 23 18 L 38 18 L 48 28 L 77 28 A 8 8 0 0 1 85 36 L 85 74 A 8 8 0 0 1 77 82 L 23 82 A 8 8 0 0 1 15 74 L 15 26 A 8 8 0 0 1 23 18 Z" strokeWidth="7" strokeLinejoin="round" />
    <path d="M 50 37.5 L 34.5 53 L 47 53 L 47 72 L 53 72 L 53 53 L 65.5 53 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const CharactersIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="9 8 82 82" fill="currentColor" className={className}>
    <circle cx="50" cy="18" r="10" />
    <path d="M 86 31.5 L 50 36 L 14 31.5 L 14 39.5 L 39 42.625 L 39 90 L 46 90 L 46 62 L 54 62 L 54 90 L 61 90 L 61 42.625 L 86 39.5 Z" />
  </svg>
);
export const MusicIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="26" height="26" className={className}>
    <defs>
      <mask id="vinyl-mask">
        <rect width="512" height="512" fill="white" />

        <g stroke="black" fill="none">
          <circle cx="256" cy="256" r="238" stroke-width="2" />
          <circle cx="256" cy="256" r="234" stroke-width="4" />

          <circle cx="256" cy="256" r="216" stroke-width="3" />
          <circle cx="256" cy="256" r="208" stroke-width="2" />
          <circle cx="256" cy="256" r="200" stroke-width="4" />
          <circle cx="256" cy="256" r="192" stroke-width="2" />
          <circle cx="256" cy="256" r="184" stroke-width="3" />

          <circle cx="256" cy="256" r="166" stroke-width="4" />
          <circle cx="256" cy="256" r="158" stroke-width="2" />
          <circle cx="256" cy="256" r="150" stroke-width="3" />
          <circle cx="256" cy="256" r="142" stroke-width="2" />

          <circle cx="256" cy="256" r="124" stroke-width="3" />
          <circle cx="256" cy="256" r="118" stroke-width="2" />
        </g>

        <g fill="white">
          <g transform="rotate(45, 256, 256)">
            <polygon points="256,256 186,-50 326,-50" />
            <polygon points="256,256 186,562 326,562" />
          </g>
          <g transform="rotate(135, 256, 256)">
            <polygon points="256,256 236,-50 276,-50" />
            <polygon points="256,256 236,562 276,562" />
          </g>
        </g>

        <circle cx="256" cy="256" r="110" fill="black" />

        <path d="M 256,166
                 C 256,229 229,256 166,256
                 C 229,256 256,283 256,346
                 C 256,283 283,256 346,256
                 C 283,256 256,229 256,166 Z"
              fill="white" />
      </mask>
    </defs>

    <circle cx="256" cy="256" r="240" fill="currentColor" mask="url(#vinyl-mask)" />
  </svg>
);

export const ScenesIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="56 96 400 320" fill="currentColor" className={className}>
    <path d="M 96 176 L 96 376 L 416 376 L 416 176 L 384 176 L 352 96 L 408 96 A 48 48 0 0 1 456 144 L 456 368 A 48 48 0 0 1 408 416 L 104 416 A 48 48 0 0 1 56 368 L 56 144 A 48 48 0 0 1 104 96 L 128 96 L 160 176 L 96 176 Z M 160 96 L 224 96 L 256 176 L 192 176 Z M 256 96 L 320 96 L 352 176 L 288 176 Z" />
  </svg>
);

export const ToolsIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="3 6 117 117" fill="currentColor" className={className}>
    {/* Top Row */}
    <circle cx="18" cy="46.25" r="8.5" />
    <circle cx="50" cy="46.25" r="8.5" />
    {/* Middle Row */}
    <circle cx="18" cy="78.25" r="8.5" />
    <circle cx="50" cy="78.25" r="8.5" />
    <circle cx="82" cy="78.25" r="8.5" />
    {/* Bottom Row */}
    <circle cx="18" cy="110.25" r="8.5" />
    <circle cx="50" cy="110.25" r="8.5" />
    <circle cx="82" cy="110.25" r="8.5" />
    {/* Sparkle Star */}
    <path d="M 94 9.25 Q 94 34.25 69 34.25 Q 94 34.25 94 59.25 Q 94 34.25 119 34.25 Q 94 34.25 94 9.25 Z" />
  </svg>
);

export const TrashIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 6.5h18" />
    <path d="M9.5 6.5V4.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v2" />
    <path d="M5.5 6.5l1 14a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-14" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const CollapseIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16" />
    <path d="M15 16l-4-4 4-4v8z" fill="currentColor" stroke="none" />
  </svg>
);
