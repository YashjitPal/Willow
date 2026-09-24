import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import {
  Sparkles,
  Heart,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  RefreshCw,
  LayoutGrid,
  Settings,
  X,
  ChevronDown,
  User,
  Bot,
  Sliders,
  Check,
  Flame,
} from 'lucide-react';
import { useThemeMode } from '@willow/core/theme-mode';
import { Live2DStage } from './Live2DStage';
import { WAIFU_MODELS, DEFAULT_MODEL, Live2DModelMeta } from './waifu-models';
import { WAIFU_PERSONAS, WaifuPersona, extractEmotion } from './waifu-personas';
import {
  activeModelStore,
  activePersonaStore,
  currentEmotionStore,
  waifuSettingsStore,
  waifuHistoryStore,
  setActiveModel,
  setActivePersona,
  updateWaifuSettings,
  appendWaifuMessage,
  clearWaifuHistory,
  WaifuMessage,
} from './waifu-store';
import { speakWithLipSync, stopSpeaking, startLipSyncFromAnalyser, stopLipSync, isLipSyncActive } from './waifu-audio';
import { generateWaifuReply, resolveWaifuModelTarget } from './waifu-engine';
import { GeminiLiveSession, LiveHistoryTurn } from '@willow/ai/live';
import { useProviderSettings } from '../settings/use-provider-settings';

interface WaifuViewProps {
  modelConfig?: any;
  setModelConfig?: React.Dispatch<React.SetStateAction<any>>;
}

export const WaifuView: React.FC<WaifuViewProps> = ({
  modelConfig = {},
  setModelConfig = () => {},
}) => {
  const { isLight } = useThemeMode();
  const { providerState } = useProviderSettings(setModelConfig);

  const activeModel = useStore(activeModelStore);
  const activePersona = useStore(activePersonaStore);
  const currentEmotion = useStore(currentEmotionStore);
  const settings = useStore(waifuSettingsStore);
  const history = useStore(waifuHistoryStore);

  const [inputPrompt, setInputPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isPersonaOpen, setIsPersonaOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [customModelUrl, setCustomModelUrl] = useState('');

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Auto-scroll chat history on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [history, streamingText]);

  // Current selected waifu model from system defaults (or live default)
  const currentWaifuModelId = modelConfig?.systemDefaults?.waifuModel || 'gemini-3.8-live';
  const target = resolveWaifuModelTarget(currentWaifuModelId, modelConfig, providerState);

  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  const lipSyncCleanupRef = useRef<(() => void) | null>(null);
  const liveTurnOpenRef = useRef(false);
  const liveAccRef = useRef('');
  const [isLiveVoiceActive, setIsLiveVoiceActive] = useState(false);

  // Initialize Speech Recognition for fallback dictation input if supported
  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      speechRecognitionRef.current = recognition;
    }

    return () => {
      try {
        liveSessionRef.current?.stop();
      } catch {}
      lipSyncCleanupRef.current?.();
      stopSpeaking();
    };
  }, []);

  const ensureLiveLipSync = (session: GeminiLiveSession | null) => {
    if (!session?.outputAnalyser) return;
    if (!isLipSyncActive()) {
      lipSyncCleanupRef.current?.();
      lipSyncCleanupRef.current = startLipSyncFromAnalyser(session.outputAnalyser);
    }
  };

  const startOrGetLiveSession = async (withMic: boolean): Promise<GeminiLiveSession> => {
    if (liveSessionRef.current && liveSessionRef.current.isActive) {
      if (withMic && !liveSessionRef.current.hasMic) {
        // Upgrade from typed-only to mic session
        try {
          liveSessionRef.current.stop();
        } catch {}
        liveSessionRef.current = null;
      } else {
        if (withMic && liveSessionRef.current.isMicMuted) {
          liveSessionRef.current.setMicMuted(false);
        }
        ensureLiveLipSync(liveSessionRef.current);
        return liveSessionRef.current;
      }
    }

    if (liveSessionRef.current) {
      try {
        liveSessionRef.current.stop();
      } catch {}
      liveSessionRef.current = null;
    }
    lipSyncCleanupRef.current?.();
    lipSyncCleanupRef.current = null;

    const currentHistory = waifuHistoryStore.get();
    const historyTurns: LiveHistoryTurn[] = currentHistory.slice(-8).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      text: m.text,
    }));

    const session = new GeminiLiveSession({
      apiKey: target.apiKey,
      model: target.liveVoiceModelId,
      systemPrompt: activePersona.systemPrompt,
      voiceName: settings.liveVoice || 'Aoede',
      history: historyTurns,
      disableMic: !withMic,
      onOpen: () => {
        ensureLiveLipSync(session);
      },
      onTurnStart: () => {
        liveTurnOpenRef.current = true;
        liveAccRef.current = '';
        setIsGenerating(true);
        setStreamingText('');
        ensureLiveLipSync(session);
      },
      onModelText: (chunk) => {
        if (!liveTurnOpenRef.current) {
          liveTurnOpenRef.current = true;
          liveAccRef.current = '';
          setIsGenerating(true);
        }
        liveAccRef.current += chunk;
        setStreamingText(liveAccRef.current);
        ensureLiveLipSync(session);
      },
      onTurnComplete: ({ aborted }) => {
        const fullResponse = liveAccRef.current.trim();
        liveTurnOpenRef.current = false;
        liveAccRef.current = '';
        setIsGenerating(false);
        setStreamingText('');

        if (fullResponse && !aborted) {
          const emotion = extractEmotion(fullResponse);
          currentEmotionStore.set(emotion);
          appendWaifuMessage({
            role: 'assistant',
            text: fullResponse,
            emotion,
          });
        }
      },
      onError: () => {
        setIsGenerating(false);
        setIsLiveVoiceActive(false);
        lipSyncCleanupRef.current?.();
        lipSyncCleanupRef.current = null;
      },
      onClose: () => {
        setIsGenerating(false);
        setIsLiveVoiceActive(false);
        lipSyncCleanupRef.current?.();
        lipSyncCleanupRef.current = null;
      },
    });

    liveSessionRef.current = session;
    await session.start();
    return session;
  };

  const toggleListening = () => {
    if (!speechRecognitionRef.current) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    if (isListening) {
      speechRecognitionRef.current.stop();
      setIsListening(false);
    } else {
      stopSpeaking();
      try {
        speechRecognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  const toggleLiveVoiceMode = async () => {
    if (isLiveVoiceActive) {
      try {
        liveSessionRef.current?.stop();
      } catch {}
      liveSessionRef.current = null;
      lipSyncCleanupRef.current?.();
      lipSyncCleanupRef.current = null;
      setIsLiveVoiceActive(false);
      setIsGenerating(false);
      setStreamingText('');
    } else {
      stopSpeaking();
      try {
        setIsLiveVoiceActive(true);
        const session = await startOrGetLiveSession(true);
        ensureLiveLipSync(session);
      } catch {
        setIsLiveVoiceActive(false);
      }
    }
  };

  const handleFallbackSend = async (text: string) => {
    setIsGenerating(true);
    setStreamingText('');

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    try {
      const currentHistory = waifuHistoryStore.get();
      const contextMessages = currentHistory.slice(-8).map((m) => ({
        role: m.role,
        content: m.text,
      }));

      const result = await generateWaifuReply({
        messages: contextMessages,
        systemPrompt: activePersona.systemPrompt,
        waifuModelId: currentWaifuModelId,
        modelConfig,
        providerState,
        signal: abortCtrl.signal,
        onToken: (token) => {
          setStreamingText((prev) => prev + token);
        },
      });

      currentEmotionStore.set(result.emotion);
      appendWaifuMessage({
        role: 'assistant',
        text: result.text,
        emotion: result.emotion,
      });

      setStreamingText('');

      if (settings.voiceEnabled) {
        void speakWithLipSync(result.text, {
          pitch: settings.voicePitch,
          rate: settings.voiceRate,
          volume: settings.voiceVolume,
        });
      }
    } catch (err: any) {
      if (!abortCtrl.signal.aborted) {
        const errorReply = "I had a momentary glitch, but I'm still right here with you! Could you say that again? ✨";
        appendWaifuMessage({
          role: 'assistant',
          text: errorReply,
          emotion: 'thoughtful',
        });
        if (settings.voiceEnabled) {
          void speakWithLipSync(errorReply, {
            pitch: settings.voicePitch,
            rate: settings.voiceRate,
            volume: settings.voiceVolume,
          });
        }
      }
    } finally {
      setIsGenerating(false);
      setStreamingText('');
      abortControllerRef.current = null;
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim();
    if (!text) return;
    if (isGenerating) {
      // Auto-recover if stuck in generating state without active streaming
      if (!streamingText && !abortControllerRef.current && !liveTurnOpenRef.current) {
        setIsGenerating(false);
      } else {
        return;
      }
    }

    setInputPrompt('');
    stopSpeaking();

    // 1. Append user message
    appendWaifuMessage({
      role: 'user',
      text,
    });

    // 2. If the active Waifu model is a Live voice model and API key is present:
    // Route directly into Gemini Live session so the model streams native neural audio (Aoede/Fenrir)
    // with true audio-driven lip sync, matching Ani from xAI!
    if (target.isLive && target.apiKey) {
      setIsGenerating(true);
      setStreamingText('');
      try {
        const session = await startOrGetLiveSession(isLiveVoiceActive);
        ensureLiveLipSync(session);
        session.sendText(text);
        return;
      } catch {
        // Fall back to standard chat pipeline below if live session fails
      }
    }

    // 3. Fallback conversational reply pipeline: generates AI response, streams tokens, updates emotion & history, and speaks with lip-sync
    await handleFallbackSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    try {
      liveSessionRef.current?.interrupt();
    } catch {}
    stopSpeaking();
    setIsGenerating(false);
    setStreamingText('');
  };

  const handleAddCustomModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customModelUrl.trim()) return;
    const name = customModelUrl.split('/').pop()?.replace('.model3.json', '') || 'Custom Model';
    const customMeta: Live2DModelMeta = {
      id: `custom-${Date.now()}`,
      name,
      url: customModelUrl.trim(),
      image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/haru.png',
      series: 'Custom Model',
      description: 'Loaded from custom .model3.json URL.',
    };
    setActiveModel(customMeta);
    setCustomModelUrl('');
    setIsGalleryOpen(false);
  };

  return (
    <div className={`relative flex h-full w-full overflow-hidden ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-[#0f0f0f] text-zinc-100'}`}>
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* LEFT: Live2D Interactive Character Stage                                   */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      <div className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden border-r ${isLight ? 'border-zinc-200 bg-gradient-to-b from-pink-50/40 via-white to-zinc-50' : 'border-white/5 bg-gradient-to-b from-pink-950/10 via-[#111111] to-[#0a0a0a]'}`}>
        {/* Top Floating Controls Bar */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsGalleryOpen(true)}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium backdrop-blur-md transition-all shadow-sm ${
                isLight
                  ? 'bg-white/90 border border-zinc-200 hover:bg-white text-zinc-800'
                  : 'bg-zinc-900/80 border border-white/10 hover:bg-zinc-800 text-zinc-200'
              }`}
            >
              <LayoutGrid size={13} className="text-pink-500" />
              <span>{activeModel.name}</span>
              <ChevronDown size={12} className="text-zinc-400" />
            </button>

            <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-md ${
              isLight ? 'bg-pink-100/80 text-pink-700' : 'bg-pink-500/15 text-pink-400 border border-pink-500/20'
            }`}>
              <Sparkles size={11} />
              <span className="capitalize">{currentEmotion}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => updateWaifuSettings({ voiceEnabled: !settings.voiceEnabled })}
              title={settings.voiceEnabled ? 'Mute Voice' : 'Enable Voice'}
              className={`flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-all ${
                settings.voiceEnabled
                  ? isLight
                    ? 'bg-pink-500 text-white shadow-pink-500/20 shadow-sm'
                    : 'bg-pink-600 text-white shadow-pink-600/30 shadow-md'
                  : isLight
                    ? 'bg-white/80 border border-zinc-200 text-zinc-400'
                    : 'bg-zinc-900/80 border border-white/10 text-zinc-500'
              }`}
            >
              {settings.voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              title="Waifu Settings"
              className={`flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-all ${
                isLight
                  ? 'bg-white/80 border border-zinc-200 hover:bg-white text-zinc-700'
                  : 'bg-zinc-900/80 border border-white/10 hover:bg-zinc-800 text-zinc-300'
              }`}
            >
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Live2D Canvas Component */}
        <div className="relative flex-1 w-full h-full min-h-0 overflow-hidden">
          <Live2DStage
            modelUrl={activeModel.url}
            fallbackUrl={activeModel.fallbackUrl}
            modelName={activeModel.name}
            emotion={currentEmotion}
            particlesEnabled={settings.particlesEnabled}
            onResetModel={() => setActiveModel(DEFAULT_MODEL)}
          />
        </div>

        {/* Subtle Bottom Interaction Hint */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none rounded-full px-3 py-1 text-[11px] font-medium text-zinc-500/80 backdrop-blur-sm">
          Drag to move · Scroll to zoom · Double-click to center · Click to pet
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* RIGHT: Companion Chat Deck & Controls                                      */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      <div className={`flex w-[420px] max-w-[420px] flex-col h-full shrink-0 ${isLight ? 'bg-white' : 'bg-[#141414]'}`}>
        {/* Companion Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isLight ? 'border-zinc-200' : 'border-white/5'}`}>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsPersonaOpen(true)}
              className="group flex items-center gap-2 text-left"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-500/15 text-pink-500 text-base">
                {activePersona.avatar}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-semibold ${isLight ? 'text-zinc-900' : 'text-zinc-100'}`}>
                    {activePersona.name}
                  </span>
                  <span className="rounded bg-pink-500/15 px-1.5 py-0.2 text-[10px] font-medium text-pink-400">
                    {activePersona.badge}
                  </span>
                  <ChevronDown size={11} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                </div>
                <div className="text-[11px] text-zinc-500 truncate max-w-[170px]">
                  {activePersona.title}
                </div>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-1">
            {/* System Default Model Pill */}
            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium ${
              isLight ? 'bg-zinc-100 text-zinc-600' : 'bg-white/5 text-zinc-400 border border-white/5'
            }`}>
              <Bot size={11} className="text-pink-400" />
              <span className="truncate max-w-[100px]">{currentWaifuModelId}</span>
            </div>

            <button
              onClick={clearWaifuHistory}
              title="Reset Conversation"
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                isLight ? 'text-zinc-500 hover:bg-zinc-100' : 'text-zinc-400 hover:bg-white/5'
              }`}
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* Conversation Stream */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3.5 gemini-chat-scrollbar">
          {history.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-1.5 mb-1 px-1">
                {msg.role === 'assistant' ? (
                  <>
                    <Bot size={11} className="text-pink-400" />
                    <span className="text-[11px] font-medium text-pink-400">{activePersona.name}</span>
                    {msg.emotion && msg.emotion !== 'neutral' && (
                      <span className="text-[10px] text-zinc-500 italic">· *{msg.emotion}*</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-[11px] font-medium text-zinc-400">You</span>
                    <User size={11} className="text-zinc-400" />
                  </>
                )}
              </div>

              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed transition-all shadow-sm ${
                  msg.role === 'user'
                    ? isLight
                      ? 'bg-zinc-900 text-white rounded-br-xs'
                      : 'bg-white text-zinc-950 rounded-br-xs font-medium'
                    : isLight
                      ? 'bg-zinc-100 text-zinc-800 rounded-bl-xs border border-zinc-200/80'
                      : 'bg-[#1c1c1c] text-zinc-200 rounded-bl-xs border border-white/10'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {/* Streaming Response Bubble */}
          {isGenerating && streamingText && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5 mb-1 px-1">
                <Bot size={11} className="text-pink-400" />
                <span className="text-[11px] font-medium text-pink-400">{activePersona.name}</span>
                <span className="text-[10px] text-pink-400/80 animate-pulse">speaking...</span>
              </div>
              <div className={`max-w-[88%] rounded-2xl rounded-bl-xs px-3.5 py-2.5 text-xs leading-relaxed border ${
                isLight ? 'bg-zinc-100 text-zinc-800 border-zinc-200' : 'bg-[#1c1c1c] text-zinc-200 border-white/10'
              }`}>
                {streamingText}
                <span className="inline-block w-1.5 h-3 ml-0.5 bg-pink-500 animate-pulse align-middle" />
              </div>
            </div>
          )}

          {/* Suggested Starter Chips */}
          {history.length <= 1 && !isGenerating && (
            <div className="mt-4 space-y-1.5 pt-2">
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider px-1">
                Suggested topics
              </span>
              <div className="flex flex-col gap-1.5">
                {activePersona.suggestedPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => void handleSendMessage(prompt)}
                    className={`w-full text-left rounded-xl p-2.5 text-xs transition-all border ${
                      isLight
                        ? 'bg-zinc-50 hover:bg-pink-50/50 hover:border-pink-200 text-zinc-700 border-zinc-200/70'
                        : 'bg-[#191919] hover:bg-pink-950/20 hover:border-pink-500/30 text-zinc-300 border-white/5'
                    }`}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Composer */}
        <div className={`p-3 border-t ${isLight ? 'border-zinc-200 bg-white' : 'border-white/5 bg-[#141414]'}`}>
          <div className={`relative flex items-center rounded-2xl border transition-all ${
            isLight
              ? 'bg-zinc-50 border-zinc-200 focus-within:border-pink-400 focus-within:ring-2 focus-within:ring-pink-100'
              : 'bg-[#1a1a1a] border-white/10 focus-within:border-pink-500/50 focus-within:ring-1 focus-within:ring-pink-500/20'
          }`}>
            <textarea
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Talk with ${activePersona.name}...`}
              rows={1}
              className="w-full resize-none bg-transparent px-3.5 py-3 text-xs placeholder:text-zinc-500 focus:outline-none min-h-[42px] max-h-[120px]"
            />

            <div className="flex items-center gap-1 pr-2">
              <button
                type="button"
                onClick={target.isLive && target.apiKey ? toggleLiveVoiceMode : toggleListening}
                title={
                  target.isLive && target.apiKey
                    ? isLiveVoiceActive
                      ? 'Stop Live Voice Chat'
                      : 'Start Live Voice Chat (Continuous Speech & Lip-Sync)'
                    : isListening
                      ? 'Stop Listening'
                      : 'Voice Input (Microphone)'
                }
                className={`flex h-8 w-8 items-center justify-center rounded-xl transition-all ${
                  isLiveVoiceActive
                    ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30 animate-pulse ring-2 ring-pink-400'
                    : isListening
                      ? 'bg-red-500 text-white animate-pulse'
                      : isLight
                        ? 'text-zinc-500 hover:bg-zinc-200/70'
                        : 'text-zinc-400 hover:bg-white/10'
                }`}
              >
                {isLiveVoiceActive || isListening ? <MicOff size={15} /> : <Mic size={15} />}
              </button>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={handleStopGenerating}
                  title="Stop generating"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  <div className="h-2.5 w-2.5 bg-white rounded-xs" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSendMessage()}
                  disabled={!inputPrompt.trim()}
                  title="Send message"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-30 disabled:hover:bg-pink-600 transition-all shadow-sm shadow-pink-600/20"
                >
                  <Send size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* MODEL GALLERY MODAL OVERLAY                                                */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {isGalleryOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
          <div className={`flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl border overflow-hidden shadow-2xl ${
            isLight ? 'bg-white border-zinc-200' : 'bg-[#181818] border-white/10'
          }`}>
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-zinc-200' : 'border-white/10'}`}>
              <div className="flex items-center gap-2">
                <LayoutGrid size={18} className="text-pink-500" />
                <h2 className="text-sm font-semibold">Live2D Character Gallery</h2>
              </div>
              <button
                onClick={() => setIsGalleryOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 gemini-chat-scrollbar">
              {/* Custom Model Input Form */}
              <form onSubmit={handleAddCustomModel} className="mb-6">
                <span className="block text-xs font-semibold mb-1.5 text-zinc-400">Load Custom Model</span>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customModelUrl}
                    onChange={(e) => setCustomModelUrl(e.target.value)}
                    placeholder="https://example.com/character/model.model3.json"
                    className={`flex-1 rounded-xl px-3 py-2 text-xs border focus:outline-none ${
                      isLight ? 'bg-zinc-50 border-zinc-200 text-zinc-900' : 'bg-zinc-900 border-white/10 text-white'
                    }`}
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-pink-600 px-4 py-2 text-xs font-medium text-white hover:bg-pink-700 transition-colors"
                  >
                    Load URL
                  </button>
                </div>
              </form>

              {/* Built-in Model Grid */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3.5">
                {WAIFU_MODELS.map((model) => {
                  const isSelected = activeModel.id === model.id;
                  return (
                    <button
                      key={model.id}
                      onClick={() => {
                        setActiveModel(model);
                        setIsGalleryOpen(false);
                      }}
                      className={`group relative flex flex-col items-center rounded-xl p-2.5 border transition-all text-center ${
                        isSelected
                          ? 'border-pink-500 bg-pink-500/10 shadow-sm ring-2 ring-pink-500/20'
                          : isLight
                            ? 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 hover:border-zinc-300'
                            : 'border-white/5 bg-zinc-900/60 hover:bg-zinc-800/80 hover:border-white/10'
                      }`}
                    >
                      <div className="relative mb-2 h-24 w-full overflow-hidden rounded-lg bg-black/20 flex items-center justify-center">
                        <img
                          src={model.image}
                          alt={model.name}
                          className="h-full w-full object-cover object-top transition-transform group-hover:scale-105"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                        <Heart className="absolute bottom-1 right-1 h-3.5 w-3.5 text-pink-500/80 fill-pink-500/20" />
                      </div>
                      <span className="text-xs font-semibold truncate w-full">{model.name}</span>
                      <span className="text-[10px] text-zinc-500 truncate w-full">{model.series}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* PERSONA SELECTION MODAL                                                    */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {isPersonaOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
          <div className={`flex flex-col w-full max-w-lg rounded-2xl border overflow-hidden shadow-2xl ${
            isLight ? 'bg-white border-zinc-200' : 'bg-[#181818] border-white/10'
          }`}>
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-zinc-200' : 'border-white/10'}`}>
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-pink-500" />
                <h2 className="text-sm font-semibold">Select Companion Persona</h2>
              </div>
              <button
                onClick={() => setIsPersonaOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-3">
              {WAIFU_PERSONAS.map((persona) => {
                const isSelected = activePersona.id === persona.id;
                return (
                  <button
                    key={persona.id}
                    onClick={() => {
                      setActivePersona(persona);
                      setIsPersonaOpen(false);
                    }}
                    className={`flex items-start gap-3 w-full rounded-xl p-3.5 text-left border transition-all ${
                      isSelected
                        ? 'border-pink-500 bg-pink-500/10 ring-2 ring-pink-500/20'
                        : isLight
                          ? 'border-zinc-200 hover:bg-zinc-50'
                          : 'border-white/5 bg-zinc-900/40 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="text-2xl pt-0.5">{persona.avatar}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{persona.name}</span>
                        <span className="rounded bg-pink-500/20 px-1.5 py-0.2 text-[10px] font-medium text-pink-400">
                          {persona.badge}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                        {persona.description}
                      </p>
                    </div>
                    {isSelected && <Check size={16} className="text-pink-500 shrink-0 mt-1" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* WAIFU SETTINGS MODAL                                                       */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {isSettingsOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
          <div className={`flex flex-col w-full max-w-md rounded-2xl border overflow-hidden shadow-2xl ${
            isLight ? 'bg-white border-zinc-200' : 'bg-[#181818] border-white/10'
          }`}>
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-zinc-200' : 'border-white/10'}`}>
              <div className="flex items-center gap-2">
                <Sliders size={18} className="text-pink-500" />
                <h2 className="text-sm font-semibold">Waifu Settings</h2>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Voice Audio & Lip-Sync</div>
                  <div className="text-[11px] text-zinc-500">Read AI answers aloud and animate mouth</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.voiceEnabled}
                  onChange={(e) => updateWaifuSettings({ voiceEnabled: e.target.checked })}
                  className="rounded text-pink-600 focus:ring-pink-500 h-4 w-4"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Click & Petting Particles</div>
                  <div className="text-[11px] text-zinc-500">Spawn hearts and sparkles on interaction</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.particlesEnabled}
                  onChange={(e) => updateWaifuSettings({ particlesEnabled: e.target.checked })}
                  className="rounded text-pink-600 focus:ring-pink-500 h-4 w-4"
                />
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Voice Pitch</span>
                  <span>{settings.voicePitch.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.8"
                  step="0.05"
                  value={settings.voicePitch}
                  onChange={(e) => updateWaifuSettings({ voicePitch: parseFloat(e.target.value) })}
                  className="w-full accent-pink-500"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Speech Rate</span>
                  <span>{settings.voiceRate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.05"
                  value={settings.voiceRate}
                  onChange={(e) => updateWaifuSettings({ voiceRate: parseFloat(e.target.value) })}
                  className="w-full accent-pink-500"
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-white/5">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Gemini Live Voice</span>
                  <span className="text-pink-400 font-medium">{settings.liveVoice || 'Aoede'}</span>
                </div>
                <select
                  value={settings.liveVoice || 'Aoede'}
                  onChange={(e) => updateWaifuSettings({ liveVoice: e.target.value })}
                  className={`w-full rounded-xl p-2 text-xs border focus:outline-none ${
                    isLight
                      ? 'bg-zinc-50 border-zinc-200 text-zinc-800'
                      : 'bg-zinc-900 border-white/10 text-zinc-200'
                  }`}
                >
                  <option value="Aoede">Aoede (Breezy, natural feminine tone)</option>
                  <option value="Kore">Kore (Firm, calm feminine tone)</option>
                  <option value="Leda">Leda (Youthful, bright feminine tone)</option>
                  <option value="Puck">Puck (Playful, upbeat tone)</option>
                  <option value="Fenrir">Fenrir (Excitable, energetic tone)</option>
                  <option value="Zephyr">Zephyr (Bright, warm tone)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WaifuView;
