/** The unread dot of `RJ` (`XComponent` with `{ type: "idle", unread: true }`, i.e. `Apo1Component`). */
export function UnreadIndicator() {
  return (
    <div className="relative flex size-5 shrink-0 items-center justify-center text-codex-description">
      <span className="icon-xs relative scale-50">
        <span className="absolute inset-0 rounded-full bg-info-solid" />
      </span>
    </div>
  );
}
