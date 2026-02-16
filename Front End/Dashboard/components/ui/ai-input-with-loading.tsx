"use client";

import { ArrowUp, Code2, Trash2, X } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface AIInputWithLoadingProps {
  id?: string;
  placeholder?: string;
  loadingDuration?: number;
  thinkingDuration?: number;
  onSubmit?: (value: string) => void | Promise<void>;
  onDelete?: () => void;
  onCode?: () => void;
  onClose?: () => void;
  className?: string;
  autoAnimate?: boolean;
  /** External loading state - when true, shows loading spinner */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** When true, disables all inputs and grays out the component */
  disabled?: boolean;
}

export function AIInputWithLoading({
  id = "ai-input-with-loading",
  placeholder = "Ask me anything!",
  loadingDuration = 3000,
  thinkingDuration = 1000,
  onSubmit,
  onDelete,
  onCode,
  onClose,
  className,
  autoAnimate = false,
  isLoading: externalLoading,
  error,
  disabled = false,
}: AIInputWithLoadingProps) {
  const [inputValue, setInputValue] = useState("");
  const [internalSubmitted, setInternalSubmitted] = useState(autoAnimate);
  const [isAnimating, setIsAnimating] = useState(autoAnimate);

  // Use external loading state if provided, otherwise use internal
  const isLoading = externalLoading !== undefined ? externalLoading : internalSubmitted;

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const runAnimation = () => {
      if (!isAnimating) return;
      setInternalSubmitted(true);
      timeoutId = setTimeout(() => {
        setInternalSubmitted(false);
        timeoutId = setTimeout(runAnimation, thinkingDuration);
      }, loadingDuration);
    };

    if (isAnimating) {
      runAnimation();
    }

    return () => clearTimeout(timeoutId);
  }, [isAnimating, loadingDuration, thinkingDuration]);

  const handleSubmit = async () => {
    if (!inputValue.trim() || isLoading || disabled) return;

    // Only manage internal state if not externally controlled
    if (externalLoading === undefined) {
      setInternalSubmitted(true);
    }

    await onSubmit?.(inputValue);
    setInputValue("");

    // Only reset if not externally controlled
    if (externalLoading === undefined) {
      setTimeout(() => {
        setInternalSubmitted(false);
      }, loadingDuration);
    }
  };

  return (
    <div className="w-full py-1.5 flex justify-center">
      <div className={cn(
        "relative w-auto mx-auto flex flex-col items-center gap-1",
        className
      )}>
        <div className="flex items-center gap-2 bg-[#1c1c1c] rounded-2xl px-3.5 shadow-2xl h-[44px]">
          <div className="w-[180px] flex items-center h-full">
            <input
              id={id}
              type="text"
              placeholder={placeholder}
              className={cn(
                "w-full bg-transparent border-none ring-0 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none",
                "!border-none !ring-0 !shadow-none !outline-none",
                "text-[#a1a1aa] placeholder:text-[#52525b] text-sm h-full transition-opacity duration-200",
                disabled && "opacity-40"
              )}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={isLoading || disabled}
            />
          </div>

          <div className="flex items-center gap-2.5">
            {/* Send button - disabled when disabled */}
            <button
              onClick={handleSubmit}
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-full transition-all duration-200",
                isLoading ? "bg-none" : "bg-[#d4d4d8] hover:bg-[#e5e5e5]",
                disabled && "opacity-40 pointer-events-none"
              )}
              type="button"
              disabled={isLoading || disabled}
            >
              {isLoading ? (
                <div
                  className="w-3.5 h-3.5 bg-white rounded-sm animate-spin transition duration-700"
                  style={{ animationDuration: "3s" }}
                />
              ) : (
                <ArrowUp size={16} className="text-[#161616]" />
              )}
            </button>

            <div className="w-[1px] h-5 bg-[#2e2e2e]" />

            {/* Code button - disabled when disabled */}
            <button
              onClick={onCode}
              className={cn(
                "p-1 rounded text-[#a1a1aa] hover:text-white transition-all duration-200",
                disabled && "opacity-40 pointer-events-none"
              )}
              title="View Code"
              disabled={disabled}
            >
              <Code2 size={18} />
            </button>

            {/* Delete button - always active */}
            <button
              onClick={onDelete}
              className="p-1 rounded text-[#ef4444]/70 hover:text-[#ef4444] transition-colors"
              title="Delete Element"
            >
              <Trash2 size={18} />
            </button>

            {/* Close button - always active */}
            <button
              onClick={onClose}
              className="p-1 rounded text-[#a1a1aa] hover:text-white transition-colors"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          {isLoading && (
            <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md text-[11px] text-[#a1a1aa] animate-in fade-in slide-in-from-bottom-1">
              Applying changes...
            </div>
          )}
        </div>

        {/* Error message display */}
        {error && (
          <div className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-400 max-w-[300px] truncate">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
