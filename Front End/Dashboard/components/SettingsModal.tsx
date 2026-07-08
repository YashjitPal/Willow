import React, { useEffect, useState, useRef } from 'react';
import { X, Search, HelpCircle, User, Users, CreditCard, Cloud, Lock, Home, ChevronDown, MoreHorizontal, FlaskConical, ArrowUpRight, Cpu, Check, Loader2, Zap, AlertCircle, LayoutGrid, Globe, FileText, Shield, Crown, PenLine, Lightbulb, HardDrive, FolderOpen, Link, Github } from 'lucide-react';
import './SettingsModal.css'; // Assuming we can import a CSS file or add a style tag
import { useAuth } from '../context/AuthContext';
import { useLocalFS } from '../context/LocalFSContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebaseConfig';
import { WorkspaceTab, PeopleTab, PrivacyTab, LabsTab, AccountTab, ConnectorsTab, ModelsTab } from './settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelConfig: any; // Using any for brevity or I could define the full type if needed
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  initialTab?: SectionType;
  initialConnector?: string | null;
}

type SectionType = 'workspace' | 'people' | 'models' | 'cloud' | 'privacy' | 'account' | 'labs' | 'connectors' | 'github';

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
    className={`w-full flex items-center gap-3 px-3 py-[9px] text-[13px] font-medium rounded-lg transition-colors
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
      workspaceColor: localWorkspaceColor as 'green' | 'pink' | 'yellow' | 'orange',
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
      case 'pink': return 'bg-[#ec4899]';
      case 'yellow': return 'bg-[#eab308]';
      case 'orange': return 'bg-[#f97316]';
      case 'green':
      default: return 'bg-[#4a7c59]';
    }
  };
  
  const workspaceInitial = userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'W';
  
  // Separate UI state for managing keys view (resets on modal close)
  const [managingProvider, setManagingProvider] = useState<'gemini' | 'openai' | 'anthropic' | null>(null);
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

  // Close dropdowns on scroll
  useEffect(() => {
    const handleScroll = () => {
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
  
  // Models & API State
  type ProviderConfig = { apiKey: string; baseUrl: string };
    type ProviderParams = {
      gemini: ProviderConfig;
      openai: ProviderConfig;
      anthropic: ProviderConfig;
      activeProvider?: string;
    };

    const defaultProviderState: ProviderParams = {
      gemini: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com' },
      openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1' },
      anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com' }
    };

  const [providerState, setProviderState] = React.useState<ProviderParams>(defaultProviderState);
  const [isLoadingKeys, setIsLoadingKeys] = React.useState(true);

  // Load API keys from Firestore using REST API (bypasses SDK streaming issues)
  useEffect(() => {
    if (!user) {
      setProviderState(defaultProviderState);
      setIsLoadingKeys(false);
      return;
    }
    
    setIsLoadingKeys(true);
    console.log('[DEBUG] Loading API keys for user:', user.uid);
    
    const loadKeys = async () => {
      try {
        const idToken = await user.getIdToken();
        const projectId = 'willow-64095';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${idToken}`,
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('[DEBUG] REST API load response:', JSON.stringify(data));
          
          if (data.fields?.providerState?.mapValue?.fields) {
            const ps = data.fields.providerState.mapValue.fields;
            
            const extractOldKey = (arr: any) => {
              if (!arr?.arrayValue?.values || arr.arrayValue.values.length === 0) return '';
              const activeKey = arr.arrayValue.values.find((v: any) => v.mapValue.fields.isActive?.booleanValue);
              const keyToUse = activeKey || arr.arrayValue.values[0];
              return keyToUse.mapValue.fields.key?.stringValue || '';
            };
            
            const extractNewConfig = (field: any, oldKeysField: any, defaultBaseUrl: string): ProviderConfig => {
              if (field?.mapValue?.fields) {
                return {
                  apiKey: field.mapValue.fields.apiKey?.stringValue || '',
                  baseUrl: field.mapValue.fields.baseUrl?.stringValue || defaultBaseUrl
                };
              }
              return { apiKey: extractOldKey(oldKeysField), baseUrl: defaultBaseUrl };
            };
            
            const loadedState: ProviderParams = {
              gemini: extractNewConfig(ps.gemini, ps.geminiKeys, 'https://generativelanguage.googleapis.com'),
              openai: extractNewConfig(ps.openai, ps.openaiKeys, 'https://api.openai.com/v1'),
              anthropic: extractNewConfig(ps.anthropic, ps.anthropicKeys, 'https://api.anthropic.com'),
              activeProvider: ps.activeProvider?.stringValue || 'gemini'
            };
            
            console.log('[DEBUG] Parsed state:', JSON.stringify(loadedState));
            setProviderState(loadedState);
          } else {
            console.log('[DEBUG] No providerState in doc');
            setProviderState(defaultProviderState);
          }
        } else if (response.status === 404) {
          console.log('[DEBUG] Doc does not exist');
          setProviderState(defaultProviderState);
        } else {
          console.log('[DEBUG] REST API load failed:', response.status);
          setProviderState(defaultProviderState);
        }
      } catch (err) {
        console.log('[DEBUG] REST API load error:', err);
        setProviderState(defaultProviderState);
      }
      setIsLoadingKeys(false);
    };
    
    loadKeys();
  }, [user?.uid]);

  // Save to Firestore when providerState changes
  const [hasLoadedInitially, setHasLoadedInitially] = React.useState(false);
  
  useEffect(() => {
    if (isLoadingKeys) return;
    if (!hasLoadedInitially) {
      setHasLoadedInitially(true);
      return;
    }
    if (!user) return;
    
    console.log('[DEBUG] Saving API keys for user:', user.uid);
    console.log('[DEBUG] Keys to save:', JSON.stringify(providerState.gemini));
    
    const saveToFirestore = async () => {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { providerState }, { merge: true });
        console.log('[DEBUG] Save successful!');
      } catch (err) {
        console.log('[DEBUG] Save error:', err);
      }
    };
    
    saveToFirestore();
  }, [providerState, user, hasLoadedInitially, isLoadingKeys]);

  const [tempKeyInput, setTempKeyInput] = React.useState('');
  const [isFetchingInfo, setIsFetchingInfo] = React.useState(false);

  // Direct save using Firestore REST API (bypasses SDK streaming issues)
  const saveProviderStateToFirestore = async (newState: ProviderParams) => {
    if (!user) return;
    
    try {
      const idToken = await user.getIdToken();
      
      const projectId = 'willow-64095';
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}?updateMask.fieldPaths=providerState`;
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            providerState: {
              mapValue: {
                fields: {
                  gemini: { mapValue: { fields: { apiKey: { stringValue: newState.gemini.apiKey }, baseUrl: { stringValue: newState.gemini.baseUrl } } } },
                  openai: { mapValue: { fields: { apiKey: { stringValue: newState.openai.apiKey }, baseUrl: { stringValue: newState.openai.baseUrl } } } },
                  anthropic: { mapValue: { fields: { apiKey: { stringValue: newState.anthropic.apiKey }, baseUrl: { stringValue: newState.anthropic.baseUrl } } } },
                  activeProvider: { stringValue: newState.activeProvider }
                }
              }
            }
          }
        })
      });
      
      if (response.ok) {
        console.log('[DEBUG] REST API save successful!');
      } else {
        const errorText = await response.text();
        console.log('[DEBUG] REST API save failed:', response.status, errorText);
      }
    } catch (err) {
      console.log('[DEBUG] REST API save error:', err);
    }
  };

  const handleUpdateConfig = async (provider: 'gemini' | 'openai' | 'anthropic', config: ProviderConfig) => {
    const newState = {
      ...providerState,
      [provider]: config
    };
    
    setProviderState(newState);
    
    localStorage.setItem('providerState', JSON.stringify(newState));
    const flatKeys = {
      gemini: newState.gemini.apiKey ? [newState.gemini.apiKey] : [],
      openai: newState.openai.apiKey ? [newState.openai.apiKey] : [],
      anthropic: newState.anthropic.apiKey ? [newState.anthropic.apiKey] : [],
    };
    localStorage.setItem('apiKeys', JSON.stringify(flatKeys));
    window.dispatchEvent(new Event('apikeys-updated'));
    
    await saveProviderStateToFirestore(newState);
  };

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

  const GEMINI_MODELS = [
    { 
        id: 'gemini-3-pro-preview', 
        name: 'Gemini 3 Pro', 
        maxLevels: 2,
        hasNone: false,
        levelLabels: { 1: 'low', 2: 'high' }
    },
    { 
        id: 'gemini-3-flash-preview', 
        name: 'Gemini 3 Flash', 
        maxLevels: 3,
        hasNone: true,
        noneLabel: 'None',
        levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' }
    },
    { 
        id: 'gemini-3-pro-image-preview', 
        name: 'Nano Banana Pro', 
        maxLevels: 2,
        hasNone: false,
        levelLabels: { 1: 'Low Reasoning', 2: 'High Reasoning' }
    },
        { 
        id: 'gemini-3.5-flash', 
        name: 'Gemini 3.5 Flash', 
        maxLevels: 3,
        hasNone: true,
        noneLabel: 'None',
        levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' }
    },
    { 
        id: 'gemini-3.1-pro-preview', 
        name: 'Gemini 3.1 Pro', 
        maxLevels: 3,
        hasNone: false,
        levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' }
    },
    { 
        id: 'gemini-3.1-flash-lite', 
        name: 'Gemini 3.1 Flash Lite', 
        maxLevels: 3,
        hasNone: true,
        noneLabel: 'None',
        levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' }
    },
    { 
        id: 'gemini-3.1-flash-lite-preview', 
        name: 'Gemini 3.1 Flash Lite (Preview)', 
        maxLevels: 3,
        hasNone: true,
        noneLabel: 'None',
        levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' }
    },
    { 
        id: 'gemini-2.5-flash-lite', 
        name: 'Gemini 2.5 Flash Lite', 
        maxLevels: 3,
        hasNone: true,
        noneLabel: 'None (Disabled)',
        levelLabels: { 1: '8k Tokens', 2: '16k Tokens', 3: '24k Tokens' }
    }
  ];

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
      
      <div className={`relative w-[calc(100vw_-_12vh)] h-[88vh] bg-[#1c1c1c] rounded-[10px] shadow-2xl border border-white/10 flex overflow-hidden z-10 ${isClosing ? 'settings-fade-out' : 'settings-fade-in'}`}>
        
        {/* Close Button */}
        <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-zinc-400 hover:text-white z-50 p-1"
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
             <SettingsSidebarItem icon={Users} label="People" active={activeTab === 'people'} onClick={() => setActiveTab('people')} />
             <SettingsSidebarItem icon={CreditCard} label="Models & API" active={activeTab === 'models'} onClick={() => setActiveTab('models')} />
             <SettingsSidebarItem icon={Cloud} label="Cloud & AI balance" active={activeTab === 'cloud'} onClick={() => setActiveTab('cloud')} />
             <SettingsSidebarItem icon={Lock} label="Privacy & security" active={activeTab === 'privacy'} onClick={() => setActiveTab('privacy')} />

             <SettingsSectionTitle title="Account" />
             <SettingsSidebarItem icon={User} label="Your account" active={activeTab === 'account'} onClick={() => setActiveTab('account')} />
              <div 
                onClick={() => setActiveTab('labs')}
                className={`px-3 py-1.5 cursor-pointer flex items-center gap-3 text-[14px] font-medium rounded-lg transition-colors ${activeTab === 'labs' ? 'bg-[#1f1f1f] text-white' : 'text-zinc-400 hover:bg-[#1f1f1f] hover:text-white'}`}
              >
                <div className="w-5 h-5 flex items-center justify-center">
                    <FlaskConical size={18} />
                </div>
                <span>Labs</span>
              </div>

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

            {activeTab !== 'workspace' && activeTab !== 'people' && activeTab !== 'privacy' && activeTab !== 'labs' && activeTab !== 'account' && activeTab !== 'connectors' && activeTab !== 'models' && (
                <div className="w-full h-full flex items-center justify-center text-zinc-500 italic">
                    {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} settings coming soon...
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
