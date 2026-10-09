import clsx from "clsx";
import { useId, type SVGProps } from "react";
import { assertIconCapability, prefixIconIds, resolveIconRendering, type IconAlignment, type IconAsset, type IconRendering } from "./icon-asset";

const css = { icon: "_Icon_uttcz_1" } as const;

type SvgProps = Omit<SVGProps<SVGSVGElement>, "children" | "dangerouslySetInnerHTML">;

export interface IconProps extends SvgProps {
  asset: IconAsset;
  alignment?: IconAlignment;
  idPrefix?: string;
  label?: string;
}

/** Renders a Codex icon asset (`<LE asset={...} />` in the bundles). */
export function Icon({ asset, alignment, idPrefix, label, ...svgProps }: IconProps) {
  assertIconCapability(asset, "icon");
  return <IconSvg preset={asset} icon={resolveIconRendering(asset, alignment)} svgProps={svgProps} idPrefix={idPrefix} label={label} />;
}

export type IconComponentProps = SvgProps;

export interface IconComponent {
  (props: IconComponentProps): React.JSX.Element;
  /** Builds the same `<svg>` imperatively (for DOM code outside React). */
  createElement(document: Document, className?: string): SVGSVGElement;
}

/** Turns an icon asset into a named icon component, like the bundles' asset-component factory. */
export function createIconComponent(asset: IconAsset, alignment?: IconAlignment): IconComponent {
  const icon = resolveIconRendering(asset, alignment);
  function AssetIcon(props: IconComponentProps) {
    return <IconSvg preset={asset} icon={icon} svgProps={{ ...props, className: clsx(css.icon, props.className), focusable: props.focusable ?? "false" }} />;
  }
  return Object.assign(AssetIcon, {
    createElement(document: Document, className?: string) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", clsx(css.icon, className));
      svg.setAttribute("focusable", "false");
      svg.setAttribute("height", String(asset.canvas.height));
      svg.setAttribute("viewBox", asset.canvas.viewBox);
      svg.setAttribute("width", String(asset.canvas.width));
      if (icon.supportsWideGamut) svg.setAttribute("data-icon-p3", asset.name);
      for (const [name, value] of Object.entries(icon.style)) svg.style.setProperty(name, value);
      svg.innerHTML = prefixIconIds(icon.body, `${asset.name}-${crypto.randomUUID()}`);
      return svg;
    },
  });
}

function IconSvg({ preset, icon, svgProps, idPrefix, label }: { preset: IconAsset; icon: IconRendering; svgProps: SvgProps; idPrefix?: string; label?: string }) {
  const {
    "aria-hidden": ariaHidden,
    className,
    focusable,
    role,
    style,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    ...rest
  } = svgProps;
  const id = useId();
  const accessibleLabel = ariaLabel ?? (label == null || label === "" ? undefined : label);
  const labelled = (accessibleLabel != null && accessibleLabel !== "") || (ariaLabelledBy != null && ariaLabelledBy !== "");
  return (
    <svg
      {...rest}
      aria-hidden={ariaHidden ?? (!labelled || undefined)}
      aria-label={accessibleLabel}
      aria-labelledby={ariaLabelledBy}
      className={className}
      data-icon-p3={icon.supportsWideGamut ? preset.name : undefined}
      focusable={focusable}
      height={preset.canvas.height}
      role={role ?? (labelled ? "img" : undefined)}
      style={{ ...icon.style, ...style }}
      viewBox={preset.canvas.viewBox}
      width={preset.canvas.width}
      xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={{ __html: prefixIconIds(icon.body, idPrefix ?? `${preset.name}-${id}`) }}
    />
  );
}
