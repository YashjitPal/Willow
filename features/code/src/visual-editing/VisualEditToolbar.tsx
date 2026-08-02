// Visual Edit Toolbar - Floating mini-prompt bar for selected elements
import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Copy, EyeOff, Sparkles, Send, X } from 'lucide-react';
import type { SelectedElement, QuickAction } from './engine/types';
import { clearSelection } from './engine/index';

interface VisualEditToolbarProps {
  element: SelectedElement;
  offsetTop: number;
  offsetLeft: number;
  onPromptSubmit?: (prompt: string, element: SelectedElement) => void;
}

const VisualEditToolbar: React.FC<VisualEditToolbarProps> = ({
  element,
  offsetTop,
  offsetLeft,
  onPromptSubmit,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { bounds } = element;

  // Position toolbar below the element (or above if not enough space)
  const toolbarTop = bounds.top + bounds.height + offsetTop + 8;
  const shouldFlip = toolbarTop + 60 > window.innerHeight;
  const finalTop = shouldFlip
    ? bounds.top + offsetTop - 60
    : toolbarTop;

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && onPromptSubmit) {
      onPromptSubmit(prompt.trim(), element);
      setPrompt('');
      setIsExpanded(false);
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    console.log('[VisualEdit] Quick action:', action, element.tagName);
    // TODO: Implement quick actions
    switch (action) {
      case 'delete':
        // Will be implemented with AST manipulation
        break;
      case 'duplicate':
        break;
      case 'hide':
        break;
      case 'edit-text':
        break;
    }
  };

  const handleClose = () => {
    clearSelection();
  };

  return (
    <div
      className="absolute pointer-events-auto z-[55]"
      style={{
        top: finalTop,
        left: bounds.left + offsetLeft,
        minWidth: 280,
      }}
    >
      <div className="flex flex-col gap-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden">
        {/* Main Toolbar Row */}
        <div className="flex items-center gap-1 p-1.5">
          {/* Quick Action Buttons */}
          <button
            onClick={() => handleQuickAction('delete')}
            className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Delete element"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={() => handleQuickAction('duplicate')}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Duplicate element"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={() => handleQuickAction('hide')}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Hide element"
          >
            <EyeOff size={16} />
          </button>

          {/* Divider */}
          <div className="w-px h-5 bg-[#2e2e2e] mx-1" />

          {/* Mini Prompt Input */}
          <div className="flex-1 flex items-center">
            {isExpanded ? (
              <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the change..."
                  className="flex-1 bg-[#27272a] text-white text-sm px-3 py-1.5 rounded-lg border border-transparent focus:border-[#3b82f6]/50 focus:outline-none placeholder:text-gray-500"
                />
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="p-1.5 rounded-lg bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={14} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setIsExpanded(true)}
                className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Sparkles size={14} className="text-[#3b82f6]" />
                <span>Edit with AI...</span>
              </button>
            )}
          </div>

          {/* Close Button */}
          <button
            onClick={handleClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Expanded Prompt Suggestions (optional) */}
        {isExpanded && (
          <div className="px-2 pb-2 flex flex-wrap gap-1.5">
            {['Make it bigger', 'Change color', 'Add shadow', 'Center it'].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setPrompt(suggestion)}
                className="px-2.5 py-1 text-[11px] text-gray-400 bg-[#27272a] hover:bg-[#3b3b3b] rounded-full transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VisualEditToolbar;
