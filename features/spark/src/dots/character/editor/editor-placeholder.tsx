import type { ReactNode } from "react";
import { FormattedMessage } from "../../lib/intl";
import { AvatarChooser } from "./avatar-chooser";
import { CharacterEditorLayout } from "./editor-layout";

export interface EditorPlaceholderProps {
  error?: boolean;
  title?: ReactNode;
  footer?: ReactNode;
  onCreatePet?: () => void;
}

/** The editor's disabled shell while its chunk or the bot's profile loads, or after either fails (`KeComponent`). */
export function EditorPlaceholder({ error = false, title, footer, onCreatePet }: EditorPlaceholderProps) {
  return (
    <CharacterEditorLayout
      title={title}
      footer={footer}
      loadingLabel={
        error ? undefined : (
          <FormattedMessage id="restricted.characterEditor.loading" defaultMessage="Loading character…" description="Status while the assistant's character renderer loads" />
        )
      }
      preview={
        error ? (
          <p className="text-sm text-secondary" role="alert">
            <FormattedMessage
              id="restricted.characterEditor.loadError"
              defaultMessage="Couldn’t load this character. Close the editor and try again"
              description="Error when loading the saved assistant profile for appearance editing"
            />
          </p>
        ) : null
      }
      controls={
        <AvatarChooser
          preview={null}
          disabled
          selectedTint={null}
          selectedPreset={null}
          customSelected={false}
          hasCustomCharacter={false}
          petDisabled
          onCreatePet={onCreatePet}
        />
      }
    />
  );
}
