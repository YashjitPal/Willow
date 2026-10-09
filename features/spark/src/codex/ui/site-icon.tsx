import clsx from "clsx";
import { GlobeLight16Icon } from "../icons/globe-light-16";

const css = { favicon: "_Favicon_fkymq_2" } as const;

export interface SiteIconProps {
  className?: string;
  href: string;
}

/**
 * Website icon (`Js` in app-initial) without remote loading, so it shows the globe placeholder of the favicon
 * (`PO`). Not yet: the bundled app icons for known sites, the `mailto:` and 12 px placeholders.
 */
export function SiteIcon({ className }: SiteIconProps) {
  return (
    <span className={clsx(css.favicon, "inline-block shrink-0", "rounded-2xs", className)}>
      <span className="absolute inset-0 flex items-center justify-center">
        <GlobeLight16Icon />
      </span>
    </span>
  );
}
