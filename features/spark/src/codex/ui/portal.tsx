import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PortalProps {
  children?: ReactNode;
  container: HTMLElement;
}

/** Portals into a `display: contents` host element appended to `container`. */
export function Portal({ children, container }: PortalProps) {
  const [host] = useState(() => {
    const element = container.ownerDocument.createElement("div");
    element.className = "contents";
    return element;
  });
  useLayoutEffect(() => {
    container.appendChild(host);
    return () => host.remove();
  }, [container, host]);
  return createPortal(children, host);
}
