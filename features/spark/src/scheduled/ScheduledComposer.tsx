import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tooltip } from '@willow/ui/Tooltip';
import { useComposerDictation } from '@willow/chat/composer/use-composer-dictation';
import { SchedIcon } from './ScheduledIcons';
import { useScheduledNarrow } from './use-scheduled-narrow';

const DICTATE_LABEL = 'Dictate (^\u21e7D)';
const STOP_DICTATION_LABEL = 'Stop dictation (^\u21e7D)';
const MAX_HEIGHT = 240;

interface ScheduledComposerProps {
  modelConfig: unknown;
  onSubmit: (text: string) => Promise<boolean> | boolean;
}

/**
 * "Describe a task": Gemini's `input-area-v2` in its single-line zero state, with its mic and,
 * once there is text, the send button beside it. Enter sends (Shift+Enter is a new line) and the
 * request becomes a Spark task, as Gemini's starts a Spark chat.
 */
export const ScheduledComposer: React.FC<ScheduledComposerProps> = ({ modelConfig, onSubmit }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const narrow = useScheduledNarrow();
  const noop = () => {};
  const dictation = useComposerDictation({
    promptText: text,
    setPromptText: setText,
    textareaRef,
    modelConfig,
    isComposerMaximized: false,
    setIsComposerMaximized: noop,
    setIsModelsOpen: noop,
    setIsPlusMenuOpen: noop,
  });

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(MAX_HEIGHT, Math.max(24, textarea.scrollHeight))}px`;
  }, [text]);

  // Gemini's composer takes the cursor as the page opens.
  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        dictation.handleToggleDictation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const hasText = text.trim().length > 0;

  const send = async () => {
    if (!hasText || sending) return;
    setSending(true);
    try {
      if (await onSubmit(text)) setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sched-composer" onClick={() => textareaRef.current?.focus()}>
      <div className="sched-composer-field">
        <textarea
          ref={textareaRef}
          className="sched-composer-input"
          aria-label="Enter a prompt for Gemini"
          placeholder={dictation.dictationPlaceholder ?? 'Describe a task'}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
      </div>
      <div className="sched-composer-actions">
        <Tooltip content={dictation.isDictating ? STOP_DICTATION_LABEL : DICTATE_LABEL}>
          <button
            type="button"
            className={`sched-composer-button sched-composer-mic${dictation.isDictationActive ? ' is-listening' : ''}`}
            aria-label={dictation.isTranscribingDictation ? 'Transcribing voice' : dictation.isDictating ? STOP_DICTATION_LABEL : DICTATE_LABEL}
            onClick={(event) => {
              event.stopPropagation();
              dictation.handleToggleDictation();
            }}
          >
            <SchedIcon name={dictation.isDictating ? 'stop' : 'mic'} size={narrow ? 28 : 24} />
          </button>
        </Tooltip>
        {hasText && (
          <Tooltip content="Submit">
            <button
              type="button"
              className="sched-composer-button sched-composer-send"
              aria-label="Send message"
              disabled={sending}
              onClick={(event) => {
                event.stopPropagation();
                void send();
              }}
            >
              <SchedIcon name="arrow_upward" size={24} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
