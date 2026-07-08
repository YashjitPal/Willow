import React from 'react';
import { ChevronDown, Check, X, Lightbulb } from 'lucide-react';

// Custom Bulb Icon: Uses standard Lightbulb but fills it when active (Reasoning On)
const ReasoningBulb = ({ isActive, className, strokeWidth }: { isActive: boolean, className?: string, strokeWidth?: number }) => {
    return (
        <Lightbulb 
            className={`${className} ${isActive ? "fill-current" : ""}`} 
            strokeWidth={2} 
        />
    );
};

interface GeminiModel {
  id: string;
  name: string;
  maxLevels: number;
  hasNone: boolean;
  noneLabel?: string;
  levelLabels?: Record<number, string>;
}

interface ModelsTabProps {
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  managingProvider: 'gemini' | 'openai' | 'anthropic' | null;
  setManagingProvider: (v: 'gemini' | 'openai' | 'anthropic' | null) => void;
  wasManagingKeys: boolean;
  handleExitManageKeys: () => void;
  providerState: {
    gemini: { apiKey: string; baseUrl: string };
    openai: { apiKey: string; baseUrl: string };
    anthropic: { apiKey: string; baseUrl: string };
    activeProvider?: string;
  };
  handleUpdateConfig: (provider: 'gemini' | 'openai' | 'anthropic', config: { apiKey: string; baseUrl: string }) => Promise<void>;
  GEMINI_MODELS: GeminiModel[];
  // Gemini dropdown
  geminiRef: React.RefObject<HTMLDivElement | null>;
  geminiDropdownOpen: boolean;
  setGeminiDropdownOpen: (v: boolean) => void;
  geminiDropdownClosing: boolean;
  geminiDirection: 'down' | 'up';
  setGeminiDirection: (v: 'down' | 'up') => void;
  closeGeminiDropdown: () => void;
  // OpenAI dropdown
  openaiRef: React.RefObject<HTMLDivElement | null>;
  openaiDropdownOpen: boolean;
  setOpenaiDropdownOpen: (v: boolean) => void;
  openaiDropdownClosing: boolean;
  openaiDirection: 'down' | 'up';
  setOpenaiDirection: (v: 'down' | 'up') => void;
  closeOpenaiDropdown: () => void;
  // Anthropic dropdown
  anthropicRef: React.RefObject<HTMLDivElement | null>;
  anthropicDropdownOpen: boolean;
  setAnthropicDropdownOpen: (v: boolean) => void;
  anthropicDropdownClosing: boolean;
  anthropicDirection: 'down' | 'up';
  setAnthropicDirection: (v: 'down' | 'up') => void;
  closeAnthropicDropdown: () => void;
  // Helpers
  determineDirection: (ref: React.RefObject<HTMLDivElement>) => 'down' | 'up';
}

export const ModelsTab: React.FC<ModelsTabProps> = ({
  modelConfig,
  setModelConfig,
  managingProvider,
  setManagingProvider,
  wasManagingKeys,
  handleExitManageKeys,
  providerState,
  handleUpdateConfig,
  GEMINI_MODELS,
  geminiRef,
  geminiDropdownOpen,
  setGeminiDropdownOpen,
  geminiDropdownClosing,
  geminiDirection,
  setGeminiDirection,
  closeGeminiDropdown,
  openaiRef,
  openaiDropdownOpen,
  setOpenaiDropdownOpen,
  openaiDropdownClosing,
  openaiDirection,
  setOpenaiDirection,
  closeOpenaiDropdown,
  anthropicRef,
  anthropicDropdownOpen,
  setAnthropicDropdownOpen,
  anthropicDropdownClosing,
  anthropicDirection,
  setAnthropicDirection,
  closeAnthropicDropdown,
  determineDirection,
}) => (
  <div className="w-full h-full px-12 py-10 overflow-y-auto relative">
    {/* Header */}
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-4">
        {managingProvider && (
          <button 
            onClick={handleExitManageKeys}
            className="p-1.5 -ml-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <ChevronDown className="rotate-90" size={20} />
          </button>
        )}
        <h1 className="text-[24px] font-bold text-white">
          {managingProvider ? `Manage ${managingProvider.charAt(0).toUpperCase() + managingProvider.slice(1)}` : 'Models & API'}
        </h1>
      </div>
    </div>
    
    {!managingProvider && (
      <div className="pb-6 border-b border-white/5 mb-8">
        <p className="text-[14px] text-zinc-400">
          Connect your AI providers and configure model settings.
        </p>
      </div>
    )}

    {/* Manage Keys View */}
    {managingProvider ? (
      <div className="animate-[fadeIn_150ms_ease-out] flex flex-col space-y-6 mt-8">
        <div className="bg-[#1c1c1c] border border-white/5 rounded-xl p-6">
          <h3 className="text-[14px] font-bold text-white mb-4">API Configuration</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-zinc-400">API Key</label>
              <input 
                type="password" 
                placeholder={`Enter ${managingProvider.charAt(0).toUpperCase() + managingProvider.slice(1)} API Key...`}
                className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors shadow-inner"
                value={providerState[managingProvider].apiKey}
                onChange={(e) => handleUpdateConfig(managingProvider, { ...providerState[managingProvider], apiKey: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-zinc-400">Base URL (Optional)</label>
              <input 
                type="text" 
                placeholder="e.g., https://api.openai.com/v1"
                className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors shadow-inner"
                value={providerState[managingProvider].baseUrl}
                onChange={(e) => handleUpdateConfig(managingProvider, { ...providerState[managingProvider], baseUrl: e.target.value })}
              />
            </div>
          </div>
          <p className="text-[12px] text-zinc-500 mt-4">
            Keys are stored locally in your browser session for security and synced securely via Firestore.
          </p>
        </div>

        {/* Active Provider Config */}
        <div className="pt-8">
          <div className="h-[12px] w-full text-white/10 mb-8 overflow-hidden">
            <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="wave-pattern" width="32" height="12" patternUnits="userSpaceOnUse">
                  <path 
                    d="M 0 6 C 4 2, 12 2, 16 6 C 20 10, 28 10, 32 6" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinecap="round" 
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#wave-pattern)" />
            </svg>
          </div>
          <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            {managingProvider === 'gemini' && "Gemini Settings"}
            {managingProvider === 'openai' && "OpenAI Settings"}
            {managingProvider === 'anthropic' && "Anthropic Settings"}
          </h2>

          <div className="bg-[#141414] border border-white/5 rounded-xl shadow-2xl shadow-black/50">
            {/* Gemini Provider Settings */}
            {managingProvider === 'gemini' && (
              <div className="p-6 space-y-6">
                {/* Model Selection */}
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" ref={geminiRef} data-dropdown="gemini">
                       {/* Custom Dropdown Trigger */}
                       <button
                           onClick={() => {
                               if (geminiDropdownOpen) {
                                   closeGeminiDropdown();
                               } else {
                                   setGeminiDirection(determineDirection(geminiRef));
                                   setGeminiDropdownOpen(true);
                               }
                           }}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span>{GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.name || 'Select model'}</span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${geminiDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>
                       
                       {/* Custom Dropdown Menu */}
                       {geminiDropdownOpen && (
                           <div className={`absolute ${geminiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${geminiDropdownClosing ? (geminiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (geminiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                               {/* Corner Border Glow Effects */}
                               <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                               {GEMINI_MODELS.map((model, index) => (
                                   <button
                                       key={model.id}
                                       onClick={() => {
                                           setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, model: model.id } }));
                                           closeGeminiDropdown();
                                       }}
                                       className={`
                                           relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                           ${modelConfig.gemini.model === model.id 
                                               ? 'bg-white/10 text-white' 
                                               : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                           }
                                           ${index === 0 ? 'rounded-t-lg' : ''}
                                           ${index === GEMINI_MODELS.length - 1 ? 'rounded-b-lg' : ''}
                                       `}
                                   >
                                       <span className="font-medium">{model.name}</span>
                                       {modelConfig.gemini.model === model.id && (
                                           <Check size={16} className="text-white" />
                                       )}
                                   </button>
                               ))}
                           </div>
                       )}
                  </div>
                </div>

                {/* Thinking Level */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Thinking</label>
                    <span className="text-[11px] font-medium text-zinc-400">
                      {modelConfig.gemini.thinkingLevel === 0 
                        ? 'Off' 
                        : GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.levelLabels?.[modelConfig.gemini.thinkingLevel as 1|2|3] || `Level ${modelConfig.gemini.thinkingLevel}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-1 bg-white/[0.02] rounded-xl border border-white/5">
                    {/* None Option */}
                    {GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.hasNone && (
                      <button
                        onClick={() => setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, thinkingLevel: 0 } }))}
                        className={`
                          flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all
                          ${modelConfig.gemini.thinkingLevel === 0 
                            ? 'bg-white/10 text-white' 
                            : 'text-zinc-500 hover:text-zinc-300'
                          }
                        `}
                      >
                        None
                      </button>
                    )}
                    {Array.from({ length: GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.maxLevels || 0 }).map((_, i) => {
                      const level = i + 1;
                      const isActive = modelConfig.gemini.thinkingLevel === level;
                      const levelLabel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.levelLabels?.[level as 1|2|3];
                      return (
                        <button
                          key={level}
                          onClick={() => setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, thinkingLevel: level } }))}
                          className={`
                            flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all
                            ${isActive 
                              ? 'bg-white/10 text-white' 
                              : 'text-zinc-500 hover:text-zinc-300'
                            }
                          `}
                        >
                          {levelLabel || `${level}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Add Button */}
                <button 
                  onClick={() => {
                    const selectedModel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model);
                    if (selectedModel) {
                      const isDuplicate = modelConfig.gemini.savedModels.some(
                        m => m.modelId === selectedModel.id && m.thinkingLevel === modelConfig.gemini.thinkingLevel
                      );
                      if (isDuplicate) return;
                      
                      setModelConfig(prev => ({
                        ...prev,
                        gemini: {
                          ...prev.gemini,
                          savedModels: [
                            ...prev.gemini.savedModels,
                            {
                              id: Math.random().toString(36).substr(2, 9),
                              modelId: selectedModel.id,
                              name: selectedModel.name,
                              thinkingLevel: prev.gemini.thinkingLevel
                            }
                          ]
                        }
                      }));
                    }
                  }}
                  disabled={(() => {
                    const selectedModel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model);
                    if (!selectedModel) return true;
                    return modelConfig.gemini.savedModels.some(
                      m => m.modelId === selectedModel.id && m.thinkingLevel === modelConfig.gemini.thinkingLevel
                    );
                  })()}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add to Models
                </button>
              </div>
            )}

            {/* OpenAI Provider Settings */}
            {managingProvider === 'openai' && (
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" ref={openaiRef} data-dropdown="openai">
                       <button
                           onClick={() => {
                               if (openaiDropdownOpen) {
                                   closeOpenaiDropdown();
                               } else {
                                   setOpenaiDirection(determineDirection(openaiRef));
                                   setOpenaiDropdownOpen(true);
                               }
                           }}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span>{
                               {
                                   'gpt-5.2-thinking': 'GPT 5.2 Thinking',
                                   'gpt-5.2-pro': 'GPT 5.2 Pro',
                                   'gpt-5.1-codex-high-max': 'GPT 5.1 Codex High Max',
                                   'gpt-5.2-codex': 'GPT 5.2 CODEX'
                               }[modelConfig.openai.model] || 'Select model'
                           }</span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${openaiDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>
                       
                       {openaiDropdownOpen && (
                           <div className={`absolute ${openaiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${openaiDropdownClosing ? (openaiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (openaiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                               <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                               {[
                                   { id: 'gpt-5.2-thinking', name: 'GPT 5.2 Thinking' },
                                   { id: 'gpt-5.2-pro', name: 'GPT 5.2 Pro' },
                                   { id: 'gpt-5.1-codex-high-max', name: 'GPT 5.1 Codex High Max' },
                                   { id: 'gpt-5.2-codex', name: 'GPT 5.2 CODEX' }
                               ].map((model, index, arr) => (
                                   <button
                                       key={model.id}
                                       onClick={() => {
                                           setModelConfig(prev => ({ ...prev, openai: { ...prev.openai, model: model.id } }));
                                           closeOpenaiDropdown();
                                       }}
                                       className={`
                                           relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                           ${modelConfig.openai.model === model.id 
                                               ? 'bg-white/10 text-white' 
                                               : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                           }
                                           ${index === 0 ? 'rounded-t-lg' : ''}
                                           ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                       `}
                                   >
                                       <span className="font-medium">{model.name}</span>
                                       {modelConfig.openai.model === model.id && (
                                           <Check size={16} className="text-white" />
                                       )}
                                   </button>
                               ))}
                           </div>
                       )}
                  </div>
                </div>

                {/* Thinking Level */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Thinking</label>
                    <span className="text-[11px] font-medium text-zinc-400">
                      {modelConfig.openai.thinkingLevel === 0 ? 'Off' : ['Low', 'Medium', 'High'][modelConfig.openai.thinkingLevel - 1]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-1 bg-white/[0.02] rounded-xl border border-white/5">
                    <button
                      onClick={() => setModelConfig(prev => ({ ...prev, openai: { ...prev.openai, thinkingLevel: 0 } }))}
                      className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.openai.thinkingLevel === 0 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      None
                    </button>
                    {['Low', 'Medium', 'High'].map((label, i) => (
                      <button
                        key={i + 1}
                        onClick={() => setModelConfig(prev => ({ ...prev, openai: { ...prev.openai, thinkingLevel: i + 1 } }))}
                        className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.openai.thinkingLevel === i + 1 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => {
                    const modelName = modelConfig.openai.model.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                    setModelConfig(prev => ({
                      ...prev,
                      openai: {
                        ...prev.openai,
                        savedModels: [
                          ...prev.openai.savedModels,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            modelId: prev.openai.model,
                            name: modelName,
                            thinkingLevel: prev.openai.thinkingLevel
                          }
                        ]
                      }
                    }));
                  }}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99]"
                >
                  Add to Models
                </button>
              </div>
            )}

            {/* Anthropic Provider Settings */}
            {managingProvider === 'anthropic' && (
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" ref={anthropicRef} data-dropdown="anthropic">
                       <button
                           onClick={() => {
                               if (anthropicDropdownOpen) {
                                   closeAnthropicDropdown();
                               } else {
                                   setAnthropicDirection(determineDirection(anthropicRef));
                                   setAnthropicDropdownOpen(true);
                               }
                           }}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span>{
                               {
                                   'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet (New)',
                                   'claude-3-opus-20240229': 'Claude 3 Opus',
                                   'claude-3-haiku-20240307': 'Claude 3 Haiku'
                               }[modelConfig.anthropic.model] || 'Select model'
                           }</span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${anthropicDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>
                       
                       {anthropicDropdownOpen && (
                           <div className={`absolute ${anthropicDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${anthropicDropdownClosing ? (anthropicDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (anthropicDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                               <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                               {[
                                   { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (New)' },
                                   { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
                                   { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
                               ].map((model, index, arr) => (
                                   <button
                                       key={model.id}
                                       onClick={() => {
                                           setModelConfig(prev => ({ ...prev, anthropic: { ...prev.anthropic, model: model.id } }));
                                           closeAnthropicDropdown();
                                       }}
                                       className={`
                                           relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                           ${modelConfig.anthropic.model === model.id 
                                               ? 'bg-white/10 text-white' 
                                               : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                           }
                                           ${index === 0 ? 'rounded-t-lg' : ''}
                                           ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                       `}
                                   >
                                       <span className="font-medium">{model.name}</span>
                                       {modelConfig.anthropic.model === model.id && (
                                           <Check size={16} className="text-white" />
                                       )}
                                   </button>
                               ))}
                           </div>
                       )}
                  </div>
                </div>

                {/* Thinking Level */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Thinking</label>
                    <span className="text-[11px] font-medium text-zinc-400">
                      {modelConfig.anthropic.thinkingLevel === 0 ? 'Off' : ['Low', 'Medium', 'High'][modelConfig.anthropic.thinkingLevel - 1]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-1 bg-white/[0.02] rounded-xl border border-white/5">
                    <button
                      onClick={() => setModelConfig(prev => ({ ...prev, anthropic: { ...prev.anthropic, thinkingLevel: 0 } }))}
                      className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.anthropic.thinkingLevel === 0 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      None
                    </button>
                    {['Low', 'Medium', 'High'].map((label, i) => (
                      <button
                        key={i + 1}
                        onClick={() => setModelConfig(prev => ({ ...prev, anthropic: { ...prev.anthropic, thinkingLevel: i + 1 } }))}
                        className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.anthropic.thinkingLevel === i + 1 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => {
                    const modelName = modelConfig.anthropic.model.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                    setModelConfig(prev => ({
                      ...prev,
                      anthropic: {
                        ...prev.anthropic,
                        savedModels: [
                          ...prev.anthropic.savedModels,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            modelId: prev.anthropic.model,
                            name: modelName,
                            thinkingLevel: prev.anthropic.thinkingLevel
                          }
                        ]
                      }
                    }));
                  }}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99]"
                >
                  Add to Models
                </button>
              </div>
            )}
          </div>

          {/* Unified Global Models List */}
          <div className="mt-8 pt-8">
            <div className="h-[12px] w-full text-white/10 mb-8 overflow-hidden">
              <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="wave-pattern-2" width="32" height="12" patternUnits="userSpaceOnUse">
                    <path 
                      d="M 0 6 C 4 2, 12 2, 16 6 C 20 10, 28 10, 32 6" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="1.5" 
                      strokeLinecap="round" 
                    />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#wave-pattern-2)" />
              </svg>
            </div>
            <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-4">Models:</h2>
            <div className="space-y-4">
              {[
                ...modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' as const })),
                ...modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' as const })),
                ...modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' as const }))
              ].length === 0 ? (
                <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl text-zinc-500 text-[13px]">
                  No model presets configured yet. Add one above to get started.
                </div>
              ) : (
                [
                  ...modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' as const })),
                  ...modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' as const })),
                  ...modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' as const }))
                ].map((saved) => (
                  <div key={saved.id} className="group relative bg-[#1c1c1c] border border-white/10 rounded-xl px-5 py-4 flex items-center justify-between transition-all hover:bg-white/5 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className={saved.provider === 'gemini' ? "text-[#fbbf24]" : "text-white"}>
                        {saved.provider === 'gemini' && (
                          <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
                            <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z"/>
                          </svg>
                        )}
                        {saved.provider === 'openai' && (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.0462 6.0462 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729Z"/></svg>
                        )}
                        {saved.provider === 'anthropic' && (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                            <path d="M16.9 18.9h-1.9l-3.9-10.4h-0.1l-3.9 10.4h-1.9l5-12.8h1.7L16.9 18.9z M9.2 13h5.7L12 5.5h-0.1L9.2 13z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-semibold text-white">{saved.name}</span>
                        <span className="text-[11px] font-medium text-zinc-500 uppercase">
                          {saved.provider === 'gemini' ? 'Google' : saved.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        {[1, 2, 3].map((level) => {
                          if (saved.provider === 'gemini') {
                            const geminiModel = GEMINI_MODELS.find(m => m.id === saved.modelId);
                            if (geminiModel && level > geminiModel.maxLevels) return null;
                          }
                          return (
                            <ReasoningBulb 
                              key={level}
                              isActive={level <= saved.thinkingLevel}
                              className={level <= saved.thinkingLevel ? "text-[#fbbf24] w-[20px] h-[20px]" : "text-zinc-600 w-[20px] h-[20px]"} 
                              strokeWidth={level <= saved.thinkingLevel ? 0 : 2}
                            />
                          );
                        })}
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setModelConfig(prev => {
                            const provider = saved.provider;
                            return {
                              ...prev,
                              [provider]: {
                                ...prev[provider],
                                savedModels: prev[provider].savedModels.filter(m => m.id !== saved.id)
                              }
                            };
                          });
                        }}
                        className="p-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-full hover:bg-white/5"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      
      </div>
    ) : (
      // Overview Mode
      <div className={`space-y-10 ${wasManagingKeys ? 'animate-[fadeIn_150ms_ease-out]' : ''}`}>
        
        {/* Provider Cards */}
        <div className="grid grid-cols-3 gap-4">
          {/* Gemini Card */}
          <div 
            className={`
              relative rounded-2xl p-5 border cursor-pointer group
              bg-gradient-to-b from-[#1c1c1c] to-[#141414]
              ${providerState.gemini.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
            `}
            onClick={() => setManagingProvider('gemini')}
          >
            <div className="flex items-start justify-between mb-8">
              <div className="w-10 h-10 rounded-xl bg-black border border-white/10 flex items-center justify-center text-white shadow-lg">
                <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                  <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z"/>
                </svg>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); setManagingProvider('gemini'); }}
                className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
              >
                Manage
              </button>
            </div>
            <div className="space-y-1">
              <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Google Gemini</h3>
              <p className="text-[12px] text-zinc-500">
                {providerState.gemini.apiKey ? 'Configured' : 'Not configured'}
              </p>
            </div>
            {providerState.gemini.apiKey && (
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
            )}
          </div>

          {/* OpenAI Card */}
          <div 
            className={`
              relative rounded-2xl p-5 border cursor-pointer group
              bg-gradient-to-b from-[#1c1c1c] to-[#141414]
              ${providerState.openai.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
            `}
            onClick={() => setManagingProvider('openai')}
          >
            <div className="flex items-start justify-between mb-8">
              <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white border border-white/10 shadow-lg">
                   <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z"/></svg>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); setManagingProvider('openai'); }}
                className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
              >
                Manage
              </button>
            </div>
            <div className="space-y-1">
              <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">OpenAI</h3>
              <p className="text-[12px] text-zinc-500">
                {providerState.openai.apiKey ? 'Configured' : 'Not configured'}
              </p>
            </div>
            {providerState.openai.apiKey && (
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
            )}
          </div>

          {/* Anthropic Card */}
          <div 
            className={`
              relative rounded-2xl p-5 border cursor-pointer group
              bg-gradient-to-b from-[#1c1c1c] to-[#141414]
              ${providerState.anthropic.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
            `}
            onClick={() => setManagingProvider('anthropic')}
          >
            <div className="flex items-start justify-between mb-8">
              <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white border border-white/10 shadow-lg">
                <svg viewBox="0 0 512 509.64" fill="currentColor" className="w-6 h-6">
                  <path fillRule="nonzero" d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"/>
                </svg>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); setManagingProvider('anthropic'); }}
                className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
              >
                Manage
              </button>
            </div>
            <div className="space-y-1">
              <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Anthropic</h3>
              <p className="text-[12px] text-zinc-500">
                {providerState.anthropic.apiKey ? 'Configured' : 'Not configured'}
              </p>
            </div>
            {providerState.anthropic.apiKey && (
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
            )}
          </div>
        </div>

        {/* System Default Models Section */}
        <div className="pt-8 mt-4">
          <div className="h-[12px] w-full text-white/10 mb-8 overflow-hidden">
            <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="wave-pattern-3" width="32" height="12" patternUnits="userSpaceOnUse">
                  <path 
                    d="M 0 6 C 4 2, 12 2, 16 6 C 20 10, 28 10, 32 6" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinecap="round" 
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#wave-pattern-3)" />
            </svg>
          </div>
          <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-6">System Defaults</h2>
          <div className="space-y-4">
            {/* Chat Renaming Model */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Chat Naming Model</span>
                <span className="text-[12px] text-zinc-500">Model used to automatically generate chat titles.</span>
              </div>
              <div className="relative w-64" ref={geminiRef} data-dropdown="chat-renaming">
                <button
                  onClick={() => {
                    if (geminiDropdownOpen) closeGeminiDropdown();
                    else {
                      setGeminiDirection(determineDirection(geminiRef));
                      setGeminiDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>
                    {[
                      ...modelConfig.gemini.savedModels,
                      ...modelConfig.openai.savedModels,
                      ...modelConfig.anthropic.savedModels
                    ].find(m => m.modelId === modelConfig.systemDefaults?.chatRenaming)?.name || (modelConfig.systemDefaults?.chatRenaming === 'gemini-3-flash-preview' ? 'Gemini 3 Flash' : modelConfig.systemDefaults?.chatRenaming) || 'Select model'}
                  </span>
                  <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${geminiDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {geminiDropdownOpen && (
                  <div className={`absolute ${geminiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${geminiDropdownClosing ? (geminiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (geminiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      {[
                        ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                        ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                        ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : [])
                      ].length === 0 ? (
                        <div className="px-4 py-3 text-[13px] text-zinc-500 text-center">
                          No models saved or no API keys configured. Manage a provider above.
                        </div>
                      ) : (
                        [
                          ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                          ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                          ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : [])
                        ].map((model) => (
                          <button
                            key={`${model.provider}-${model.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setModelConfig(prev => ({ 
                                ...prev, 
                                systemDefaults: { 
                                  ...prev.systemDefaults, 
                                  chatRenaming: model.modelId 
                                } 
                              }));
                              closeGeminiDropdown();
                            }}
                            className={`
                              w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group
                              ${modelConfig.systemDefaults?.chatRenaming === model.modelId 
                                ? 'bg-white/10 text-white' 
                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                              }
                            `}
                          >
                            <span className="font-medium">{model.name}</span>
                            {modelConfig.systemDefaults?.chatRenaming === model.modelId && (
                              <Check size={14} className="text-white" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Computer Use Model */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Computer Use Model</span>
                <span className="text-[12px] text-zinc-500">Model used for the automated test agent.</span>
              </div>
              <div className="relative w-64" ref={openaiRef} data-dropdown="computer-use">
                <button
                  onClick={() => {
                    if (openaiDropdownOpen) closeOpenaiDropdown();
                    else {
                      setOpenaiDirection(determineDirection(openaiRef));
                      setOpenaiDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>
                    {[
                      ...modelConfig.gemini.savedModels,
                      ...modelConfig.openai.savedModels,
                      ...modelConfig.anthropic.savedModels
                    ].find(m => m.modelId === modelConfig.systemDefaults?.computerUse)?.name || (modelConfig.systemDefaults?.computerUse === 'claude-sonnet-4.5' ? 'Claude Sonnet 4.5' : modelConfig.systemDefaults?.computerUse) || 'Select model'}
                  </span>
                  <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${openaiDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {openaiDropdownOpen && (
                  <div className={`absolute ${openaiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${openaiDropdownClosing ? (openaiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (openaiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      {[
                        ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                        ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                        ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : [])
                      ].length === 0 ? (
                        <div className="px-4 py-3 text-[13px] text-zinc-500 text-center">
                          No models saved or no API keys configured. Manage a provider above.
                        </div>
                      ) : (
                        [
                          ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                          ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                          ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : [])
                        ].map((model) => (
                          <button
                            key={`${model.provider}-${model.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setModelConfig(prev => ({ 
                                ...prev, 
                                systemDefaults: { 
                                  ...prev.systemDefaults, 
                                  computerUse: model.modelId 
                                } 
                              }));
                              closeOpenaiDropdown();
                            }}
                            className={`
                              w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group
                              ${modelConfig.systemDefaults?.computerUse === model.modelId 
                                ? 'bg-white/10 text-white' 
                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                              }
                            `}
                          >
                            <span className="font-medium">{model.name}</span>
                            {modelConfig.systemDefaults?.computerUse === model.modelId && (
                              <Check size={14} className="text-white" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);
