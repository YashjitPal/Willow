import React from 'react';
import { Check } from 'lucide-react';
import { useBackground, BackgroundType } from '../BackgroundContext';
import { useThemeMode } from '@willow/core/theme-mode';

export const AppearanceMenu: React.FC<{ onClose: () => void; isClosing?: boolean; isMounted?: boolean; backgroundType?: string }> = ({ onClose, isClosing, isMounted, backgroundType }) => {
  const { themeChoice, isLight, setThemeChoice } = useThemeMode();
  const { background, setBackground } = useBackground();

  const backgrounds: { id: BackgroundType; label: string; preview: React.ReactNode }[] = [
    {
      id: 'solid',
      label: 'Solid',
      preview: (
        <div className="w-full h-full bg-[#212121] flex flex-col items-center justify-center px-2 gap-1.5">
          <div className="w-8 h-0.5 bg-white/60 rounded-full" />
          <div className="w-full h-3 bg-[#2f2f2f] rounded-[4px] border border-white/5 flex items-center justify-between px-1">
            <div className="w-1 h-1 rounded-full bg-white/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-white/80" />
          </div>
        </div>
      )
    },
    {
      id: 'waves',
      label: 'Waves',
      preview: (
        <div className="w-full h-full bg-gradient-to-t from-[#D94080] via-[#4099FF] to-[#1f1f1f]" />
      )
    },
    {
      id: 'lines',
      label: 'Lines',
      preview: (
        <div className="w-full h-full bg-[#030303] relative overflow-hidden">
          {/* Gold-silvery glowing lines on dark background */}
          <div className="absolute inset-0 flex justify-around">
            <div className="w-[2px] h-full bg-gradient-to-b from-amber-400/80 via-yellow-300/60 to-transparent blur-[1px]" />
            <div className="w-[2px] h-full bg-gradient-to-b from-gray-300/70 via-slate-400/50 to-transparent blur-[1px]" />
            <div className="w-[2px] h-full bg-gradient-to-b from-amber-300/60 via-orange-400/40 to-transparent blur-[1px]" />
            <div className="w-[2px] h-full bg-gradient-to-b from-slate-300/50 via-gray-400/30 to-transparent blur-[1px]" />
          </div>
        </div>
      )
    }
  ];

  // Determine animation state
  const getAnimationClass = () => {
    if (isClosing) return 'opacity-0 translate-x-[-8px]';
    if (isMounted) return 'opacity-100 translate-x-0';
    return 'opacity-0 translate-x-[-8px]'; // Initial state before mounting animation
  };

  const sidebarBgClass = isLight
    ? (backgroundType === 'waves' ? 'bg-white/90 backdrop-blur-xl' : 'bg-white')
    : (backgroundType === 'waves' ? 'bg-[#1f1f1f]/90 backdrop-blur-xl' : 'bg-[#1f1f1f]');

  return (
    <div 
      style={{ 
        boxShadow: isLight
          ? '0 10px 30px -5px rgba(0, 0, 0, 0.08), 0 0 20px rgba(0, 0, 0, 0.04)'
          : '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset'
      }}
      className={`absolute top-0 left-[calc(100%+12px)] w-[200px] ${sidebarBgClass} ${isLight ? 'border border-black/5 text-[#1f1f1f]' : 'text-white'} rounded-xl shadow-2xl py-2 z-[70] transition-all duration-150
        before:absolute before:-left-6 before:top-0 before:bottom-0 before:w-6 before:content-['']
        ${getAnimationClass()}`}
    >
      <div className="p-3 grid grid-cols-3 gap-3">
        {backgrounds.map((bg) => (
          <button 
            key={bg.id}
            onClick={() => setBackground(bg.id)}
            className={`aspect-square rounded-xl overflow-hidden transition-all ring-2 ${
              background === bg.id 
                ? (isLight ? 'ring-black/60 scale-105' : 'ring-white/60 scale-105')
                : (isLight ? 'ring-black/10 hover:ring-black/30' : 'ring-white/10 hover:ring-white/30')
            }`}
            title={bg.label}
          >
            {bg.preview}
          </button>
        ))}
      </div>

      <div className="px-1.5 space-y-0.5 mt-1">
        <button 
          onClick={() => setThemeChoice('light')}
          className={`w-full flex items-center justify-between px-3 h-[30px] text-[13.5px] font-medium tracking-tight ${
            isLight ? 'text-[#1f1f1f] hover:bg-black/[0.05]' : 'text-white hover:bg-white/5'
          } rounded-xl transition-colors`}
        >
          <span>Light</span>
          {themeChoice === 'light' && <Check size={16} className={isLight ? 'text-black' : 'text-white'} />}
        </button>
        <button 
          onClick={() => setThemeChoice('dark')}
          className={`w-full flex items-center justify-between px-3 h-[30px] text-[13.5px] font-medium tracking-tight ${
            isLight ? 'text-[#1f1f1f] hover:bg-black/[0.05]' : 'text-white hover:bg-white/5'
          } rounded-xl transition-colors`}
        >
          <span>Dark</span>
          {themeChoice === 'dark' && <Check size={16} className={isLight ? 'text-black' : 'text-white'} />}
        </button>
        <button 
          onClick={() => setThemeChoice('system')}
          className={`w-full flex items-center justify-between px-3 h-[30px] text-[13.5px] font-medium tracking-tight ${
            isLight ? 'text-[#1f1f1f] hover:bg-black/[0.05]' : 'text-white hover:bg-white/5'
          } rounded-xl transition-colors`}
        >
          <span>System</span>
          {themeChoice === 'system' && <Check size={16} className={isLight ? 'text-black' : 'text-white'} />}
        </button>
      </div>
    </div>
  );
};
