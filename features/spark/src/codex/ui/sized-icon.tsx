import clsx from "clsx";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Icon } from "../icons/icon";
import type { IconAsset } from "../icons/icon-asset";

const css = { compactSource: "_CompactSource_ym4jk_2", leadingSource: "_LeadingSource_ym4jk_6" } as const;

type GlyphComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type SizedIconSource = { assets: { 16: IconAsset; 20: IconAsset } } | { 16: GlyphComponent; 20: GlyphComponent } | GlyphComponent;

export interface SizedIconProps {
  icon: SizedIconSource;
  className?: string;
  legacyClassName?: string;
  size?: "leading" | "secondary";
  "aria-hidden"?: boolean;
  "data-no-autosize"?: boolean;
}

function AdaptiveSources({ compact, leading, ariaHidden }: { compact: ReactNode; leading: ReactNode; ariaHidden?: boolean }) {
  return (
    <>
      <span className={css.compactSource} aria-hidden={ariaHidden}>
        {compact}
      </span>
      <span className={css.leadingSource} aria-hidden={ariaHidden}>
        {leading}
      </span>
    </>
  );
}

/** Icon offered in 16 and 20 px variants (`hE` / `$d` in the bundles); `secondary` always shows the 16 px one. */
export function SizedIcon({ className, icon, legacyClassName = "icon-xs shrink-0", size = "leading", ...rest }: SizedIconProps) {
  if (typeof icon === "object" && "assets" in icon) {
    const ariaHidden = rest["aria-hidden"];
    if (size === "secondary") return <Icon className={className} aria-hidden={ariaHidden} asset={icon.assets[16]} />;
    return (
      <AdaptiveSources
        compact={<Icon className={className} aria-hidden={ariaHidden} asset={icon.assets[16]} />}
        leading={<Icon className={className} aria-hidden={ariaHidden} asset={icon.assets[20]} />}
      />
    );
  }
  if (typeof icon === "object" && 16 in icon) {
    const Compact = icon[16];
    const Leading = icon[20];
    if (size === "secondary") return <Compact className={className} {...rest} aria-hidden />;
    return <AdaptiveSources ariaHidden compact={<Compact className={className} {...rest} aria-hidden />} leading={<Leading className={className} {...rest} aria-hidden />} />;
  }
  const Glyph = icon;
  return <Glyph className={clsx(legacyClassName, className)} {...rest} />;
}
