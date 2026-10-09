import type { FormEvent, ReactNode } from "react";
import { FormattedMessage } from "../lib/intl";
import { Button } from "../codex-ui/button";
import { Dialog, DialogDescription, DialogTitle } from "../codex-ui/dialog";
import { DialogBody, DialogFooter, DialogHeader, DialogSection } from "../codex-ui/dialog-layout";
import { ExternalLink } from "../codex-ui/external-link";

interface DataUseNoticeDialogProps {
  onAcknowledge: () => void;
  onDismiss: () => void;
}

/** `t` of `data-use-notice-dialog`: the dogfood notice shown to `@openai.com` accounts before creating a bot. */
export function DataUseNoticeDialog({ onAcknowledge, onDismiss }: DataUseNoticeDialogProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAcknowledge();
  };
  return (
    <Dialog
      open
      shouldIgnoreClickOutside
      size="compact"
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogBody as="form" onSubmit={submit}>
        <DialogSection>
          <DialogHeader
            title={
              <DialogTitle>
                <FormattedMessage
                  id="restricted.orbitDataUseNotice.title.dotPlaceholder"
                  defaultMessage="Internal {dot} Dogfood Data Use"
                  description="Title of the employee notice shown before starting each new internal bot session. {dot} is the untranslated term for the user's agent."
                  values={{ dot: "bot" }}
                />
              </DialogTitle>
            }
            subtitle={
              <DialogDescription>
                <FormattedMessage
                  id="restricted.orbitDataUseNotice.descriptionWithOptOut.dotPlaceholder"
                  defaultMessage="By default, your internal {dot} sessions, including data accessed through your {dot}’s proactive agent’s activities (e.g. scanning Slack), will be used for internal evals and training purposes. We will not use your {dot} sessions to train public-facing models. Your data will be accessible only by a limited set of employees. If you plan to use your {dot} to query raw user data from production traffic, or access tented or sensitive personal information, or would otherwise like to opt out, please opt out <link>here</link>."
                  description="Employee notice explaining how internal bot sessions, including data accessed by an agent acting proactively without a user prompt, are used for evaluation and training, who can access the data, and when and how to opt out. The link opens the opt-out form. {dot} is the untranslated term for the user's agent."
                  values={{ dot: "bot", link: optOutLink }}
                />
              </DialogDescription>
            }
          />
        </DialogSection>
        <DialogSection>
          <DialogFooter>
            <Button color="secondary" type="button" onClick={onDismiss}>
              <FormattedMessage
                id="restricted.orbitDataUseNotice.dismiss"
                defaultMessage="Not now"
                description="Dismisses the internal bot data-use notice and returns to a new chat without creating a bot"
              />
            </Button>
            <Button type="submit">
              <FormattedMessage
                id="restricted.orbitDataUseNotice.acknowledge"
                defaultMessage="Got it"
                description="Acknowledges the data-use notice and continues creating this bot session"
              />
            </Button>
          </DialogFooter>
        </DialogSection>
      </DialogBody>
    </Dialog>
  );
}

function optOutLink(chunks: ReactNode[]) {
  return (
    <ExternalLink key="link" href="https://docs.google.com/forms/d/e/1FAIpQLSfNaFdCdgIkKfUKhMlFZcF3nXchJmFlVWqvunyM3GNd108Vng/viewform?usp=header" underline="always">
      {chunks}
    </ExternalLink>
  );
}
