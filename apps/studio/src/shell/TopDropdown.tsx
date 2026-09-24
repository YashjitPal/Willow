import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Sparkles, Command, SquarePen, Film } from 'lucide-react';
import { useThemeMode } from '@willow/core/theme-mode';

export const TopDropdown: React.FC<{
  selected?: 'chat' | 'develop' | 'media';
  onSelect?: (mode: 'chat' | 'develop' | 'media') => void;
  showNewChat?: boolean;
  onNewChat?: () => void;
}> = ({ selected: selectedProp = 'chat', onSelect, showNewChat = false, onNewChat }) => {
  const { isLight } = useThemeMode();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<'chat' | 'develop' | 'media'>(selectedProp);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Keep internal state in sync with controlled prop
  useEffect(() => {
    setSelected(selectedProp);
  }, [selectedProp]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (option: 'chat' | 'develop' | 'media') => {
    setSelected(option);
    setIsOpen(false);
    onSelect?.(option);
  };

  return (
    <div
      className="absolute top-4 left-4 z-[100] flex items-center"
    >
      <button 
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 text-[18px] font-medium tracking-tight rounded-xl transition-colors ${
          isLight
            ? `text-[#1f1f1f] hover:bg-black/5 ${isOpen ? 'bg-black/5' : ''}`
            : `text-white/80 hover:text-white hover:bg-white/5 ${isOpen ? 'text-white' : ''}`
        }`}
      >
        <span>{selected === 'chat' ? 'Chat' : selected === 'develop' ? 'Develop' : 'Media'}</span>
        <ChevronDown
          size={16}
          className={`transition-transform duration-200 mt-0.5 ${
            isLight ? 'text-[#747775]' : 'text-white/50'
          } ${isOpen ? 'rotate-180' : ''}`}
          strokeWidth={2.5}
        />
      </button>

      {showNewChat && (
        <button
          onClick={onNewChat}
          title="New chat"
          className={`ml-1 p-1.5 rounded-lg transition-colors ${
            isLight
              ? 'text-[#444746] hover:text-[#1f1f1f] hover:bg-black/5'
              : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
        >
          <SquarePen size={17} strokeWidth={2} />
        </button>
      )}

      {isOpen && (
        <div 
          ref={menuRef}
          className={`absolute top-[calc(100%+4px)] left-0 w-[300px] rounded-2xl p-2 z-[60] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 ${
            isLight
              ? 'bg-white border border-black/10 shadow-[0_10px_30px_rgba(0,0,0,0.12)]'
              : 'bg-[#2a2a2a] shadow-[0_10px_30px_rgba(0,0,0,0.5)]'
          }`}
        >
          <button 
            onClick={() => handleSelect('develop')}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer group ${
              isLight ? 'hover:bg-black/5' : 'hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-3">
              <Sparkles size={20} className={isLight ? 'text-[#1f1f1f]' : 'text-white'} strokeWidth={1.5} />
              <div className="flex flex-col items-start leading-tight text-left">
                <span className={`text-[15px] font-medium mt-0.5 ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Develop</span>
                <span className={`text-[13px] mt-0.5 ${isLight ? 'text-[#444746]' : 'text-[#a0a0a0]'}`}>Build, preview, and ship web applications</span>
              </div>
            </div>
            {selected === 'develop' && <Check size={18} className={isLight ? 'text-[#0b57d0]' : 'text-white'} strokeWidth={2.5} />}
          </button>

          <button 
            onClick={() => handleSelect('chat')}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer group mt-1 ${
              isLight ? 'hover:bg-black/5' : 'hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-3">
              <Command size={20} className={isLight ? 'text-[#1f1f1f]' : 'text-white'} strokeWidth={1.5} />
              <div className="flex flex-col items-start leading-tight text-left">
                <span className={`text-[15px] font-medium mt-0.5 ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Chat</span>
                <span className={`text-[13px] mt-0.5 ${isLight ? 'text-[#444746]' : 'text-[#a0a0a0]'}`}>Conversational partner for everyday tasks</span>
              </div>
            </div>
            {selected === 'chat' && <Check size={18} className={isLight ? 'text-[#0b57d0]' : 'text-white'} strokeWidth={2.5} />}
          </button>

          <button 
            onClick={() => handleSelect('media')}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer group mt-1 ${
              isLight ? 'hover:bg-black/5' : 'hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-3">
              <Film size={20} className={isLight ? 'text-[#1f1f1f]' : 'text-white'} strokeWidth={1.5} />
              <div className="flex flex-col items-start leading-tight text-left">
                <span className={`text-[15px] font-medium mt-0.5 ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Media</span>
                <span className={`text-[13px] mt-0.5 ${isLight ? 'text-[#444746]' : 'text-[#a0a0a0]'}`}>Create, generate, and edit rich multimedia</span>
              </div>
            </div>
            {selected === 'media' && <Check size={18} className={isLight ? 'text-[#0b57d0]' : 'text-white'} strokeWidth={2.5} />}
          </button>
        </div>
      )}
    </div>
  );
};

