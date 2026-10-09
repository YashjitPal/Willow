import clsx from "clsx";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Icon } from "../icons/icon";
import type { IconAsset } from "../icons/icon-asset";

const css = {
  compactSource: "_CompactSource_ym4jk_2",
  leadingSource: "_LeadingSource_ym4jk_6",
} as const;

export interface AdaptiveIconSourcesProps {
  "aria-hidden"?: boolean | "true" | "false";
  compact?: ReactNode;
  leading?: ReactNode;
}

/**
 * Renders both icon variants; CSS (`--display-icon-compact` / `--display-icon-leading`) decides which is shown.
 * `gE` in the bundles.
 */
export function AdaptiveIconSources({ "aria-hidden": ariaHidden, compact, leading }: AdaptiveIconSourcesProps) {
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

type SvgIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface AdaptiveIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  /** 16px icon component shown in the leading slot (ignored when `asset16` is set). */
  icon16?: SvgIconComponent;
  asset16?: IconAsset;
  /** Legacy icon shown in the compact slot. */
  legacyIcon: SvgIconComponent;
  legacyClassName?: string;
}

/** Pairs a legacy icon with its 16px replacement (`mE` in the bundles). */
export function AdaptiveIcon({ className, icon16: Icon16, asset16, legacyIcon: LegacyIcon, legacyClassName = "icon-2xs shrink-0", ...svgProps }: AdaptiveIconProps) {
  return (
    <AdaptiveIconSources
      compact={<LegacyIcon className={clsx(legacyClassName, className)} {...svgProps} />}
      leading={asset16 == null ? Icon16 && <Icon16 className={className} {...svgProps} /> : <Icon className={className} {...svgProps} asset={asset16} />}
    />
  );
}
