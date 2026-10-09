import { useLayoutEffect, useState } from "react";

interface CommentInkProps {
  /** The `span.page-comment-highlight` widget (positioned) the ink is drawn from. */
  widget: HTMLElement;
  /** The `[data-page-comment-thread]` text the thread is anchored on. */
  anchor: HTMLElement;
  active: boolean;
  agent: boolean;
  hovered: boolean;
  /** Changes whenever the document re-renders, so line boxes are measured again. */
  revision: number;
}

/** `svg.page-comment-highlight-ink`: one filled box per line of the anchored text, behind the text. */
export function CommentInk({ widget, anchor, active, agent, hovered, revision }: CommentInkProps) {
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const origin = widget.getBoundingClientRect();
      const next = Array.from(anchor.getClientRects())
        .filter((rect) => rect.width > 0)
        .map((rect) => `M${rect.left - origin.left} ${rect.top - origin.top}h${rect.width}v${rect.height}h${-rect.width}Z`);
      setPaths((current) => (current.join() === next.join() ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchor, revision, widget]);

  return (
    <svg
      aria-hidden
      className="page-comment-highlight-ink"
      data-active={active ? "" : undefined}
      data-agent={agent ? "" : undefined}
      data-hovered={hovered ? "" : undefined}
    >
      {paths.map((path) => (
        <path key={path} d={path} fill="currentColor" />
      ))}
    </svg>
  );
}
