import React from 'react';
import { Check } from 'lucide-react';

interface WorkspaceTabProps {
  localWorkspaceName: string;
  setLocalWorkspaceName: (v: string) => void;
  localWorkspaceDescription: string;
  setLocalWorkspaceDescription: (v: string) => void;
  localWorkspaceColor: string;
  setLocalWorkspaceColor: (v: "green" | "pink" | "yellow" | "orange") => void;
  workspaceSettingsChanged: boolean;
  setWorkspaceSettingsChanged: (v: boolean) => void;
  showWorkspaceColorPicker: boolean;
  setShowWorkspaceColorPicker: (v: boolean) => void;
  colorPickerClosing: boolean;
  closeColorPicker: () => void;
  colorPickerRef: React.RefObject<HTMLDivElement | null>;
  getWorkspaceColorClass: () => string;
  workspaceInitial: string;
  handleWorkspaceUpdate: () => Promise<void>;
  handleWorkspaceCancel: () => void;
}

export const WorkspaceTab: React.FC<WorkspaceTabProps> = ({
  localWorkspaceName,
  setLocalWorkspaceName,
  localWorkspaceDescription,
  setLocalWorkspaceDescription,
  localWorkspaceColor,
  setLocalWorkspaceColor,
  workspaceSettingsChanged,
  setWorkspaceSettingsChanged,
  showWorkspaceColorPicker,
  setShowWorkspaceColorPicker,
  colorPickerClosing,
  closeColorPicker,
  colorPickerRef,
  getWorkspaceColorClass,
  workspaceInitial,
  handleWorkspaceUpdate,
  handleWorkspaceCancel,
}) => (
  <div className="w-full h-full relative">
    <div className="px-12 py-10 overflow-y-auto h-full pb-24">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[24px] font-bold text-white">Workspace settings</h1>
      </div>
      <div className="pb-6 border-b border-white/5 mb-6">
        <p className="text-[14px] text-zinc-400">
          Workspaces allow you to collaborate on projects in real time.
        </p>
      </div>

      {/* Workspace Avatar with Color Picker */}
      <div className="flex items-start gap-8 py-6 border-b border-white/5">
        <div className="w-[50%] shrink-0">
          <h3 className="text-[14px] font-bold text-white mb-1">Workspace avatar</h3>
          <p className="text-[14px] text-zinc-400">Set an avatar color for your workspace.</p>
        </div>
        <div className="flex-1 flex justify-end md:justify-start">
          <div className="relative" ref={colorPickerRef}>
            <button
              onClick={() => {
                if (showWorkspaceColorPicker) {
                  closeColorPicker();
                } else {
                  setShowWorkspaceColorPicker(true);
                }
              }}
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-[16px] font-bold text-white shadow-inner cursor-pointer hover:opacity-90 transition-all ${getWorkspaceColorClass()}`}
            >
              {workspaceInitial}
            </button>

            {/* Color Picker Slide-out */}
            {showWorkspaceColorPicker && (
              <div className={`absolute left-12 top-0 bg-[#1a1a1a] border border-white/10 rounded-xl p-2 flex gap-2 shadow-xl z-50 ${colorPickerClosing ? 'animate-slide-out-left' : 'animate-slide-in-right'}`}>
                {[
                  { id: 'green', color: 'bg-[#4a7c59]', label: 'Willow Green' },
                  { id: 'pink', color: 'bg-[#ec4899]', label: 'Pink' },
                  { id: 'yellow', color: 'bg-[#eab308]', label: 'Yellow' },
                  { id: 'orange', color: 'bg-[#f97316]', label: 'Orange' },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setLocalWorkspaceColor(option.id as "green" | "pink" | "yellow" | "orange");
                      setWorkspaceSettingsChanged(true);
                      closeColorPicker();
                    }}
                    className={`w-10 h-10 rounded-lg ${option.color} flex items-center justify-center transition-all hover:scale-110 ${localWorkspaceColor === option.id ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1a1a1a]' : ''}`}
                    title={option.label}
                  >
                    {localWorkspaceColor === option.id && <Check size={16} className="text-white" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workspace Name */}
      <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
          <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Workspace name</h3>
            <p className="text-[14px] text-zinc-400">Your full workspace name, as visible to others.</p>
          </div>
          <div className="flex-1">
            <input
              type="text"
              value={localWorkspaceName}
              onChange={(e) => {
                setLocalWorkspaceName(e.target.value);
                setWorkspaceSettingsChanged(true);
              }}
              className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
            />
            <div className="text-right mt-1.5 text-[12px] text-zinc-500 font-mono">
              {localWorkspaceName.length} / 100 characters
            </div>
          </div>
        </div>
      </div>

      {/* Workspace Description */}
      <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
          <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Workspace description</h3>
            <p className="text-[14px] text-zinc-400">A short description about your workspace or team.</p>
          </div>
          <div className="flex-1">
            <textarea
              placeholder="Description"
              value={localWorkspaceDescription}
              onChange={(e) => {
                setLocalWorkspaceDescription(e.target.value);
                setWorkspaceSettingsChanged(true);
              }}
              maxLength={500}
              className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors resize-y min-h-[100px]"
            />
            <div className="text-right mt-1.5 text-[12px] text-zinc-500 font-mono">
              {localWorkspaceDescription.length} / 500 characters
            </div>
          </div>
        </div>
      </div>

      {/* Leave Workspace */}
      <div className="py-6">
        <div className="flex items-start gap-8">
          <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Leave workspace</h3>
            <p className="text-[14px] text-zinc-400 leading-relaxed">
              You cannot leave your last workspace. Your account must be a member of at least one workspace.
            </p>
          </div>
          <div className="flex-1 flex justify-end">
            <button className="px-4 py-2 bg-[#2d1515] text-[#ff4d4d] text-[13px] font-medium rounded-lg hover:bg-[#3d1a1a] transition-colors border border-[#ff4d4d]/10">
              Leave workspace
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Floating Footer */}
    <div className="absolute bottom-0 w-full bg-[#1c1c1c] border-t border-white/10 px-8 py-4 flex items-center justify-end gap-3 z-10 shadow-2xl">
      <button
        onClick={handleWorkspaceCancel}
        className="px-4 py-2 text-[13px] font-bold text-white hover:bg-white/5 rounded-lg transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={handleWorkspaceUpdate}
        disabled={!workspaceSettingsChanged}
        className="px-5 py-2 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-100 transition-colors shadow-lg shadow-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Update
      </button>
    </div>
  </div>
);
