import { Skeleton } from "../../codex/ui";
import type { PageBlock } from "./state/page-document";

type VisualizationBlock = Extract<PageBlock, { type: "page_visualization" }>;
type ImageBlock = Extract<PageBlock, { type: "page_image" }>;

/**
 * `page_visualization` host (`div[data-page-visualization-file-id]` with its `[data-page-visualization-block]`
 * node view). The sandboxed visualization iframe is not cloned; generation shows a skeleton.
 */
export function VisualizationView({ block }: { block: VisualizationBlock }) {
  return (
    <div contentEditable={false} data-page-visualization-file-id={block.fileId} data-page-visualization-title={block.title}>
      <div data-page-visualization-block="" aria-busy={block.status === "generating" || undefined} className="flex flex-col gap-2">
        {block.status === "generating" ? <Skeleton className="h-40 w-full" /> : null}
        <span className="truncate text-sm text-secondary">{block.title}</span>
      </div>
    </div>
  );
}

/** `page_image` inline atom (`span[data-page-image-src]`) with its `[data-page-image-view]` node view. */
export function ImageView({ block }: { block: ImageBlock }) {
  return (
    <p>
      <span contentEditable={false} data-page-image-src={block.src} data-page-image-alt={block.alt} title={block.alt}>
        <span data-page-image-view="">
          <img alt={block.alt} draggable={false} src={block.src} />
        </span>
      </span>
    </p>
  );
}

/** Emoji shown in a callout's `[data-page-callout-icon]` slot. The emoji picker is not cloned. */
export function CalloutIcon({ emoji }: { emoji: string }) {
  return <span aria-hidden>{emoji}</span>;
}
