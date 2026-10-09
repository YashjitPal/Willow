export interface IconBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IconPoint {
  x: number;
  y: number;
}

export interface IconCanvas {
  width: number;
  height: number;
  viewBox: string;
  frame?: IconBounds;
  inkBounds?: IconBounds;
  visualBounds?: IconBounds;
  effectBounds?: IconBounds;
}

export type IconLayerRole = "foreground" | "accent" | "brand" | "fixed" | (string & {});

export interface IconPaintLayer {
  role: IconLayerRole;
  color: string;
  bounds?: IconBounds;
  token?: string;
  foundationToken?: string;
  wideGamut?: string;
  wideGamutToken?: string;
}

export type IconPaint =
  | { kind: "monochrome"; [key: string]: unknown }
  | { kind: "multicolor"; layers: readonly IconPaintLayer[] };

export interface IconOptical {
  shape: string;
  bounds?: IconBounds;
  center?: IconPoint;
  insets?: { top: number; right: number; bottom: number; left: number };
  anchors?: Record<string, IconPoint>;
}

export type IconCapability = "icon" | "mask" | "clipPath";

export interface IconAsset {
  name: string;
  canvas: IconCanvas;
  paint: IconPaint;
  optical: IconOptical;
  capabilities: readonly IconCapability[];
  body: string;
}

export interface IconAssetInput extends Omit<IconAsset, "optical"> {
  optical?: IconOptical;
}

/** `composite` aligns on the ink anchor; any other value aligns on the foreground anchor. */
export type IconAlignment = "composite" | "foreground" | (string & {});

const SUPPORTED_CAPABILITIES = new Set<string>(["icon", "mask", "clipPath"]);

export function defineIconAsset(input: IconAssetInput): IconAsset {
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0 || input.capabilities.some((c) => !SUPPORTED_CAPABILITIES.has(c))) {
    throw new TypeError("icon capabilities must be supported and non-empty");
  }
  if (typeof input.body !== "string" || input.body.trim() === "" || /<\/?(?:svg|symbol|script)\b/i.test(input.body)) {
    throw new TypeError("icon body must be an inner SVG fragment");
  }
  return { ...input, optical: input.optical ?? { shape: "non-circular" }, body: input.body.trim() };
}

export function assertIconCapability(asset: IconAsset, capability: IconCapability) {
  if (!SUPPORTED_CAPABILITIES.has(capability)) throw new TypeError(`unsupported icon capability ${capability}`);
  if (!asset.capabilities.includes(capability)) throw new TypeError(`${asset.name} does not support the ${capability} capability`);
}

function layerVariableName(layer: IconPaintLayer): string | undefined {
  if (layer.token != null || layer.foundationToken != null) return layer.token ?? layer.foundationToken;
  if ((layer.role === "brand" || layer.role === "fixed") && layer.wideGamut != null && /^#[\da-f]{6}$/iu.test(layer.color)) {
    return `authored-${layer.color.slice(1).toLowerCase()}`;
  }
  return undefined;
}

/** CSS custom properties (`--icon-<token>`) that let themes recolor multicolor layers. */
export function iconLayerStyle(asset: IconAsset): Record<string, string> {
  if (asset.paint.kind === "monochrome") return {};
  const style: Record<string, string> = {};
  for (const layer of asset.paint.layers) {
    const variable = layerVariableName(layer);
    if (variable == null) continue;
    const name = variable.replace(/^--/u, "");
    const base = layer.foundationToken == null ? layer.color : `var(--${layer.foundationToken.replace(/^--/u, "")}, ${layer.color})`;
    const value = (layer.role !== "brand" && layer.role !== "fixed") || (layer.wideGamut == null && layer.wideGamutToken == null) ? base : `var(--icon-p3-${name}, ${base})`;
    style[`--icon-${name}`] = layer.token == null ? value : `var(--${name}, ${value})`;
  }
  return style;
}

/** The SVG body with layer colors routed through their `--icon-*` variables. */
export function iconBody(asset: IconAsset): string {
  if (asset.paint.kind === "monochrome") return asset.body;
  let body = asset.body;
  const inkColors = new Set(asset.paint.layers.filter((l) => l.role === "foreground" || l.role === "accent").map((l) => l.color.toLowerCase()));
  const wideGamut: string[] = [];
  for (const layer of asset.paint.layers) {
    const variable = layerVariableName(layer);
    if (variable == null) continue;
    const name = variable.replace(/^--/u, "");
    const branded = layer.role === "brand" || layer.role === "fixed";
    const attributes = branded ? (inkColors.has(layer.color.toLowerCase()) ? "stop-color" : "fill|stroke|stop-color") : "fill|stroke";
    const color = layer.color.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    body = body.replaceAll(new RegExp(`\\b(${attributes})=(["'])${color}\\2`, "giu"), `$1="var(--icon-${name}, ${layer.color})"`);
    if (branded && layer.wideGamut != null) {
      wideGamut.push(`--icon-p3-${name}:${layer.wideGamutToken == null ? layer.wideGamut : `var(--${layer.wideGamutToken.replace(/^--/u, "")},${layer.wideGamut})`}`);
    }
  }
  if (wideGamut.length === 0) return body;
  return `<style>@supports (color:color(display-p3 1 1 1)){@media (color-gamut:p3){svg[data-icon-p3="${asset.name}"]{${wideGamut.join(";")}}}}</style>${body}`;
}

function visualBoundsOverflowFrame({ frame, visualBounds }: IconCanvas): boolean {
  return (
    frame != null &&
    visualBounds != null &&
    (visualBounds.x < frame.x ||
      visualBounds.y < frame.y ||
      visualBounds.x + visualBounds.width > frame.x + frame.width ||
      visualBounds.y + visualBounds.height > frame.y + frame.height)
  );
}

function alignIconBody(asset: IconAsset, alignment: IconAlignment | undefined): { body: string; overflows: boolean } {
  const body = iconBody(asset);
  const overflows = visualBoundsOverflowFrame(asset.canvas);
  if (alignment == null) return { body, overflows };
  const frame = asset.canvas.frame ?? { x: 0, y: 0, width: asset.canvas.width, height: asset.canvas.height };
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const anchors = asset.optical.anchors;
  const anchor =
    alignment === "composite"
      ? (anchors?.ink ?? asset.optical.center ?? center)
      : (anchors?.foreground ?? anchors?.ink ?? asset.optical.center ?? center);
  const dx = Number((center.x - anchor.x).toFixed(6));
  const dy = Number((center.y - anchor.y).toFixed(6));
  if (dx === 0 && dy === 0) return { body, overflows };
  const visualBounds = asset.canvas.visualBounds;
  return {
    body: `<g transform="translate(${dx} ${dy})">${body}</g>`,
    overflows:
      overflows ||
      visualBounds == null ||
      visualBounds.x + dx < frame.x ||
      visualBounds.y + dy < frame.y ||
      visualBounds.x + dx + visualBounds.width > frame.x + frame.width ||
      visualBounds.y + dy + visualBounds.height > frame.y + frame.height,
  };
}

export interface IconRendering {
  body: string;
  style: Record<string, string>;
  supportsWideGamut: boolean;
}

export function resolveIconRendering(asset: IconAsset, alignment?: IconAlignment): IconRendering {
  const aligned = alignIconBody(asset, alignment);
  return {
    body: aligned.body,
    style: { ...iconLayerStyle(asset), ...(aligned.overflows ? { overflow: "visible" } : {}) },
    supportsWideGamut:
      asset.paint.kind === "multicolor" && asset.paint.layers.some((l) => (l.role === "brand" || l.role === "fixed") && l.wideGamut != null),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

/** Prefixes local SVG ids (and their url()/href references) so multiple instances never collide. */
export function prefixIconIds(body: string, prefix: string | undefined): string {
  const ids = new Set([...body.matchAll(/(?:^|[\s<])id\s*=\s*(["'])([^"']+)\1/g)].map((m) => m[2]).filter((id) => id != null));
  if (prefix == null) {
    if (ids.size > 0) throw new TypeError("icon idPrefix is required when the SVG body contains local IDs");
    return body;
  }
  let result = body;
  for (const id of ids) {
    const prefixed = `${prefix}-${id}`;
    const escaped = escapeRegExp(id);
    result = result
      .replace(new RegExp(`((?:^|[\\s<])id\\s*=\\s*)(["'])${escaped}\\2`, "g"), (_m, head: string, quote: string) => head + quote + prefixed + quote)
      .replace(new RegExp(`(url\\(\\s*)(["']?)#${escaped}\\2(\\s*\\))`, "g"), (_m, head: string, quote: string, tail: string) => `${head}${quote}#${prefixed}${quote}${tail}`)
      .replace(new RegExp(`((?:^|[\\s<])(?:xlink:)?href\\s*=\\s*)(["'])#${escaped}\\2`, "g"), (_m, head: string, quote: string) => `${head}${quote}#${prefixed}${quote}`);
  }
  return result;
}
