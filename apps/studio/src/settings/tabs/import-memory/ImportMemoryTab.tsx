/**
 * Settings > Import memory to Willow.
 *
 * A clone of Gemini's `/import` route: copy a prompt into another AI assistant, paste its
 * answer back, and separately upload a chat-history export. Transcribed from the live page
 * — geometry from `getBoundingClientRect`, declarations from CDP
 * `CSS.getMatchedStylesForNode` (Gemini's sheets are cross-origin, so `document.styleSheets`
 * exposes none of their rules). Captures in
 * `tools/ui-research/captures/settings/import-memory/`.
 *
 * **This is UI only.** Nothing here imports anything: the Copy button copies the prompt to
 * the clipboard, and the two Add buttons are inert. The paste box does hold its text so the
 * card's focus and has-content states are real rather than decorative, and so the Add
 * memory button enables the way Gemini's does.
 */
import React, { useCallback, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './ImportMemoryTab.css';

/**
 * The prompt Gemini ships, verbatim apart from the destination product name.
 *
 * Captured from the live page (`captures/settings/import-memory/texts.json`) rather than
 * rewritten: it is the instruction another assistant has to follow for the paste-back to
 * produce anything useful, so its wording and its category order are load-bearing.
 */
const IMPORT_PROMPT = `You are helping me import context from one AI assistant to another. Your job is to go through our past conversations and sum up what you know about me.

In the output, please avoid using any first-person pronouns (I, my, me, mine) and any second-person pronouns (you, your, yours). Instead, refer to the individual you have learned about as "the user" or use neutral phrasing.

Preserve the user's words verbatim where possible, especially for instructions and preferences.

Categories (output in this order):
1. Demographics Information: Preferred names, profession, education, and general residence.
2. Interests & Preferences: Sustained, active engagements (not just owning an object or a one-time purchase).
3. Relationships: Confirmed, sustained relationships.
4. Dated Events, Projects & Plans: A log of significant, recent activities.
5. Instructions: Rules I've explicitly asked you to follow going forward, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

Format:
Divide the content into the labeled section using the categories above. Try to include verbatim quotes from my prompts that justify each entry. Structure each entry using this format:
* The user's name is <name>.
    * Evidence: User said "call me <name>". Date: [YYYY-MM-DD].

Output:
- Output ONLY the requested information. Do not include any conversational filler, intro text, or sign-offs.

Finally, complete the sentence "Imported from: <name>", where name is ChatGPT, Claude, Grok, etc. This must be the absolute final text in your response.`;

export const ImportMemoryTab: React.FC = () => {
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT);
      setCopied(true);
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the button simply does not confirm.
    }
  }, []);

  return (
    <div className="import-memory">
      <div className="import-memory__container">
        <div className="import-memory__content">
          <div className="import-memory__header">
            <h2 className="import-memory__title gds-display-s">Import memory to Willow</h2>
          </div>

          <div className="import-memory__steps">
            <div className="import-memory__step">
              <div className="import-memory__step-indicator">
                <span className="import-memory__step-number gds-body-s">1</span>
                <h3 className="import-memory__section-title gds-title-m">
                  Copy this prompt into a chat with your other AI provider
                </h3>
              </div>

              <div className="import-memory__prompt-card" onClick={handleCopy}>
                <div className="import-memory__prompt-text gds-body-l">{IMPORT_PROMPT}</div>
                <div className="import-memory__prompt-actions">
                  <button
                    type="button"
                    className="import-memory__pill import-memory__pill--outlined"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy();
                    }}
                  >
                    <MaterialSymbol
                      name="content_copy"
                      family="luminous"
                      size={24}
                      weight={300}
                      roundness={100}
                      opticalSize={24}
                    />
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="import-memory__step">
              <div className="import-memory__step-indicator">
                <span className="import-memory__step-number gds-body-s">2</span>
                <h3 className="import-memory__section-title gds-title-m">Paste the response here</h3>
              </div>

              <div className={`import-memory__paste-card${pasted ? ' has-content' : ''}`}>
                <textarea
                  className="import-memory__paste-textarea gds-body-l"
                  placeholder="Paste your info here..."
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                />
                <div className="import-memory__paste-actions">
                  <button
                    type="button"
                    className="import-memory__pill import-memory__pill--filled"
                    disabled={!pasted.trim()}
                  >
                    <MaterialSymbol
                      name="add"
                      family="luminous"
                      size={24}
                      weight={300}
                      roundness={100}
                      opticalSize={24}
                    />
                    <span>Add memory</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="import-memory__section">
            <h2 className="import-memory__section-heading gds-headline-m">Import chats</h2>
            <div className="import-memory__subtitle gds-body-m">
              Export your data from a{' '}
              <button type="button" className="import-memory__link">
                supported AI provider
              </button>{' '}
              and upload the .zip file (up to 5 GB) directly to Willow.{' '}
              <button type="button" className="import-memory__link">
                Learn more
              </button>
            </div>

            <button
              type="button"
              className="import-memory__pill import-memory__pill--filled import-memory__action-button gds-label-l"
            >
              <MaterialSymbol
                name="add"
                family="google-symbols"
                size={20}
                weight={370}
                symbolWidth={92}
                roundness={0}
                className="import-memory__action-icon"
              />
              <span>Add</span>
            </button>

            <ol className="import-memory__record-list" />

            <div className="import-memory__disclaimer gds-body-s">
              Your imported and continued chats are saved in your Activity. This data is used to
              improve our services (including training generative AI models), and to protect
              Willow, our users and the public. You can{' '}
              <button type="button" className="import-memory__link">
                manage or delete your activity
              </button>{' '}
              anytime.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportMemoryTab;
