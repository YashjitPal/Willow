import clsx from "clsx";
import type { ReactNode } from "react";

export type AvatarSize =
  | "badge"
  | "inline"
  | "xs"
  | "response"
  | "sm"
  | "group"
  | "md"
  | "row"
  | "picker"
  | "lg"
  | "profile"
  | "xl"
  | "preview"
  | "fill";

const sizeClasses: Record<AvatarSize, string> = {
  badge: "size-3",
  inline: "size-4",
  xs: "icon-sm",
  response: "size-5",
  sm: "size-6",
  group: "size-7",
  md: "size-8",
  row: "size-10",
  picker: "size-12",
  lg: "size-20",
  profile: "size-28",
  xl: "size-32",
  preview: "size-48",
  fill: "size-full",
};

const textClasses: Record<AvatarSize, string> = {
  badge: "text-[6px] leading-none",
  inline: "text-[6px] leading-none",
  xs: "text-[10px] leading-none",
  response: "text-[10px] leading-none",
  sm: "text-xs",
  group: "text-xs",
  md: "text-sm",
  row: "text-sm",
  picker: "text-lg",
  lg: "text-[28px]",
  profile: "text-[40px]",
  xl: "text-[40px]",
  preview: "text-5xl",
  fill: "text-5xl",
};

const avatarColors = ["blue", "purple", "green", "yellow", "red"] as const;

const colorClasses: Record<(typeof avatarColors)[number], string> = {
  blue: "bg-avatar-blue",
  purple: "bg-avatar-purple",
  green: "bg-avatar-green",
  yellow: "bg-avatar-yellow",
  red: "bg-avatar-red",
};

/** `bX` (`mao`): stable avatar color for a key; text after `__` is ignored. */
export function avatarColor(key: string, offset = 0) {
  let hash = 0;
  for (const character of key.split("__")[0]) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % avatarColors.length;
  return avatarColors[(hash + offset) % avatarColors.length];
}

/** `Zvt` (`YGi`): first and last initials of a name, or `?`. */
export function nameInitials(name: string | null | undefined) {
  const words = name?.trim() ? name.trim().split(/\s+/) : [];
  const initials = `${words[0]?.charAt(0) ?? ""}${words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : ""}`.toUpperCase();
  return initials.length > 0 ? initials : "?";
}

export interface AvatarProps {
  alt?: string;
  colorKey?: string;
  fallback?: ReactNode;
  name: string | null | undefined;
  size?: AvatarSize;
}

/**
 * Initials avatar (`vX` / `S10` in app-initial, the `src == null` branch `Xao`). Not yet: the image branch, the
 * non-circle shapes and overlays.
 */
export function Avatar({ alt, colorKey, fallback, name, size = "sm" }: AvatarProps) {
  if (fallback != null) return fallback;
  const initials = nameInitials(name);
  const text = size === "badge" || size === "inline" || size === "xs" ? Array.from(initials)[0] : initials;
  const key = colorKey || name?.trim();
  return (
    <span
      aria-hidden={!alt || undefined}
      aria-label={alt || undefined}
      className={clsx(
        "ws-avatar flex shrink-0 items-center justify-center font-normal text-avatar-foreground select-none",
        "rounded-full",
        key ? colorClasses[avatarColor(key)] : "bg-avatar-gray",
        sizeClasses[size],
        textClasses[size],
      )}
      role={alt ? "img" : undefined}
    >
      {size === "badge" || size === "inline" ? (
        <svg aria-hidden className="size-full" viewBox="0 0 12 12">
          <text x="6" y="6" dominantBaseline="central" textAnchor="middle" fill="currentColor">
            {text}
          </text>
        </svg>
      ) : (
        text
      )}
    </span>
  );
}
