/**
 * The build-mode picker (Ship / Chat / Design / Proto).
 *
 * Self-contained: it takes everything it needs as props and owns its own
 * placement and close state. Moved out of Composer.tsx verbatim.
 *
 * The open/close animation is CSS, not framer-motion: the `animate-dropdown*`
 * classes are Tailwind animations declared in `apps/studio/index.html` and used
 * app-wide, so they travel with the className string.
 * `handleClose` delays the real `onClose` by 150ms to let that animation run —
 * calling `onClose` directly would unmount the menu mid-animation.
 */

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { MODES, type Mode } from './composer-options';

export const ModesMenu: React.FC<{
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  currentMode: Mode;
  onModeSelect: (mode: Mode) => void;
}> = ({ onClose, triggerRef, currentMode, onModeSelect }) => {
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

  return (
    <div
      ref={menuRef}
      className={`absolute left-0 w-[160px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 p-1.5 ${side === "top" ? "bottom-[calc(100%+8px)] origin-bottom-left" : "top-[calc(100%+8px)] origin-top-left"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
    >
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => {
            onModeSelect(mode.id);
            handleClose();
          }}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium
            ${
              currentMode === mode.id
                ? "bg-[#2563eb] text-white"
                : "text-zinc-300 hover:bg-white/5 hover:text-white"
            }`}
        >
          <mode.icon size={16} strokeWidth={2.2} />
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
};
