import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import lottie from 'lottie-web';
import { AnimatePresence, motion } from 'framer-motion';
import { Glasses } from 'lucide-react';
import { InputBar } from './InputBar';
import { HeroSection } from './HeroSection';
import { BottomPanel } from './BottomPanel';
import { TextShimmer } from './ui/text-shimmer';
import { MaterialSymbol } from './ui/MaterialSymbol';
import { StreamingMarkdown } from './ui/StreamingMarkdown';
import { ResponseActions, ThinkingStepsSidebar } from './ChatResponseChrome';
import { streamChat, ChatMessage as AiChatMessage, StreamPhase } from '../lib/ai';
import {
  GeminiLiveSession,
  LIVE_MODEL_ID,
  LiveHistoryTurn,
  playLiveChime,
  primeLiveChimes,
} from '../lib/live';
import { useUserDataContext } from '../context/UserDataContext';
import { useLocalFS, isTempChatId } from '../context/LocalFSContext';
import { getThinkingEffortLabel } from '../lib/model-efforts';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingTime?: number;
  /** Displayable thought summary returned by the model, never hidden chain-of-thought data. */
  thinkingText?: string;
  modelSnapshot?: {
    provider: string;
    modelId: string;
    label: string;
    thinkingLevel: number;
  };
  isError?: boolean;
  isGenerating?: boolean;
  /** User bubble is a live-voice utterance whose transcript hasn't arrived yet. */
  isTranscribing?: boolean;
  /** Assistant turn driven by the Live API (no Thinking row). */
  isLive?: boolean;
  /** Live reply cut short by user barge-in — rendered without the action row. */
  wasInterrupted?: boolean;
  /** Whether this message was newly sent in the current session (should animate in). */
  isNew?: boolean;
}

const USER_MESSAGE_COLLAPSED_HEIGHT = 4 * 24;

const UserMessageBubble: React.FC<Pick<ChatMsg, 'content' | 'isTranscribing'>> = ({
  content,
  isTranscribing,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const measure = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      setNaturalHeight((currentHeight) => (
        currentHeight === nextHeight ? currentHeight : nextHeight
      ));
      if (nextHeight <= USER_MESSAGE_COLLAPSED_HEIGHT) {
        setIsExpanded(false);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  const canToggle = !isTranscribing && naturalHeight > USER_MESSAGE_COLLAPSED_HEIGHT;
  const visibleHeight = canToggle
    ? (isExpanded ? naturalHeight : USER_MESSAGE_COLLAPSED_HEIGHT)
    : (naturalHeight || undefined);
  const toggleLabel = isExpanded ? 'Collapse text' : 'Expand text';

  return (
    <div
      className="relative min-w-0 max-w-[508px] overflow-hidden rounded-[40px] bg-[#141414] px-7 py-5 text-[17px] font-normal leading-6 text-[#e3e3e3] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
      style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
    >
      <div
        className="overflow-hidden"
        style={{
          maxHeight: visibleHeight,
          transition: 'max-height 400ms cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        <div ref={contentRef}>
          {isTranscribing && !content ? (
            <span className="select-none italic text-gray-500">Transcribing…</span>
          ) : (
            content
          )}
        </div>
      </div>

      {canToggle && (
        <>
          {!isExpanded && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-5 right-[56px] z-10 h-6 w-[88px] bg-gradient-to-r from-transparent via-[#141414] to-[#141414]"
            />
          )}
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className="absolute bottom-5 right-6 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-[#28292a] text-[#c4c7c5] transition-colors hover:bg-[#333537] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label={toggleLabel}
            aria-expanded={isExpanded}
            title={toggleLabel}
          >
            <MaterialSymbol
              family="luminous"
              name={isExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
              size={24}
              weight={300}
              roundness={100}
              opticalSize={24}
            />
          </button>
        </>
      )}
    </div>
  );
};

interface DashboardChatProps {
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  onOpenDriveSettings?: () => void;
  isIncognito?: boolean;
  onChatStartedChange?: (started: boolean) => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pure conversational system prompt (no code-gen artifacts)
// ──────────────────────────────────────────────────────────────────────────────
const CHAT_SYSTEM_PROMPT =
  'You are Willow, a friendly and highly capable AI assistant. ' +
  'Respond conversationally and helpfully. Use markdown for formatting ' +
  '(bold, bullet lists, fenced code blocks, tables) when it improves clarity. ' +
  'For simple math or chemistry, prefer plain Unicode (e.g. CO₂, x², →, π) over LaTeX. ' +
  'Only use $$...$$ for genuinely complex equations. ' +
  'Do not wrap responses in boltArtifact or any XML tags.';

const getShortModelName = (name: string) => {
  if (!name) return 'Model';
  if (name.includes('2.5 Flash Lite')) return '2.5 Lite';
  return name.replace(/Gemini\s+/gi, '').trim();
};

const waitForBrowserPaint = () => new Promise<void>((resolve) => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  const fallback = window.setTimeout(finish, 50);
  requestAnimationFrame(() => {
    window.clearTimeout(fallback);
    finish();
  });
});

// The exact Lottie animation data from Gemini's "Thinking" indicator
// Source: https://gemini.gstatic.com/_/boq-bard-web/_/r/XytT4kFAhW4.json
// Fill color set to exact Gemini dark theme color: rgb(224, 224, 224) -> [0.878, 0.878, 0.878, 1]
const GEMINI_THINKING_DOTS_DATA = {"v":"5.12.1","fr":60.0914611816406,"ip":0,"op":693.005318581434,"w":28,"h":28,"nm":"01 - Icons Three Dots - A 28x28","ddd":0,"assets":[],"layers":[{"ddd":0,"ind":1,"ty":3,"nm":"Center","sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":1,"k":[{"i":{"x":[0.566],"y":[1]},"o":{"x":[0.435],"y":[0]},"t":192.001,"s":[0]},{"i":{"x":[0.667],"y":[1]},"o":{"x":[0.333],"y":[0]},"t":235.002,"s":[-120]},{"i":{"x":[0.226],"y":[1]},"o":{"x":[0.274],"y":[0]},"t":481.004,"s":[-120]},{"t":536.004113650287,"s":[-360]}],"ix":10},"p":{"a":0,"k":[14,14,0],"ix":2,"l":2},"a":{"a":0,"k":[50,50,0],"ix":1,"l":2},"s":{"a":0,"k":[100,100,100],"ix":6,"l":2}},"ao":0,"ip":0,"op":693.005318581434,"st":0,"bm":0},{"ddd":0,"ind":2,"ty":4,"nm":"LEFT","parent":1,"sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":0,"k":0,"ix":10},"p":{"a":1,"k":[{"i":{"x":0.559,"y":1},"o":{"x":0.243,"y":0.609},"t":0,"s":[43.4,53.744,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.008},"t":12,"s":[43.4,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.008},"t":48,"s":[43.4,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.008},"t":84.001,"s":[43.4,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.008},"t":120.001,"s":[43.4,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.516,"y":0.008},"t":156.001,"s":[43.4,55,0],"to":[0,0,0],"ti":[-0.04,3.987,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":192.001,"s":[43.4,45,0],"to":[-0.212,14.619,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":235.002,"s":[53.212,59.625,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":268.002,"s":[43.4,43.1,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":301.002,"s":[53.212,59.625,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":337.003,"s":[43.4,43.1,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":373.003,"s":[53.212,59.625,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":409.003,"s":[43.4,43.1,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":445.003,"s":[53.212,59.625,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.333,"y":0},"t":481.004,"s":[43.4,43.1,0],"to":[0,0,0],"ti":[0,0,0]},{"t":524.004,"s":[43.4,45,0],"h":1},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.005},"t":536.004,"s":[43.4,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.008},"t":560.004,"s":[43.4,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.008},"t":596.005,"s":[43.4,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.34,"y":1},"o":{"x":0.516,"y":0.008},"t":632.005,"s":[43.4,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.576,"y":0.694},"o":{"x":0.601,"y":0.007},"t":668.005,"s":[43.4,45,0],"to":[0,0,0],"ti":[0,0,0]},{"t":692.005310906713,"s":[43.4,53.744,0]}],"ix":2,"l":2},"a":{"a":0,"k":[0,0,0],"ix":1,"l":2},"s":{"a":0,"k":[50,50,100],"ix":6,"l":2}},"ao":0,"shapes":[{"ty":"gr","it":[{"ty":"rc","d":1,"s":{"a":0,"k":[8,8],"ix":2},"p":{"a":0,"k":[0,0],"ix":3},"r":{"a":0,"k":10,"ix":4},"nm":"Rectangle Path 1","mn":"ADBE Vector Shape - Rect","hd":false},{"ty":"fl","c":{"a":0,"k":[0.878,0.878,0.878,1],"ix":4},"o":{"a":0,"k":100,"ix":5},"r":1,"bm":0,"nm":"Fill 1","mn":"ADBE Vector Graphic - Fill","hd":false},{"ty":"tr","p":{"a":0,"k":[0,0],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Rectangle 1","np":3,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":693.005318581434,"st":-31.0002379163412,"ct":1,"bm":0},{"ddd":0,"ind":3,"ty":4,"nm":"CENTER","parent":1,"sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":0,"k":0,"ix":10},"p":{"a":1,"k":[{"i":{"x":0.468,"y":1},"o":{"x":0.313,"y":0.367},"t":0,"s":[50,47.037,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":24,"s":[50,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":60,"s":[50,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":96.001,"s":[50,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":132.001,"s":[50,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.833,"y":0.833},"o":{"x":0.5,"y":0},"t":168.001,"s":[50,55,0],"to":[0,0,0],"ti":[3.375,2.938,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.167,"y":0.167},"t":204.002,"s":[50,45,0],"to":[-4.316,-3.756,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":235.002,"s":[40.688,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":268.002,"s":[59.562,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":301.002,"s":[40.688,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":337.003,"s":[59.562,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":373.003,"s":[40.688,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":409.003,"s":[59.562,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":445.003,"s":[40.688,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.333,"y":0},"t":481.004,"s":[59.562,47.75,0],"to":[0,0,0],"ti":[0,0,0]},{"t":522.004,"s":[50,45,0],"h":1},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":536.004,"s":[50,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":572.004,"s":[50,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":608.005,"s":[50,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":644.005,"s":[50,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.744,"y":0.413},"o":{"x":0.435,"y":0},"t":680.005,"s":[50,45,0],"to":[0,0,0],"ti":[0,0,0]},{"t":692.005310906713,"s":[50,47.037,0]}],"ix":2,"l":2},"a":{"a":0,"k":[0,0,0],"ix":1,"l":2},"s":{"a":0,"k":[50,50,100],"ix":6,"l":2}},"ao":0,"shapes":[{"ty":"gr","it":[{"ty":"rc","d":1,"s":{"a":0,"k":[8,8],"ix":2},"p":{"a":0,"k":[0,0],"ix":3},"r":{"a":0,"k":10,"ix":4},"nm":"Rectangle Path 1","mn":"ADBE Vector Shape - Rect","hd":false},{"ty":"fl","c":{"a":0,"k":[0.878,0.878,0.878,1],"ix":4},"o":{"a":0,"k":100,"ix":5},"r":1,"bm":0,"nm":"Fill 1","mn":"ADBE Vector Graphic - Fill","hd":false},{"ty":"tr","p":{"a":0,"k":[0,0],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Rectangle 1","np":3,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":693.005318581434,"st":-12.0000920966482,"ct":1,"bm":0},{"ddd":0,"ind":4,"ty":4,"nm":"RIGHT","parent":1,"sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":0,"k":0,"ix":10},"p":{"a":1,"k":[{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":0,"s":[56.6,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":36,"s":[56.6,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":72.001,"s":[56.6,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":108.001,"s":[56.6,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":144.001,"s":[56.6,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":180.001,"s":[56.6,55,0],"to":[0,0,0],"ti":[-0.133,3.463,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.5,"y":0},"t":235.002,"s":[56.6,43.1,0],"to":[-6.076,10.768,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":268.002,"s":[47.225,59.438,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":301.002,"s":[56.6,43.1,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":337.003,"s":[47.225,59.438,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":373.003,"s":[56.6,43.1,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":409.003,"s":[47.225,59.438,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":445.003,"s":[56.6,43.1,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.333,"y":0},"t":481.004,"s":[47.225,59.438,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":536.004,"s":[56.6,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":584.004,"s":[56.6,55,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":620.005,"s":[56.6,45,0],"to":[0,0,0],"ti":[0,0,0]},{"i":{"x":0.5,"y":1},"o":{"x":0.5,"y":0},"t":656.005,"s":[56.6,55,0],"to":[0,0,0],"ti":[0,0,0]},{"t":692.005310906713,"s":[56.6,45,0]}],"ix":2,"l":2},"a":{"a":0,"k":[0,0,0],"ix":1,"l":2},"s":{"a":0,"k":[50,50,100],"ix":6,"l":2}},"ao":0,"shapes":[{"ty":"gr","it":[{"ty":"rc","d":1,"s":{"a":0,"k":[8,8],"ix":2},"p":{"a":0,"k":[0,0],"ix":3},"r":{"a":0,"k":10,"ix":4},"nm":"Rectangle Path 1","mn":"ADBE Vector Shape - Rect","hd":false},{"ty":"fl","c":{"a":0,"k":[0.878,0.878,0.878,1],"ix":4},"o":{"a":0,"k":100,"ix":5},"r":1,"bm":0,"nm":"Fill 1","mn":"ADBE Vector Graphic - Fill","hd":false},{"ty":"tr","p":{"a":0,"k":[0,0],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Rectangle 1","np":3,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":693.005318581434,"st":0,"ct":1,"bm":0}],"markers":[],"props":{}};

const GeminiThinkingVisualizer = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: GEMINI_THINKING_DOTS_DATA,
    });
    return () => anim.destroy();
  }, []);

  return <div ref={containerRef} style={{ width: 24, height: 24 }} />;
};

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────
export const DashboardChat: React.FC<DashboardChatProps> = ({
  modelConfig,
  selectedModelId,
  setSelectedModelId,
  isAuthenticated,
  onAuthRequired,
  onOpenDriveSettings,
  isIncognito = false,
  onChatStartedChange,
}) => {
  const { apiKeys } = useUserDataContext();
  const { isLocalFolderConnected, saveLocalFSChat, generateChatTitle, activeChatId, loadLocalFSChat, localChats } = useLocalFS();

  // Unique session ID for auto-saving chats locally
  const [chatSessionId, setChatSessionId] = useState(() => {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    return `${dateStr}_${Math.random().toString(36).slice(2, 8)}`;
  });

  const [chatTitle, setChatTitle] = useState<string | null>(null);


  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [externalReloadVersion, setExternalReloadVersion] = useState(0);
  const forceExternalReloadRef = useRef(false);
  const pendingExternalReloadRef = useRef<string | null>(null);

  useEffect(() => {
    const handleBodyUpdate = (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (!chatId || chatId !== activeChatId) return;
      pendingExternalReloadRef.current = chatId;
      if (isGeneratingRef.current || isLiveRef.current) return;
      pendingExternalReloadRef.current = null;
      forceExternalReloadRef.current = true;
      setExternalReloadVersion((version) => version + 1);
    };
    window.addEventListener('willow_chat_body_updated', handleBodyUpdate);
    return () => window.removeEventListener('willow_chat_body_updated', handleBodyUpdate);
  }, [activeChatId]);

  // Listen to activeChatId and load the chat when it changes
  useEffect(() => {
    if (isLocalFolderConnected && activeChatId) {
      // Prevent reloading and overwriting if the selected chat is already active in memory
      const forceReload = forceExternalReloadRef.current;
      forceExternalReloadRef.current = false;
      if (!forceReload && (activeChatId === chatTitle || activeChatId === chatSessionId)) {
        return;
      }
      isFirstScrollRef.current = true;
      initialLoadRef.current = true; // Block auto-save on load when switching chats

      const loadChat = async () => {
        try {
          const msgs = await loadLocalFSChat(activeChatId);
          if (msgs && msgs.length > 0) {
            // Strip runtime-only flags that should never be persisted.
            // If a save happened mid-generation, the assistant placeholder
            // will have isGenerating:true and empty content — drop those.
            const sanitized: ChatMsg[] = msgs
              .map((m: any) => ({
                id: m.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2),
                role: m.role,
                content: m.content || '',
                thinkingTime: m.thinkingTime,
                thinkingText: typeof m.thinkingText === 'string' ? m.thinkingText : undefined,
                modelSnapshot: m.modelSnapshot,
                isError: m.isError,
                // Clear all runtime flags
                isGenerating: false,
                isTranscribing: false,
                isLive: false,
                wasInterrupted: m.wasInterrupted,
              }))
              .filter((m: ChatMsg) => m.content.trim().length > 0);

            if (sanitized.length > 0) {
              setMessages(sanitized);
              // `chatTitle` means "the human name this chat is saved under" —
              // a temp id is not one. Writing it here closes the title-effect's
              // `!chatTitle` gate permanently, so the chat can never be named
              // and the sidebar skeleton shimmers forever. chatSessionId still
              // adopts the id, which is what keeps the guard at ~line 153 sound.
              setChatTitle(isTempChatId(activeChatId) ? null : activeChatId);
              setChatSessionId(activeChatId);
              return;
            }
          }
          // Load yielded nothing usable. Don't leave the PREVIOUS chat's
          // messages on screen under the newly-selected id — adopt the id
          // with an empty thread instead (and release the load guard so the
          // first real message saves normally).
          setMessages([]);
          setChatTitle(isTempChatId(activeChatId) ? null : activeChatId);
          setChatSessionId(activeChatId);
          lastSavedMessagesRef.current = [];
          initialLoadRef.current = false;
        } catch {}
      };
      void loadChat();
    }
  }, [activeChatId, isLocalFolderConnected, loadLocalFSChat, chatTitle, chatSessionId, externalReloadVersion]);

  // Handle the case where the currently active chat is deselected/deleted.
  // We must ONLY clear when an EXISTING active chat goes away (a non-null ->
  // null transition) AND it STAYS null. A brand-new chat legitimately has
  // activeChatId === null the whole time, and internal renames/syncs can briefly
  // flip it; clearing on either would wipe the user's live conversation. So we
  // (a) track the previous id, and (b) re-check after a short delay so a transient
  // null can't wipe the chat — only a sustained deselect clears it.
  const prevActiveChatIdRef = useRef<string | null>(activeChatId);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  // Mirrors of isLive/isGenerating for the clear-effect's delayed re-check (they
  // are declared later in the component, so we read them via refs at fire time).
  const isLiveRef = useRef(false);
  const isGeneratingRef = useRef(false);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => {
    const prev = prevActiveChatIdRef.current;
    prevActiveChatIdRef.current = activeChatId;
    if (prev !== null && activeChatId === null && messages.length > 0) {
      const t = setTimeout(() => {
        // Only a SUSTAINED, idle deselect clears the view. Never clear during a
        // live session or while generating (live mode toggles activeChatId/
        // isGenerating rapidly and can briefly read null), and never if the chat
        // became active again in the meantime.
        if (activeChatIdRef.current !== null || isLiveRef.current || isGeneratingRef.current) return;
        setMessages([]);
        setChatTitle(null);
        const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
        setChatSessionId(`${dateStr}_${Math.random().toString(36).slice(2, 8)}`);
      }, 500);
      return () => clearTimeout(t);
    }
  }, [activeChatId, messages.length]);

  // Generate the chat title only after the first assistant reply has finished.
  // Starting this from the empty assistant placeholder races the temp-id rename
  // against the first response stream and can reload/replace the live thread.
  // Naming is background work and must never sit on the reply's critical path.
  // localChats is read via a ref (not a dep) so poll-driven list reorders can't
  // re-trigger this effect, and an in-flight ref guards against a second
  // generation firing while the first is still awaiting the naming model.
  const localChatsRef = useRef(localChats);
  useEffect(() => { localChatsRef.current = localChats; }, [localChats]);
  const titleGenInFlightRef = useRef(false);
  useEffect(() => {
    if (isIncognito) return;
    const firstUserIndex = messages.findIndex((message) => message.role === 'user');
    const firstUser = firstUserIndex >= 0 ? messages[firstUserIndex] : undefined;
    const firstAssistant = firstUserIndex >= 0
      ? messages.slice(firstUserIndex + 1).find((message) => message.role === 'assistant')
      : undefined;
    const firstReplyFinished = !!firstAssistant
      && !firstAssistant.isGenerating
      && firstAssistant.content.trim().length > 0;

    if (
      isLocalFolderConnected
      && firstUser
      && firstReplyFinished
      && !chatTitle
      && !titleGenInFlightRef.current
    ) {
      titleGenInFlightRef.current = true;
      const userMsg = firstUser.content;
      const assistantMsg = firstAssistant.content;
      
      const fetchTitle = async () => {
        let title = '';
        try {
          title = await generateChatTitle(userMsg, assistantMsg);
        } catch (err) {
          // Fallback handled below
        }

        // Fallback: If Gemini naming is slow, fails, or has no key, use the first 5 words of the user prompt
        if (!title) {
          const words = userMsg.trim().split(/\s+/);
          const rawFallback = words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '');
          title = rawFallback.replace(/[\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Untitled Chat';
        }

        if (title) {
          // A generated title can collide with an EXISTING chat's name (two
          // conversations about the same topic name identically) — and
          // saveLocalFSChat would then silently overwrite that older chat's
          // body in IndexedDB and on disk. Uniquify against every chat id we
          // can see: the in-memory list PLUS the persisted list and timestamp
          // keys (a chat created in another tab, or seconds ago, may not have
          // reached `localChats` state yet).
          const taken = new Set<string>(localChatsRef.current);
          taken.delete(chatSessionId);
          let uniqueTitle = title;
          let suffix = 1;
          while (taken.has(uniqueTitle)) {
            uniqueTitle = `${title} (${suffix})`;
            suffix++;
          }
          setChatTitle(uniqueTitle);
          // NOTE: deliberately do NOT setChatSessionId(uniqueTitle) here.
          // The load effect short-circuits on `activeChatId === chatSessionId`;
          // during the async temp→title rename there's a render where
          // activeChatId is still the temp id. If chatSessionId had already
          // flipped to the title, that guard would miss, the effect would load
          // the just-deleted temp body, get nothing, and the empty-load branch
          // would wipe the live thread. saveLocalFSChat's oldChatId handling
          // makes the lingering temp id harmless.
          // Persist from the LIVE messages ref, not this effect's closure.
          // The `await generateChatTitle` above can span a whole extra user
          // turn; saving the stale closure snapshot under the title (while
          // saveLocalFSChat deletes the temp body it renames from) silently
          // dropped that turn from persistence. Strip runtime flags and any
          // still-streaming placeholder (empty content) exactly like the
          // load path does.
          const latest = messagesRef.current
            .map(({ isGenerating: _ig, isTranscribing: _it, isLive: _il, isNew: _in, ...rest }: any) => rest)
            .filter((m: any) => typeof m.content === 'string' && m.content.trim().length > 0);
          if (latest.length > 0) {
            const saved = await saveLocalFSChat(uniqueTitle, latest, chatSessionId);
            if (saved) {
              lastSavedMessagesRef.current = messagesRef.current;
            } else {
              // A cross-tab or on-disk collision may have appeared after our
              // optimistic uniqueness check. Keep the temp chat intact and let
              // the effect retry with the now-refreshed chat list.
              setChatTitle(null);
              titleGenInFlightRef.current = false;
            }
          }
        }
      };
      void fetchTitle();
    }
  }, [messages, chatTitle, chatSessionId, isLocalFolderConnected, generateChatTitle, saveLocalFSChat, isIncognito]);

  const [streaming, setStreaming] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const sendInFlightRef = useRef(false);
  // React 19 may batch rapid SDK stream callbacks with the completion cleanup.
  // Track the deferred clear so a new turn can cancel it before accepting text.
  const streamingClearRafRef = useRef<number | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  // Pre-response activity label. Stays on the shimmer row until the first real
  // text token streams ('responding'), so tool calls (search / code exec) don't
  // prematurely flip the row to "Thought for Ns".
  const [thinkingPhase, setThinkingPhase] = useState<StreamPhase>('thinking');
  const [thinkSeconds, setThinkSeconds] = useState(0);
  const [reactions, setReactions] = useState<Record<string, 'like' | 'dislike' | null>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [openThinkingMessageId, setOpenThinkingMessageId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const stopListening = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setListeningId(null);
  }, []);

  useEffect(() => {
    stopListening();
  }, [activeChatId, stopListening]);

  // Auto-save chat history locally in real-time when messages change.
  // Skip saving while generating — partial messages have empty content that
  // would corrupt the stored file. The final save fires once isGenerating
  // flips to false (which triggers a setMessages → re-render → this effect).
  // Also, we use a ref to prevent saving the exact same messages we just loaded,
  // which would bump the "last edited" timestamp to Date.now() simply by clicking on a chat.
  const initialLoadRef = useRef(true);
  const lastSavedMessagesRef = useRef<ChatMsg[]>([]);

  useEffect(() => {
    if (isIncognito) return;
    
    if (initialLoadRef.current && messages.length > 0) {
       initialLoadRef.current = false;
       lastSavedMessagesRef.current = messages;
       return;
    }

    if (messages === lastSavedMessagesRef.current) {
        return; // Exact same array reference (e.g. from a load or unrelated re-render)
    }

    if (isLocalFolderConnected && messages.length > 0 && !isGenerating && !initialLoadRef.current) {
      const activeId = chatTitle || chatSessionId;
      // Strip runtime flags before persisting
      const toSave = messages.map(({ isGenerating: _ig, isTranscribing: _it, isLive: _il, isNew: _in, ...rest }) => rest);
      void saveLocalFSChat(activeId, toSave, chatTitle ? chatSessionId : null);
      lastSavedMessagesRef.current = messages;
    }
  }, [messages, chatTitle, chatSessionId, isLocalFolderConnected, saveLocalFSChat, isGenerating, isIncognito]);

  // ── Live voice mode (Gemini Live API) ──────────────────────────────────────
  const [isLive, setIsLive] = useState(false);
  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  // Keep the clear-effect's refs in sync with live/generation state.
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => {
    // Nothing parked = nothing to replay. Without this the guard below reads
    // `null !== null` on a brand-new chat (no reload pending AND no chat
    // selected), falls through, and latches forceExternalReloadRef with no
    // event having occurred. Because the only reset (line ~152) lives inside
    // the `activeChatId` branch of the load effect, that latch survives until
    // the first send flips activeChatId — where it bypasses the identity guard
    // and reloads the user-message-only body over the live streaming thread.
    if (!pendingExternalReloadRef.current) return;
    if (isLive || isGenerating || pendingExternalReloadRef.current !== activeChatId) return;
    pendingExternalReloadRef.current = null;
    forceExternalReloadRef.current = true;
    setExternalReloadVersion((version) => version + 1);
  }, [activeChatId, isGenerating, isLive]);
  // Current in-flight live turn: the user + assistant message ids we're
  // writing into. `acc` mirrors `streaming` so finalize can read it without a
  // stale-closure round-trip.
  const liveTurnRef = useRef<{ userId: string; assistantId: string; acc: string } | null>(null);

  const hasStarted = messages.length > 0 || isGenerating || isLive;
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;

  useEffect(() => {
    onChatStartedChange?.(hasStarted);
  }, [hasStarted, onChatStartedChange]);

  // ── Scroll-to-top + dynamic response-area sizing (ported from Staging) ─────
  // When you send, your bubble animates to `TARGET_VISUAL_OFFSET` from the top
  // and the assistant block below it is given exactly enough min-height to fill
  // the remaining visible viewport, so you can't scroll into empty space before
  // the reply fills it. The gap below the 👍👎Copy row and the top of the input
  // box matches Staging's gap to its suggestions row (both = the 32px gradient).
  const TARGET_VISUAL_OFFSET = 80; // = pt-20 on the thread column
  const MESSAGE_GAP = 52;          // Gemini bubble edge to the following response
  const THREAD_GAP = 32;           // All other completed-turn adjacencies

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Inner content of the last assistant block — measured for the overflow
  // check so it's independent of the outer minHeight/paddingBottom we apply.
  const lastAssistantContentRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledUserId = useRef<string | null>(null);
  const scrollAnimRaf = useRef<number | null>(null);
  const isFirstScrollRef = useRef(false);

  const [responseAreaMinHeight, setResponseAreaMinHeight] = useState<number | undefined>(undefined);
  const [needsScrollPadding, setNeedsScrollPadding] = useState(false);
  // Live footer (input overlay) height — InputBar grows with multi-line text /
  // tool chips / attachments, so this must be reactive for the reserve + gap
  // math to stay correct.
  const [footerH, setFooterH] = useState(0);

  // Mirror messages in a ref so resize-driven recomputes can read the latest
  // list without re-running (and racing) on every setMessages.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    // Keep footerH AND responseAreaMinHeight in lock-step. The rendered
    // reserve is `responseAreaMinHeight + footerH`; if the two update in
    // separate renders the sum dips for one frame, scrollHeight shrinks, the
    // browser clamps scrollTop, and content visibly 'vibrates' while InputBar
    // animates (tool chip add/remove). Setting both in the same RO tick lets
    // React 18 auto-batch them into a single commit with a matched pair.
    const sync = () => {
      const h = el.offsetHeight;
      setFooterH(h);
      setResponseAreaMinHeight((prev) => {
        if (prev === undefined) return prev;
        const c = chatScrollRef.current;
        const msgs = messagesRef.current;
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        const msgEl = lastUser ? messageRefs.current[lastUser.id] : null;
        if (!c || !msgEl) return prev;
        return Math.max(
          0,
          c.clientHeight - TARGET_VISUAL_OFFSET - msgEl.offsetHeight - MESSAGE_GAP - h,
        );
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasStarted]);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const thinkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkStart = useRef<number>(0);
  const isThinkingRef = useRef(false);
  const thinkSecondsRef = useRef(0);

  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { thinkSecondsRef.current = thinkSeconds; }, [thinkSeconds]);

  useEffect(() => () => {
    if (thinkTimer.current) clearInterval(thinkTimer.current);
    if (scrollAnimRaf.current) cancelAnimationFrame(scrollAnimRaf.current);
    if (streamingClearRafRef.current !== null) {
      cancelAnimationFrame(streamingClearRafRef.current);
    }
  }, []);

  // ── Scroll-to-top animation on each new user turn ──────────────────────────
  // Mirrors StagingSidebar: reserve the response-area height FIRST via
  // flushSync so the scroll target is always reachable (turn-1 clamp fix),
  // then 85% instant-jump + 200ms ease-out to land the bubble at
  // TARGET_VISUAL_OFFSET.
  useLayoutEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    const userMsgs = messages.filter((m) => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1];
    if (!lastUser || lastUser.id === lastScrolledUserId.current) return;
    lastScrolledUserId.current = lastUser.id;

    requestAnimationFrame(() => {
      const msgEl = messageRefs.current[lastUser.id];
      if (!msgEl || !chatScrollRef.current) return;
      const c = chatScrollRef.current;

      // Reserve response-area height on the new placeholder BEFORE scrolling so
      // there's enough scrollHeight to reach the target. Read the LIVE footer
      // height from the DOM (InputBar has just shrunk after submit) and commit
      // it to state in the same flushSync so the reserve render uses matching
      // numbers — otherwise `responseAreaMinHeight` (computed with the small
      // live value) would be paired with a stale large `footerH` state.
      const liveFooterH = footerRef.current?.offsetHeight ?? 0;
      const preMinH =
        c.clientHeight - TARGET_VISUAL_OFFSET - msgEl.offsetHeight - MESSAGE_GAP - liveFooterH;
      flushSync(() => {
        setFooterH(liveFooterH);
        setResponseAreaMinHeight(Math.max(0, preMinH));
        setNeedsScrollPadding(false);
      });

      // The previous reply is now at its natural height, so the 👍👎Copy row
      // sits directly above the new bubble and they sweep together.
      // Animate from the CURRENT scroll position — never snap — so nothing
      // teleports; the bubble simply rises from exactly where it appeared.
      const targetScrollTop = Math.max(0, msgEl.offsetTop - TARGET_VISUAL_OFFSET);
      
      const N = 4;
      if (isFirstScrollRef.current && messages.length > N) {
        const targetIndex = messages.length - 1 - N;
        const jumpMessage = messages[targetIndex];
        const jumpEl = jumpMessage ? messageRefs.current[jumpMessage.id] : null;
        if (jumpEl) {
          c.scrollTop = Math.max(0, jumpEl.offsetTop - TARGET_VISUAL_OFFSET);
        }
      }
      isFirstScrollRef.current = false;

      const animStart = Math.min(c.scrollTop, targetScrollTop);
      // Animate the FULL distance (no instant-jump) so the bubble visibly
      // rises from the prompt box to the top.
      const distance = targetScrollTop - animStart;
      const t0 = performance.now();
      const dur = 320;
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

      const step = (now: number) => {
        const p = Math.min((now - t0) / dur, 1);
        c.scrollTop = animStart + distance * easeOutCubic(p);
        if (p < 1) {
          scrollAnimRaf.current = requestAnimationFrame(step);
        } else {
          c.scrollTop = targetScrollTop;
          scrollAnimRaf.current = null;
        }
      };
      scrollAnimRaf.current = requestAnimationFrame(step);
    });
  }, [messages]);

  // ── Recalculate reserved height when the viewport OR footer height changes.
  //    Intentionally NOT keyed on `messages` — the scroll-to-top RAF is the
  //    single authority for per-turn recompute; this effect only corrects for
  //    real size changes (window resize, InputBar grow/shrink between turns).
  useEffect(() => {
    const c = chatScrollRef.current;
    if (!c) return;
    const recompute = () => {
      setResponseAreaMinHeight((prev) => {
        if (prev === undefined) return prev;
        const msgs = messagesRef.current;
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        const msgEl = lastUser ? messageRefs.current[lastUser.id] : null;
        if (!msgEl) return prev;
        // Read the live footer height so a container resize always commits a
        // matched (responseAreaMinHeight, footerH) pair even mid-InputBar
        // animation; the footer RO above keeps footerH itself in sync.
        const liveFooterH = footerRef.current?.offsetHeight ?? 0;
        return Math.max(
          0,
          c.clientHeight - TARGET_VISUAL_OFFSET - msgEl.offsetHeight - MESSAGE_GAP - liveFooterH,
        );
      });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    const lastUserEl = lastUserMessageId ? messageRefs.current[lastUserMessageId] : null;
    if (lastUserEl) ro.observe(lastUserEl);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, lastUserMessageId]);

  // ── Keep needsScrollPadding in sync with whether the reply CONTENT fits
  //    above the footer. Bidirectional: flips true when content outgrows the
  //    reserve (long reply, or footer grew), and flips back false when it fits
  //    again (footer shrank / tool chip removed). Measures the inner content
  //    wrapper so the comparison is independent of the minHeight/paddingBottom
  //    we conditionally apply to the outer block — avoids feedback loops.
  useEffect(() => {
    if (responseAreaMinHeight === undefined) return;
    const el = lastAssistantContentRef.current;
    if (!el) return;
    const check = () => {
      const contentH = el.offsetHeight;
      const fits = contentH <= responseAreaMinHeight + 5;
      setNeedsScrollPadding((prev) => (prev === !fits ? prev : !fits));
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [messages, responseAreaMinHeight, streaming, footerH]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const stopThinking = useCallback(() => {
    if (thinkTimer.current) { clearInterval(thinkTimer.current); thinkTimer.current = null; }
    isThinkingRef.current = false;
    setIsThinking(false);
  }, []);

  const resolveModel = useCallback(() => {
    const all = [
      ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
      ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
      ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
      ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' as const })),
      ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' as const })),
      ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' as const })),
    ];
    const sel = all.find((m) => m.id === selectedModelId);
    const provider = (sel?.provider ?? 'gemini') as 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai';
    const model = sel?.modelId ?? modelConfig?.gemini?.model ?? 'gemini-3.6-flash';
    const thinkingLevel: number = sel?.thinkingLevel ?? modelConfig?.[provider]?.thinkingLevel ?? 0;
    const apiKey: string | undefined = apiKeys?.[provider]?.[0];
    const effortLabel = sel && thinkingLevel > 0 ? getThinkingEffortLabel(sel) : '';
    const baseLabel = getShortModelName(sel?.name || model);
    const modelLabel = `${baseLabel}${effortLabel ? ` ${effortLabel}` : ''}`;
    return { provider, model, thinkingLevel, apiKey, modelLabel };
  }, [modelConfig, selectedModelId, apiKeys]);

  const newId = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2);

  const finalizeAssistant = (
    id: string,
    content: string,
    thinkingTime?: number,
    isError = false
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, content, thinkingTime, isError, isGenerating: false }
          : m
      )
    );
  };

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text: string, historyOverride?: ChatMsg[]) => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating || sendInFlightRef.current) return;
      if (!isAuthenticated) { onAuthRequired?.(); return; }

      const { provider, model, thinkingLevel, apiKey, modelLabel } = resolveModel();
      sendInFlightRef.current = true;
      if (streamingClearRafRef.current !== null) {
        cancelAnimationFrame(streamingClearRafRef.current);
        streamingClearRafRef.current = null;
      }
      const isBrandNewConversation = historyOverride === undefined && messages.length === 0;

      const userMsg: ChatMsg = { id: newId(), role: 'user', content: trimmed, isNew: true };
      const assistantId = newId();
      const assistantPlaceholder: ChatMsg = {
        id: assistantId,
        role: 'assistant',
        content: '',
        isGenerating: true,
        modelSnapshot: {
          provider,
          modelId: model,
          label: modelLabel,
          thinkingLevel,
        },
      };

      const prevMessages = historyOverride ?? messages;
      setMessages([...prevMessages, userMsg, assistantPlaceholder]);

      if (!isIncognito && isLocalFolderConnected && isBrandNewConversation) {
        // Initialize the local chat with the temporary ID so it shows up as a skeleton loader in the sidebar immediately!
        void saveLocalFSChat(chatSessionId, [userMsg], null);
      }

      setIsGenerating(true);
      setIsThinking(true);
      setThinkingPhase('thinking');
      isThinkingRef.current = true;
      setThinkSeconds(0);
      thinkSecondsRef.current = 0;
      setStreaming('');
      thinkStart.current = Date.now();
      if (thinkTimer.current) clearInterval(thinkTimer.current);
      thinkTimer.current = setInterval(() => {
        const s = Math.ceil((Date.now() - thinkStart.current) / 1000);
        thinkSecondsRef.current = s;
        setThinkSeconds(s);
      }, 1000);

      if (!apiKey) {
        sendInFlightRef.current = false;
        stopThinking();
        setIsGenerating(false);
        finalizeAssistant(
          assistantId,
          `API key for **${provider}** is missing. Add one in **Settings → Models** to start chatting.`,
          undefined,
          true
        );
        return;
      }

      const history: AiChatMessage[] = [...prevMessages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let acc = '';
      let thoughtAcc = '';
      try {
        await streamChat(
          history,
          // Chat mode: search grounding + native code execution both offered.
          {
            provider,
            model,
            apiKey,
            thinkingLevel,
            includeThoughts: thinkingLevel > 0,
            enableSearch: true,
            enableCodeExecution: true,
            baseUrl: (modelConfig as any)?.[provider]?.baseUrl,
          },
          (token) => {
            if (isThinkingRef.current) {
              const elapsed = Math.max(1, Math.ceil((Date.now() - thinkStart.current) / 1000));
              thinkSecondsRef.current = elapsed;
              setThinkSeconds(elapsed);
              stopThinking();
            }
            acc += token;
            // The provider callbacks can be drained from an already-buffered SSE
            // response in a tight microtask chain. Force each accumulated value
            // into React before the final message/cleanup updates can absorb it.
            flushSync(() => setStreaming(acc));
          },
          () => {},
          CHAT_SYSTEM_PROMPT,
          (phase) => {
            // Keep the shimmer row live with the right label until real text
            // streams. 'responding' is handled by the onToken branch above.
            if (phase !== 'responding') setThinkingPhase(phase);
          },
          undefined,
          (thoughtChunk) => {
            thoughtAcc += thoughtChunk;
            setMessages((prev) => prev.map((message) =>
              message.id === assistantId
                ? { ...message, thinkingText: thoughtAcc }
                : message
            ));
          },
        );
        // Give the browser one generating-state paint after the final delta. If
        // finalisation happens in the same task, React can otherwise replace the
        // streaming buffer with the completed message before it was ever shown.
        await waitForBrowserPaint();
        finalizeAssistant(assistantId, acc, thinkSecondsRef.current);
      } catch (e: any) {
        finalizeAssistant(
          assistantId,
          `Something went wrong: ${e?.message || 'Unknown error.'}`,
          undefined,
          true
        );
      } finally {
        sendInFlightRef.current = false;
        stopThinking();
        // Keep the final streaming value alive through the completion commit.
        // The completed message now owns the same text, so clearing next frame is
        // visually lossless and cannot erase the last delta before paint.
        streamingClearRafRef.current = requestAnimationFrame(() => {
          streamingClearRafRef.current = null;
          setStreaming('');
        });
        setIsGenerating(false);
      }
    },
    [messages, isGenerating, isAuthenticated, onAuthRequired, resolveModel, stopThinking, isIncognito, isLocalFolderConnected, saveLocalFSChat, chatSessionId, modelConfig]
  );

  // ── Live mode ──────────────────────────────────────────────────────────────
  // A live "turn" maps onto the exact same message shape as a typed turn:
  //   • onTurnStart    → push user bubble (isTranscribing) + assistant placeholder
  //                       in ONE setMessages — same as handleSend — so the
  //                       scroll-to-top useLayoutEffect + flushSync reserve fire
  //                       identically and all spacing rules hold.
  //   • onUserTranscript → fill the user bubble's `content`, drop isTranscribing
  //   • onModelText      → append to `streaming` (same render path as typed)
  //   • onTurnComplete   → finalizeAssistant + clear streaming, ready for next
  //                       utterance; session stays open.
  const openLiveTurn = useCallback(() => {
    if (streamingClearRafRef.current !== null) {
      cancelAnimationFrame(streamingClearRafRef.current);
      streamingClearRafRef.current = null;
    }
    const userId = newId();
    const assistantId = newId();
    liveTurnRef.current = { userId, assistantId, acc: '' };

    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: '', isTranscribing: true, isNew: true },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        isGenerating: true,
        isLive: true,
        modelSnapshot: {
          provider: 'gemini',
          modelId: LIVE_MODEL_ID,
          label: '3.1 Flash Live',
          thinkingLevel: 0,
        },
      },
    ]);

    // Live turns are real-time: no "Thinking" shimmer, no "Thought for Xs".
    // Keep isGenerating so the streaming render path + action-row gate work,
    // but leave the think timer alone.
    setIsGenerating(true);
    setIsThinking(false);
    isThinkingRef.current = false;
    setStreaming('');
  }, []);

  const closeLiveTurn = useCallback(
    (opts?: { error?: string; aborted?: boolean }) => {
      const turn = liveTurnRef.current;
      liveTurnRef.current = null;
      stopThinking();
      setIsGenerating(false);
      if (!turn) return;
      // If neither a transcript nor a model token ever arrived (e.g. mic blip),
      // drop the empty pair rather than leave dangling bubbles.
      if (!opts?.error && turn.acc.length === 0) {
        let hadTranscript = false;
        setMessages((prev) => {
          hadTranscript = !!prev.find((m) => m.id === turn.userId)?.content;
          return hadTranscript
            ? prev
            : prev.filter((m) => m.id !== turn.userId && m.id !== turn.assistantId);
        });
        // If we removed them, also drop the reserve + scroll bookkeeping so the
        // next real turn re-runs the sweep from scratch.
        if (!hadTranscript) {
          lastScrolledUserId.current = null;
          setResponseAreaMinHeight(undefined);
        }
        if (!hadTranscript) {
          streamingClearRafRef.current = requestAnimationFrame(() => {
            streamingClearRafRef.current = null;
            setStreaming('');
          });
          return;
        }
      }
      // Interrupted: the text released so far is exactly what was *spoken*
      // (the audio-synced drain dropped everything after the barge-in point).
      // Append an em-dash so it reads as cut-off, and flag the message so the
      // render skips the like/dislike/copy row — and so any later typed turn
      // sends only the spoken-so-far text as context.
      const finalText = opts?.error
        ? opts.error
        : opts?.aborted && turn.acc
          ? `${turn.acc.replace(/\s+$/, '')} —`
          : turn.acc;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === turn.userId
            ? { ...m, isTranscribing: false, content: m.content || '…' }
            : m.id === turn.assistantId
              ? {
                  ...m,
                  content: finalText,
                  isGenerating: false,
                  isError: !!opts?.error,
                  wasInterrupted: !!opts?.aborted,
                  thinkingTime: undefined,
                }
              : m
        )
      );
      streamingClearRafRef.current = requestAnimationFrame(() => {
        streamingClearRafRef.current = null;
        setStreaming('');
      });
    },
    [stopThinking]
  );

  const handleStopLive = useCallback(() => {
    // Falling two-note earcon = "done listening". Only on explicit user stop —
    // error closes stay silent.
    playLiveChime('end');
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    setIsLive(false);
    // If the model was mid-reply, treat stop as an interruption: `turn.acc` is
    // exactly what was *heard* (audio-synced release already dropped anything
    // unspoken), so finalise with the trailing `—` just like a barge-in.
    if (liveTurnRef.current) closeLiveTurn({ aborted: true });
  }, [closeLiveTurn]);

  const handleStartLive = useCallback(() => {
    if (isLive || isGenerating) return;
    if (!isAuthenticated) { onAuthRequired?.(); return; }

    const apiKey: string | undefined = apiKeys?.gemini?.[0];
    if (!apiKey) {
      // Surface the same friendly inline error style as typed chat.
      const uId = newId();
      const aId = newId();
      setMessages((prev) => [
        ...prev,
        { id: uId, role: 'user', content: 'Start live voice chat', isNew: true },
        {
          id: aId,
          role: 'assistant',
          content:
            'A **Gemini** API key is required for live voice mode ' +
            `(\`${LIVE_MODEL_ID}\`). Add one in **Settings → Models**.`,
          isError: true,
        },
      ]);
      return;
    }

    // Still inside the click gesture: create/resume the chime AudioContext and
    // kick off both fetches so the start cue is decoded before onOpen fires.
    primeLiveChimes();

    setIsLive(true);

    // Prime the live model with everything already in the thread so a mid-chat
    // voice session has full context. Read from the ref (fresh) not the
    // closed-over `messages`.
    const history: LiveHistoryTurn[] = messagesRef.current
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.content,
      }));

    const session = new GeminiLiveSession({
      apiKey,
      model: LIVE_MODEL_ID,
      systemPrompt: CHAT_SYSTEM_PROMPT,
      history,
      // Rising two-note earcon the moment the socket ACKs setup + mic is hot —
      // i.e. the exact instant it's actually listening.
      onOpen: () => playLiveChime('start'),
      onTurnStart: () => openLiveTurn(),
      onUserTranscript: (full) => {
        const turn = liveTurnRef.current;
        if (!turn) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === turn.userId ? { ...m, content: full, isTranscribing: false } : m
          )
        );
      },
      onModelText: (chunk) => {
        const turn = liveTurnRef.current;
        if (!turn) return;
        // `chunk` is released by live.ts only when its audio is actually being
        // spoken, so `turn.acc` == what the user has *heard* so far.
        turn.acc += chunk;
        flushSync(() => setStreaming(turn.acc));
      },
      onTurnComplete: ({ aborted }) => closeLiveTurn({ aborted }),
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error('[DashboardChat] live error', err);
        if (liveTurnRef.current) {
          // Mid-turn failure → finalise the in-flight assistant bubble with the error.
          closeLiveTurn({ error: `Live session error: ${err.message}` });
        } else {
          // Connect/setup failed before any speech. closeLiveTurn() would
          // early-return (no turn), leaving the user staring at a silent
          // bounce back to the empty state. Push an explicit error pair so
          // the scroll/reserve machinery has something to anchor on AND the
          // user can read what went wrong.
          const uId = newId();
          const aId = newId();
          setMessages((prev) => [
            ...prev,
            { id: uId, role: 'user', content: 'Start live voice chat', isNew: true },
            {
              id: aId,
              role: 'assistant',
              isError: true,
              content:
                `Couldn't start live mode (\`${LIVE_MODEL_ID}\`).\n\n` +
                `> ${err.message}\n\n` +
                'Check that your Gemini key has **Live API** access and that ' +
                'microphone permission was granted.',
            },
          ]);
        }
        liveSessionRef.current = null;
        setIsLive(false);
      },
      onClose: () => {
        // onError (above) already handled the unhappy path; a clean close just
        // drops back to typed mode.
        liveSessionRef.current = null;
        setIsLive(false);
      },
    });
    liveSessionRef.current = session;
    void session.start();
  }, [
    isLive,
    isGenerating,
    isAuthenticated,
    onAuthRequired,
    apiKeys,
    openLiveTurn,
    closeLiveTurn,
    stopThinking,
  ]);

  // Tear down the socket + mic if the component unmounts mid-session.
  useEffect(() => () => { liveSessionRef.current?.stop(); }, []);

  const handleCopy = (msg: ChatMsg) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId((id) => (id === msg.id ? null : id)), 1600);
  };

  const handleListen = (msg: ChatMsg) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (listeningId === msg.id) {
      setListeningId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(msg.content);
    utterance.onend = () => setListeningId((id) => (id === msg.id ? null : id));
    utterance.onerror = () => setListeningId((id) => (id === msg.id ? null : id));
    setListeningId(msg.id);
    window.speechSynthesis.speak(utterance);
  };

  const handleRegenerate = (assistantId: string) => {
    if (isGenerating) return;
    const assistantIndex = messages.findIndex((message) => message.id === assistantId);
    if (assistantIndex < 1) return;
    const userIndex = messages.slice(0, assistantIndex).map((message) => message.role).lastIndexOf('user');
    if (userIndex < 0) return;

    const userMessage = messages[userIndex];
    stopListening();
    setOpenThinkingMessageId(null);
    void handleSend(userMessage.content, messages.slice(0, userIndex));
  };

  const startEditing = (msg: ChatMsg) => {
    if (isGenerating) return;
    setEditingUserId(msg.id);
    setEditDraft(msg.content);
  };

  const submitEdit = (messageId: string) => {
    const trimmed = editDraft.trim();
    if (!trimmed || isGenerating) return;
    const userIndex = messages.findIndex((message) => message.id === messageId);
    if (userIndex < 0) return;

    stopListening();
    setEditingUserId(null);
    setEditDraft('');
    setOpenThinkingMessageId(null);
    void handleSend(trimmed, messages.slice(0, userIndex));
  };

  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  // EMPTY STATE — render the *actual* HeroSection + BottomPanel so the layout
  // is literally the same component tree as Develop mode (single source of
  // truth for prompt-box position). Only `onPromptSubmit` differs: it starts
  // an in-dashboard chat instead of navigating to Staging.
  if (!hasStarted) {
    return (
      <div className="flex flex-col min-h-full">
        <HeroSection
          initialMode="chat"
          onPromptSubmit={(prompt) => handleSend(prompt)}
          onStartLive={handleStartLive}
          modelConfig={modelConfig}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          onAuthRequired={onAuthRequired}
          isAuthenticated={isAuthenticated}
          isIncognito={isIncognito}
        />
        {isAuthenticated && (
          <div className="pb-20">
            <BottomPanel onOpenDriveSettings={onOpenDriveSettings} />
          </div>
        )}
      </div>
    );
  }

  // ACTIVE STATE — ChatGPT-style thread with bottom-docked input
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const latestConversationMessageId = [...messages]
    .reverse()
    .find((m) => m.role === 'user' || m.role === 'assistant')?.id;
  const thinkingMessage = openThinkingMessageId
    ? messages.find((message) => message.id === openThinkingMessageId && message.role === 'assistant')
    : undefined;

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <div
        className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col transition-[margin-right] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
          thinkingMessage ? 'min-[1024px]:mr-[428px]' : 'mr-0'
        }`}
      >
      {/* Scrollable message thread
          scrollbar-gutter:stable keeps the mx-auto column from nudging left
          the moment streamed content grows tall enough to spawn a scrollbar. */}
      <div
        ref={chatScrollRef}
        className="gemini-chat-scrollbar min-h-0 flex-1 overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.15 }}
          className={`mx-auto flex w-full max-w-[760px] flex-col pl-7 pr-7 pt-20 transition-[padding-left] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
            thinkingMessage ? 'min-[1024px]:pl-9' : ''
          }`}
          style={{
            paddingBottom:
              responseAreaMinHeight !== undefined && !needsScrollPadding ? 0 : footerH,
          }}
        >
          {isIncognito && (
            <div className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-white/5 border border-white/5 text-zinc-400 text-[12px] font-medium rounded-full w-fit mx-auto select-none backdrop-blur-md">
              <Glasses size={13} className="text-zinc-400" />
              <span>Incognito Mode — Temporary Session</span>
            </div>
          )}
          {messages.map((msg, messageIndex) => {
            const previousMessage = messages[messageIndex - 1];
            const gapBefore = messageIndex === 0
              ? (isIncognito ? THREAD_GAP : 0)
              : previousMessage?.role === 'user' && msg.role === 'assistant'
                ? MESSAGE_GAP
                : THREAD_GAP;

            if (msg.role === 'user') {
              const isLastUser = msg.id === lastUserMessageId;
              return (
                <motion.div
                  key={msg.id}
                  ref={(el) => { messageRefs.current[msg.id] = el; }}
                  initial={msg.isNew ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="group relative flex justify-end"
                  style={{ marginTop: gapBefore }}
                >
                  {editingUserId === msg.id ? (
                    <form
                      className="w-full max-w-[508px] rounded-[28px] bg-[#141414] p-4 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
                      style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitEdit(msg.id);
                      }}
                    >
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        rows={3}
                        className="gemini-chat-scrollbar min-h-[72px] w-full resize-none bg-transparent px-3 py-2 text-[17px] font-normal leading-6 text-[#e3e3e3] outline-none"
                        aria-label="Edit prompt"
                      />
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUserId(null);
                            setEditDraft('');
                          }}
                          className="h-9 rounded-full px-4 text-[14px] font-medium text-[#c4c7c5] transition-colors hover:bg-white/[0.08]"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!editDraft.trim()}
                          className="h-9 rounded-full bg-[#d3e3fd] px-4 text-[14px] font-medium text-[#041e49] transition-colors hover:bg-[#e0ebff] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Update
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <UserMessageBubble
                        content={msg.content}
                        isTranscribing={msg.isTranscribing}
                      />
                      {!msg.isTranscribing && (
                        <div className="gemini-user-actions pointer-events-none absolute right-0 top-full flex h-10 items-start pt-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => handleCopy(msg)}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-[#e6e6e6] transition-colors hover:bg-white/[0.08] hover:text-[#e6e6e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                            aria-label="Copy prompt"
                            title="Copy prompt"
                          >
                            <MaterialSymbol
                              family="luminous"
                              name={copiedId === msg.id ? 'check' : 'copy'}
                              size={24}
                              weight={copiedId === msg.id ? 400 : 300}
                              roundness={100}
                              opticalSize={24}
                            />
                          </button>
                          {isLastUser && (
                            <button
                              type="button"
                              onClick={() => startEditing(msg)}
                              className="flex h-9 w-9 items-center justify-center rounded-full text-[#e6e6e6] transition-colors hover:bg-white/[0.08] hover:text-[#e6e6e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                              aria-label="Edit"
                              title="Edit"
                            >
                              <MaterialSymbol family="luminous" name="edit" size={24} weight={300} roundness={100} opticalSize={24} />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              );
            }

            // Assistant — single persistent element across thinking → streaming → done.
            const generating = !!msg.isGenerating;
            // While generating, body comes from the live `streaming` buffer; once
            // finalised, `msg.content` holds the full text. Using `||` (not a
            // ternary) means the instant generation flips off we keep rendering
            // the same string, so StreamingMarkdown's RAF buffer can finish
            // draining without a content swap.
            const bodyText = generating ? streaming : msg.content || streaming;
            // Live turns: no "Thinking" shimmer, no "Thought for Xs" — the
            // voice starts near-instantly so the row is noise.
            const showThinkingRow =
              !msg.isError &&
              !msg.isLive &&
              generating &&
              bodyText.trim().length === 0;
            const isLastAssistant = msg.id === lastAssistantId;
            const isLatestCompletedTurn = !generating && msg.id === latestConversationMessageId;

            return (
              <div
                key={msg.id}
                ref={(el) => { messageRefs.current[msg.id] = el; }}
                className="group/assistant-response"
                style={{
                  marginTop: gapBefore,
                  ...(isLastAssistant && responseAreaMinHeight !== undefined
                    ? {
                        // Reserve exactly the visible area below the user bubble.
                        // paddingBottom = footer height so the action row clears
                        // the input overlay by the same 32px (h-8 gradient) that
                        // separates action-row → suggestions in Staging.
                        minHeight: !needsScrollPadding
                          ? responseAreaMinHeight + footerH
                          : undefined,
                        paddingBottom: !needsScrollPadding ? footerH : undefined,
                      }
                    : {}),
                }}
              >
                {/* Inner wrapper = pure content height, unaffected by the outer
                    minHeight/paddingBottom. Measured for the overflow check. */}
                <div
                  ref={isLastAssistant ? lastAssistantContentRef : undefined}
                  className="space-y-3"
                >
                {showThinkingRow && (() => {
                  const active = generating && isThinking;
                  const phaseSymbol =
                    active && thinkingPhase === 'searching' ? 'search'
                    : active && thinkingPhase === 'executing' ? 'terminal'
                    : 'lightbulb';
                  const phaseLabel =
                    thinkingPhase === 'searching' ? 'Searching'
                    : thinkingPhase === 'executing' ? 'Running code'
                    : 'Thinking';
                  return (
                    <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                      {thinkingPhase === 'thinking' ? (
                        <GeminiThinkingVisualizer />
                      ) : (
                        <MaterialSymbol name={phaseSymbol} size={18} opticalSize={20} />
                      )}
                      {active ? (
                        <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                          {phaseLabel}
                        </TextShimmer>
                      ) : (
                        <span className="text-[15.15px] font-medium">{phaseLabel}</span>
                      )}
                    </div>
                  );
                })()}

                {bodyText && (
                  <StreamingMarkdown
                    text={bodyText}
                    isStreaming={generating}
                    animate={generating && !msg.isError}
                  />
                )}

                {/* Action row — fades in only after completion to avoid layout jump */}
                <motion.div
                  initial={false}
                  animate={{
                    height: generating ? 0 : 'auto',
                  }}
                  transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                  className={`overflow-visible transition-opacity duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] ${
                    generating
                      ? 'pointer-events-none opacity-0'
                      : isLatestCompletedTurn
                        ? 'opacity-100'
                        : 'pointer-events-none opacity-0 group-hover/assistant-response:pointer-events-auto group-hover/assistant-response:opacity-100 group-focus-within/assistant-response:pointer-events-auto group-focus-within/assistant-response:opacity-100'
                  }`}
                >
                  <ResponseActions
                    reaction={reactions[msg.id] || null}
                    copied={copiedId === msg.id}
                    listening={listeningId === msg.id}
                    canRedo={isLastAssistant}
                    canShowThinking={!msg.isError}
                    onLike={() => setReactions((current) => ({
                      ...current,
                      [msg.id]: current[msg.id] === 'like' ? null : 'like',
                    }))}
                    onDislike={() => setReactions((current) => ({
                      ...current,
                      [msg.id]: current[msg.id] === 'dislike' ? null : 'dislike',
                    }))}
                    onRedo={() => handleRegenerate(msg.id)}
                    onCopy={() => handleCopy(msg)}
                    onListen={() => handleListen(msg)}
                    onShowThinking={() => setOpenThinkingMessageId(msg.id)}
                  />
                </motion.div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>

      {/* Bottom-docked input (footer). h-8 gradient matches Staging so the gap
          action-row → input-top here == action-row → suggestions-top there. */}
      <motion.div
        ref={footerRef}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', duration: 0.55, bounce: 0.15 }}
        className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pointer-events-none"
      >
        <div
          className="h-8 w-full max-w-[820px]"
          style={{
            backgroundColor: 'var(--dashboard-surface)',
            WebkitMaskImage: 'linear-gradient(to top, black 20%, transparent)',
            maskImage: 'linear-gradient(to top, black 20%, transparent)',
          }}
        />
        <div
          className="w-full flex justify-center px-4 pb-[53px] pointer-events-auto bg-[var(--dashboard-surface)]"
        >
          <InputBar
            chatVariant
            showDisclaimer
            currentMode="chat"
            onModeChange={() => {}}
            onSubmit={(prompt) => {
              // Typing + Enter while live implicitly ends the voice session and
              // falls back to the regular typed path.
              if (isLive) handleStopLive();
              handleSend(prompt);
            }}
            liveActive={isLive}
            onStartLive={handleStartLive}
            onStopLive={handleStopLive}
            modelConfig={modelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            onAuthRequired={onAuthRequired}
            isAuthenticated={isAuthenticated}
          />
        </div>
      </motion.div>
      </div>

      <AnimatePresence>
        {thinkingMessage && (
          <ThinkingStepsSidebar
            key={thinkingMessage.id}
            thinkingText={thinkingMessage.thinkingText || ''}
            modelLabel={thinkingMessage.modelSnapshot?.label || 'Model'}
            onClose={() => setOpenThinkingMessageId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default DashboardChat;
