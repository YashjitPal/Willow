import React from 'react';
import { Check, Sun, Moon, Laptop, Sparkles, Waves, Layout } from 'lucide-react';
import { WORKSPACE_COLOR_DEFINITIONS } from '@willow/core/workspace-theme';
import { useAuth } from '@willow/auth/AuthContext';
import { useThemeMode, type ThemeChoice as ThemeMode } from '@willow/core/theme-mode';
import { useBackground } from '../../shell/BackgroundContext';

const THEME_STORAGE_KEY = 'willow_theme';

export const AppearanceTab: React.FC = () => {
  const { userProfile, updateUserProfile } = useAuth();
  const { background, setBackground } = useBackground();
  const { themeChoice, isLight, setThemeChoice } = useThemeMode();

  const handleThemeModeChange = (mode: ThemeMode) => {
    setThemeChoice(mode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* storage quota / private browsing */
    }
  };

  // 2. Accent Color State
  const activeColorId = userProfile?.workspaceColor || 'green';

  const handleColorSelect = (colorId: string) => {
    void updateUserProfile({ workspaceColor: colorId as any }).catch(() => {
      /* guest mode fallback */
    });
  };

  return (
    <div className={`w-full h-full relative flex flex-col ${isLight ? 'bg-[#faf9f9]' : 'bg-[#1c1c1c]'}`}>
      <div className="flex-1 overflow-y-auto px-12 py-10 pb-20">
        {/* Header */}
        <div className={`pb-6 border-b ${isLight ? 'border-black/5' : 'border-white/5'} mb-8`}>
          <h1 className={`text-[24px] font-bold tracking-tight ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Appearance</h1>
          <p className={`text-[14px] mt-1 ${isLight ? 'text-[#444746]' : 'text-zinc-400'}`}>
            Customize how Willow looks on your device, choose your theme mode, background style, and accent colors.
          </p>
        </div>

        {/* Section 1: Color Scheme / Theme Mode */}
        <div className={`pb-8 border-b ${isLight ? 'border-black/5' : 'border-white/5'} mb-8`}>
          <h2 className={`text-[15px] font-semibold mb-1 ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Color Scheme</h2>
          <p className={`text-[13px] mb-4 ${isLight ? 'text-[#444746]' : 'text-zinc-400'}`}>
            Select a color theme or automatically match your system appearance.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 max-w-[620px]">
            {/* System Card */}
            <button
              type="button"
              onClick={() => handleThemeModeChange('system')}
              className={`group relative flex flex-col rounded-2xl border p-4 text-left transition-all duration-200 ${
                isLight ? 'bg-white' : 'bg-[#1c1c1c]'
              } ${
                themeChoice === 'system'
                  ? (isLight ? 'border-black/40 shadow-sm' : 'border-white/40 shadow-sm')
                  : (isLight ? 'border-black/10 hover:border-black/20 hover:bg-black/[0.02]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]')
              }`}
            >
              <div className={`h-20 w-full rounded-xl overflow-hidden mb-3.5 border ${isLight ? 'border-black/10' : 'border-white/10'} flex`}>
                <div className="w-1/2 h-full bg-[#f4f4f4] p-2 flex flex-col justify-between">
                  <div className="w-6 h-1 bg-zinc-400 rounded-full" />
                  <div className="w-full h-6 bg-white rounded-md border border-zinc-200" />
                </div>
                <div className="w-1/2 h-full bg-[#121212] p-2 flex flex-col justify-between">
                  <div className="w-6 h-1 bg-zinc-600 rounded-full" />
                  <div className="w-full h-6 bg-[#222222] rounded-md border border-white/5" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Laptop size={16} className={themeChoice === 'system' ? (isLight ? 'text-black' : 'text-white') : (isLight ? 'text-[#444746]' : 'text-zinc-400')} />
                  <span className={`text-[14px] font-medium ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>System</span>
                </div>
                {themeChoice === 'system' && (
                  <div className={`h-5 w-5 rounded-full ${isLight ? 'bg-black text-white' : 'bg-white text-black'} flex items-center justify-center`}>
                    <Check size={13} strokeWidth={2.5} />
                  </div>
                )}
              </div>
            </button>

            {/* Dark Card */}
            <button
              type="button"
              onClick={() => handleThemeModeChange('dark')}
              className={`group relative flex flex-col rounded-2xl border p-4 text-left transition-all duration-200 ${
                isLight ? 'bg-white' : 'bg-[#1c1c1c]'
              } ${
                themeChoice === 'dark'
                  ? (isLight ? 'border-black/40 shadow-sm' : 'border-white/40 shadow-sm')
                  : (isLight ? 'border-black/10 hover:border-black/20 hover:bg-black/[0.02]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]')
              }`}
            >
              <div className={`h-20 w-full rounded-xl overflow-hidden mb-3.5 border ${isLight ? 'border-black/10' : 'border-white/10'} bg-[#121212] p-2.5 flex flex-col justify-between`}>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-1.5 bg-zinc-600 rounded-full" />
                  <div className="w-3 h-3 rounded-full bg-zinc-700" />
                </div>
                <div className="w-full h-7 bg-[#222222] rounded-lg border border-white/5 px-2 flex items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Moon size={16} className={themeChoice === 'dark' ? (isLight ? 'text-black' : 'text-white') : (isLight ? 'text-[#444746]' : 'text-zinc-400')} />
                  <span className={`text-[14px] font-medium ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Dark</span>
                </div>
                {themeChoice === 'dark' && (
                  <div className={`h-5 w-5 rounded-full ${isLight ? 'bg-black text-white' : 'bg-white text-black'} flex items-center justify-center`}>
                    <Check size={13} strokeWidth={2.5} />
                  </div>
                )}
              </div>
            </button>

            {/* Light Card */}
            <button
              type="button"
              onClick={() => handleThemeModeChange('light')}
              className={`group relative flex flex-col rounded-2xl border p-4 text-left transition-all duration-200 ${
                isLight ? 'bg-white' : 'bg-[#1c1c1c]'
              } ${
                themeChoice === 'light'
                  ? (isLight ? 'border-black/40 shadow-sm' : 'border-white/40 shadow-sm')
                  : (isLight ? 'border-black/10 hover:border-black/20 hover:bg-black/[0.02]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]')
              }`}
            >
              <div className={`h-20 w-full rounded-xl overflow-hidden mb-3.5 border ${isLight ? 'border-black/10' : 'border-white/10'} bg-[#f4f4f4] p-2.5 flex flex-col justify-between`}>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-1.5 bg-zinc-400 rounded-full" />
                  <div className="w-3 h-3 rounded-full bg-zinc-300" />
                </div>
                <div className="w-full h-7 bg-white rounded-lg border border-zinc-200 px-2 flex items-center shadow-xs">
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-400" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sun size={16} className={themeChoice === 'light' ? (isLight ? 'text-black' : 'text-white') : (isLight ? 'text-[#444746]' : 'text-zinc-400')} />
                  <span className={`text-[14px] font-medium ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Light</span>
                </div>
                {themeChoice === 'light' && (
                  <div className={`h-5 w-5 rounded-full ${isLight ? 'bg-black text-white' : 'bg-white text-black'} flex items-center justify-center`}>
                    <Check size={13} strokeWidth={2.5} />
                  </div>
                )}
              </div>
            </button>
          </div>
        </div>

        {/* Section 2: Accent Color */}
        <div className={`pb-8 border-b ${isLight ? 'border-black/5' : 'border-white/5'} mb-8`}>
          <h2 className={`text-[15px] font-semibold mb-1 ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Accent Color</h2>
          <p className={`text-[13px] mb-4 ${isLight ? 'text-[#444746]' : 'text-zinc-400'}`}>
            Pick an accent palette. It dynamically styles buttons, highlights, switches, ambient glows, and notifications.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-[620px]">
            {WORKSPACE_COLOR_DEFINITIONS.map((option) => {
              const isSelected = activeColorId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleColorSelect(option.id)}
                  className={`group flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all duration-150 ${
                    isLight ? 'bg-white' : 'bg-[#1c1c1c]'
                  } ${
                    isSelected
                      ? (isLight ? 'border-black/40 shadow-sm' : 'border-white/40 shadow-sm')
                      : (isLight ? 'border-black/10 hover:border-black/20 hover:bg-black/[0.02]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]')
                  }`}
                >
                  <div
                    style={{ backgroundColor: option.hex }}
                    className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-105 ${
                      isSelected ? (isLight ? 'scale-105 ring-2 ring-black/40 ring-offset-2 ring-offset-white' : 'scale-105 ring-2 ring-white/40 ring-offset-2 ring-offset-[#1c1c1c]') : ''
                    }`}
                  >
                    {isSelected && (
                      <span className={`h-2.5 w-2.5 rounded-full ${isLight ? 'bg-white' : 'bg-[#1c1c1c]'}`} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-medium truncate leading-snug ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>
                      {option.label}
                    </div>
                    <div className={`text-[11px] font-mono ${isLight ? 'text-[#747775]' : 'text-zinc-500'}`}>
                      {option.hex}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 3: Background Style */}
        <div>
          <h2 className={`text-[15px] font-semibold mb-1 ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Background Style</h2>
          <p className={`text-[13px] mb-4 ${isLight ? 'text-[#444746]' : 'text-zinc-400'}`}>
            Select an ambient animation or solid dark backdrop for Willow Studio.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 max-w-[620px]">
            {/* Dark Solid */}
            <button
              type="button"
              onClick={() => void setBackground('solid')}
              className={`group flex flex-col rounded-2xl border p-4 text-left transition-all duration-200 ${
                isLight ? 'bg-white' : 'bg-[#1c1c1c]'
              } ${
                background === 'solid'
                  ? (isLight ? 'border-black/40 shadow-sm' : 'border-white/40 shadow-sm')
                  : (isLight ? 'border-black/10 hover:border-black/20 hover:bg-black/[0.02]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]')
              }`}
            >
              <div className={`h-20 w-full rounded-xl overflow-hidden mb-3.5 border ${isLight ? 'border-black/10 bg-[#f4f4f4]' : 'border-white/10 bg-[#0f0f0f]'} flex items-center justify-center`}>
                <Layout size={24} className={isLight ? 'text-zinc-400 group-hover:text-zinc-600 transition-colors' : 'text-zinc-600 group-hover:text-zinc-500 transition-colors'} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-[14px] font-medium ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Dark Solid</div>
                  <div className={`text-[12px] ${isLight ? 'text-[#747775]' : 'text-zinc-500'}`}>Pure clean surface</div>
                </div>
                {background === 'solid' && (
                  <div className={`h-5 w-5 rounded-full ${isLight ? 'bg-black text-white' : 'bg-white text-black'} flex items-center justify-center`}>
                    <Check size={13} strokeWidth={2.5} />
                  </div>
                )}
              </div>
            </button>

            {/* Waves Shader */}
            <button
              type="button"
              onClick={() => void setBackground('waves')}
              className={`group flex flex-col rounded-2xl border p-4 text-left transition-all duration-200 ${
                isLight ? 'bg-white' : 'bg-[#1c1c1c]'
              } ${
                background === 'waves'
                  ? (isLight ? 'border-black/40 shadow-sm' : 'border-white/40 shadow-sm')
                  : (isLight ? 'border-black/10 hover:border-black/20 hover:bg-black/[0.02]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]')
              }`}
            >
              <div className={`h-20 w-full rounded-xl overflow-hidden mb-3.5 border ${isLight ? 'border-black/10' : 'border-white/10'} bg-gradient-to-tr from-[#D94080]/60 via-[#4099FF]/60 to-[#1f1f1f] flex items-center justify-center`}>
                <Waves size={24} className="text-white/80" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-[14px] font-medium ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Waves</div>
                  <div className={`text-[12px] ${isLight ? 'text-[#747775]' : 'text-zinc-500'}`}>GLSL animated shader</div>
                </div>
                {background === 'waves' && (
                  <div className={`h-5 w-5 rounded-full ${isLight ? 'bg-black text-white' : 'bg-white text-black'} flex items-center justify-center`}>
                    <Check size={13} strokeWidth={2.5} />
                  </div>
                )}
              </div>
            </button>

            {/* Lines Shader */}
            <button
              type="button"
              onClick={() => void setBackground('lines')}
              className={`group flex flex-col rounded-2xl border p-4 text-left transition-all duration-200 ${
                isLight ? 'bg-white' : 'bg-[#1c1c1c]'
              } ${
                background === 'lines'
                  ? (isLight ? 'border-black/40 shadow-sm' : 'border-white/40 shadow-sm')
                  : (isLight ? 'border-black/10 hover:border-black/20 hover:bg-black/[0.02]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]')
              }`}
            >
              <div className={`h-20 w-full rounded-xl overflow-hidden mb-3.5 border ${isLight ? 'border-black/10' : 'border-white/10'} bg-[#060606] relative flex items-center justify-center`}>
                <div className="absolute inset-0 flex justify-around opacity-75">
                  <div className="w-[1.5px] h-full bg-gradient-to-b from-amber-400/80 via-yellow-300/60 to-transparent blur-[0.5px]" />
                  <div className="w-[1.5px] h-full bg-gradient-to-b from-gray-300/70 via-slate-400/50 to-transparent blur-[0.5px]" />
                  <div className="w-[1.5px] h-full bg-gradient-to-b from-amber-300/60 via-orange-400/40 to-transparent blur-[0.5px]" />
                </div>
                <Sparkles size={22} className="text-amber-200/90 relative z-10" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-[14px] font-medium ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>Lines</div>
                  <div className={`text-[12px] ${isLight ? 'text-[#747775]' : 'text-zinc-500'}`}>Glowing particle stream</div>
                </div>
                {background === 'lines' && (
                  <div className={`h-5 w-5 rounded-full ${isLight ? 'bg-black text-white' : 'bg-white text-black'} flex items-center justify-center`}>
                    <Check size={13} strokeWidth={2.5} />
                  </div>
                )}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
