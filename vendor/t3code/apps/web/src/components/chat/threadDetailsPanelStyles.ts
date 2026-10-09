/**
 * Visual primitives shared by controls when they are rendered in the thread details panel.
 *
 * Panel controls keep one density at every breakpoint, independent of toolbar button sizes. They
 * are Willow's menu rows (`willow/menus.css`): 36px, 8px in with 8px gaps, 12px corners, a 20px
 * glyph, 13px/17px labels, the row's own fill at 6% / 8% under the pointer and 10% / 12% pressed.
 */
const THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS = "bg-transparent shadow-none";

const THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS =
  "hover:!bg-black/[0.06] data-pressed:!bg-black/[0.1] dark:hover:!bg-[rgb(230_230_230/0.08)] dark:data-pressed:!bg-[rgb(230_230_230/0.12)]";

const THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS} ${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS = "gap-2 px-2 text-left";

// The row supplies the first tint; the hovered or open segment adds a second tint.
const THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS} data-popup-open:!bg-black/[0.06] dark:data-popup-open:!bg-[rgb(230_230_230/0.08)]`;

const THREAD_DETAILS_PANEL_CONTROL_CLASS = `h-9 min-w-0 rounded-xl border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} text-[13px] leading-[17px] font-normal text-foreground`;
const THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS} has-[[data-popup-open]]:bg-black/[0.06] dark:has-[[data-popup-open]]:bg-[rgb(230_230_230/0.08)]`;

export const THREAD_DETAILS_PANEL_ROW_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} w-full justify-start ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SELECT_ROW_CLASS = `${THREAD_DETAILS_PANEL_ROW_CLASS} pe-0 [&_[data-slot=select-icon]]:-me-px [&_[data-slot=select-icon]]:relative [&_[data-slot=select-icon]]:flex [&_[data-slot=select-icon]]:h-full [&_[data-slot=select-icon]]:w-9 [&_[data-slot=select-icon]]:shrink-0 [&_[data-slot=select-icon]]:items-center [&_[data-slot=select-icon]]:justify-center [&_[data-slot=select-icon]]:before:absolute [&_[data-slot=select-icon]]:before:-left-px [&_[data-slot=select-icon]]:before:top-1/2 [&_[data-slot=select-icon]]:before:h-4 [&_[data-slot=select-icon]]:before:w-px [&_[data-slot=select-icon]]:before:-translate-y-1/2 [&_[data-slot=select-icon]]:before:bg-border/65 [&_[data-slot=select-icon]>svg]:me-0 [&_[data-slot=select-icon]>svg]:size-5 [&_[data-slot=select-icon]>svg]:text-foreground [&_[data-slot=select-icon]>svg]:opacity-100`;

// No transition on the group: the halves are Buttons whose background snaps (their base only
// transitions shadow), so an eased group tint would land frames later and the hover would
// visibly commit in two steps.
export const THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS = `group/thread-details-link flex w-full items-center rounded-xl ${THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_LINK_SPLIT_PRIMARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} flex-1 justify-start rounded-e-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

/** The trailing half of a link split row when it carries a word ("Merge") rather than an icon. */
export const THREAD_DETAILS_PANEL_LINK_SPLIT_ACTION_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} shrink-0 justify-center rounded-s-none text-primary ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS = `h-9 w-full min-w-0 justify-start rounded-xl border border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} text-[13px] leading-[17px] font-normal text-foreground sm:h-9 sm:text-[13px]`;

export const THREAD_DETAILS_PANEL_ICON_CLASS = "size-5 shrink-0 text-foreground";

export const THREAD_DETAILS_PANEL_CHEVRON_CLASS = "size-5 shrink-0 text-foreground";

export const THREAD_DETAILS_PANEL_ICON_ACTION_CLASS = `size-8 justify-center rounded-full border-transparent bg-transparent p-0 sm:size-8 ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS = `group/thread-details-action flex w-full items-center rounded-xl ${THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_PRIMARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} flex-1 justify-start rounded-e-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SECONDARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} w-9 justify-center rounded-s-none px-0 ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS = "h-4 w-px shrink-0 bg-border/65";

export const THREAD_DETAILS_PANEL_SPLIT_CHECKS_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} justify-center gap-1.5 rounded-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;
