import React, { forwardRef, useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUp, AudioLines, Lightbulb, Copy, X } from 'lucide-react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { streamChat, ChatMessage as AiChatMessage, prewarmClient } from '@willow/ai/chat';
import { apiKeysForBinding, resolveProviderBinding } from '@willow/ai/providers/profiles';
import type { ProviderId } from '@willow/ai/providers/endpoints';
import { addDesignNode, designNodesStore, selectedDesignNodeIds } from './design-store';
import { useStore } from '@nanostores/react';
import { TextShimmer } from '@willow/ui/text-shimmer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface DesignChatProps {
  modelConfig: any;
  selectedModelId: string | null;
  initialPrompt?: string;
  hideComposer?: boolean;
}

export interface DesignChatHandle {
  submit: (prompt: string) => void;
  focus: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isGenerating?: boolean;
  timestamp: number;
}

export const DesignChat = forwardRef<DesignChatHandle, DesignChatProps>(({ modelConfig, selectedModelId, initialPrompt, hideComposer = false }, ref) => {
  // Build a tiny HTML preview for the squircle thumbnails
  const buildMiniPreview = useCallback((rawCode: string) => {
    const cleaned = (rawCode || '')
      .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]lucide-react['"];?/g, 'const {$1} = window.require("lucide-react");')
      .replace(/import\s*React\s*,\s*\{([\s\S]*?)\}\s*from\s*['"]react['"];?/g, 'const {$1} = React;')
      .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]react['"];?/g, 'const {$1} = React;')
      .replace(/import\s+[^'"]+['"][^'"]+['"];?/g, '')
      .replace(/export\s+default\s+function\s+\w+/g, 'function App')
      .replace(/export\s+default\s+/g, 'const App = ')
      .replace(/export\s+function\s+(\w+)/g, 'function $1')
      .replace(/export\s+const\s+/g, 'const ');
    return `<!DOCTYPE html><html class="dark"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"><\/script><script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script><script>tailwind.config={darkMode:'class'}<\/script><style>*{animation:none!important;transition:none!important}html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif}#root{width:100%;height:100%}::-webkit-scrollbar{display:none}</style></head><body><div id="root"></div><script type="text/babel" data-presets="react,typescript,env">const React=window.React;window.require=(m)=>{if(m==='react')return React;if(m==='lucide-react')return new Proxy({},{get:(_,p)=>(props)=>React.createElement('span')});return{}};try{${cleaned};const C=typeof App!=='undefined'?App:null;if(C)ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C))}catch(e){}<\/script></body></html>`;
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [promptValue, setPromptValue] = useState('');
  const [isCurrentlyGenerating, setIsCurrentlyGenerating] = useState(false);
  const [currentStreamingResponse, setCurrentStreamingResponse] = useState('');
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const { apiKeys } = useUserDataContext();

  // Selected screens from canvas
  const selectedIds = useStore(selectedDesignNodeIds);
  const allNodes = useStore(designNodesStore);
  const selectedScreens = allNodes.filter(n => selectedIds.includes(n.id));

  // Scroll to bottom when messages update
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, currentStreamingResponse]);

  // Extract React code from a markdown code block
  const extractCode = (content: string) => {
    const match = content.match(/```(?:jsx|tsx|react|javascript|typescript)?\n([\s\S]*?)```/i);
    return match ? match[1].trim() : content;
  };

  // Pull the main component name from the generated source
  const extractComponentName = (code: string): string => {
    let m;
    // export default function LoginPage
    if ((m = code.match(/export\s+default\s+function\s+([A-Z]\w*)/))) return m[1];
    // export default class LoginPage
    if ((m = code.match(/export\s+default\s+class\s+([A-Z]\w*)/))) return m[1];
    // export function LoginPage
    if ((m = code.match(/export\s+function\s+([A-Z]\w*)/))) return m[1];
    // const LoginPage = () =>  /  const LoginPage: React.FC
    if ((m = code.match(/(?:const|let|var)\s+([A-Z]\w*)\s*[:=]/))) return m[1];
    // export default LoginPage  (standalone at line end)
    if ((m = code.match(/export\s+default\s+([A-Z]\w*)\s*;?\s*$/m))) return m[1];
    // function LoginPage(
    if ((m = code.match(/function\s+([A-Z]\w*)/))) return m[1];
    return 'App';
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isCurrentlyGenerating) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setPromptValue('');
    setIsCurrentlyGenerating(true);
    setCurrentStreamingResponse('');

    const assistantId = Math.random().toString(36).substring(7);
    let fullResponse = '';

    const aiMessages: AiChatMessage[] = messages.concat(userMessage).map(m => ({
      role: m.role,
      content: m.content
    }));

    try {
      // Find selected provider and model — same logic as main sidebar
      let provider: 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai' | 'moonshot' | 'spacexai' | 'zhipuai' = 'gemini';
      let modelId = '';

      const allSavedModels = [
        ...(modelConfig.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' })),
        ...(modelConfig.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' })),
        ...(modelConfig.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' })),
        ...(modelConfig.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' })),
        ...(modelConfig.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' })),
        ...(modelConfig.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' }))
      ];

      const selected = allSavedModels.find((m: any) => m.id === selectedModelId);
      if (selected) {
        provider = selected.provider as 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai';
        modelId = selected.modelId;
      } else {
        // Fallback to default
        provider = 'gemini';
        modelId = (modelConfig.gemini?.model) || 'gemini-2.5-pro';
      }

      /* Endpoint, wire format and tool policy come from the live profile, never
         from the saved model — see `resolveProviderBinding`. */
      const binding = resolveProviderBinding(modelConfig, provider as ProviderId, selected);
      const bucketKeys = apiKeysForBinding(binding, provider as ProviderId, apiKeys);
      const apiKey = bucketKeys[0];

      if (!apiKey) {
         setMessages(prev => [...prev, {
            id: assistantId,
            role: 'assistant',
            content: `Error: API Key for ${provider} is missing. Please add it in Settings.`,
            timestamp: Date.now()
         }]);
         setIsCurrentlyGenerating(false);
         return;
      }

      await streamChat(
        aiMessages,
        {
          provider: provider as any,
          model: modelId,
          apiKey: apiKey,
          thinkingLevel: selected?.thinkingLevel || 1,
          apiKeyFallbacks: bucketKeys.slice(1),
          ...binding,
        },
        (token) => {
          fullResponse += token;
          setCurrentStreamingResponse(fullResponse);
        },
        () => {
          // onStart
        },
        `You are an expert UI/UX designer and Frontend Developer. 
Your goal is to generate single, beautiful, modern fully-functional React components using Tailwind CSS and Lucide React icons.
Return your generated code inside a single \`\`\`tsx code block. It will be rendered on a canvas. Do NOT provide an implementation plan, just output the TSX code block. Be concise.`
      );

      // Add actual message and remove streaming state
      flushSync(() => {
         setMessages(prev => [...prev, {
           id: assistantId,
           role: 'assistant',
           content: fullResponse,
           timestamp: Date.now()
         }]);
         setCurrentStreamingResponse('');
         setIsCurrentlyGenerating(false);
      });

      // If there is code in the response, add it to the Design Board
      const code = extractCode(fullResponse);
      if (code && fullResponse.includes('\`\`\`')) {
         addDesignNode({
            prompt: text,
            code: code,
            fileName: extractComponentName(code)
         });
      }

    } catch (error: any) {
      console.error('[DesignChat] Generation error:', error);
      flushSync(() => {
         setMessages(prev => [...prev, {
           id: assistantId,
           role: 'assistant',
           content: `Error generating design: ${error.message || 'Unknown error'}`,
           timestamp: Date.now()
         }]);
         setCurrentStreamingResponse('');
         setIsCurrentlyGenerating(false);
      });
    }
  };

  useImperativeHandle(ref, () => ({
    submit: (prompt: string) => { void handleSendMessage(prompt); },
    focus: () => textareaRef.current?.focus(),
  }), [handleSendMessage]);

  // The landing composer hands its first request into the full canvas view.
  // Consume it once per value so reopening the canvas never duplicates a request.
  const consumedInitialPrompt = useRef<string | null>(null);
  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt || consumedInitialPrompt.current === prompt) return;
    consumedInitialPrompt.current = prompt;
    setPromptValue(prompt);
    void handleSendMessage(prompt);
  }, [initialPrompt]);

  return (
    <div
      className={`flex h-full flex-col ${hideComposer ? 'bg-transparent' : 'bg-[#141414]'}`}
      style={{ contain: 'strict' }}
    >
      {/* Scrollable Messages Area */}
      <div 
        ref={chatScrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
        style={{ paddingBottom: hideComposer ? '0px' : '120px' }} // Account for fixed footer
      >
        <div className={`${hideComposer ? 'px-4 pb-4 pt-8' : 'p-[14px]'} space-y-8 max-w-full`}>
            {hideComposer && (
              <div className="mb-9 flex h-5 w-12 items-center justify-center rounded-full bg-[#f5f5f5] text-[13px] font-bold tracking-[3px] text-[#1a1a1c]">
                ...
              </div>
            )}
            {messages.length === 0 && (
              hideComposer ? (
                <div className="flex h-full min-h-[240px] items-center justify-center px-6 text-center text-[14px] leading-6 text-[#8f9398]">
                  Your prompt and Stitch's response will appear here.
                </div>
              ) : <div className="flex flex-col items-center justify-center text-center mt-12 mb-8">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-[#27272a] flex items-center justify-center mb-6">
                   <div className="text-gray-400">🎨</div>
                </div>
                <h2 className="text-[19px] font-semibold text-gray-200 mb-2 text-center leading-snug">
                  Design Canvas Mode
                </h2>
                <p className="text-sm text-gray-400 max-w-[80%]">
                  Describe the screen or element you want to design. It will be generated and placed on the canvas.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className="space-y-8 max-w-full overflow-hidden">
                {msg.role === 'user' ? (
                  <div className={hideComposer ? 'w-full' : 'flex justify-end -mr-[6px]'}>
                    <div className={hideComposer
                      ? 'flex h-[58px] w-full min-w-0 items-center gap-2 rounded-[20px] border border-[#37383c] px-3.5 text-[15px] text-[#aeb1b5]'
                      : 'flex flex-col items-end gap-2 max-w-[85%] break-words'}>
                        {hideComposer && (
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#5d708e,#8d6a87)] text-[10px] text-white">*</div>
                        )}
                        <span className={hideComposer ? 'min-w-0 flex-1 truncate' : 'bg-[#27272a] text-gray-200 px-4 py-3 rounded-2xl text-[15px] leading-relaxed shadow-sm'}>
                          {msg.content}
                        </span>
                        {hideComposer && (
                          <>
                            <Copy size={16} className="shrink-0 text-[#7f8388]" />
                            <span className="shrink-0 text-lg leading-none text-[#7f8388]">⌄</span>
                          </>
                        )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 max-w-[95%]">
                    <div className="text-[#e2e3e5] text-[15px] leading-[1.6] prose prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-1 prose-strong:text-white overflow-x-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    {/* Action buttons */}
                    {!hideComposer && <div className="flex items-center gap-3 pt-4 border-t border-white/5 flex-wrap shrink-0">
                        <button 
                          onClick={() => navigator.clipboard.writeText(msg.content)}
                          className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                        >
                          <Copy size={14} />
                        </button>
                    </div>}
                  </div>
                )}
              </div>
            ))}

            {/* Current Streaming UI */}
            {isCurrentlyGenerating && (
              <div className="space-y-4">
                <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                  <Lightbulb size={18} />
                  <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                    Designing
                  </TextShimmer>
                </div>
                {currentStreamingResponse && (
                  <div className="text-gray-300 text-[15px] leading-[1.65] whitespace-pre-wrap">
                    {currentStreamingResponse}
                  </div>
                )}
              </div>
            )}
        </div>
      </div>

      {/* Input Footer Area */}
      {!hideComposer && <div ref={footerRef} className="absolute bottom-0 left-0 w-full z-30 pointer-events-none">
        <div className="h-8 w-full bg-gradient-to-t from-[#141414]/90 to-transparent pointer-events-none" />
        <div className="bg-[#141414] pointer-events-auto px-[14px] pb-4 pt-4">
            <div className="bg-[#27272a] rounded-[26px] p-3.5 relative flex flex-col shadow-lg border border-white/5">

               {/* Attached screens (selected on canvas) */}
               {selectedScreens.length > 0 && (
                 <div className="flex gap-3 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1">
                   {selectedScreens.map((screen) => (
                     <div key={screen.id} className="relative group flex-shrink-0 animate-in fade-in zoom-in-95 duration-200">
                       <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                         <iframe
                           srcDoc={buildMiniPreview(screen.code)}
                           className="pointer-events-none select-none"
                           style={{ border: 'none', width: 960, height: 540, transform: 'scale(0.0667)', transformOrigin: 'top left' }}
                           sandbox="allow-scripts allow-same-origin"
                           scrolling="no"
                           tabIndex={-1}
                         />
                       </div>
                       <button
                         onClick={() => {
                           selectedDesignNodeIds.set(selectedIds.filter(id => id !== screen.id));
                         }}
                         className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                       >
                         <X size={12} />
                       </button>
                       <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white/60 text-center py-0.5 rounded-b-2xl truncate px-1">
                         {screen.fileName || 'App'}.tsx
                       </div>
                     </div>
                   ))}
                 </div>
               )}

               <textarea
                  ref={textareaRef}
                  placeholder={"Ask Lovable to design..."}
                  className="w-full bg-transparent text-gray-100 placeholder-gray-400 resize-none outline-none min-h-[44px] px-3 py-1.5 text-[16px] leading-relaxed font-normal overflow-y-auto transition-opacity duration-200"
                  style={{ scrollbarGutter: 'stable' }}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(promptValue);
                    }
                  }}
                  rows={1}
               />
               <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                     <button className="p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-all flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                     </button>
                     <button className="flex items-center rounded-full transition-all text-[13px] font-medium flex-shrink-0 h-[36px] bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white pl-4 pr-2.5 gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                        <span className="ml-2">Tools</span>
                     </button>
                  </div>
                  <div className="flex items-center gap-2">
                       {isCurrentlyGenerating ? (
                         <button className="w-[38px] h-[38px] rounded-full bg-[#3b82f6]/20 text-[#3b82f6] transition-colors flex items-center justify-center shadow-md flex-shrink-0 opacity-50 cursor-not-allowed">
                           <div className="w-[14px] h-[14px] bg-current rounded-[3px]" />
                         </button>
                       ) : (
                         <button 
                            onClick={() => handleSendMessage(promptValue)}
                            className={`w-[38px] h-[38px] rounded-full transition-all flex items-center justify-center shadow-md flex-shrink-0 ${promptValue.trim().length > 0 ? 'bg-[#d4d4d8] text-black hover:bg-white' : 'bg-[#3f3f46] text-gray-400'}`}
                          >
                           {(promptValue.trim().length > 0) ? (
                              <ArrowUp size={18} strokeWidth={2.5} />
                           ) : (
                              <AudioLines size={18} />
                           )}
                         </button>
                       )}
                  </div>
               </div>
            </div>
        </div>
      </div>}
    </div>
  );
});

DesignChat.displayName = 'DesignChat';
