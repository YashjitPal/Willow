// Icons for the Media app's rail and toolbars.
//
// The rail glyphs are Flow's own: Google Symbols ligatures at 24px with
// `"FILL" 0, "wght" 300`, which is what every icon in Flow's rail and header
// computes to. They were hand-drawn SVG approximations until the ligature names
// were read off the live app — see `tools/ui-research/scrapers/flow/55-chrome.cjs`.
//
// Two are still inline SVG, for different reasons: the vinyl record has no
// counterpart in Flow at all, and `RatioIcon` is a shape parameterised by an
// aspect ratio rather than a glyph.
//
// A ligature that is not in the loaded Google Symbols subset renders as its own
// name in words. Adding one here means regenerating that subset — see the
// @font-face comment in `apps/studio/index.html`.
import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

/** Flow's rail/header icon: 24px, unfilled, weight axis 300. */
const FlowGlyph = ({ name, className, size = 24 }: { name: string; className?: string; size?: number }) => (
  <MaterialSymbol
    name={name}
    family="google-symbols"
    size={size}
    weight={400}
    variationSettings='"FILL" 0, "wght" 300'
    className={className}
  />
);

type IconProps = { className?: string; size?: number };

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

export const AllMediaIcon = (p: IconProps) => <FlowGlyph name="dashboard" {...p} />;

export const ImagesIcon = (p: IconProps) => <FlowGlyph name="image" {...p} />;

export const VideoIcon = (p: IconProps) => <FlowGlyph name="videocam" {...p} />;

export const UploadsIcon = (p: IconProps) => <FlowGlyph name="drive_folder_upload" {...p} />;

export const CharactersIcon = (p: IconProps) => <FlowGlyph name="accessibility_new" {...p} />;

/**
 * The vinyl is drawn at 26px because a disc reads smaller than the squarer ligatures beside it at
 * the same size, but it takes up a 24px box like they do. Letting the extra 2px count as layout
 * put it 1px off its neighbours — right of them in the expanded rail, which lays rows out from the
 * left, and left of them in the collapsed one, which centres them — so it shifted on every toggle.
 */
const VinylDisc = ({ className }: { className?: string }) => (
  /* `shrink-0` or the flex wrapper squeezes the disc to its own 24px and it stops being round. */
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="26" height="26" className={`shrink-0 ${className || ''}`}>
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

export const MusicIcon = ({ className }: { className?: string }) => (
  <span className="w-6 h-6 shrink-0 flex items-center justify-center">
    <VinylDisc className={className} />
  </span>
);

export const ScenesIcon = (p: IconProps) => <FlowGlyph name="movie" {...p} />;

export const ToolsIcon = (p: IconProps) => <FlowGlyph name="apps_spark_2" {...p} />;

export const TrashIcon = (p: IconProps) => <FlowGlyph name="delete" {...p} />;

export const CollapseIcon = (p: IconProps) => <FlowGlyph name="left_panel_close" {...p} />;
