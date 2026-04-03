import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Sparkles, Command } from 'lucide-react';

export const TopDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<'chat' | 'develop'>('chat');
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => setIsOpen(false), 200);
  };

  const handleSelect = (option: 'chat' | 'develop') => {
    setSelected(option);
    setIsOpen(false);
  };

  return (
    <div 
      className="absolute top-4 left-4 z-[100] flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button 
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 text-[18px] font-medium tracking-tight text-white/80 hover:text-white rounded-xl transition-colors ${isOpen ? 'text-white' : ''}`}
      >
        <span>{selected === 'chat' ? 'Chat' : 'Develop'}</span>
        <ChevronDown 
          size={16} 
          className={`text-white/50 transition-transform duration-200 mt-0.5 ${isOpen ? 'rotate-180' : ''}`} 
          strokeWidth={2.5}
        />
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className="absolute top-[calc(100%+4px)] left-0 w-[300px] bg-[#2a2a2a] rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] p-2 z-[60] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <button 
            onClick={() => handleSelect('develop')}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors hover:bg-white/5 cursor-pointer group`}
          >
            <div className="flex items-center gap-3">
              <Sparkles size={20} className="text-white" strokeWidth={1.5} />
              <div className="flex flex-col items-start leading-tight text-left">
                <span className="text-[15px] font-medium text-white group-hover:text-white mt-0.5">Develop</span>
                <span className="text-[13px] text-[#a0a0a0] mt-0.5">Our smartest model & more</span>
              </div>
            </div>
            {selected === 'develop' && <Check size={18} className="text-white" strokeWidth={2.5} />}
          </button>

          <button 
            onClick={() => handleSelect('chat')}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors hover:bg-white/5 cursor-pointer group mt-1`}
          >
            <div className="flex items-center gap-3">
              <Command size={20} className="text-white" strokeWidth={1.5} />
              <div className="flex flex-col items-start leading-tight text-left">
                <span className="text-[15px] font-medium text-white group-hover:text-white mt-0.5">Chat</span>
                <span className="text-[13px] text-[#a0a0a0] mt-0.5">Great for everyday tasks</span>
              </div>
            </div>
            {selected === 'chat' && <Check size={18} className="text-white" strokeWidth={2.5} />}
          </button>
        </div>
      )}
    </div>
  );
};
