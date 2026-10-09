import clsx from "clsx";
import { type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode, Suspense, useId, useRef, useState } from "react";
import { FormattedMessage, defineMessages, useIntl } from "../../lib/intl";
import { goToSparkDot } from "../../../spark-store";
import { prefillSparkDotComposer } from "../../dots-store";
import { Icon } from "../../codex-icons/icon";
import { arrowRotateCounterclockwiseLight16 } from "../../codex-icons/arrow-rotate-counterclockwise-light-16";
import { PencilLight16Icon } from "../../codex-icons/pencil-light-16";
import { Button } from "../../codex-ui/button";
import { Dialog, DialogTitle } from "../../codex-ui/dialog";
import { DialogBody, DialogHeader, DialogSection, FieldStack } from "../../codex-ui/dialog-layout";
import { Input, Textarea } from "../../codex-ui/input";
import { DotAvatar } from "../avatar/dot-avatar";
import { AVATAR_COLORS, type DotAppearance, LEGACY_AVATAR_IDS, asLegacyAvatarId, randomLegacyAppearance } from "../avatar/legacy-avatars";
import type { CharacterEditorHandle } from "../editor/character-editor";
import { EditorPlaceholder } from "../editor/editor-placeholder";
import { LazyCharacterEditor, prefetchCharacterEditor } from "../editor/lazy-character-editor";
import { PetArtwork } from "../editor/pet-chooser";
import { type DotAvatarIdentity, useIsLegacyIdentity } from "../orbit/conversation-character";
import { type CodexPet, findPet } from "../pets/codex-pets";
import { useIdentityPet } from "../pets/pet-avatar";
import { AppearanceOptionGroup } from "./appearance-option-group";
import { DOT_NAME_MAX_LENGTH, dotNameMessages, isDefaultDotName, isDotNameRejected } from "./dot-names";

export type AppearancePickerVariant = "toolbar" | "profile" | "hero" | "compact" | "name" | "compact-name";

export type AppearancePickerSave = (appearance: DotAppearance | null, name: string, pet?: CodexPet) => boolean | Promise<boolean>;

export interface AppearancePickerDialogProps {
  appearance: DotAppearance | null;
  name: string | null;
  identity?: DotAvatarIdentity;
  petId?: string | null;
  /** Durable orbit bots edit their character in the full editor. */
  characterConversationId?: string;
  onSave: AppearancePickerSave;
  variant?: AppearancePickerVariant;
  disabled?: boolean;
  readOnlyName?: boolean;
  /** Renders the dialog open, with the trigger hidden, and calls back when it closes. */
  onClose?: () => void;
  defaultOpen?: boolean;
  triggerContent?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}

interface AppearanceDraft {
  appearance: DotAppearance | null;
  name: string;
  pet?: CodexPet | null;
}

const avatarLabels = defineMessages({
  sunglasses: {
    id: "restricted.aeonAppearancePicker.avatar.sunglasses",
    defaultMessage: "Use the sunglasses avatar",
    description: "Accessible label for selecting the bot avatar with sunglasses",
  },
  "bow-tie": {
    id: "restricted.aeonAppearancePicker.avatar.bow-tie",
    defaultMessage: "Use the bow tie avatar",
    description: "Accessible label for selecting the bot avatar with a bow tie",
  },
  "balancing-ball": {
    id: "restricted.aeonAppearancePicker.avatar.balancing-ball",
    defaultMessage: "Use the blossom avatar",
    description: "Accessible label for selecting the blossom-shaped bot avatar",
  },
  cowboy: {
    id: "restricted.aeonAppearancePicker.avatar.cowboy",
    defaultMessage: "Use the cowboy hat avatar",
    description: "Accessible label for selecting the bot avatar with a cowboy hat",
  },
  beanie: {
    id: "restricted.aeonAppearancePicker.avatar.beanie",
    defaultMessage: "Use the beanie avatar",
    description: "Accessible label for selecting the bot avatar with a beanie",
  },
  mustache: {
    id: "restricted.aeonAppearancePicker.avatar.mustache",
    defaultMessage: "Use the red avatar",
    description: "Accessible label for selecting the red circular bot avatar",
  },
  pirate: {
    id: "restricted.aeonAppearancePicker.avatar.pirate",
    defaultMessage: "Use the pirate avatar",
    description: "Accessible label for selecting the bot avatar with an eye patch",
  },
  feather: {
    id: "restricted.aeonAppearancePicker.avatar.feather",
    defaultMessage: "Use the feather avatar",
    description: "Accessible label for selecting the bot avatar with a feather",
  },
  monocle: {
    id: "restricted.aeonAppearancePicker.avatar.monocle",
    defaultMessage: "Use the monocle avatar",
    description: "Accessible label for selecting the bot avatar with a monocle",
  },
  "party-hat": {
    id: "restricted.aeonAppearancePicker.avatar.party-hat",
    defaultMessage: "Use the triangle avatar",
    description: "Accessible label for selecting the triangular bot avatar",
  },
  bowler: {
    id: "restricted.aeonAppearancePicker.avatar.bowler",
    defaultMessage: "Use the bowler hat avatar",
    description: "Accessible label for selecting the bot avatar with a bowler hat",
  },
  headphones: {
    id: "restricted.aeonAppearancePicker.avatar.headphones",
    defaultMessage: "Use the blob avatar",
    description: "Accessible label for selecting the blob-shaped bot avatar",
  },
});

const stopPropagation = (event: { stopPropagation: () => void }) => event.stopPropagation();

function preventComposingSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
}

/** Dialog for a bot's nickname and appearance, opened from an avatar or name trigger (`GComponent`). */
export function AppearancePickerDialog({
  appearance,
  name,
  identity = "orbit-draft",
  petId,
  characterConversationId,
  onSave,
  variant = "toolbar",
  disabled = false,
  readOnlyName = false,
  onClose,
  defaultOpen = false,
  triggerContent,
  onCloseAutoFocus,
}: AppearancePickerDialogProps) {
  const intl = useIntl();
  const nameInputId = useId();
  const nameErrorId = useId();
  const displayName = name != null && !isDefaultDotName(name) ? name : "bot";
  const [draft, setDraft] = useState<AppearanceDraft | null>(() => (defaultOpen || onClose != null ? { appearance, name: displayName } : null));
  const draftName = draft?.name ?? displayName;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<"name" | "save" | null>(null);
  const [nameInvalid, setNameInvalid] = useState(false);
  const editorRef = useRef<CharacterEditorHandle>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [editorReady, setEditorReady] = useState(false);
  const isLegacy = useIsLegacyIdentity(identity);
  const showsEditor = characterConversationId != null && !isLegacy;

  const conversationPet = useIdentityPet(characterConversationId ?? identity);
  const draftWearsPet = draft?.appearance?.avatar === "pet";
  const wearsPet = appearance?.avatar === "pet";
  const petById = wearsPet || draftWearsPet ? findPet(petId) : null;
  const savedPet = petId == null ? (draftWearsPet ? conversationPet : null) : petById;
  const draftPetChoice = draft?.pet === undefined ? savedPet : draft.pet;
  const triggerPet = wearsPet ? petById : null;
  const triggerAvatar = wearsPet && petId != null ? null : (appearance?.avatar ?? null);
  const draftPet = draftWearsPet ? draftPetChoice : null;
  const draftAvatar = draftWearsPet && petId != null ? null : (draft?.appearance?.avatar ?? null);
  const keepsSavedPet = draft?.pet === undefined && draftWearsPet && wearsPet;
  const canSave = !showsEditor || keepsSavedPet || (draftWearsPet ? draftPetChoice != null : editorReady);
  const isAvatarVariant = variant === "profile" || variant === "hero";
  const isNameVariant = variant === "name" || variant === "compact-name";

  if (disabled && draft != null) setDraft(null);

  const runSave = (save: () => boolean | Promise<boolean>) => {
    setSaving(true);
    setSaveError(null);
    Promise.resolve()
      .then(save)
      .then(
        (saved) => {
          if (saved) {
            setDraft(null);
            onClose?.();
          } else {
            setSaveError("save");
          }
        },
        (error: unknown) => setSaveError(isDotNameRejected(error) ? "name" : "save"),
      )
      .finally(() => setSaving(false));
  };

  const createPet = () => {
    if (characterConversationId == null || saving || disabled || readOnlyName) return;
    setDraft(null);
    onClose?.();
    const prefillPrompt = intl.formatMessage({
      id: "restricted.aeonAppearancePicker.createPetPrompt",
      defaultMessage: "Make a pet avatar for yourself based on something you know about me",
      description:
        "Draft message placed in the bot assistant's composer when the user chooses to create a pet avatar in its appearance editor. The user can edit it before sending.",
    });
    prefillSparkDotComposer(characterConversationId, prefillPrompt);
    goToSparkDot(characterConversationId);
  };

  const changeName = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (draft == null) return;
    setDraft({ ...draft, name: event.target.value.replace(/[\r\n]/g, "") });
    setNameInvalid(false);
  };
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (showsEditor && event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  const showNameError = (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    event.preventDefault();
    setNameInvalid(true);
    event.currentTarget.focus();
  };
  const nameInputProps = {
    id: nameInputId,
    name: "nickname",
    "aria-describedby": nameInvalid ? nameErrorId : undefined,
    "aria-invalid": nameInvalid,
    autoFocus: true,
    value: draftName,
    placeholder: intl.formatMessage({
      id: "restricted.aeonAppearancePicker.namePlaceholder",
      defaultMessage: "Your bot",
      description:
        "Placeholder in the empty nickname field in the bot's appearance editor and character studio. A bot is the user's customizable assistant character. Keep the singular term bot untranslated.",
    }),
    maxLength: DOT_NAME_MAX_LENGTH,
    readOnly: readOnlyName,
    disabled: saving,
    onChange: changeName,
    onKeyDown: submitOnEnter,
    onInvalid: showNameError,
  };
  const nameField =
    draft == null ? null : (
      <FieldStack>
        <label className={showsEditor ? "sr-only" : "text-sm font-medium select-none"} htmlFor={nameInputId}>
          <FormattedMessage id="restricted.aeonAppearancePicker.name" defaultMessage="Nickname" description="Label for the assistant's private nickname in the appearance dialog" />
        </label>
        {showsEditor ? <Textarea {...nameInputProps} variant="display" rows={1} /> : <Input {...nameInputProps} variant="default" />}
        <p id={nameErrorId} className={clsx("text-sm text-danger select-none", !nameInvalid && (showsEditor ? "hidden" : "invisible"))} role="alert">
          <FormattedMessage
            id="restricted.aeonAppearancePicker.nameFormatError"
            defaultMessage="Use up to 24 characters without backslashes"
            description="Inline error for an invalid assistant nickname. Names can use up to 24 characters but cannot include a backslash."
          />
        </p>
      </FieldStack>
    );

  const footer =
    draft == null ? null : (
      <>
        {saveError ? (
          <p role="alert" className="text-sm text-danger">
            {saveError === "name" ? (
              <FormattedMessage {...dotNameMessages.rejected} />
            ) : (
              <FormattedMessage
                id="restricted.aeonAppearancePicker.saveFailed"
                defaultMessage="Couldn’t save your changes. Try again."
                description="Failure message in the appearance dialog when saving the assistant name and avatar fails. The draft is kept for retry."
              />
            )}
          </p>
        ) : null}
        <Button
          className="justify-center"
          type="submit"
          color="primary"
          size="dialog"
          loading={saving}
          disabledAppearance={showsEditor ? "unchanged" : "dimmed"}
          disabled={saving || draftName.trim().length === 0 || !canSave}
        >
          <FormattedMessage id="restricted.aeonAppearancePicker.save" defaultMessage="Save" description="Confirm the assistant name and appearance changes" />
        </Button>
        {!showsEditor && (
          <Button
            className="justify-center"
            type="button"
            color="secondary"
            size="dialog"
            disabled={saving}
            onClick={() => setDraft({ ...draft, appearance: randomLegacyAppearance(draft.appearance) })}
          >
            <Icon asset={arrowRotateCounterclockwiseLight16} />
            <FormattedMessage
              id="restricted.aeonAppearancePicker.randomize"
              defaultMessage="Randomize"
              description="Preview a random assistant appearance without changing its name or saving it"
            />
          </Button>
        )}
      </>
    );

  const onOpenChange = (nextOpen: boolean) => {
    if (saving) return;
    if (nextOpen && showsEditor) prefetchCharacterEditor();
    setDraft(nextOpen && !disabled ? { appearance, name: displayName } : null);
    setSaveError(null);
    setNameInvalid(false);
    setEditorReady(false);
    if (!nextOpen) onClose?.();
  };

  const prefetchEditor = () => {
    if (showsEditor) prefetchCharacterEditor();
  };
  const trigger = triggerContent ?? (
    <Button
      ref={triggerRef}
      aria-label={
        isNameVariant
          ? undefined
          : intl.formatMessage(
              {
                id: "restricted.aeonAppearancePicker.trigger.productName.dot",
                defaultMessage: "Change your {productName}’s appearance",
                description:
                  "Accessible label for changing an assistant's appearance; productName is the untranslated term for the user's agent, not the assistant's custom name",
              },
              { productName: "bot" },
            )
      }
      className={clsx(onClose != null && "hidden", isAvatarVariant && "group/avatar relative touch-none", variant === "profile" && "-ms-1", isNameVariant && "max-w-full [text-align:inherit]")}
      color={isAvatarVariant ? "ghostTertiary" : "ghostActive"}
      radius={isNameVariant ? "small" : "default"}
      size={variant === "toolbar" ? "icon" : "inline"}
      disabled={disabled}
      onPointerEnter={prefetchEditor}
      onFocus={prefetchEditor}
      onClick={stopPropagation}
    >
      {isNameVariant ? (
        <span className={clsx("px-2.5 py-0.5", variant === "compact-name" ? "truncate" : "line-clamp-3 break-words whitespace-normal")}>{displayName}</span>
      ) : (
        <span
          className={clsx(
            "relative flex items-center justify-center",
            variant === "hero" && "size-16",
            variant === "compact" && "size-5",
            variant === "profile" && "size-12",
            variant === "toolbar" && "size-full",
          )}
        >
          {triggerPet == null ? (
            <DotAvatar className="size-full" avatar={triggerAvatar} identity={identity} active={draft == null} interactionTarget={triggerRef} />
          ) : (
            <PetArtwork pet={triggerPet} />
          )}
          {isAvatarVariant ? (
            <span
              className={clsx(
                "pointer-events-none absolute flex items-center justify-center rounded-full border border-default bg-surface shadow-sm",
                variant === "hero"
                  ? "right-0 bottom-0 size-7 text-default"
                  : "-top-1 -right-1 size-5 text-codex-description opacity-0 group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100 group-data-[state=open]/avatar:opacity-100",
              )}
            >
              <PencilLight16Icon />
            </span>
          ) : null}
        </span>
      )}
    </Button>
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft == null) return;
    if (draftName !== name && (draftName.length > DOT_NAME_MAX_LENGTH || draftName.includes("\\"))) {
      setNameInvalid(true);
      const field = event.currentTarget.elements.namedItem("nickname");
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    if (saving || disabled || draftName.trim().length === 0 || !canSave) return;
    const nextName = draftName.trim();
    runSave(async () => {
      if (keepsSavedPet) return onSave(draft.appearance, nextName);
      if (showsEditor) {
        if (draft.appearance?.avatar === "pet" && draftPetChoice != null) {
          if (await onSave(draft.appearance, nextName, draftPetChoice)) {
            editorRef.current?.saveCustom();
            return true;
          }
          return false;
        }
        if (editorRef.current) {
          await editorRef.current.save(readOnlyName || nextName === name ? undefined : nextName);
          return true;
        }
        return false;
      }
      if (draft.appearance?.avatar === "pet" && draftPetChoice != null) return onSave(draft.appearance, nextName, draftPetChoice);
      return onSave(draft.appearance, nextName);
    });
  };

  const body =
    draft == null ? null : (
      <DialogBody
        as="form"
        size={showsEditor ? undefined : "viewport"}
        variant={showsEditor ? "chatgpt" : "default"}
        onKeyDown={preventComposingSubmit}
        onSubmit={submit}
      >
        <DialogHeader
          className={showsEditor ? "sr-only" : "select-none"}
          title={
            <DialogTitle>
              <FormattedMessage
                id="restricted.aeonAppearancePicker.header.productName.dot"
                defaultMessage="Customize your {productName}"
                description="Heading in the assistant appearance picker; productName is the untranslated term for the user's agent, not the assistant's custom name"
                values={{ productName: <strong key="productName">bot</strong> }}
              />
            </DialogTitle>
          }
        />
        {showsEditor && characterConversationId != null ? (
          <Suspense fallback={<EditorPlaceholder title={nameField} footer={footer} onCreatePet={readOnlyName ? undefined : createPet} />}>
            <LazyCharacterEditor
              ref={editorRef}
              conversationId={characterConversationId}
              onReady={setEditorReady}
              onCreatePet={readOnlyName ? undefined : createPet}
              disabled={saving}
              pet={draftPetChoice}
              onSelectPet={(pet) => setDraft({ ...draft, pet, appearance: pet == null ? null : { avatar: "pet", color: AVATAR_COLORS.pet } })}
              title={nameField}
              footer={footer}
            />
          </Suspense>
        ) : (
          <DialogSection spacing="large">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="sm:col-start-2 sm:row-start-1">{nameField}</div>
              <div className="flex items-center justify-center sm:col-start-2 sm:row-start-2">
                {draftPet == null ? (
                  <DotAvatar className="size-32 sm:size-48" avatar={draftAvatar} identity={identity} useSavedAvatar={false} />
                ) : (
                  <div className="size-32 sm:size-48">
                    <PetArtwork pet={draftPet} />
                  </div>
                )}
              </div>
              <AppearanceOptionGroup
                className="sm:col-start-1 sm:row-span-3 sm:row-start-1"
                aria-label={intl.formatMessage(
                  {
                    id: "restricted.aeonAppearancePicker.avatarGroup.productName.dot",
                    defaultMessage: "Your {productName}’s avatar",
                    description:
                      "Accessible label for the assistant avatar picker group; productName is the untranslated term for the user's agent, not the assistant's custom name",
                  },
                  { productName: "bot" },
                )}
                variant="artwork"
                disabled={saving}
                options={LEGACY_AVATAR_IDS.map((avatar, index) => ({
                  id: avatar,
                  icon: <DotAvatar className="size-full" avatar={avatar} identity={identity} useSavedAvatar={false} />,
                  label: isLegacy
                    ? intl.formatMessage(
                        {
                          id: "restricted.aeonAppearancePicker.legacyAvatar",
                          defaultMessage: "Use avatar {number}",
                          description: "Accessible label for choosing a numbered abstract avatar for a legacy agent",
                        },
                        { number: index + 1 },
                      )
                    : intl.formatMessage(avatarLabels[avatar]),
                }))}
                selectedId={draft.appearance?.avatar ?? null}
                onChange={(id) => {
                  const avatar = asLegacyAvatarId(id);
                  if (avatar != null) setDraft({ ...draft, appearance: { color: AVATAR_COLORS[avatar], avatar } });
                }}
              />
              <div className="flex flex-col justify-end gap-3 sm:col-start-2 sm:row-start-3">{footer}</div>
            </div>
          </DialogSection>
        )}
      </DialogBody>
    );

  return (
    <Dialog
      open={draft != null && !disabled}
      onOpenChange={onOpenChange}
      size="xxwide"
      contentPosition={showsEditor ? "scrollable" : "centered"}
      variant={showsEditor ? "mediaDetail" : "default"}
      showDialogClose={!saving}
      shouldIgnoreClickOutside={saving}
      contentProps={{
        "aria-describedby": undefined,
        onCloseAutoFocus,
        onClick: stopPropagation,
        onEscapeKeyDown: (event) => {
          if (saving) event.preventDefault();
        },
      }}
      triggerContent={trigger}
    >
      {body}
    </Dialog>
  );
}
