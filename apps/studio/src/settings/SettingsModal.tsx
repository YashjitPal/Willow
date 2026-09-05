import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { X, Search, HelpCircle, User, Users, CreditCard, Cloud, Lock, Home, ChevronDown, MoreHorizontal, FlaskConical, ArrowUpRight, Cpu, Check, Loader2, Zap, AlertCircle, LayoutGrid, Globe, FileText, Shield, Crown, PenLine, Lightbulb, HardDrive, FolderOpen, Link, Github, Brain } from 'lucide-react';
import './SettingsModal.css'; // Assuming we can import a CSS file or add a style tag
import { useStore } from '@nanostores/react';
import { useAuth } from '@willow/auth/AuthContext';
import { experimentsStore } from '@willow/core/experiments-store';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { WorkspaceTab, PeopleTab, PrivacyTab, LabsTab, AccountTab, ConnectorsTab, ModelsTab, GovernanceTab, PersonalIntelligenceTab } from './tabs/index';
import { type ProviderId } from '@willow/ai/providers/endpoints';
import { GEMINI_MODELS } from './provider-models';
import { useProviderSettings } from './use-provider-settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelConfig: any; // Using any for brevity or I could define the full type if needed
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  initialTab?: SectionType;
  initialConnector?: string | null;
}

type SectionType = 'workspace' | 'people' | 'models' | 'cloud' | 'privacy' | 'governance' | 'account' | 'labs' | 'connectors' | 'github';

const SettingsSidebarItem: React.FC<{ 
  icon?: React.ElementType; 
  label: string; 
  active?: boolean;
  hasSubItems?: boolean;
  onClick?: () => void;
  customIconColor?: string;
  customIconInitial?: string;
}> = ({ icon: Icon, label, active, hasSubItems, onClick, customIconColor, customIconInitial }) => (
  <button
    type="button"
    aria-current={active ? 'page' : undefined}
    className={`settings-keyboard-control w-full flex items-center gap-3 px-3 py-[9px] text-[13px] font-medium rounded-lg transition-colors
      ${active 
        ? 'bg-[#1f1f1f] text-white' 
        : 'text-zinc-400 hover:bg-[#1f1f1f] hover:text-white'
      }`}
    onClick={onClick}
  >
    {Icon && <Icon size={18} strokeWidth={2} />}
    {!Icon && customIconColor && (
        <div className={`w-5 h-5 rounded ${customIconColor} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
            {customIconInitial || 'W'}
        </div>
    )}
    {!Icon && !customIconColor && (
        <div className="w-5 h-5 rounded bg-[#4a7c59] flex items-center justify-center text-[10px] font-bold text-white shrink-0">W</div>
    )}
    <span className="flex-1 text-left truncate">{label}</span>
  </button>
);

const SettingsSectionTitle: React.FC<{ title: string }> = ({ title }) => (
    <div className="px-3 mt-5 mb-2 text-[12px] font-medium text-zinc-500">
        {title}
    </div>
);

const SettingsDropdownMenu: React.FC<{ 
  current: string; 
  options: Array<{ id: string; label: string; icon: React.ElementType }>;
  onSelect: (val: string) => void;
  onClose: () => void;
  width?: string;
}> = ({ current, options, onSelect, onClose, width = '200px' }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div 
      ref={menuRef}
      style={{ width }}
      className="absolute top-full right-0 mt-1 bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl py-1.5 z-[100] animate-in fade-in zoom-in-95 duration-150"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => {
            onSelect(opt.id);
            onClose();
          }}
          className={`w-full flex items-center justify-between px-3 h-[36px] text-[13.5px] font-medium tracking-tight transition-colors
            ${current === opt.id ? 'bg-[#1e2b48] text-[#58a1ff]' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
        >
          <div className="flex items-center gap-3">
            <opt.icon size={16} strokeWidth={2} className={current === opt.id ? 'text-[#58a1ff]' : 'text-zinc-500'} />
            <span>{opt.label}</span>
          </div>
          {current === opt.id && <Check size={14} className="text-[#58a1ff]" />}
        </button>
      ))}
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, modelConfig, setModelConfig, initialTab, initialConnector }) => {
  const { user, userProfile, updateUserProfile, signOut, isDriveConnected, connectDrive, disconnectDrive } = useAuth();
  const {
    isSupported: isLocalFSSupported,
    isLocalFolderConnected,
    localFolderName,
    connectLocalFolder,
    disconnectLocalFolder
  } = useLocalFS();
  const isAgentsEnabled = useStore(experimentsStore)['agents-surface'];
  const [profileName, setProfileName] = useState('');
  const [shouldRender, setShouldRender] = React.useState(isOpen);
  const [isClosing, setIsClosing] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<SectionType>(initialTab || 'workspace');
  const [defaultVisibility, setDefaultVisibility] = useState('workspace');
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const [websiteAccess, setWebsiteAccess] = useState('anyone');
  const [showWebsiteMenu, setShowWebsiteMenu] = useState(false);
  const [publishAccess, setPublishAccess] = useState('editors');
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showWorkspaceColorPicker, setShowWorkspaceColorPicker] = useState(false);
  const [colorPickerClosing, setColorPickerClosing] = useState(false);
  const colorPickerRef = React.useRef<HTMLDivElement>(null);
  
  // Generate dynamic workspace name fallback
  const getDefaultWorkspaceName = () => {
    if (userProfile?.workspaceName) return userProfile.workspaceName;
    if (userProfile?.displayName) {
      const firstName = userProfile.displayName.split(' ')[0];
      return `${firstName}'s Willow`;
    }
    return "My Willow";
  };
  
  // ===== WORKSPACE SETTINGS LOCAL STATE =====
  const [localWorkspaceName, setLocalWorkspaceName] = useState(getDefaultWorkspaceName());
  const [localWorkspaceDescription, setLocalWorkspaceDescription] = useState(userProfile?.workspaceDescription || '');
  const [localWorkspaceColor, setLocalWorkspaceColor] = useState(userProfile?.workspaceColor || 'green');
  const [workspaceSettingsChanged, setWorkspaceSettingsChanged] = useState(false);
  
  // ===== ACCOUNT SETTINGS LOCAL STATE =====
  const [localDisplayName, setLocalDisplayName] = useState(userProfile?.displayName || '');
  const [localUsername, setLocalUsername] = useState(userProfile?.username || '');
  const [localPhotoURL, setLocalPhotoURL] = useState(userProfile?.photoURL || null);
  const [localLocation, setLocalLocation] = useState(userProfile?.location || '');
  const [localDescription, setLocalDescription] = useState(userProfile?.description || '');
  const [accountSettingsChanged, setAccountSettingsChanged] = useState(false);
  
  // Sync local state when userProfile changes (initial load or external changes)
  React.useEffect(() => {
    if (!workspaceSettingsChanged) {
      setLocalWorkspaceName(getDefaultWorkspaceName());
      setLocalWorkspaceColor(userProfile?.workspaceColor || 'green');
      setLocalWorkspaceDescription(userProfile?.workspaceDescription || '');
    }
    if (!accountSettingsChanged) {
      setLocalDisplayName(userProfile?.displayName || '');
      setLocalUsername(userProfile?.username || '');
      setLocalPhotoURL(userProfile?.photoURL || null);
      setLocalLocation(userProfile?.location || '');
      setLocalDescription(userProfile?.description || '');
    }
  }, [userProfile]);
  
  // Handle workspace settings update
  const handleWorkspaceUpdate = async () => {
    await updateUserProfile({
      workspaceName: localWorkspaceName,
      workspaceColor: localWorkspaceColor as any,
      workspaceDescription: localWorkspaceDescription,
    });
    setWorkspaceSettingsChanged(false);
  };
  
  // Handle workspace settings cancel
  const handleWorkspaceCancel = () => {
    setLocalWorkspaceName(getDefaultWorkspaceName());
    setLocalWorkspaceColor(userProfile?.workspaceColor || 'green');
    setLocalWorkspaceDescription(userProfile?.workspaceDescription || '');
    setWorkspaceSettingsChanged(false);
  };
  
  // Handle account settings update
  const handleAccountUpdate = async () => {
    await updateUserProfile({
      displayName: localDisplayName,
      username: localUsername,
      photoURL: localPhotoURL,
      location: localLocation,
      description: localDescription,
    });
    setAccountSettingsChanged(false);
  };
  
  // Handle account settings cancel
  const handleAccountCancel = () => {
    setLocalDisplayName(userProfile?.displayName || '');
    setLocalUsername(userProfile?.username || '');
    setLocalPhotoURL(userProfile?.photoURL || null);
    setLocalLocation(userProfile?.location || '');
    setLocalDescription(userProfile?.description || '');
    setAccountSettingsChanged(false);
  };
  
  // Reset all local state when modal is closed (discard unsaved changes)
  React.useEffect(() => {
    if (!isOpen) {
      // Reset workspace settings
      setLocalWorkspaceName(getDefaultWorkspaceName());
      setLocalWorkspaceColor(userProfile?.workspaceColor || 'green');
      setLocalWorkspaceDescription(userProfile?.workspaceDescription || '');
      setWorkspaceSettingsChanged(false);
      
      // Reset account settings
      setLocalDisplayName(userProfile?.displayName || '');
      setLocalUsername(userProfile?.username || '');
      setLocalPhotoURL(userProfile?.photoURL || null);
      setLocalLocation(userProfile?.location || '');
      setLocalDescription(userProfile?.description || '');
      setAccountSettingsChanged(false);
    }
  }, [isOpen]);
  
  // Close color picker when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        closeColorPicker();
      }
    };
    if (showWorkspaceColorPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showWorkspaceColorPicker]);
  
  // Close color picker with animation
  const closeColorPicker = () => {
    setColorPickerClosing(true);
    setTimeout(() => {
      setShowWorkspaceColorPicker(false);
      setColorPickerClosing(false);
    }, 150);
  };
  
  // Workspace color class helper (uses local state for live preview)
  const getWorkspaceColorClass = () => {
    switch (localWorkspaceColor) {
      case 'blue': return 'bg-[#3b82f6]';
      case 'pink': return 'bg-[#ec4899]';
      case 'yellow': return 'bg-[#eab308]';
      case 'orange': return 'bg-[#f97316]';
      case 'purple': return 'bg-[#8b5cf6]';
      case 'lilac': return 'bg-[#c084fc]';
      case 'coral': return 'bg-[#f43f5e]';
      case 'teal': return 'bg-[#14b8a6]';
      case 'green':
      default: return 'bg-[#4a7c59]';
    }
  };
  
  const workspaceInitial = userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'W';
  
  // Separate UI state for managing keys view (resets on modal close)
  const [managingProvider, setManagingProvider] = useState<ProviderId | null>(null);
  const [wasManagingKeys, setWasManagingKeys] = useState(false);
  const [activeConnector, setActiveConnector] = useState<string | null>(initialConnector ?? null);
  
  // Effect to handle initial tab/connector when modal opens
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
    if (isOpen && initialConnector !== undefined) {
      setActiveConnector(initialConnector);
    }
  }, [isOpen, initialTab, initialConnector]);
  
  // Custom dropdown states
  const geminiRef = useRef<HTMLDivElement>(null);
  const openaiRef = useRef<HTMLDivElement>(null);
  const anthropicRef = useRef<HTMLDivElement>(null);

  const [geminiDropdownOpen, setGeminiDropdownOpen] = useState(false);
  const [geminiDropdownClosing, setGeminiDropdownClosing] = useState(false);
  const [geminiDirection, setGeminiDirection] = useState<'down' | 'up'>('down');

  const [openaiDropdownOpen, setOpenaiDropdownOpen] = useState(false);
  const [openaiDropdownClosing, setOpenaiDropdownClosing] = useState(false);
  const [openaiDirection, setOpenaiDirection] = useState<'down' | 'up'>('down');

  const [anthropicDropdownOpen, setAnthropicDropdownOpen] = useState(false);
  const [anthropicDropdownClosing, setAnthropicDropdownClosing] = useState(false);
  const [anthropicDirection, setAnthropicDirection] = useState<'down' | 'up'>('down');

  const determineDirection = (ref: React.RefObject<HTMLDivElement>) => {
    if (!ref.current) return 'down' as const;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = 220; 
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      return 'up' as const;
    }
    return 'down' as const;
  };
  
  // Helper functions to close dropdowns with animation
  const closeGeminiDropdown = () => {
    setGeminiDropdownClosing(true);
    setTimeout(() => {
      setGeminiDropdownOpen(false);
      setGeminiDropdownClosing(false);
    }, 150);
  };
  const closeOpenaiDropdown = () => {
    setOpenaiDropdownClosing(true);
    setTimeout(() => {
      setOpenaiDropdownOpen(false);
      setOpenaiDropdownClosing(false);
    }, 150);
  };
  const closeAnthropicDropdown = () => {
    setAnthropicDropdownClosing(true);
    setTimeout(() => {
      setAnthropicDropdownOpen(false);
      setAnthropicDropdownClosing(false);
    }, 150);
  };
  
  // Click outside detection for dropdowns
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dropdown="gemini"]')) {
        if (geminiDropdownOpen && !geminiDropdownClosing) closeGeminiDropdown();
      }
      if (!target.closest('[data-dropdown="openai"]')) {
        if (openaiDropdownOpen && !openaiDropdownClosing) closeOpenaiDropdown();
      }
      if (!target.closest('[data-dropdown="anthropic"]')) {
        if (anthropicDropdownOpen && !anthropicDropdownClosing) closeAnthropicDropdown();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [geminiDropdownOpen, geminiDropdownClosing, openaiDropdownOpen, openaiDropdownClosing, anthropicDropdownOpen, anthropicDropdownClosing]);

  // Close dropdowns on scroll outside the model selector menu
  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest && target.closest('[data-dropdown]')) {
        return;
      }
      if (geminiDropdownOpen && !geminiDropdownClosing) closeGeminiDropdown();
      if (openaiDropdownOpen && !openaiDropdownClosing) closeOpenaiDropdown();
      if (anthropicDropdownOpen && !anthropicDropdownClosing) closeAnthropicDropdown();
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [geminiDropdownOpen, geminiDropdownClosing, openaiDropdownOpen, openaiDropdownClosing, anthropicDropdownOpen, anthropicDropdownClosing]);
  
  // Track when we exit manage keys view
  const handleExitManageKeys = () => {
    setWasManagingKeys(true);
    setManagingProvider(null);
    setTimeout(() => setWasManagingKeys(false), 200);
  };
  
  // Delete account state
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 150);
      return () => clearTimeout(timer);
    }
    
    if (!isOpen) {
      setManagingProvider(null);
    }
  }, [isOpen, shouldRender]);
  
  /*
   * Models & API state.
   *
   * The keys, their cache and the Firestore round-trip used to be inline here.
   * They moved to `provider-settings.ts` when the standalone `/models-settings`
   * page became a second surface onto the same document — see the note at the
   * top of that file for why one debounced writer is not negotiable.
   */
  const { providerState, handleUpdateConfig } = useProviderSettings(setModelConfig);


  // Delete account handler
  const handleDeleteAccount = async () => {
    if (!user) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    console.log('[Delete] Starting account deletion for:', user.email, 'UID:', user.uid);
    
    try {
      console.log('[Delete] Calling user.delete()...');
      await user.delete();
      console.log('[Delete] SUCCESS - User account deleted!');
      
      setIsDeleting(false);
      onClose();
      window.location.href = '/login';
      
    } catch (err: any) {
      console.error('[Delete] Error:', err.code, err.message);
      setIsDeleting(false);
      setDeleteError(`Delete failed: ${err.code || err.message}`);
    }
  };

  // Effect: Ensure valid thinkingLevel when model changes for Gemini
  useEffect(() => {
    const selected = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model);
    if (selected) {
        if (!selected.hasNone && modelConfig.gemini.thinkingLevel === 0) {
            setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, thinkingLevel: 1 } }));
        } else if (modelConfig.gemini.thinkingLevel > selected.maxLevels) {
            setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, thinkingLevel: selected.maxLevels } }));
        }
    }
  }, [modelConfig.gemini.model]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/60 ${isClosing ? 'backdrop-fade-out' : 'backdrop-fade-in'}`}
        onClick={onClose}
      />
      
      <div role="dialog" aria-modal="true" aria-label="Settings" className={`relative w-[calc(100vw_-_12vh)] h-[88vh] bg-[#1c1c1c] rounded-[10px] shadow-2xl border border-white/10 flex overflow-hidden z-10 ${isClosing ? 'settings-fade-out' : 'settings-fade-in'}`}>
        
        {/* Close Button */}
        <button 
            onClick={onClose}
            type="button"
            aria-label="Close settings"
            className="settings-keyboard-control absolute top-4 right-4 text-zinc-400 hover:text-white z-50 p-1"
        >
            <X size={20} />
        </button>

        {/* Sidebar */}
        <div className="w-[250px] bg-[#1c1c1c] border-r border-white/5 flex flex-col py-2 px-3 shrink-0">
             
             <SettingsSectionTitle title="Workspace" />
             <SettingsSidebarItem 
                label="Workspace" 
                active={activeTab === 'workspace'} 
                onClick={() => setActiveTab('workspace')} 
                customIconColor={getWorkspaceColorClass()}
                customIconInitial={workspaceInitial}
             />
             <SettingsSidebarItem icon={CreditCard} label="Models & API" active={activeTab === 'models'} onClick={() => setActiveTab('models')} />
             {/* Agents ships opt-in, so its governance tab hides with it. */}
             {isAgentsEnabled && (
               <SettingsSidebarItem icon={Shield} label="Agent Builder governance" active={activeTab === 'governance'} onClick={() => setActiveTab('governance')} />
             )}

             <SettingsSectionTitle title="Account" />
             <SettingsSidebarItem icon={User} label="Your account" active={activeTab === 'account'} onClick={() => setActiveTab('account')} />
              <button
                type="button"
                aria-current={activeTab === 'labs' ? 'page' : undefined}
                onClick={() => setActiveTab('labs')}
                className={`settings-keyboard-control px-3 py-1.5 cursor-pointer flex items-center gap-3 text-[14px] font-medium rounded-lg transition-colors ${activeTab === 'labs' ? 'bg-[#1f1f1f] text-white' : 'text-zinc-400 hover:bg-[#1f1f1f] hover:text-white'}`}
              >
                <div className="w-5 h-5 flex items-center justify-center">
                    <FlaskConical size={18} />
                </div>
                <span>Labs</span>
              </button>

             <SettingsSectionTitle title="Connectors" />
             <SettingsSidebarItem icon={Link} label="Connectors" active={activeTab === 'connectors'} onClick={() => setActiveTab('connectors')} />
             <SettingsSidebarItem icon={Github} label="GitHub" active={activeTab === 'github'} onClick={() => setActiveTab('github')} />

        </div>

        {/* Content */}
        <div className="flex-1 bg-[#1c1c1c] w-full overflow-hidden relative">
            {activeTab === 'workspace' && (
                <WorkspaceTab
                  localWorkspaceName={localWorkspaceName}
                  setLocalWorkspaceName={setLocalWorkspaceName}
                  localWorkspaceDescription={localWorkspaceDescription}
                  setLocalWorkspaceDescription={setLocalWorkspaceDescription}
                  localWorkspaceColor={localWorkspaceColor}
                  setLocalWorkspaceColor={setLocalWorkspaceColor}
                  workspaceSettingsChanged={workspaceSettingsChanged}
                  setWorkspaceSettingsChanged={setWorkspaceSettingsChanged}
                  showWorkspaceColorPicker={showWorkspaceColorPicker}
                  setShowWorkspaceColorPicker={setShowWorkspaceColorPicker}
                  colorPickerClosing={colorPickerClosing}
                  closeColorPicker={closeColorPicker}
                  colorPickerRef={colorPickerRef}
                  getWorkspaceColorClass={getWorkspaceColorClass}
                  workspaceInitial={workspaceInitial}
                  handleWorkspaceUpdate={handleWorkspaceUpdate}
                  handleWorkspaceCancel={handleWorkspaceCancel}
                />
            )}

            {activeTab === 'models' && (
                <ModelsTab
                  modelConfig={modelConfig}
                  setModelConfig={setModelConfig}
                  managingProvider={managingProvider}
                  setManagingProvider={setManagingProvider}
                  wasManagingKeys={wasManagingKeys}
                  handleExitManageKeys={handleExitManageKeys}
                  providerState={providerState}
                  handleUpdateConfig={handleUpdateConfig}
                  GEMINI_MODELS={GEMINI_MODELS}
                  geminiRef={geminiRef}
                  geminiDropdownOpen={geminiDropdownOpen}
                  setGeminiDropdownOpen={setGeminiDropdownOpen}
                  geminiDropdownClosing={geminiDropdownClosing}
                  geminiDirection={geminiDirection}
                  setGeminiDirection={setGeminiDirection}
                  closeGeminiDropdown={closeGeminiDropdown}
                  openaiRef={openaiRef}
                  openaiDropdownOpen={openaiDropdownOpen}
                  setOpenaiDropdownOpen={setOpenaiDropdownOpen}
                  openaiDropdownClosing={openaiDropdownClosing}
                  openaiDirection={openaiDirection}
                  setOpenaiDirection={setOpenaiDirection}
                  closeOpenaiDropdown={closeOpenaiDropdown}
                  anthropicRef={anthropicRef}
                  anthropicDropdownOpen={anthropicDropdownOpen}
                  setAnthropicDropdownOpen={setAnthropicDropdownOpen}
                  anthropicDropdownClosing={anthropicDropdownClosing}
                  anthropicDirection={anthropicDirection}
                  setAnthropicDirection={setAnthropicDirection}
                  closeAnthropicDropdown={closeAnthropicDropdown}
                  determineDirection={determineDirection}
                />
            )}

            {activeTab === 'people' && (
                <PeopleTab
                  userProfile={userProfile}
                  user={user}
                />
            )}

            {activeTab === 'privacy' && (
                <PrivacyTab
                  defaultVisibility={defaultVisibility}
                  setDefaultVisibility={setDefaultVisibility}
                  showVisibilityMenu={showVisibilityMenu}
                  setShowVisibilityMenu={setShowVisibilityMenu}
                  websiteAccess={websiteAccess}
                  setWebsiteAccess={setWebsiteAccess}
                  showWebsiteMenu={showWebsiteMenu}
                  setShowWebsiteMenu={setShowWebsiteMenu}
                  publishAccess={publishAccess}
                  setPublishAccess={setPublishAccess}
                  showPublishMenu={showPublishMenu}
                  setShowPublishMenu={setShowPublishMenu}
                  SettingsDropdownMenu={SettingsDropdownMenu}
                />
            )}

            {activeTab === 'governance' && (
                <GovernanceTab />
            )}

            {activeTab === 'labs' && (
                <LabsTab />
            )}

            {activeTab === 'account' && (
                <AccountTab
                  user={user}
                  userProfile={userProfile}
                  localDisplayName={localDisplayName}
                  setLocalDisplayName={setLocalDisplayName}
                  localUsername={localUsername}
                  setLocalUsername={setLocalUsername}
                  localPhotoURL={localPhotoURL}
                  setLocalPhotoURL={setLocalPhotoURL}
                  localLocation={localLocation}
                  setLocalLocation={setLocalLocation}
                  localDescription={localDescription}
                  setLocalDescription={setLocalDescription}
                  accountSettingsChanged={accountSettingsChanged}
                  setAccountSettingsChanged={setAccountSettingsChanged}
                  showDeleteConfirmation={showDeleteConfirmation}
                  setShowDeleteConfirmation={setShowDeleteConfirmation}
                  isDeleting={isDeleting}
                  deleteError={deleteError}
                  setDeleteError={setDeleteError}
                  handleDeleteAccount={handleDeleteAccount}
                  handleAccountUpdate={handleAccountUpdate}
                  handleAccountCancel={handleAccountCancel}
                />
            )}

            {activeTab === 'connectors' && (
                <ConnectorsTab
                  activeConnector={activeConnector}
                  setActiveConnector={setActiveConnector}
                  setActiveTab={setActiveTab}
                  isLocalFSSupported={isLocalFSSupported}
                  isLocalFolderConnected={isLocalFolderConnected}
                  localFolderName={localFolderName}
                  connectLocalFolder={connectLocalFolder}
                  disconnectLocalFolder={disconnectLocalFolder}
                  isDriveConnected={isDriveConnected}
                  connectDrive={connectDrive}
                  disconnectDrive={disconnectDrive}
                />
            )}

            {activeTab !== 'workspace' && activeTab !== 'people' && activeTab !== 'privacy' && activeTab !== 'governance' && activeTab !== 'labs' && activeTab !== 'account' && activeTab !== 'connectors' && activeTab !== 'models' && (
                <div className="w-full h-full flex items-center justify-center text-zinc-500 italic">
                    {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} settings coming soon...
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
