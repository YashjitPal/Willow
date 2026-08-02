import React from 'react';
import { ChevronDown, Globe, LayoutGrid, FileText, Lock, PenLine, Shield, Crown } from 'lucide-react';

// Re-export the SettingsDropdownMenu type contract — the actual component stays in SettingsModal.tsx
interface SettingsDropdownMenuProps {
  current: string;
  options: Array<{ id: string; label: string; icon: React.ElementType }>;
  onSelect: (val: string) => void;
  onClose: () => void;
  width?: string;
}

interface PrivacyTabProps {
  defaultVisibility: string;
  setDefaultVisibility: (v: string) => void;
  showVisibilityMenu: boolean;
  setShowVisibilityMenu: (v: boolean) => void;
  websiteAccess: string;
  setWebsiteAccess: (v: string) => void;
  showWebsiteMenu: boolean;
  setShowWebsiteMenu: (v: boolean) => void;
  publishAccess: string;
  setPublishAccess: (v: string) => void;
  showPublishMenu: boolean;
  setShowPublishMenu: (v: boolean) => void;
  SettingsDropdownMenu: React.FC<SettingsDropdownMenuProps>;
}

export const PrivacyTab: React.FC<PrivacyTabProps> = ({
  defaultVisibility,
  setDefaultVisibility,
  showVisibilityMenu,
  setShowVisibilityMenu,
  websiteAccess,
  setWebsiteAccess,
  showWebsiteMenu,
  setShowWebsiteMenu,
  publishAccess,
  setPublishAccess,
  showPublishMenu,
  setShowPublishMenu,
  SettingsDropdownMenu,
}) => (
  <div className="w-full h-full px-12 py-10 overflow-y-auto">
    <div className="flex items-center justify-between mb-2">
      <h1 className="text-[24px] font-bold text-white">Privacy & security</h1>
    </div>
    
    <div className="pb-6 border-b border-white/5 mb-0">
      <p className="text-[14px] text-zinc-400">
        Manage privacy and security settings for your workspace.
      </p>
    </div>

    <div className="space-y-0 pb-10">
      {/* Default project visibility */}
      <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Default project visibility</h3>
          <p className="text-[14px] text-zinc-400">Choose whether new projects start as public, private (workspace-only), or drafts.</p>
        </div>
        <div className="relative">
          <button 
            onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
            className="flex items-center gap-3 px-3 py-1.5 bg-[#242424]/40 border border-white/5 rounded-lg text-[13px] text-zinc-300 hover:bg-white/5 transition-colors group"
          >
            {defaultVisibility === 'public' && <Globe size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />}
            {defaultVisibility === 'workspace' && <LayoutGrid size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />}
            {defaultVisibility === 'personal' && <FileText size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />}
            
            <span className="font-semibold capitalize">{defaultVisibility}</span>
            <ChevronDown size={14} className="text-zinc-500" />
          </button>
          
          {showVisibilityMenu && (
            <SettingsDropdownMenu 
              current={defaultVisibility}
              options={[
                { id: 'public', label: 'Public', icon: Globe },
                { id: 'workspace', label: 'Workspace', icon: LayoutGrid },
                { id: 'personal', label: 'Personal', icon: FileText },
              ]}
              onSelect={setDefaultVisibility}
              onClose={() => setShowVisibilityMenu(false)}
              width="180px"
            />
          )}
        </div>
      </div>

      {/* Default website access */}
      <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white">Default website access</h3>
          <p className="text-[14px] text-zinc-400">Choose if new published websites are public or only accessible to logged in workspace members.</p>
        </div>
        <div className="relative">
          <button 
            onClick={() => setShowWebsiteMenu(!showWebsiteMenu)}
            className="flex items-center gap-3 px-3 py-1.5 bg-[#242424]/40 border border-white/5 rounded-lg text-[13px] text-zinc-300 hover:bg-white/5 transition-colors group min-w-[120px]"
          >
            {websiteAccess === 'anyone' ? (
              <Globe size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
            ) : (
              <Lock size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
            )}
            <span className="font-semibold capitalize">{websiteAccess}</span>
            <ChevronDown size={14} className="text-zinc-500" />
          </button>
          
          {showWebsiteMenu && (
            <SettingsDropdownMenu 
              current={websiteAccess}
              options={[
                { id: 'anyone', label: 'Anyone', icon: Globe },
                { id: 'workspace', label: 'Workspace', icon: Lock },
              ]}
              onSelect={setWebsiteAccess}
              onClose={() => setShowWebsiteMenu(false)}
              width="160px"
            />
          )}
        </div>
      </div>

      {/* MCP servers access */}
      <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white">MCP servers access</h3>
          <p className="text-[14px] text-zinc-400">Enable or disable MCP servers for all workspace members.</p>
        </div>
        <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
          <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all -translate-x-0 group-hover:bg-zinc-500" />
        </div>
      </div>


      {/* Restrict workspace invitations */}
      <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Restrict workspace invitations</h3>
          <p className="text-[14px] text-zinc-400">When enabled, only admins and owners can invite members to this workspace.</p>
        </div>
        <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
          <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all -translate-x-0 group-hover:bg-zinc-500" />
        </div>
      </div>

      {/* Who can publish externally */}
      <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Who can publish externally</h3>
          <p className="text-[14px] text-zinc-400">Control who can publish and deploy projects to the web.</p>
        </div>
        <div className="relative">
          <button 
            onClick={() => setShowPublishMenu(!showPublishMenu)}
            className="flex items-center gap-3 px-3 py-1.5 bg-[#242424]/40 border border-white/5 rounded-lg text-[13px] text-zinc-300 hover:bg-white/5 transition-colors group min-w-[160px]"
          >
            {publishAccess === 'editors' && <PenLine size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />}
            {publishAccess === 'admins' && <Shield size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />}
            {publishAccess === 'owners' && <Crown size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />}
            
            <span className="font-semibold truncate">
              {publishAccess === 'editors' && 'Editors and above'}
              {publishAccess === 'admins' && 'Admins and owners'}
              {publishAccess === 'owners' && 'Owners only'}
            </span>
            <ChevronDown size={14} className="text-zinc-500" />
          </button>
          
          {showPublishMenu && (
            <SettingsDropdownMenu 
              current={publishAccess}
              options={[
                { id: 'editors', label: 'Editors and above', icon: PenLine },
                { id: 'admins', label: 'Admins and owners', icon: Shield },
                { id: 'owners', label: 'Owners only', icon: Crown },
              ]}
              onSelect={setPublishAccess}
              onClose={() => setShowPublishMenu(false)}
              width="200px"
            />
          )}
        </div>
      </div>

      {/* Disable share preview */}
      <div className="py-6 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Disable share preview</h3>
          <p className="text-[14px] text-zinc-400">When enabled, users will not be able to create temporary public app preview links, which are accessible to anyone.</p>
        </div>
        <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
          <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all -translate-x-0 group-hover:bg-zinc-500" />
        </div>
      </div>
    </div>
  </div>
);
