import clsx from "clsx";
import type { ReactNode } from "react";
import { normalizeProjectIcon, projectColorClasses, projectColorNames, type ProjectColor, type ProjectIconId } from "./project-appearance";
import { ProjectIcon, type ProjectIconSize } from "./project-icon";

/** `oDt`: a local project's marker, an emoji or a catalog icon, and its color. */
export interface ProjectMarkerAppearance {
  color: ProjectColor;
  marker: { kind: "emoji"; emoji: string } | { kind: "icon"; icon: ProjectIconId };
}

/** `iSr`: what a project without a stored marker shows and edits from. */
export const defaultProjectMarkerAppearance: ProjectMarkerAppearance = { color: "black", marker: { kind: "icon", icon: "folder" } };

const projectColors: readonly string[] = ["black", ...projectColorNames];

function parseProjectMarkerAppearance(value: unknown): ProjectMarkerAppearance | null {
  if (typeof value !== "object" || value == null) return null;
  const { color, marker } = value as { color?: unknown; marker?: unknown };
  if (typeof color !== "string" || !projectColors.includes(color) || typeof marker !== "object" || marker == null) return null;
  const { kind, icon, emoji } = marker as { kind?: unknown; icon?: unknown; emoji?: unknown };
  if (kind === "emoji") return typeof emoji === "string" && emoji.length > 0 ? { color: color as ProjectColor, marker: { kind, emoji } } : null;
  if (kind !== "icon") return null;
  const normalized = normalizeProjectIcon(icon);
  return normalized == null ? null : { color: color as ProjectColor, marker: { kind, icon: normalized } };
}

/** `YQt` (`sDt`): stored markers by project id; one invalid entry discards them all. */
export function parseProjectMarkerAppearances(value: unknown): Record<string, ProjectMarkerAppearance> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  const appearances: Record<string, ProjectMarkerAppearance> = {};
  for (const [projectId, entry] of Object.entries(value)) {
    const appearance = parseProjectMarkerAppearance(entry);
    if (appearance == null) return {};
    appearances[projectId] = appearance;
  }
  return appearances;
}

export interface ProjectMarkerProps {
  appearance: ProjectMarkerAppearance;
  className?: string;
  /** Shown instead of the catalog folder icon. */
  fallbackIcon?: ReactNode;
  iconClassName?: string;
  iconSize?: ProjectIconSize;
}

/** `TXt` (app-initial, `Xxr`): a local project's emoji or icon in its color. Remote project masking is not ported. */
export function ProjectMarker({ appearance, className, fallbackIcon, iconClassName, iconSize }: ProjectMarkerProps) {
  const { marker } = appearance;
  const content =
    marker.kind === "emoji" ? (
      <span className="leading-none">{marker.emoji}</span>
    ) : marker.icon === "folder" && fallbackIcon != null ? (
      fallbackIcon
    ) : (
      <ProjectIcon className={iconClassName ?? (iconSize == null ? "icon-xs" : undefined)} icon={marker.icon} size={iconSize} />
    );
  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center text-sm font-medium",
        projectColorClasses[appearance.color].accentClassName,
        className,
      )}
    >
      {content}
    </span>
  );
}
