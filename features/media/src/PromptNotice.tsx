import React from 'react';
import { X } from 'lucide-react';

export type PromptNoticeState = {
  message: string;
  /** Adds a button that opens Settings → Models. */
  settings?: boolean;
  /** No model of this kind is added. The notice hides itself once one is. */
  missingModel?: 'image' | 'video' | 'music';
};

/** The line above a prompt box when a generation could not start. */
export function PromptNotice({ notice, onDismiss, onOpenSettings }: {
  notice: PromptNoticeState;
  onDismiss: () => void;
  onOpenSettings?: () => void;
}) {
  const isAsk = !!notice.missingModel;
  return (
    <div
      className={`p-3 mx-1 rounded-xl text-xs flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-1 duration-200 ${
        isAsk ? 'bg-white/[0.04] border border-white/10 text-[#e3e3e3]' : 'bg-red-950/20 border border-red-500/20 text-red-300'
      }`}
    >
      <span className="font-semibold leading-relaxed">{notice.message}</span>
      <div className="flex items-center gap-1 shrink-0">
        {notice.settings && onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-7 px-3 rounded-full bg-[#f1f3f4] text-[#202124] text-[12px] font-medium hover:bg-white transition-colors cursor-pointer"
          >
            {isAsk ? 'Add a model' : 'Open Settings'}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          className={`p-1 hover:bg-white/5 rounded-full hover:text-white transition-colors shrink-0 cursor-pointer ${isAsk ? 'text-[#a0a0a0]' : 'text-red-400'}`}
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
