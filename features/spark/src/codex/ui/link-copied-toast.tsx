import { FormattedMessage } from "react-intl";
import { toast } from "sonner";

/** `n` in link-copied-toast: confirms a copied share link. */
export function showLinkCopiedToast() {
  toast.success(<FormattedMessage id="sharing.linkCopied" defaultMessage="Link copied!" description="Success toast after copying a share link" />, {
    duration: 3000,
    position: "top-center",
  });
}
