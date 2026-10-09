import { useRef, useState } from "react";
import { AppearancePicker } from "../character/appearance-picker/appearance-picker";
import { circlePersonLight20 } from "../codex-icons/circle-person-light-20";
import { Icon } from "../codex-icons/icon";
import { FormattedMessage } from "../lib/intl";
import { ConnectionBubble } from "./connection-bubble";

/** `UeComponent` of `messaging-setup-suggestion`: the bot's "Customize your bot" setup suggestion. */
export function CustomizationSuggestion({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <ConnectionBubble
        icon={<Icon asset={circlePersonLight20} />}
        busy={false}
        connected={false}
        disabled={open}
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          setOpen(true);
        }}
      >
        <FormattedMessage
          id="orbit.setup.customize.productName.dot"
          defaultMessage="Customize your {productName}"
          description="Opens the bot's name and avatar customization dialog from a setup suggestion in the conversation. {productName} is the untranslated term for the user's agent."
          values={{ productName: "bot" }}
        />
      </ConnectionBubble>
      {open ? (
        <AppearancePicker
          conversationId={conversationId}
          onClose={() => setOpen(false)}
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault();
            triggerRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </>
  );
}
