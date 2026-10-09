import clsx from "clsx";
import type { ReactNode } from "react";
import { StackLight16Icon, StackLight20Icon, TextPageLight16Icon, TextPageLight20Icon } from "../../codex/icons";
import {
  normalizeProjectIcon,
  projectColorName,
  projectColorNames,
  projectColorTheme,
  projectColorValues,
  resolveProjectColor,
  type ProjectColorName,
} from "../../codex/ui/project-appearance";
import { SizedIcon } from "../../codex/ui/sized-icon";
import { SymbolTile } from "../../codex/ui/symbol-tile";
import { useSpace, useSpacesStore, type PageSymbol, type SpaceAppearance } from "../state";

export { SymbolTile, type SymbolTileProps } from "../../codex/ui/symbol-tile";

export const spaceColorNames = projectColorNames;
export type SpaceColorName = ProjectColorName;
export const spaceColors = projectColorValues;

/** `efr`: palette entry for a stored theme, `black` for none, `null` for a custom color. */
export const spaceColorName = projectColorName;

/** `BL`: the CSS color for a stored theme in the current color scheme. */
export function resolveSpaceColor(value: string | null | undefined) {
  return resolveProjectColor(value, document.documentElement.dataset.theme === "dark" ? "dark" : "light");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `tJn`: splits a leading emoji off a title. */
export function splitLeadingEmoji(text: string) {
  const first = graphemes.segment(text)[Symbol.iterator]().next().value?.segment;
  if (first != null && /\p{Emoji_Presentation}|\p{Emoji}\uFE0F|[#*0-9]\u20E3/u.test(first)) {
    const title = text.slice(first.length).trimStart();
    return { emoji: first, title, titleOffset: text.length - title.length };
  }
  return { emoji: null, title: text, titleOffset: 0 };
}

/** `dfr`: the symbol a Space appearance resolves to: a catalog icon id, else a leading emoji. */
export function appearanceSymbol(appearance: SpaceAppearance | null | undefined): PageSymbol | null {
  const icon = normalizeProjectIcon(appearance?.emoji);
  if (icon != null) return { kind: "icon", value: icon, color: appearance?.theme ?? "black" };
  const emoji = splitLeadingEmoji(appearance?.emoji ?? "").emoji;
  return emoji == null ? null : { kind: "emoji", value: emoji };
}

/** `o1t` (`pfr`): a Space's appearance, taken from its root Page symbol when it has one. */
export function useSpaceAppearance(spaceId: string | undefined): SpaceAppearance | null | undefined {
  const space = useSpace(spaceId);
  const rootSymbol = useSpacesStore((state) => (space == null ? undefined : state.pages[space.root_page_id]?.symbol));
  if (space == null) return undefined;
  if (rootSymbol != null) {
    const color = rootSymbol.kind === "icon" ? projectColorName(rootSymbol.color) : null;
    return { emoji: rootSymbol.value, theme: color == null ? null : projectColorTheme(color) };
  }
  return space.appearance;
}

type TileVariant = "default" | "roundrect" | "avatar";

export interface SpaceIconProps {
  className?: string;
  spaceId?: string;
  size?: 16 | 20 | "leading";
  symbol?: PageSymbol | null;
  variant?: TileVariant;
}

/** `K$t` (`ZLComponent`): a Space's emoji or the default stack icon. */
export function SpaceIcon({ className, spaceId, size, symbol, variant = "default" }: SpaceIconProps) {
  const appearance = useSpaceAppearance(spaceId);
  const resolvedSymbol = symbol ?? appearanceSymbol(appearance);
  const color = symbol != null ? (symbol.kind === "icon" ? symbol.color : null) : (appearance?.theme ?? null);
  let defaultIcon: ReactNode = <StackLight16Icon />;
  if (variant === "avatar" || size === 20) defaultIcon = <StackLight20Icon />;
  else if (size === "leading" || (variant === "roundrect" && size == null)) defaultIcon = <SizedIcon icon={{ 16: StackLight16Icon, 20: StackLight20Icon }} />;
  if (resolvedSymbol?.kind === "emoji") defaultIcon = <span aria-hidden>{resolvedSymbol.value}</span>;
  const tileClassName = className ?? (variant === "roundrect" ? "icon-2xs" : "icon-xs");
  return (
    <SymbolTile
      className={size == null ? tileClassName : undefined}
      color={color}
      icon={resolvedSymbol?.kind === "icon" ? resolvedSymbol.value : null}
      defaultIcon={defaultIcon}
      variant={variant}
      size={size ?? (variant === "default" && className == null ? 16 : undefined)}
    />
  );
}

/** `Ymr1Component`: a Page symbol, falling back to `defaultIcon`. */
function PageSymbolIcon({ symbol, defaultIcon, size = 20, className }: { symbol: PageSymbol; defaultIcon: ReactNode; size?: 16 | 20; className?: string }) {
  if (symbol.kind === "emoji") {
    return (
      <span aria-hidden className={className}>
        {symbol.value}
      </span>
    );
  }
  return <SymbolTile className={className} color={symbol.color} defaultIcon={defaultIcon} icon={symbol.value} size={size} />;
}

/** `L$t` (`Cmr`): icon and display title for a Page, splitting a leading emoji off the title. */
export function pageIconAndTitle(title: string, iconClassName?: string, defaultIcon?: ReactNode, symbol?: PageSymbol | null, size: 16 | 20 = 16) {
  const fallback = defaultIcon ?? <TextPageLight16Icon className={iconClassName} />;
  if (symbol != null) return { icon: <PageSymbolIcon className={iconClassName} symbol={symbol} defaultIcon={fallback} size={size} />, title };
  const split = splitLeadingEmoji(title);
  if (split.emoji == null) return { icon: fallback, title };
  return {
    icon: (
      <span aria-hidden className={iconClassName}>
        {split.emoji}
      </span>
    ),
    title: split.title,
  };
}

export interface PageIconProps {
  children: (display: { icon: ReactNode; title: string }) => ReactNode;
  fallbackIcon?: ReactNode;
  iconClassName?: string;
  /** `file-type` tints the default page icon with the document color. */
  iconColor?: "file-type";
  iconSize?: 16 | 20;
  pageId?: string;
  symbol?: PageSymbol | null;
  title: string;
}

/** `F$t` (`IR1Component`): resolves a Page's icon (its Space's icon for a Space root) and passes it to `children`. */
export function PageIcon({ children, fallbackIcon, iconClassName, iconColor, iconSize = 16, pageId, symbol, title }: PageIconProps) {
  const rootOfSpace = useSpacesStore((state) => (pageId == null ? undefined : state.spaces.find((space) => space.root_page_id === pageId)));
  if (rootOfSpace != null) return <>{children({ icon: <SpaceIcon spaceId={rootOfSpace.id} size={iconSize} />, title })}</>;
  const defaultClassName = clsx(iconClassName, iconColor === "file-type" && "text-file-document");
  const defaultIcon = iconSize === 20 ? <TextPageLight20Icon className={defaultClassName} /> : <TextPageLight16Icon className={defaultClassName} />;
  return <>{children(pageIconAndTitle(title, iconClassName, fallbackIcon ?? defaultIcon, symbol, iconSize))}</>;
}
