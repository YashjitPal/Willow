/**
 * Flow's Create tool page (`flow-create-applet-page`) at /media/create-tool: "New tool", the hero
 * lines, three of Flow's four suggestions in a random order (a suggestion fills the prompt, it
 * does not send it) and the prompt box. Sending makes the tool and opens it in Edit, where the
 * Tool Builder's first turn builds it; Back goes to the Tools page.
 */
import React from 'react';
import { showSnack } from '../scenes/scene-store';
import { builderSession } from './builder-session';
import { CREATE_SUGGESTIONS, type CreateSuggestion } from './catalog';
import { NavigationHeader } from './ToolsManagerPage';
import { toolLocation, toolsLocation } from './tools-routes';
import { createTool } from './tools-store';
import { useToolsUi } from './tools-ui';
import { FlowIconButton } from './ui';

const PLACEHOLDER = 'Build a retro pixel effect app with a large upload drop zone and a settings sidebar.';

function pickSuggestions(): CreateSuggestion[] {
  const pool = [...CREATE_SUGGESTIONS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, 3);
}

export const CreateToolPage: React.FC = () => {
  const ui = useToolsUi();
  const host = ui.host;
  const [suggestions] = React.useState(pickSuggestions);
  const [text, setText] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || pending) return;
    setPending(true);
    setText('');
    try {
      const tool = await createTool({ pending: true });
      void builderSession(tool.id).send(prompt, { modelConfig: host.modelConfig, apiKeys: host.apiKeys, geminiKey: host.geminiKeys[0] });
      host.navigate(toolLocation(host.search, tool.id, { mode: 'EDIT' }));
    } catch {
      setPending(false);
      showSnack({ icon: 'error', text: 'Failed to start tool creation. Please try again.', actions: [{ label: 'Dismiss' }], tone: 'error' });
    }
  };

  const fill = (suggestion: CreateSuggestion) => {
    setText(suggestion.prompt);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  return (
    <div className="ng-flow-create-applet-page">
      <div className="create-applet-page">
        <header className="create-applet-header">
          <NavigationHeader title="New tool" onBack={() => host.navigate(toolsLocation(host.search))} />
        </header>
        <div className="wt-tools-body">
          {host.renderSidebar()}
          <div className="wt-tools-main">
            <div className="create-applet-content wt-create-content">
              <div className="create-applet-container">
                <main className="create-applet-main">
                  <div className="create-applet-centered-content">
                    <h1 className="create-applet-hero-title">
                      <span className="hero-line">Start building any creative tool</span>
                      <span className="hero-line">you can dream by describing it below.</span>
                    </h1>
                    <div className="suggestions-row">
                      {suggestions.map((s) => (
                        <button key={s.name} type="button" className="suggestion-card" disabled={pending} onClick={() => fill(s)}>
                          <div className="suggestion-icon"><img className="suggestion-image" src={s.icon} alt="" /></div>
                          <div className="suggestion-text">
                            <span className="suggestion-name">{s.name}</span>
                            <span className="suggestion-subtitle">{s.description}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </main>
                <footer className="create-applet-footer">
                  <div className="create-applet-prompt-box-wrapper">
                    <div className="ng-flow-base-prompt-box create-applet-prompt-box">
                      <div className="base-prompt-box">
                        <div className="prompt-top-row">
                          <div className="ng-flow-rich-text-editor prompt-input" onClick={() => inputRef.current?.focus()}>
                            {!text && <span className="prosemirror-placeholder">{PLACEHOLDER}</span>}
                            <div className="prosemirror-editor">
                              <textarea
                                ref={inputRef}
                                rows={1}
                                className="wt-rich-input"
                                aria-label="Prompt"
                                value={text}
                                disabled={pending}
                                onChange={(e) => setText(e.target.value)}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    void submit();
                                  }
                                }}
                              />
                            </div>
                          </div>
                          <div className="top-right-actions" />
                        </div>
                        <div className="bottom-controls">
                          <div className="submit-controls">
                            <div className="ng-flow-generate-icon-button">
                              <FlowIconButton
                                icon="arrow_forward"
                                label="Start generation"
                                tooltip={null}
                                variant="secondary"
                                className="generate-icon-button"
                                iconClassName="flow-icon-m mat-icon-rtl-mirror"
                                disabled={pending || !text.trim()}
                                onClick={() => void submit()}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="disclaimer-text">Creating tools does not currently cost credits.</p>
                </footer>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="ng-flow-footer-disclaimer">
        <p className="footer-disclaimer-text">Willow can make mistakes, so double check it</p>
      </div>
    </div>
  );
};
