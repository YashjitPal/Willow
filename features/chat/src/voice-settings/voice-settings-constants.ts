/**
 * Voice settings panel — extracted spec.
 *
 * Every number, colour and easing in this file was read off the shipped panel
 * over CDP (computed styles, `getBoundingClientRect`, a style-attribute
 * MutationObserver) or lifted verbatim from the shipped bundle via
 * `Debugger.getScriptSource`. Nothing here was chosen; where a value needed
 * deriving from two measurements the derivation is written out so it stays
 * checkable.
 *
 * Upstream is on Tailwind v4 with a design-token layer (`bg-token-bg-primary`,
 * `text-token-text-quaternary`, …). Willow's v3 build has neither those tokens
 * nor v4's bare-numeric scales, so the components spell the same values as v3
 * arbitrary utilities. The literals live here so the correspondence between the
 * class strings and what was measured is one lookup away.
 *
 * Token values, read from `getComputedStyle(document.documentElement)` on the
 * live page (dark theme, which is the only theme Willow's voice mode runs in):
 *
 *   --text-primary                    #fff
 *   --text-secondary                  #cdcdcd
 *   --text-tertiary                   #afafaf
 *   --text-quaternary                 #ffffff69
 *   --bg-primary                      #212121
 *   --bg-secondary                    #303030
 *   --bg-tertiary                     #414141
 *   --border-light                    #ffffff0d
 *   --interactive-bg-secondary-hover  #ffffff1a
 */

/** Panel width: `w-[100cqw] … max-w-lg` against a viewport-sized container. */
export const PANEL_MAX_WIDTH = 512;

/**
 * Measured 512 x 372 at a 1536-wide viewport and again at 800 — the width is
 * capped by `max-w-lg` and the height is entirely content-driven, so neither
 * moved. The height is recorded for the tests rather than applied as a style.
 */
export const PANEL_MEASURED_HEIGHT = 372;

/** `rounded-2xl`. */
export const PANEL_RADIUS = 16;

/** `bg-token-bg-primary`. */
export const PANEL_BG = '#212121';

/**
 * The colour everything in the panel inherits: --text-primary, #fff.
 *
 * Upstream never writes this on the panel — it inherits from an ancestor that
 * defines the token, which is why the voice name and the globe glyph carry no
 * colour of their own in the captured markup (the name is bare `text-xl
 * font-semibold`, the glyph is `fill="currentColor"`).
 *
 * Willow has no such ancestor, and a modal `<dialog>` is worse than neutral: the
 * UA sheet gives it `color: CanvasText`, so an uncoloured descendant paints black
 * on the #212121 panel. Setting the token's own value on the dialog restores the
 * inheritance upstream relies on, rather than colouring each element by hand.
 */
export const PANEL_TEXT_COLOR = '#ffffff';

/**
 * The scrim.
 *
 * Painted on the `<dialog>` element itself, not on `::backdrop` — the captured
 * class list carries `backdrop-blur-[1px] bg-[rgba(0,0,0,0.5)]` directly, and
 * Tailwind's `backdrop-blur-*` is `backdrop-filter` on the element. So this is
 * the dialog's own computed `background-color` and `backdrop-filter`. The blur is
 * real, not a no-op: the page behind is visibly softened at 1px.
 */
export const BACKDROP_BG = 'rgba(0, 0, 0, 0.5)';
export const BACKDROP_BLUR = 1;

/**
 * Panel enter/exit.
 *
 * This one had to come from source. Framer Motion drives inline styles from
 * `requestAnimationFrame`, so it emits no `animationstart`/`transitionstart` and
 * registers nothing in `getAnimations()` — four separate CSS-event recorders all
 * reported "no animation" before the bundle was read:
 *
 *   initial: {opacity: 0, scale: .96}
 *   animate: {opacity: 1, scale: 1}
 *   exit:    {opacity: 0, scale: .96}
 *   transition: {duration: A, ease: [.4, 0, .2, 1]}      with A = Xa() ? 0 : .22
 *
 * `Xa()` is the reduced-motion hook, hence DURATION_REDUCED. Confirmed live
 * afterwards by sampling the style attribute at 10 ms: an unclassed div inside
 * the dialog stepping scale(0.963488) → scale(0.982586) → scale(0.988738) with
 * `prefers-reduced-motion` false.
 */
export const PANEL_TRANSITION = {
  duration: 0.22,
  ease: [0.4, 0, 0.2, 1],
} as const;
export const PANEL_TRANSITION_DURATION_REDUCED = 0;
export const PANEL_SCALE_CLOSED = 0.96;

/** `p-8 pb-4` on the panel body. */
export const PANEL_PADDING = 32;
export const PANEL_PADDING_BOTTOM = 16;

/** Close button: `absolute inset-e-5 top-5 h-8 w-8 rounded-lg`. */
export const CLOSE_BUTTON_SIZE = 32;
export const CLOSE_BUTTON_INSET = 20;
export const CLOSE_BUTTON_RADIUS = 8;
export const CLOSE_ICON_SIZE = 20;

/**
 * Close button hover, from a computed-style read before and during a synthetic
 * pointerover: transparent → #414141 (`dark:hover:bg-token-bg-tertiary!`), with
 * no transition on the property, so the change is instant.
 */
export const CLOSE_BUTTON_HOVER_BG = '#414141';
export const CLOSE_BUTTON_FG = '#cdcdcd';

/**
 * Orb slot.
 *
 * `h-36 min-h-36 w-36 min-w-36` on both the row and the visualiser box, from the
 * compact branch of the picker: `className: I ? 'h-36 min-h-36 w-36 min-w-36'`
 * where `I = mode === 'focused' && variant === 'compact'`. The live canvas
 * carries `style="width: 144px; height: 144px;"` with a 180 x 180 backing
 * buffer, i.e. 144 CSS px at DPR 1.25.
 */
export const ORB_SLOT_SIZE = 144;

/** Gap between the orb row and the voice-name block: `gap-6` on the wrapper. */
export const PICKER_GAP = 24;

/**
 * Voice-name block.
 *
 * `relative flex h-20 w-60` for the compact layout (`I ? 'h-20 w-60' : 'h-24
 * w-48'`), with the name column itself at `w-48`.
 */
export const NAME_BLOCK_HEIGHT = 80;
export const NAME_BLOCK_WIDTH = 240;
export const NAME_COLUMN_WIDTH = 192;

/** Name `text-xl font-semibold`; description `text-sm` at --text-secondary. */
export const VOICE_NAME_FONT_SIZE = 20;
export const VOICE_NAME_LINE_HEIGHT = 28;
export const VOICE_NAME_WEIGHT = 600;
export const VOICE_DESCRIPTION_FONT_SIZE = 14;
export const VOICE_DESCRIPTION_LINE_HEIGHT = 20;
export const VOICE_DESCRIPTION_COLOR = '#cdcdcd';

/**
 * Dots: `flex items-center justify-center gap-3 h-10` around
 * `h-2 w-2 rounded-full transition-colors`.
 *
 * Selected is `bg-black dark:bg-white`; unselected in the compact layout is
 * `bg-token-text-tertiary/30`. The unselected value computes to
 * `oklab(0.754013 … / 0.3)` because v4 mixes alpha in oklab; those oklab coords
 * are exactly #afafaf's, so what is painted is --text-tertiary at 30 %.
 */
export const DOT_SIZE = 8;
export const DOT_GAP = 12;
export const DOT_ROW_HEIGHT = 40;
export const DOT_SELECTED_BG = '#ffffff';
export const DOT_UNSELECTED_BG = 'rgba(175, 175, 175, 0.3)';

/**
 * Arrows: `absolute z-50 transition-opacity duration-175`, placed
 * `top-1/2 -translate-y-1/2` with `-start-4` / `-end-4` in the focused layout.
 *
 * The 175 ms is an opacity fade the component drives itself, not a hover
 * response — `isFading ? 'opacity-20' : 'opacity-100'`, where `isFading` is set
 * on arrow-initiated changes and cleared by `setTimeout(…, 175)`. Which is why
 * the hover probe correctly recorded no change here.
 */
export const ARROW_INSET = -16;
export const ARROW_ICON_SIZE = 24;
export const ARROW_FADE_MS = 175;
export const ARROW_FADE_OPACITY = 0.2;
export const ARROW_ICON_COLOR = '#ffffff69';
export const ARROW_ICON_HOVER_COLOR = '#cdcdcd';

/**
 * Settings rows below the picker: `mt-6 w-full` wrapper around
 * `border-token-border-light flex min-h-[52px] items-center justify-between
 * gap-4 border-b last:border-b-0`.
 *
 * Only one row ships today (Language), and it is the last row, so `border-b` is
 * cancelled by `last:border-b-0` and nothing is painted. The border colour is
 * kept because the row is written to take siblings — a second row would draw it.
 */
export const SETTINGS_LIST_MARGIN_TOP = 24;
export const SETTINGS_ROW_MIN_HEIGHT = 52;
export const SETTINGS_ROW_GAP = 16;
export const SETTINGS_ROW_BORDER_COLOR = '#ffffff0d';

/**
 * Row label group: `flex min-w-0 items-center gap-3`, measured 97.14 x 24 for
 * "Language" at a 1536-wide viewport.
 *
 * The globe is declared `width="20" height="20"` but carries `icon-sm`, whose
 * `!important` 16px wins — the rect measures 16 x 16 while the viewBox stays
 * "0 0 20 20". The clone renders it the same way round: 20-unit viewBox, 16 px
 * box.
 */
export const SETTINGS_ROW_ICON_SIZE = 16;
export const SETTINGS_ROW_ICON_VIEWBOX = 20;
export const SETTINGS_ROW_LABEL_GAP = 12;
export const SETTINGS_ROW_LABEL_FONT_SIZE = 16;
export const SETTINGS_ROW_LABEL_LINE_HEIGHT = 24;
export const SETTINGS_ROW_LABEL_COLOR = '#ffffff';

/**
 * Combobox trigger: `inline-flex h-9 items-center … max-w-60 justify-end gap-1
 * rounded-lg bg-transparent px-2 py-1 text-end` with a transparent 1 px border.
 *
 * Measured 111.95 x 36 — the width is content-driven ("Auto-detect" plus the
 * chevron), which is why only the height and the cap are recorded. Hover is the
 * same `dark:hover:bg-token-bg-tertiary!` as the close button, so the same
 * #414141, again with no transition on the property.
 */
export const COMBOBOX_HEIGHT = 36;
export const COMBOBOX_MAX_WIDTH = 240;
export const COMBOBOX_RADIUS = 8;
export const COMBOBOX_PADDING_X = 8;
export const COMBOBOX_PADDING_Y = 4;
export const COMBOBOX_GAP = 4;
export const COMBOBOX_FONT_SIZE = 14;
export const COMBOBOX_LINE_HEIGHT = 14;
export const COMBOBOX_HOVER_BG = '#414141';
export const COMBOBOX_CHEVRON_SIZE = 16;

/**
 * Dropdown surface: `z-50 popover … dark:bg-[#353535] rounded-2xl py-1.5
 * shadow-long max-w-xs max-h-[60vh] min-w-[220px] overflow-auto`.
 *
 * `bg-token-main-surface-primary` is overridden by the explicit dark hex, and
 * --main-surface-primary reads #000, so #353535 is what is painted.
 */
export const LISTBOX_BG = '#353535';
export const LISTBOX_RADIUS = 16;
export const LISTBOX_PADDING_Y = 6;
export const LISTBOX_MIN_WIDTH = 220;
export const LISTBOX_MAX_WIDTH = 320;
export const LISTBOX_MAX_HEIGHT_VH = 60;
export const LISTBOX_Z_INDEX = 50;

/**
 * Popper placement, derived from one live capture rather than assumed.
 *
 * Radix writes the positioning onto a wrapper div as inline styles:
 *
 *   position: fixed; left: 872.85px; bottom: 0px; height: 283.2px;
 *   margin: 10px 0px; min-width: 119.15px; min-height: 180px;
 *   max-height: 806px; z-index: 50;
 *
 * against a trigger at x=880.05 w=111.95, in an 826-tall viewport. That gives
 * the three numbers below:
 *
 *   left      872.85 − 880.05      = −7.2   (the popover overlaps its trigger)
 *   min-width 119.15 − 111.95      = +7.2   (same 7.2, mirrored)
 *   margin    826 − 10 − 532.4     = 283.6  ≈ the 283.2 height that was set,
 *                                            i.e. a 10 px viewport margin
 *
 * Vertically it is item-aligned, not edge-aligned: the selected option's centre
 * lands on the trigger's centre. Trigger centre is 538.8 + 36/2 = 556.8;
 * "Auto-detect" is option 0, so its centre sits at listTop + 6 (py-1.5) + 18
 * (half a 36 px row) = listTop + 24, predicting listTop = 532.8 against 532.4
 * measured — 0.4 px, which is the sub-pixel rounding on the trigger rect.
 */
export const LISTBOX_OFFSET_X = -7.2;
export const LISTBOX_VIEWPORT_MARGIN = 10;
export const LISTBOX_MIN_HEIGHT = 180;

/**
 * Options: `.__menu-item flex justify-between`, resolved against the shipped
 * `--menu-item-height: calc(.25rem * 9)`.
 *
 * Resting background is transparent even for the checked option — the tick in
 * the trailing slot is the only selected affordance. `transition: all` computes
 * with a 0 s duration, so the hover change is instant.
 */
export const OPTION_HEIGHT = 36;
export const OPTION_PADDING_TOP = 6;
export const OPTION_PADDING_END = 32;
export const OPTION_PADDING_START = 10;
export const OPTION_MARGIN_X = 6;
export const OPTION_RADIUS = 10;
export const OPTION_FONT_SIZE = 14;
export const OPTION_LINE_HEIGHT = 20;
export const OPTION_HOVER_BG = '#ffffff1a';
export const OPTION_CHECK_SIZE = 16;

/**
 * `shadow-long`, on both the panel and the dropdown. Read back as one computed
 * `box-shadow` string; it is three layers, and the comma-separated form does not
 * survive a Tailwind arbitrary value, so it lives in CSS next to `.__menu-item`
 * and is recorded here only so the tests can assert against the measurement.
 */
export const SHADOW_LONG =
  'rgba(0, 0, 0, 0.32) 0px 8px 16px 0px, rgba(255, 255, 255, 0.2) 0px 0px 1px 0px inset, rgba(0, 0, 0, 0.62) 0px 0px 1px 0px';

/**
 * The trigger, in the voice-mode header rather than the dialog, so it was
 * measured on the live page separately from the panel dump.
 *
 * `h-10 w-10 … overflow-hidden rounded-full border-none p-0.5 transition-colors
 * duration-200 ease-in-out`, measured 40 x 40 at x=1472 y=6 in a 1536-wide
 * viewport. `border-radius` reads 2.68435e+07px, i.e. `rounded-full`.
 *
 * Both offsets are inherited from the header rather than set on the button, so
 * they are recorded as the ancestors' values and reproduced that way:
 *
 *   right  24  = `pe-6` on the header row (1536 − 1472 − 40 = 24)
 *   top     6  = `p-2` (8) on that row, minus 2 from `-mt-0.5` on the flex row
 *
 * The header row itself measured 1260.8 x 54 with padding `8px 24px 8px 8px`,
 * inside a `pointer-events-none fixed` container pinned top/right — which is
 * what makes the button clickable while the strip around it is not.
 */
export const TRIGGER_SIZE = 40;
export const TRIGGER_PADDING = 2;
export const TRIGGER_ICON_SIZE = 20;
export const TRIGGER_INSET_TOP = 6;
export const TRIGGER_INSET_END = 24;
export const TRIGGER_HEADER_PADDING = 8;
export const TRIGGER_HEADER_PADDING_END = 24;
export const TRIGGER_TRANSITION_MS = 200;
export const TRIGGER_TRANSITION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * Trigger colours.
 *
 * The svg carries `fill-token-text-primary`, so the resting fill is
 * --text-primary = #fff from the token dump. Hover is the one value on this
 * element that was not sampled directly: the icon declares
 * `group-hover:fill-token-text-inverted` and --text-inverted was not in the
 * captured token set, while the button itself declares
 * `hover:text-token-text-secondary`, which is #cdcdcd and was captured. The
 * clone applies the measured secondary and leaves the inverted fill out rather
 * than inventing a hex for it; this is the only place in the panel where the
 * spelling is a measured value standing in for an unmeasured one.
 */
export const TRIGGER_ICON_FILL = '#ffffff';
export const TRIGGER_ICON_HOVER_FILL = '#cdcdcd';

/**
 * Where Willow puts the trigger, which is not where upstream puts it.
 *
 * Asked for directly: "make it be in the exact same position as the temporary
 * chat button". That button is Willow's own top-right chat chrome — `absolute
 * top-[14px] right-[12px]` with a `w-[36px] h-[36px]` box, sitting in the content
 * column whose right edge is the viewport's — so the same rect expressed in a
 * fixed strip is 36 x 36 at top 14, right 12.
 *
 * The captured geometry is kept above, unchanged, as the record of what was
 * measured: 40 x 40 at top 6 / right 24, reached through `p-2 pe-6` and
 * `-mt-0.5`. Only the box and its offsets are overridden here. The glyph keeps
 * its measured 20px size, its fill, its hover colour and its 200ms ease-in-out,
 * and stays centred in the box — so the icon's centre lands exactly on the
 * temporary chat button's icon centre, which is what "same position" means for
 * the only part of this control that paints anything.
 */
export const TRIGGER_WILLOW_SIZE = 36;
export const TRIGGER_WILLOW_INSET_TOP = 14;
export const TRIGGER_WILLOW_INSET_END = 12;

/**
 * Content column: `flex w-full flex-col items-center gap-6` inside the padded
 * body, measured 448 x 248 — 448 being 512 − 2 x 32, so it is the padding box
 * and needs no width of its own.
 *
 * Row-by-row, at panel origin x=512 y=226.8:
 *
 *   orb row        544, 258.8   448 x 144
 *   orb box        696, 258.8   144 x 144   (centred: 544 + (448 − 144)/2)
 *   voice block    648, 426.8   240 x 80    (258.8 + 144 + 24 gap = 426.8)
 *   dot group      684, 474.8   168 x 32    (9 dots x 8 + 8 gaps x 12 = 168)
 *   prev arrow     632, 454.8    24 x 24    (648 − 16)
 *   next arrow     880, 454.8    24 x 24    (648 + 240 − 24 + 16)
 *   language row   544, 530.8   448 x 52    (426.8 + 80 + 24 = 530.8)
 *
 * The 9 dots are the nine shipped voices; Willow's count comes from the active
 * provider's roster instead, so DOT_ROW_WIDTH_9 is kept only as the check that
 * the gap/size pair reproduces the measured row.
 */
export const CONTENT_COLUMN_WIDTH = 448;
export const CONTENT_COLUMN_HEIGHT = 248;
export const DOT_ROW_WIDTH_9 = 168;

/**
 * How many dots are drawn at once.
 *
 * The one number here the capture forces rather than supplies. Upstream ships
 * nine voices and draws nine dots; Gemini ships thirty, and thirty dots is
 * 30 x 8 + 29 x 12 = 588px inside a 240px block (`w-60`) — the gaps alone are
 * 348px and do not shrink, so the row would burst the panel.
 *
 * Rather than invent a smaller dot, a tighter gap or a scroll affordance, the row
 * always renders the measured geometry: nine dots at DOT_SIZE with DOT_GAP,
 * totalling DOT_ROW_WIDTH_9, exactly as captured. Which nine of the roster they
 * stand for slides with the selection. For a nine-voice provider this is
 * upstream, unchanged; for a longer one every painted pixel is still a measured
 * one. The full roster stays reachable through the arrows, and each rendered
 * radio carries `aria-setsize`/`aria-posinset` so assistive tech reports the real
 * count instead of nine.
 */
export const DOT_WINDOW = 9;


