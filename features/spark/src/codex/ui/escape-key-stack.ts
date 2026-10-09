import { useEffect, useId } from "react";
import { useStableCallback } from "./use-stable-callback";

interface EscapeKeyEntry {
  id: string;
  onEscape: () => void;
}

let entries: EscapeKeyEntry[] = [];
let listening = false;

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const [latest] = entries;
  if (latest != null) {
    event.preventDefault();
    latest.onEscape();
  }
}

function syncListener() {
  if (entries.length > 0 && !listening) {
    document.body.addEventListener("keydown", handleKeyDown);
    listening = true;
  } else if (entries.length === 0 && listening) {
    document.body.removeEventListener("keydown", handleKeyDown);
    listening = false;
  }
}

/** `aan` (`vLe` in app-shared): while `active`, Escape runs `onEscape` of the most recently activated registration. */
export function useEscapeKeyStack(active: boolean, onEscape: () => void) {
  const id = useId();
  const handleEscape = useStableCallback(onEscape);
  useEffect(() => {
    if (!active) return;
    entries.unshift({ id, onEscape: handleEscape });
    syncListener();
    return () => {
      entries = entries.filter((entry) => entry.id !== id);
      syncListener();
    };
  }, [id, active, handleEscape]);
}
