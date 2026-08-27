/**
 * The theme picker, with a search box.
 *
 * Self-contained: props in, no shared closure with the composer. Moved out of
 * Composer.tsx verbatim.
 *
 * Placement and close behaviour are the same pattern as ./ModesMenu — the two
 * were written separately and still hold identical copies of `calculatePosition`
 * and the scroll/resize/click-outside effects. They are left as copies here
 * rather than merged, so this move stays a pure relocation.
 *
 * Selecting a theme only sets local state; nothing is persisted yet.
 */

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Plus, Search, Settings } from "lucide-react";
import { THEMES } from './composer-options';

export const ThemesMenu: React.FC<{
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onAuthRequired?: () => void;
}> = ({ onClose, triggerRef, onAuthRequired }) => {
  const [selectedId, setSelectedId] = useState("default");
  const [searchQuery, setSearchQuery] = useState("");
  const [side, setSide] = useState<"top" | "bottom">("top");
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 150);
  };

  const calculatePosition = () => {
    if (!triggerRef.current || !menuRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    const viewportHeight = window.innerHeight;
    const spacing = 8;
    const spaceAbove = triggerRect.top;
    const spaceBelow = viewportHeight - triggerRect.bottom;

    if (side === "top") {
      if (spaceAbove < menuHeight + spacing && spaceBelow > spaceAbove)
        setSide("bottom");
    } else {
      if (spaceBelow < menuHeight + spacing && spaceAbove > spaceBelow)
        setSide("top");
    }
  };

  useLayoutEffect(() => {
    calculatePosition();
  }, []);

  useEffect(() => {
    const handleScroll = () => calculatePosition();
    const scrollContainer = document.querySelector("main");
    if (scrollContainer)
      scrollContainer.addEventListener("scroll", handleScroll, {
        passive: true,
      });
    window.addEventListener("resize", handleScroll);
    return () => {
      if (scrollContainer)
        scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [side]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        // Click is outside menu - trigger animated close
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredThemes = THEMES.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      ref={menuRef}
      className={`absolute left-0 w-[240px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 ${side === "top" ? "bottom-[calc(100%+8px)] origin-bottom-left" : "top-[calc(100%+8px)] origin-top-left"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
    >
      <div className="relative flex items-center px-4 py-3.5 border-b border-white/5 bg-[#1c1c1c]">
        <Search
          className="text-zinc-500 shrink-0 mr-3"
          size={18}
          strokeWidth={2.5}
        />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent text-white text-[14px] placeholder-zinc-500 outline-none flex-1 leading-none font-normal"
          placeholder="Search themes..."

        />
      </div>

      <div className="flex-1 overflow-y-auto max-h-[260px] p-2 pt-0 no-scrollbar bg-[#1c1c1c]">
        <div className="px-2 pt-3.5 pb-2 text-[10.5px] font-bold text-zinc-500 uppercase tracking-widest">
          DEFAULT THEMES
        </div>
        <div className="space-y-0.5">
          {filteredThemes.map((theme) => {
            const isSelected = selectedId === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => setSelectedId(theme.id)}
                className={`w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[13.5px] font-medium group
                  ${
                    isSelected
                      ? "bg-[#2563eb] text-white shadow-lg shadow-blue-500/10"
                      : "text-zinc-300 hover:bg-white/5 hover:text-white"
                  }`}
              >
                <span>{theme.name}</span>
                <div className="flex items-center -space-x-1.5">
                  {theme.colors.map((color, i) => (
                    <div
                      key={i}
                      className={`w-[14px] h-[14px] rounded-full ring-[1.5px] relative
                        ${
                          isSelected
                            ? "ring-[#2563eb]"
                            : "ring-[#1c1c1c] group-hover:ring-[#2a2a2a]"
                        }`}
                      style={{ backgroundColor: color, zIndex: 3 - i }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center h-[42px] border-t border-white/10 mt-1 bg-[#1c1c1c]">
        <button 
          onClick={() => { onAuthRequired?.(); handleClose(); }}
          className="flex-1 flex items-center justify-center gap-2 text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/5 h-full"
        >
          <Plus size={14} strokeWidth={2.5} />
          <span>Create new</span>
        </button>
        <div className="w-[1px] h-4 bg-white/10"></div>
        <button 
          onClick={() => { onAuthRequired?.(); handleClose(); }}
          className="w-[42px] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 h-full"
        >
          <Settings size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
};
