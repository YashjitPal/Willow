/** Shows startup failures before React can replace the boot splash. */
export function showBootError(error: unknown) {
  console.error("Willow failed to start.", error);
  // Willow's agent tab keeps the page hidden until it says it is up, so it says this too.
  const parent = typeof window === "undefined" ? undefined : window.parent;
  if (parent && parent !== window) {
    parent.postMessage(
      {
        source: "willow-agents",
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
      "*",
    );
  }
  const bootShell = document.getElementById("boot-shell");
  if (!bootShell) return;

  const content = document.createElement("div");
  content.id = "boot-error";
  content.setAttribute("role", "alert");

  const message = document.createElement("p");
  message.textContent = "Willow could not load.";
  content.append(message);

  if (import.meta.env.DEV && error instanceof Error) {
    const detail = document.createElement("p");
    detail.textContent = error.message;
    content.append(detail);
  }

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  content.append(reload);
  bootShell.replaceChildren(content);
}
