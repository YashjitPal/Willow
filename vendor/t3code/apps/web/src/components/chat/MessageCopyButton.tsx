import { memo } from "react";
import { Button } from "../ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { willowSymbol } from "~/willow/icons";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Willow's copy glyph, under a prompt and a response alike (features/chat ChatView, ChatResponseChrome). */
const CopyGlyph = willowSymbol("copy", "luminous");

/** How long Willow's snackbar stays once it is in (platform/ui CopyToast). */
const COPIED_TOAST_TIMEOUT_MS = 2000;

/** Willow shows one snackbar at a time, so a new copy replaces the last one's. */
let copiedToastId: string | null = null;

const showCopiedToast = (title: string) => {
  if (copiedToastId) toastManager.close(copiedToastId);
  copiedToastId = toastManager.add({ title, timeout: COPIED_TOAST_TIMEOUT_MS });
};

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  extraFlavors,
  copiedLabel = "Copied to clipboard",
  size = "xs",
  variant = "outline",
  className,
}: {
  text: string;
  /** Additional clipboard types written beside `text/plain` when the platform allows it. */
  extraFlavors?: Readonly<Record<string, string>>;
  /** What Willow's snackbar says once copied: "Prompt copied" for the user's own message. */
  copiedLabel?: string;
  size?: "xs" | "icon-xs";
  variant?: "outline" | "ghost";
  className?: string;
}) {
  // Willow confirms a copy with its snackbar alone; the button keeps its glyph.
  const { copyToClipboard } = useCopyToClipboard<void>({
    onCopy: () => showCopiedToast(copiedLabel),
    onError: (error: Error) =>
      toastManager.add({ type: "error", title: "Failed to copy", description: error.message }),
    ...(extraFlavors ? { extraFlavors } : {}),
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Copy message"
            onClick={() => copyToClipboard(text)}
            type="button"
            size={size}
            variant={variant === "ghost" ? "ghost-muted" : variant}
            className={className}
          />
        }
      >
        <CopyGlyph />
      </TooltipTrigger>
      <TooltipPopup>
        <p>Copy message</p>
      </TooltipPopup>
    </Tooltip>
  );
});
