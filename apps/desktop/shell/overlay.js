// The overlay window's half of Willow's desktop overlay (src-tauri/src/pets.rs).
//
// A transparent window over a display's work area, holding nothing until a
// Willow page opens it with a surface: a function's source, its styles and its
// data. The surface is run here with `Overlay`, the only way it can reach the
// outside: pointer input while the cursor is over something it drew, keyboard
// focus while it is being typed into, and one message channel back to the page
// that opened it.
(() => {
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const listeners = new Set();
  let interactive;
  let focusable = false;

  const Overlay = {
    setInteractive(next) {
      const wanted = next === true;
      // The surface asks on every pointer move; only changes cross to the app.
      if (interactive === wanted) return;
      interactive = wanted;
      void invoke('overlay_set_interactive', { interactive: wanted });
    },
    setFocusable(next) {
      const wanted = next === true;
      if (focusable === wanted) return;
      focusable = wanted;
      void invoke('overlay_set_focusable', { focusable: wanted });
    },
    focusOwner() {
      Overlay.setFocusable(false);
      void invoke('overlay_send', { message: { type: 'willow:overlay-focus-owner' } });
    },
    send(message) {
      void invoke('overlay_send', { message });
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };

  // The app delivers messages by calling this.
  window.__willowOverlay = {
    receive(message) {
      for (const listener of [...listeners]) {
        try {
          listener(message);
        } catch {
          // One listener throwing must not stop the others.
        }
      }
    },
  };

  invoke('overlay_surface').then((surface) => {
    if (!surface || typeof surface.script !== 'string' || surface.script.length === 0) return;
    const style = document.createElement('style');
    style.textContent = surface.styles || '';
    document.head.append(style);

    // A script element rather than eval, so the surface runs in the page's own world.
    window.__willowOverlayApi = Overlay;
    const script = document.createElement('script');
    script.textContent = `;(${surface.script})(window.__willowOverlayApi, ${JSON.stringify(surface.data ?? null)});`;
    document.body.append(script);
    script.remove();
    void invoke('overlay_attached');
  });
})();
