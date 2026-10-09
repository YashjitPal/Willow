import type { ComponentProps, ReactNode } from "react";

// Codex's launcher rows (NewTabPage): soft-filled 8px corners 4px apart, 13px titles over 12px
// tertiary detail, a firmer fill under the pointer.
export function DiscoveryList({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

export function DiscoveryListRow({
  icon,
  title,
  description,
  action,
  ...props
}: Omit<ComponentProps<"button">, "title" | "children" | "className"> & {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg bg-[color-mix(in_oklab,var(--codex-ink)_2.5%,transparent)] px-2.5 py-2 text-left transition-colors hover:bg-(--codex-secondary-soft) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--codex-border-heavy) disabled:pointer-events-none disabled:opacity-64"
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] leading-[18px] text-(--codex-ink)">{title}</span>
        <span className="truncate text-xs leading-4 text-(--codex-ink-tertiary)">
          {description}
        </span>
      </div>
      {action}
    </button>
  );
}
