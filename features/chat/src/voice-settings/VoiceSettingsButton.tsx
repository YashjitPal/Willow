/**
 * The voice-settings trigger — the sliders button at the top right of voice mode.
 *
 * Measured on the live page rather than taken from the panel dump, because it
 * sits in the voice-mode header outside the dialog. Its box came out 40x40 with
 * its right edge 24px from the viewport edge and its top at y=6, and the ancestor
 * chain accounts for both: the header row is `p-2 pe-6` (8px top, 24px end) and
 * the button's own row carries `-mt-0.5`, so 8 − 2 = 6.
 *
 * That placement is the one thing here Willow does not take from the capture. It
 * was asked for: the button sits where the temporary chat button sits instead —
 * a 36x36 box at top 14, right 12 — because upstream's 6/24 reads as misaligned
 * against every other control in Willow's top-right chrome. The measured values
 * stay recorded in voice-settings-constants.ts next to the override, and the
 * glyph is untouched: 20px, the captured fill, the captured hover, the captured
 * 200ms ease-in-out, centred in the box so its centre lands on the temporary chat
 * button's.
 *
 * One further adaptation, flagged: the captured chain reports the strip as
 * `position: fixed` at top/right 0, with no z-index of its own. Willow's orb
 * surface sits at `z-[49]` and its overlays at `z-50`, so the strip is given
 * `z-50` to clear the orb. The panel itself needs no such value — it is a modal
 * `<dialog>` in the top layer, as upstream's is.
 */

import React from 'react';

import { VoiceSettingsIcon } from './voice-settings-icons';
import {
  TRIGGER_ICON_SIZE,
  TRIGGER_TRANSITION_EASE,
  TRIGGER_TRANSITION_MS,
  TRIGGER_WILLOW_INSET_END,
  TRIGGER_WILLOW_INSET_TOP,
  TRIGGER_WILLOW_SIZE,
} from './voice-settings-constants';

export type VoiceSettingsButtonProps = {
  onClick: () => void;
  /** Reflects the panel's state, so assistive tech sees the two as a pair. */
  expanded: boolean;
};

export const VoiceSettingsButton: React.FC<VoiceSettingsButtonProps> = ({
  onClick,
  expanded,
}) => (
  // Captured chain, outermost first: `div.@container/main.pointer-events-none
  // .fixed` at top/right 0 → the header row at `p-2 pe-6` → `div.-mt-0.5.flex
  // .flex-row.items-center`. The padding chain existed only to produce the 6/24
  // offsets, so with the offsets replaced it is replaced too: the strip stays
  // (`pointer-events-none` on it is what keeps the rest of the top edge
  // click-through) and the button is placed against it directly.
  <div className="pointer-events-none fixed left-0 right-0 top-0 z-50">
    <button
      aria-expanded={expanded}
      aria-label="Voice settings"
      // Captured: `h-10 w-10 group overflow-hidden rounded-full border-none p-0.5
      // transition-colors duration-200 ease-in-out`, with `bg-transparent!`
      // forced in both themes — so no hover backplate; the hover is on the glyph.
      className="group pointer-events-auto absolute flex items-center justify-center overflow-hidden rounded-full border-none bg-transparent p-0 transition-colors"
      style={{
        top: TRIGGER_WILLOW_INSET_TOP,
        right: TRIGGER_WILLOW_INSET_END,
        width: TRIGGER_WILLOW_SIZE,
        height: TRIGGER_WILLOW_SIZE,
        transitionDuration: `${TRIGGER_TRANSITION_MS}ms`,
        transitionTimingFunction: TRIGGER_TRANSITION_EASE,
      }}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-center">
        {/* `fill-token-text-primary group-hover:fill-token-text-inverted`.
            The resting fill is --text-primary = #fff, captured. The hover
            fill is --text-inverted, which was not in the captured token set;
            the button's own `hover:text-token-text-secondary` was, at
            #cdcdcd, so that is what is applied rather than a hex invented for
            the inverted token. See voice-settings-constants.ts. */}
        <VoiceSettingsIcon
          size={TRIGGER_ICON_SIZE}
          className="text-white transition-colors group-hover:text-[#cdcdcd]"
        />
      </div>
    </button>
  </div>
);

export default VoiceSettingsButton;
