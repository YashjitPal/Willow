import type { IconAsset } from "./icon-asset";

/**
 * Willow draws Codex's interface icons with Google's Material Symbols Rounded,
 * so Spaces carries Willow's iconography rather than Codex's. Each entry maps a
 * Codex icon (its name without the weight and size suffix, `chevron-down-md-light-16`
 * is `chevron-down`) to the Material Symbol with the same meaning. Brand marks,
 * multicolour artwork and the symbols people choose for Pages and Spaces keep
 * Codex's drawing, as does any icon without an entry here.
 */
const MATERIAL_SYMBOLS: Record<string, string> = {
  "analytics": "analytics",
  "archive": "archive",
  "arrow-down": "arrow_downward",
  "arrow-down-line-horizontal": "vertical_align_bottom",
  "arrow-down-open-base": "download",
  "arrow-left": "arrow_back",
  "arrow-left-arrow-right": "swap_horiz",
  "arrow-right": "arrow_forward",
  "arrow-right-up-trending": "trending_up",
  "arrow-rotate-counterclockwise": "undo",
  "arrow-up": "arrow_upward",
  "arrow-up-line-horizontal": "vertical_align_top",
  "arrow-up-open-base": "ios_share",
  "arrow-up-right": "arrow_outward",
  "arrows-clockwise-rotate": "refresh",
  "at-sign": "alternate_email",
  "bell": "notifications",
  "bookmark": "bookmark",
  "books": "library_books",
  "building": "domain",
  "calendar": "calendar_today",
  "chat-bubble": "chat_bubble",
  "chat-bubble-on-chat-bubble": "forum",
  "chat-bubble-plus": "add_comment",
  "checkmark": "check",
  "checkmark-circle": "check_circle",
  "checkmark-square": "check_box",
  "chevron-down": "expand_more",
  "chevron-left": "chevron_left",
  "chevron-right": "chevron_right",
  "chevron-up": "expand_less",
  "clipboard-list": "assignment",
  "clock": "schedule",
  "code": "code",
  "cube": "deployed_code",
  "document-pdf": "picture_as_pdf",
  "drag": "drag_indicator",
  "ellipsis-horizontal": "more_horiz",
  "ellipsis-vertical": "more_vert",
  "emoji-face-badge-plus": "add_reaction",
  "envelope": "mail",
  "exclamation-mark-triangle": "warning",
  "eye": "visibility",
  "filter": "filter_list",
  "folder": "folder",
  "folder-person-2": "folder_shared",
  "gear": "settings",
  "globe": "public",
  "heart": "favorite",
  "info-circle": "info",
  "link": "link",
  "list-bullet": "format_list_bulleted",
  "list-number": "format_list_numbered",
  "lock": "lock",
  "magic-wand": "auto_awesome",
  "magnifying-glass": "search",
  "minus": "remove",
  "open-link": "open_in_new",
  "paperclip": "attach_file",
  "pause-circle": "pause_circle",
  "pencil": "edit",
  "pencil-sparkle": "edit_note",
  "person": "person",
  "person-2": "person",
  "person-group": "group",
  "photo": "image",
  "photo-on-square": "photo_library",
  "pin": "keep",
  "pin-slash": "keep_off",
  "pin-window": "picture_in_picture_alt",
  "play-circle": "play_circle",
  "plus": "add",
  "plus-square": "add_box",
  "quotemark": "format_quote",
  "shapes": "category",
  "sites": "web",
  "slides": "slideshow",
  "spreadsheet": "table_chart",
  "square-and-pencil": "edit_square",
  "square-grid-2x2": "grid_view",
  "square-on-square": "content_copy",
  "square-text-format": "format_shapes",
  "stack": "stacks",
  "sticky-notes": "sticky_note_2",
  "table": "table",
  "table-column": "view_column",
  "terms": "article",
  "text-alignleft": "format_align_left",
  "text-bubble": "comment",
  "text-italic": "format_italic",
  "text-page": "description",
  "text-style": "text_fields",
  "trash": "delete",
  "trash-open-arrow-up": "restore_from_trash",
  "trash-xmark": "delete_forever",
  "video": "movie",
  "xmark": "close",
  "xmark-circle": "cancel",
};

const SIZE_SUFFIX = /-(?:light|regular|semibold|bold)-\d+$/;
const SCALE_SUFFIX = /-(?:xs|sm|md|lg|xl)$/;
const KEEPS_CODEX_DRAWING = /^(?:legacy-|project-|agent-mention-|ms-|sites-access-|spinner)/;

export interface MaterialSymbol {
  name: string;
  fill: boolean;
}

const cache = new Map<string, MaterialSymbol | null>();

/** The Material Symbol Willow draws for a Codex icon, or `null` to keep Codex's drawing. */
export function materialSymbolFor(asset: IconAsset): MaterialSymbol | null {
  const cached = cache.get(asset.name);
  if (cached !== undefined) return cached;
  let symbol: MaterialSymbol | null = null;
  if (asset.paint.kind === "monochrome" && !KEEPS_CODEX_DRAWING.test(asset.name)) {
    let base = asset.name.replace(SIZE_SUFFIX, "");
    const fill = /-fill(?=-|$)/.test(base);
    base = base.replace(/-fill(?=-|$)/, "").replace(SCALE_SUFFIX, "");
    const name = MATERIAL_SYMBOLS[base];
    if (name != null) symbol = { name, fill };
  }
  cache.set(asset.name, symbol);
  return symbol;
}

/** The SVG body that draws a Material Symbol on the asset's own canvas, so every Codex sizing rule still applies. */
export function materialSymbolBody(asset: IconAsset, symbol: MaterialSymbol) {
  const { width, height } = asset.canvas;
  const size = Math.min(width, height);
  const settings = `'FILL' ${symbol.fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${Math.max(20, Math.min(48, size))}`;
  return `<text x="${width / 2}" y="${height / 2}" fill="currentColor" font-family="Material Symbols Rounded" font-size="${size}" text-anchor="middle" dominant-baseline="central" style="font-variation-settings:${settings};user-select:none;pointer-events:none">${symbol.name}</text>`;
}
