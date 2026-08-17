import React, { useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

interface VisualEditorSelectMenuProps {
  options: string[];
  selected?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLElement>;
  label?: string; // e.g. "Select opacity"
  width?: number; // Optional custom width
}

export const VisualEditorSelectMenu: React.FC<VisualEditorSelectMenuProps> = ({ 
  options, 
  selected, 
  onSelect, 
  onClose, 
  isOpen, 
  triggerRef,
  label,
  width = 240
}) => {
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Use layout effect to prevent flash of incorrect position
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current) {
      const updatePosition = () => {
        if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          const menuHeight = Math.min(options.length * 36 + (label ? 40 : 10), 300); // Approximate height calculation
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          
          let placement: 'top' | 'bottom' = 'bottom';
          let top = rect.bottom + 8; // Default to bottom

          // Smart flipping: if not enough space below but enough above, flip it
          if (spaceBelow < menuHeight && spaceAbove > menuHeight) {
            placement = 'top';
          }

          setPosition({
            top: placement === 'bottom' ? rect.bottom + 8 : rect.top - 8,
            left: rect.left,
            placement
          });
        }
      };

      updatePosition();
      
      // Trigger animation after position is set
      requestAnimationFrame(() => {
        setIsVisible(true);
      });

      // Recalculate on scroll/resize
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);

      // Lock body scroll
      document.body.style.overflow = 'hidden';

      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
        document.body.style.overflow = '';
      };
    } else {
        setIsVisible(false);
        // Wait for animation to finish before unmounting (clearing position)
        const timer = setTimeout(() => {
            setPosition(null);
        }, 200);
        return () => clearTimeout(timer);
    }
  }, [isOpen, triggerRef, options.length, label]);

  if (!isOpen && !position) return null;

  const content = (
    <>
        {/* Overlay to handle click outside relative to Portal - High Z-index just below menu */}
        <div 
            className="fixed inset-0 z-[99999] bg-transparent" 
            onClick={onClose} 
        />
        
        <div 
            className={`fixed z-[100000] ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{ 
                top: position?.top ?? 0, 
                left: position?.left ?? 0,
                width: width,
                // Structural transform for placement (Top vs Bottom) - NO TRANSITION
                transform: position?.placement === 'top' ? 'translateY(-100%)' : 'translateY(0)'
            }}
        >
        <div className={`bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl overflow-hidden transition-[opacity,transform] duration-200 origin-top-left ${
                isVisible 
                ? 'opacity-100 scale-100 translate-y-0' 
                : 'opacity-0 scale-95 -translate-y-2'
            } ${position?.placement === 'top' ? 'origin-bottom-left' : 'origin-top-left'}`}
        >
            {/* Optional Label/Header */}
            {label && (
                <div className="flex items-center px-3 py-2 border-b border-white/5 text-gray-400 text-[13px] font-medium">
                    {label}
                </div>
            )}

            {/* Options List */}
            <div className="max-h-[300px] overflow-y-auto py-1 custom-scrollbar">
                {options.map((option) => (
                    <button
                        key={option}
                        onClick={() => {
                            onSelect(option);
                            onClose();
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors group ${selected === option ? 'bg-white/5 text-blue-400' : 'text-gray-300'}`}
                    >
                        <span className={`text-[13px] group-hover:text-white transition-colors ${selected === option ? 'font-medium text-blue-400' : ''}`}>
                            {option}
                        </span>
                        {selected === option && (
                            <Check size={14} className="text-blue-500" />
                        )}
                    </button>
                ))}
            </div>
        </div>
        </div>
    </>
  );

  return createPortal(content, document.body);
};
