import { defineMessages } from "../../lib/intl";

export const DOT_NAME_MAX_LENGTH = 24;

/** Names that mean "no nickname" (`Fhn`). */
export function isDefaultDotName(name: string | null | undefined) {
  return name == null || ["", "O", "o", "Orbit", "orbit", "dot", "bot"].includes(name.trim());
}

/** The nickname as the server stores it: no backslashes, trimmed, at most 24 characters (`Ymt`). */
export function normalizeDotName(name: string) {
  return Array.from(name.replace(/\\/g, "").trim()).slice(0, DOT_NAME_MAX_LENGTH).join("").trimEnd();
}

/** The 400 `orbit_name_not_allowed` answer to a nickname that fails moderation. */
export class DotNameRejectedError extends Error {
  readonly status = 400;
  readonly errorCode = "orbit_name_not_allowed";

  constructor() {
    super("Name not allowed");
  }
}

/** `Jmt` */
export function isDotNameRejected(error: unknown) {
  return error instanceof DotNameRejectedError;
}

/** `Kmt` */
export const dotNameMessages = defineMessages({
  rejected: {
    id: "restricted.aeon.renameDialog.nameRejected",
    defaultMessage: "This name is not allowed. Choose a different name.",
    description:
      "Error in the bot appearance editor, rename dialog, or rename toast when the assistant's chosen nickname fails content moderation. Ask the user to choose another name instead of retrying the rejected name.",
  },
});
