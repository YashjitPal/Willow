/**
 * Flow's Tools catalog as Willow ships it: the 34 templates and 34 community tools, the Community
 * carousel and the Create tool suggestions (`catalog/catalog.json`), and each tool's files
 * (`catalog/sources/<id>.json`, loaded only when the tool is opened). Generated from Flow by
 * tools/ui-research/scrapers/flow/tools/14-build-catalog.cjs; see that script for where each
 * field comes from. Pictures stay on Flow's CDN (gstatic), as Flow serves them.
 */
import catalogJson from './catalog/catalog.json';

export type ToolCategory = 'Spotlight' | 'Image' | 'Video' | 'Prompting' | 'Experimental';

/** Flow's section order; a section shows only when it has tools. */
export const TOOL_CATEGORIES: ToolCategory[] = ['Spotlight', 'Image', 'Video', 'Prompting', 'Experimental'];

export const CATEGORY_TITLES: Record<ToolCategory, string> = {
  Spotlight: 'Spotlight creatives',
  Image: 'Image',
  Video: 'Video',
  Prompting: 'Prompting',
  Experimental: 'Experimental',
};

export interface CatalogTool {
  id: string;
  name: string;
  description: string;
  author: string;
  icon: string;
  preview: string | null;
  category: ToolCategory;
  spotlightOrder?: number;
}

export interface CarouselSlide {
  id: string;
  title: string;
  subtitle: string;
  background: string;
  toolIcon?: string;
  toolName?: string;
  toolId?: string | null;
  author?: string;
  avatars?: string[];
  cta?: string;
}

export interface CreateSuggestion {
  icon: string;
  name: string;
  description: string;
  prompt: string;
}

interface CatalogFile {
  assetBase: string;
  banners: { templates: string; myTools: string };
  iconPresets: string[];
  templates: CatalogTool[];
  community: CatalogTool[];
  carousel: CarouselSlide[];
  suggestions: CreateSuggestion[];
}

const catalog = catalogJson as unknown as CatalogFile;

export const ASSET_BASE = catalog.assetBase;
export const BANNERS = catalog.banners;
/** The Edit icon dialog's presets: default/ada-1…18, then first-party/ada-1…17. */
export const ICON_PRESETS = catalog.iconPresets;
export const TEMPLATES: readonly CatalogTool[] = catalog.templates;
export const COMMUNITY_TOOLS: readonly CatalogTool[] = catalog.community;
export const COMMUNITY_SLIDES: readonly CarouselSlide[] = catalog.carousel;
export const CREATE_SUGGESTIONS: readonly CreateSuggestion[] = catalog.suggestions;
/** The Community tab's banner while its slides are not shown. */
export const COMMUNITY_BANNER = `${ASSET_BASE.replace(/applets\/$/, '')}banners/2026-07-15-52de2576-bb58-46ee-a3d0-0dd198d6ffff-Community-Tools.png`;
const byId = new Map<string, CatalogTool>([...TEMPLATES, ...COMMUNITY_TOOLS].map((t) => [t.id, t]));

export const catalogTool = (id: string): CatalogTool | undefined => byId.get(id);
export const isTemplateId = (id: string): boolean => TEMPLATES.some((t) => t.id === id);
export const isCommunityId = (id: string): boolean => id.startsWith('community-') && byId.has(id);

/** A new tool's picture: one of Flow's default presets, as its server picks one. */
export function randomToolIcon(): string {
  return `${ASSET_BASE}default/ada-${1 + Math.floor(Math.random() * 18)}.png`;
}

/** Flow's gallery order for templates: its fixed list, then name. */
export function templatesBySection(): { category: ToolCategory; tools: CatalogTool[] }[] {
  return TOOL_CATEGORIES.map((category) => ({ category, tools: TEMPLATES.filter((t) => t.category === category) }))
    .filter((s) => s.tools.length > 0);
}

/** Flow's community order: spotlight order first, then name. */
export function communityBySection(): { category: ToolCategory; tools: CatalogTool[] }[] {
  const order = (a: CatalogTool, b: CatalogTool) => {
    if (a.spotlightOrder !== undefined && b.spotlightOrder !== undefined && a.spotlightOrder !== b.spotlightOrder) return a.spotlightOrder - b.spotlightOrder;
    if (a.spotlightOrder !== undefined && b.spotlightOrder === undefined) return -1;
    if (b.spotlightOrder !== undefined && a.spotlightOrder === undefined) return 1;
    return a.name.localeCompare(b.name);
  };
  return TOOL_CATEGORIES.map((category) => ({ category, tools: COMMUNITY_TOOLS.filter((t) => t.category === category).sort(order) }))
    .filter((s) => s.tools.length > 0);
}
