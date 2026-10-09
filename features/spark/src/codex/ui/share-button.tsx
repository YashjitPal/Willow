import { FormattedMessage } from "react-intl";
import { ArrowUpOpenBaseLight16Icon, ArrowUpOpenBaseLight20Icon } from "../icons";
import { Button, type ButtonProps } from "./button";
import { FloatingControlButton, floatingControlCss, type FloatingControlButtonProps } from "./floating-control";
import { SizedIcon } from "./sized-icon";

function ShareButtonContent({ children }: { children?: ButtonProps["children"] }) {
  return (
    <>
      <SizedIcon className={floatingControlCss.shareIcon} icon={{ 16: ArrowUpOpenBaseLight16Icon, 20: ArrowUpOpenBaseLight20Icon }} />
      <span data-page-share-label data-viewer-header-collapsible className="overflow-hidden whitespace-nowrap">
        <FormattedMessage id="artifactViewer.share" defaultMessage="Share" description="Button for sharing an artifact from its viewer" />
      </span>
      {children}
    </>
  );
}

/** Viewer header share control (`share-button` chunk `n`). */
export function ShareButton({ children, ...rest }: FloatingControlButtonProps) {
  return (
    <FloatingControlButton {...rest} className={rest.className == null ? "ws-share-button" : `ws-share-button ${rest.className}`}>
      <ShareButtonContent>{children}</ShareButtonContent>
    </FloatingControlButton>
  );
}

/** Toolbar variant of the share control (`share-button` chunk `t`). */
export function ToolbarShareButton({ children, ...rest }: ButtonProps) {
  return (
    <Button {...rest} className={rest.className == null ? "ws-share-button" : `ws-share-button ${rest.className}`} color="ghostActive" radius="full" size="toolbar">
      <ShareButtonContent>{children}</ShareButtonContent>
    </Button>
  );
}
