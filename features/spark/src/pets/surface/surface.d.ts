/** What the pet talks to: the desktop overlay's `Overlay`, or a page's stand-in for it. */
export interface PetSurfaceHost {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  /** Desktop only: whether the window takes the pointer. */
  setInteractive(interactive: boolean): void;
  /** Desktop only: whether the window may take keyboard focus. */
  setFocusable?(focusable: boolean): void;
  /** Desktop only: raise the app the pet belongs to. */
  focusOwner?(): void;
}

/** The pet, its indicator and its activity stack, drawn into the current document. */
export function petSurface(host: PetSurfaceHost, data: unknown): void;
