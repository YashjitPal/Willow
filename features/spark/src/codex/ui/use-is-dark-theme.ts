import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function getSnapshot() {
  const theme = document.documentElement.dataset.theme;
  return theme == null ? null : theme === "dark";
}

function getServerSnapshot() {
  return null;
}

/** Whether `<html data-theme>` is `dark`; `null` while no theme is set (`xE` in the bundles). */
export function useIsDarkTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
