import React, { useEffect, useState, useRef } from 'react';
import { X, Search, HelpCircle, User, Users, CreditCard, Cloud, Lock, Home, ChevronDown, MoreHorizontal, FlaskConical, ArrowUpRight, Cpu, Check, Loader2, Zap, AlertCircle, LayoutGrid, Globe, FileText, Shield, Crown, PenLine, Lightbulb, HardDrive } from 'lucide-react';
import './SettingsModal.css'; // Assuming we can import a CSS file or add a style tag
import { useAuth } from '../context/AuthContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebaseConfig';

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

// Custom Bulb Icon that handles the "no base" requirement for active state
// Custom Bulb Icon that handles the "no base" requirement for active state
// Custom Bulb Icon: Uses standard Lightbulb but fills it when active (Reasoning On)
const ReasoningBulb = ({ isActive, className, strokeWidth }: { isActive: boolean, className?: string, strokeWidth?: number }) => {
    return (
        <Lightbulb 
            className={`${className} ${isActive ? "fill-current" : ""}`} 
            strokeWidth={2} 
        />
    );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, modelConfig, setModelConfig, initialTab, initialConnector }) => {
  const { user, userProfile, updateUserProfile, signOut, isDriveConnected, connectDrive, disconnectDrive } = useAuth();
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
  const [geminiDropdownOpen, setGeminiDropdownOpen] = useState(false);
  const [geminiDropdownClosing, setGeminiDropdownClosing] = useState(false);
  const [openaiDropdownOpen, setOpenaiDropdownOpen] = useState(false);
  const [openaiDropdownClosing, setOpenaiDropdownClosing] = useState(false);
  const [anthropicDropdownOpen, setAnthropicDropdownOpen] = useState(false);
  const [anthropicDropdownClosing, setAnthropicDropdownClosing] = useState(false);
  
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
      // Check if clicked outside any dropdown
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
  
  // Track when we exit manage keys view
  const handleExitManageKeys = () => {
    setWasManagingKeys(true);
    setManagingProvider(null);
    // Reset after animation completes
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
      }, 150); // Match CSS duration
      return () => clearTimeout(timer);
    }
    
    // Reset managingProvider when modal closes
    if (!isOpen) {
      setManagingProvider(null);
    }
  }, [isOpen, shouldRender]);
  
  // Models & API State
  type ApiKey = { id: string; key: string; name: string; isActive: boolean; createdAt: number };
  type ProviderParams = {
    geminiKeys: ApiKey[];
    openaiKeys: ApiKey[];
    anthropicKeys: ApiKey[];
    activeProvider: 'gemini' | 'openai' | 'anthropic';
  };

  const defaultProviderState: ProviderParams = {
    geminiKeys: [],
    openaiKeys: [],
    anthropicKeys: [],
    activeProvider: 'gemini'
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
            
            // Parse the Firestore REST API format back to our format
            const parseKeys = (arr: any) => {
              if (!arr?.arrayValue?.values) return [];
              return arr.arrayValue.values.map((v: any) => ({
                id: v.mapValue.fields.id.stringValue,
                key: v.mapValue.fields.key.stringValue,
                name: v.mapValue.fields.name.stringValue,
                isActive: v.mapValue.fields.isActive.booleanValue,
                createdAt: parseInt(v.mapValue.fields.createdAt.integerValue)
              }));
            };
            
            const loadedState: ProviderParams = {
              geminiKeys: parseKeys(ps.geminiKeys),
              openaiKeys: parseKeys(ps.openaiKeys),
              anthropicKeys: parseKeys(ps.anthropicKeys),
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
    console.log('[DEBUG] Keys to save:', JSON.stringify(providerState.geminiKeys));
    
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
  // Mock fetching state per provider if needed, or global
  const [isFetchingInfo, setIsFetchingInfo] = React.useState(false);

  // Direct save using Firestore REST API (bypasses SDK streaming issues)
  const saveProviderStateToFirestore = async (newState: ProviderParams) => {
    if (!user) return;
    
    try {
      // Get the user's ID token for authentication
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
                  geminiKeys: { arrayValue: { values: newState.geminiKeys.map(k => ({ mapValue: { fields: { id: { stringValue: k.id }, key: { stringValue: k.key }, name: { stringValue: k.name }, isActive: { booleanValue: k.isActive }, createdAt: { integerValue: k.createdAt.toString() } } } })) } },
                  openaiKeys: { arrayValue: { values: newState.openaiKeys.map(k => ({ mapValue: { fields: { id: { stringValue: k.id }, key: { stringValue: k.key }, name: { stringValue: k.name }, isActive: { booleanValue: k.isActive }, createdAt: { integerValue: k.createdAt.toString() } } } })) } },
                  anthropicKeys: { arrayValue: { values: newState.anthropicKeys.map(k => ({ mapValue: { fields: { id: { stringValue: k.id }, key: { stringValue: k.key }, name: { stringValue: k.name }, isActive: { booleanValue: k.isActive }, createdAt: { integerValue: k.createdAt.toString() } } } })) } },
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

  const handleAddKey = async (provider: 'gemini' | 'openai' | 'anthropic') => {
    if (!tempKeyInput.trim()) return;
    
    const keysKey = `${provider}Keys` as keyof ProviderParams;
    const currentKeys = providerState[keysKey] as ApiKey[];
    
    if (currentKeys.length >= 10) return; // Limit 10

    const newKey: ApiKey = {
      id: Math.random().toString(36).substr(2, 9),
      key: tempKeyInput,
      name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Key ${currentKeys.length + 1}`,
      isActive: currentKeys.length === 0, // Auto-activate if first
      createdAt: Date.now()
    };

    const newState = {
      ...providerState,
      [keysKey]: [...currentKeys, newKey]
    };
    
    setProviderState(newState);
    setTempKeyInput('');
    
    // Save to Firestore immediately
    await saveProviderStateToFirestore(newState);
    
    // Simulate fetch if Gemini
    if (provider === 'gemini') {
        setIsFetchingInfo(true);
        setTimeout(() => setIsFetchingInfo(false), 1000);
    }
  };

  const toggleKey = (provider: 'gemini' | 'openai' | 'anthropic', id: string) => {
    setProviderState(prev => {
        const keysKey = `${provider}Keys` as keyof ProviderParams;
        // logic: if toggling ON, disable others. If toggling OFF, just disable.
        const currentKeys = prev[keysKey] as ApiKey[];
        const updatedKeys = currentKeys.map(k => {
             if (k.id === id) return { ...k, isActive: !k.isActive };
             // If we want single active key enforcement:
             // if (k.id === id) return { ...k, isActive: !k.isActive }; // Single toggle logic?
             // usually for API keys, you pick ONE to use. let's enforce single active.
             return { ...k, isActive: k.id === id ? !k.isActive : false }; 
        });
        
        // If the toggled key became active, set this provider as active global provider?
        // Maybe user manually selects active provider.
        
        return { ...prev, [keysKey]: updatedKeys };
    });
  };

  const deleteKey = (provider: 'gemini' | 'openai' | 'anthropic', id: string) => {
      setProviderState(prev => {
          const keysKey = `${provider}Keys` as keyof ProviderParams;
          const currentKeys = prev[keysKey] as ApiKey[];
          return { ...prev, [keysKey]: currentKeys.filter(k => k.id !== id) };
      });
  };

  // Delete account handler
  const handleDeleteAccount = async () => {
    if (!user) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    console.log('[Delete] Starting account deletion for:', user.email, 'UID:', user.uid);
    
    try {
      // Delete the user from Firebase Auth directly
      console.log('[Delete] Calling user.delete()...');
      await user.delete();
      console.log('[Delete] SUCCESS - User account deleted!');
      
      // Show success and redirect
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
        maxLevels: 2, // 1: low, 2: high
        hasNone: false,
        levelLabels: { 1: 'low', 2: 'high' }
    },
    { 
        id: 'gemini-3-flash-preview', 
        name: 'Gemini 3 Flash', 
        maxLevels: 3, // 1: low, 2: medium, 3: high (None = minimal/no thinking)
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
        id: 'gemini-3.1-pro-preview', 
        name: 'Gemini 3.1 Pro', 
        maxLevels: 3, // 1: low, 2: medium, 3: high
        hasNone: false,
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
        
        {/* Close Button - absolute top right */}
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
             <div 
                onClick={() => setActiveTab('connectors')}
                className={`px-3 py-1.5 cursor-pointer flex items-center gap-3 text-[14px] font-medium rounded-lg transition-colors ${activeTab === 'connectors' ? 'bg-[#1f1f1f] text-white' : 'text-zinc-400 hover:bg-[#1f1f1f] hover:text-white'}`}
             >
                <div className="w-5 h-5 flex items-center justify-center">
                    {/* Simple geometric icon for Connectors */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 16a5 5 0 0 1-5-5"/><path d="M12 2a10 10 0 0 0 0 20"/></svg>
                </div>
                <span>Connectors</span>
             </div>
             <SettingsSidebarItem icon={({ size, ...props }) => (
                 <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
                    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36.5-8 3C6.77 6.5 6.73 6.1 4 4c-1 0-3 .5-3 1.5.28 1.15.28 2.35 0 3.5A5.403 5.403 0 0 0 4 12.5c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
                    <path d="M9 18c-4.51 2-5-2-7-2"/>
                 </svg>
             )} label="GitHub" active={activeTab === 'github'} onClick={() => setActiveTab('github')} />

        </div>

        {/* Content */}
        <div className="flex-1 bg-[#1c1c1c] w-full overflow-hidden relative">
            {activeTab === 'workspace' && (
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
            )}

            {activeTab === 'models' && (
                <div className="w-full h-full px-12 py-10 overflow-y-auto relative">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-4">
                            {managingProvider && (
                                <button 
                                    onClick={handleExitManageKeys}
                                    className="p-1.5 -ml-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                                >
                                    <ChevronDown className="rotate-90" size={20} />
                                </button>
                            )}
                            <h1 className="text-[24px] font-bold text-white">
                                {managingProvider ? `Manage ${managingProvider.charAt(0).toUpperCase() + managingProvider.slice(1)} Keys` : 'Models & API'}
                            </h1>
                        </div>
                    </div>
                    
                    {!managingProvider && (
                        <div className="pb-6 border-b border-white/5 mb-8">
                            <p className="text-[14px] text-zinc-400">
                                Connect your AI providers and configure model settings.
                            </p>
                        </div>
                    )}

                    {/* Manage Keys View */}
                    {managingProvider ? (
                        <div className="animate-[fadeIn_150ms_ease-out] flex flex-col h-full">
                            <div className="bg-[#1c1c1c] border border-white/5 rounded-xl p-6 mb-6">
                                <h3 className="text-[14px] font-bold text-white mb-4">Add New Key</h3>
                                <div className="flex gap-3">
                                    <input 
                                        type="text" 
                                        placeholder={`Enter ${managingProvider} API Key...`}
                                        className="flex-1 bg-[#272729] border border-white/10 rounded-lg px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                        value={tempKeyInput}
                                        onChange={(e) => setTempKeyInput(e.target.value)}
                                    />
                                    <button 
                                        onClick={() => handleAddKey(managingProvider!)}
                                        disabled={!tempKeyInput || (providerState[`${managingProvider}Keys` as keyof ProviderParams] as ApiKey[]).length >= 10}
                                        className="px-6 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Add
                                    </button>
                                </div>
                                <p className="text-[12px] text-zinc-500 mt-2">
                                    {(providerState[`${managingProvider}Keys` as keyof ProviderParams] as ApiKey[]).length >= 10 
                                        ? "Maximum limit of 10 keys reached." 
                                        : "Keys are stored locally in your browser session for security."}
                                </p>
                            </div>

                            <div className="flex-1 flex flex-col">
                                <h3 className="text-[14px] font-bold text-white mb-2">Saved Keys</h3>
                                {(providerState[`${managingProvider}Keys` as keyof ProviderParams] as ApiKey[]).length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center text-center border border-dashed border-white/10 rounded-xl text-zinc-500 text-[13px]" style={{ minHeight: 'calc(100vh - 450px)' }}>
                                        No keys added yet. Add one above to get started.
                                    </div>
                                ) : (
                                    (providerState[`${managingProvider}Keys` as keyof ProviderParams] as ApiKey[]).map((keyItem) => (
                                        <div key={keyItem.id} className="bg-[#1c1c1c] border border-white/5 rounded-xl px-5 py-4 flex items-center justify-between group hover:border-white/10 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-2.5 h-2.5 rounded-full transition-all ${keyItem.isActive ? 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.4)]' : 'bg-zinc-600'}`} />
                                                <div className="space-y-1">
                                                    <div className="text-[14px] font-semibold text-white tracking-tight">{keyItem.name}</div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[12px] font-mono text-zinc-400 bg-white/5 px-2 py-0.5 rounded">
                                                            {keyItem.key.slice(0, 4)}····{keyItem.key.slice(-4)}
                                                        </span>
                                                        <span className="text-[11px] text-zinc-500">
                                                            Added {new Date(keyItem.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {new Date(keyItem.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                 <button 
                                                    onClick={() => toggleKey(managingProvider!, keyItem.id)}
                                                    className={`
                                                        w-10 h-6 rounded-full p-1 transition-colors relative
                                                        ${keyItem.isActive ? 'bg-white' : 'bg-zinc-700'}
                                                    `}
                                                >
                                                    <div className={`
                                                        w-4 h-4 rounded-full transition-transform
                                                        ${keyItem.isActive ? 'translate-x-4 bg-black' : 'translate-x-0 bg-white'}
                                                    `} />
                                                </button>
                                                <button 
                                                    onClick={() => deleteKey(managingProvider!, keyItem.id)}
                                                    className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : (
                        // Overview Mode
                        <div className={`space-y-10 ${wasManagingKeys ? 'animate-[fadeIn_150ms_ease-out]' : ''}`}>
                            
                            {/* Provider Cards */}
                            <div className="grid grid-cols-3 gap-4">
                                {/* Gemini Card */}
                                <div 
                                    className={`
                                        relative rounded-2xl p-5 border cursor-pointer group
                                        bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                                        ${providerState.activeProvider === 'gemini' ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                                    `}
                                    onClick={() => setProviderState(prev => ({ ...prev, activeProvider: 'gemini' }))}
                                >
                                    <div className="flex items-start justify-between mb-8">
                                        <div className="w-10 h-10 rounded-xl bg-black border border-white/10 flex items-center justify-center text-white shadow-lg">
                                            {/* Gemini Logo */}
                                            <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                                                <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z"/>
                                            </svg>
                                        </div>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setManagingProvider('gemini'); }}
                                            className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                                        >
                                            Manage Keys
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Google Gemini</h3>
                                        <p className="text-[12px] text-zinc-500">
                                            {providerState.geminiKeys.some(k => k.isActive) ? 'Active' : 'Not configured'} • {providerState.geminiKeys.length} keys
                                        </p>
                                    </div>
                                    {providerState.activeProvider === 'gemini' && (
                                        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                                    )}
                                </div>

                                {/* OpenAI Card */}
                                <div 
                                    className={`
                                        relative rounded-2xl p-5 border cursor-pointer group
                                        bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                                        ${providerState.activeProvider === 'openai' ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                                    `}
                                    onClick={() => setProviderState(prev => ({ ...prev, activeProvider: 'openai' }))}
                                >
                                    <div className="flex items-start justify-between mb-8">
                                        <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white border border-white/10 shadow-lg">
                                             <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
                                        </div>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setManagingProvider('openai'); }}
                                            className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                                        >
                                            Manage Keys
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">OpenAI</h3>
                                        <p className="text-[12px] text-zinc-500">
                                            {providerState.openaiKeys.some(k => k.isActive) ? 'Active' : 'Not configured'} • {providerState.openaiKeys.length} keys
                                        </p>
                                    </div>
                                    {providerState.activeProvider === 'openai' && (
                                        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                                    )}
                                </div>

                                {/* Anthropic Card */}
                                <div 
                                    className={`
                                        relative rounded-2xl p-5 border cursor-pointer group
                                        bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                                        ${providerState.activeProvider === 'anthropic' ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                                    `}
                                    onClick={() => setProviderState(prev => ({ ...prev, activeProvider: 'anthropic' }))}
                                >
                                    <div className="flex items-start justify-between mb-8">
                                        <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white border border-white/10 shadow-lg">
                                            {/* Anthropic Logo */}
                                            <svg viewBox="0 0 512 509.64" fill="currentColor" className="w-6 h-6">
                                                <path fillRule="nonzero" d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"/>
                                            </svg>
                                        </div>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setManagingProvider('anthropic'); }}
                                            className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                                        >
                                            Manage Keys
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Anthropic</h3>
                                        <p className="text-[12px] text-zinc-500">
                                            {providerState.anthropicKeys.some(k => k.isActive) ? 'Active' : 'Not configured'} • {providerState.anthropicKeys.length} keys
                                        </p>
                                    </div>
                                    {providerState.activeProvider === 'anthropic' && (
                                        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                                    )}
                                </div>
                            </div>

                            {/* Active Provider Config */}
                            <div className="pt-8 border-t border-white/5">
                                <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    {providerState.activeProvider === 'gemini' && "Gemini Settings"}
                                    {providerState.activeProvider === 'openai' && "OpenAI Settings"}
                                    {providerState.activeProvider === 'anthropic' && "Anthropic Settings"}
                                </h2>

                                <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
                                    {/* Unified Panel Content */}
                                    {providerState.activeProvider === 'gemini' && (
                                        <div className="p-6 space-y-6">
                                            {/* Model Selection */}
                                            <div className="space-y-3">
                                                <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                                                <div className="relative" data-dropdown="gemini">
                                                    {/* Custom Dropdown Trigger */}
                                                    <button
                                                        onClick={() => geminiDropdownOpen ? closeGeminiDropdown() : setGeminiDropdownOpen(true)}
                                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                                                    >
                                                        <span>{GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.name || 'Select model'}</span>
                                                        <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${geminiDropdownOpen ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    
                                                    {/* Custom Dropdown Menu */}
                                                    {geminiDropdownOpen && (
                                                        <div className={`absolute top-full left-0 right-0 mt-2 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden origin-top ${geminiDropdownClosing ? 'animate-dropdownClose' : 'animate-dropdownOpen'}`}>
                                                                {/* Corner Border Glow Effects */}
                                                                <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                                                                {GEMINI_MODELS.map((model, index) => (
                                                                    <button
                                                                        key={model.id}
                                                                        onClick={() => {
                                                                            setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, model: model.id } }));
                                                                            closeGeminiDropdown();
                                                                        }}
                                                                        className={`
                                                                            relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                                                            ${modelConfig.gemini.model === model.id 
                                                                                ? 'bg-white/10 text-white' 
                                                                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                                                            }
                                                                            ${index === 0 ? 'rounded-t-lg' : ''}
                                                                            ${index === GEMINI_MODELS.length - 1 ? 'rounded-b-lg' : ''}
                                                                        `}
                                                                    >
                                                                        <span className="font-medium">{model.name}</span>
                                                                        {modelConfig.gemini.model === model.id && (
                                                                            <Check size={16} className="text-white" />
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Thinking Level */}
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Thinking</label>
                                                    <span className="text-[11px] font-medium text-zinc-400">
                                                        {modelConfig.gemini.thinkingLevel === 0 
                                                            ? 'Off' 
                                                            : GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.levelLabels?.[modelConfig.gemini.thinkingLevel as 1|2|3] || `Level ${modelConfig.gemini.thinkingLevel}`}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 p-1 bg-white/[0.02] rounded-xl border border-white/5">
                                                    {/* None Option */}
                                                    {GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.hasNone && (
                                                        <button
                                                            onClick={() => setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, thinkingLevel: 0 } }))}
                                                            className={`
                                                                flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all
                                                                ${modelConfig.gemini.thinkingLevel === 0 
                                                                    ? 'bg-white/10 text-white' 
                                                                    : 'text-zinc-500 hover:text-zinc-300'
                                                                }
                                                            `}
                                                        >
                                                            None
                                                        </button>
                                                    )}
                                                    {Array.from({ length: GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.maxLevels || 0 }).map((_, i) => {
                                                        const level = i + 1;
                                                        const isActive = modelConfig.gemini.thinkingLevel === level;
                                                        const levelLabel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.levelLabels?.[level as 1|2|3];
                                                        return (
                                                            <button
                                                                key={level}
                                                                onClick={() => setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, thinkingLevel: level } }))}
                                                                className={`
                                                                    flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all
                                                                    ${isActive 
                                                                        ? 'bg-white/10 text-white' 
                                                                        : 'text-zinc-500 hover:text-zinc-300'
                                                                    }
                                                                `}
                                                            >
                                                                {levelLabel || `${level}`}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Add Button */}
                                            <button 
                                                onClick={() => {
                                                    const selectedModel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model);
                                                    if (selectedModel) {
                                                        const isDuplicate = modelConfig.gemini.savedModels.some(
                                                            m => m.modelId === selectedModel.id && m.thinkingLevel === modelConfig.gemini.thinkingLevel
                                                        );
                                                        if (isDuplicate) return;
                                                        
                                                        setModelConfig(prev => ({
                                                            ...prev,
                                                            gemini: {
                                                                ...prev.gemini,
                                                                savedModels: [
                                                                    ...prev.gemini.savedModels,
                                                                    {
                                                                        id: Math.random().toString(36).substr(2, 9),
                                                                        modelId: selectedModel.id,
                                                                        name: selectedModel.name,
                                                                        thinkingLevel: prev.gemini.thinkingLevel
                                                                    }
                                                                ]
                                                            }
                                                        }));
                                                    }
                                                }}
                                                disabled={(() => {
                                                    const selectedModel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model);
                                                    if (!selectedModel) return true;
                                                    return modelConfig.gemini.savedModels.some(
                                                        m => m.modelId === selectedModel.id && m.thinkingLevel === modelConfig.gemini.thinkingLevel
                                                    );
                                                })()}
                                                className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                Add to Models
                                            </button>
                                        </div>
                                    )}

                                    {providerState.activeProvider === 'openai' && (
                                        <div className="p-6 space-y-6">
                                            {/* Model Selection */}
                                            <div className="space-y-3">
                                                <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                                                <div className="relative" data-dropdown="openai">
                                                    {/* Custom Dropdown Trigger */}
                                                    <button
                                                        onClick={() => openaiDropdownOpen ? closeOpenaiDropdown() : setOpenaiDropdownOpen(true)}
                                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                                                    >
                                                        <span>{
                                                            {
                                                                'gpt-5.2-thinking': 'GPT 5.2 Thinking',
                                                                'gpt-5.2-pro': 'GPT 5.2 Pro',
                                                                'gpt-5.1-codex-high-max': 'GPT 5.1 Codex High Max',
                                                                'gpt-5.2-codex': 'GPT 5.2 CODEX'
                                                            }[modelConfig.openai.model] || 'Select model'
                                                        }</span>
                                                        <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${openaiDropdownOpen ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    
                                                    {/* Custom Dropdown Menu */}
                                                    {openaiDropdownOpen && (
                                                        <div className={`absolute top-full left-0 right-0 mt-2 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden origin-top ${openaiDropdownClosing ? 'animate-dropdownClose' : 'animate-dropdownOpen'}`}>
                                                                {/* Corner Border Glow Effects */}
                                                                <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                                                                {[
                                                                    { id: 'gpt-5.2-thinking', name: 'GPT 5.2 Thinking' },
                                                                    { id: 'gpt-5.2-pro', name: 'GPT 5.2 Pro' },
                                                                    { id: 'gpt-5.1-codex-high-max', name: 'GPT 5.1 Codex High Max' },
                                                                    { id: 'gpt-5.2-codex', name: 'GPT 5.2 CODEX' }
                                                                ].map((model, index, arr) => (
                                                                    <button
                                                                        key={model.id}
                                                                        onClick={() => {
                                                                            setModelConfig(prev => ({ ...prev, openai: { ...prev.openai, model: model.id } }));
                                                                            closeOpenaiDropdown();
                                                                        }}
                                                                        className={`
                                                                            relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                                                            ${modelConfig.openai.model === model.id 
                                                                                ? 'bg-white/10 text-white' 
                                                                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                                                            }
                                                                            ${index === 0 ? 'rounded-t-lg' : ''}
                                                                            ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                                                        `}
                                                                    >
                                                                        <span className="font-medium">{model.name}</span>
                                                                        {modelConfig.openai.model === model.id && (
                                                                            <Check size={16} className="text-white" />
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Thinking Level */}
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Thinking</label>
                                                    <span className="text-[11px] font-medium text-zinc-400">
                                                        {modelConfig.openai.thinkingLevel === 0 ? 'Off' : ['Low', 'Medium', 'High'][modelConfig.openai.thinkingLevel - 1]}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 p-1 bg-white/[0.02] rounded-xl border border-white/5">
                                                    <button
                                                        onClick={() => setModelConfig(prev => ({ ...prev, openai: { ...prev.openai, thinkingLevel: 0 } }))}
                                                        className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.openai.thinkingLevel === 0 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                    >
                                                        None
                                                    </button>
                                                    {['Low', 'Medium', 'High'].map((label, i) => (
                                                        <button
                                                            key={i + 1}
                                                            onClick={() => setModelConfig(prev => ({ ...prev, openai: { ...prev.openai, thinkingLevel: i + 1 } }))}
                                                            className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.openai.thinkingLevel === i + 1 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                        >
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Add Button */}
                                            <button 
                                                onClick={() => {
                                                    const modelName = modelConfig.openai.model.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                                                    setModelConfig(prev => ({
                                                        ...prev,
                                                        openai: {
                                                            ...prev.openai,
                                                            savedModels: [
                                                                ...prev.openai.savedModels,
                                                                {
                                                                    id: Math.random().toString(36).substr(2, 9),
                                                                    modelId: prev.openai.model,
                                                                    name: modelName,
                                                                    thinkingLevel: prev.openai.thinkingLevel
                                                                }
                                                            ]
                                                        }
                                                    }));
                                                }}
                                                className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99]"
                                            >
                                                Add to Models
                                            </button>
                                        </div>
                                    )}

                                    {providerState.activeProvider === 'anthropic' && (
                                        <div className="p-6 space-y-6">
                                            {/* Model Selection */}
                                            <div className="space-y-3">
                                                <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                                                <div className="relative" data-dropdown="anthropic">
                                                    {/* Custom Dropdown Trigger */}
                                                    <button
                                                        onClick={() => anthropicDropdownOpen ? closeAnthropicDropdown() : setAnthropicDropdownOpen(true)}
                                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                                                    >
                                                        <span>{
                                                            {
                                                                'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet (New)',
                                                                'claude-3-opus-20240229': 'Claude 3 Opus',
                                                                'claude-3-haiku-20240307': 'Claude 3 Haiku'
                                                            }[modelConfig.anthropic.model] || 'Select model'
                                                        }</span>
                                                        <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${anthropicDropdownOpen ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    
                                                    {/* Custom Dropdown Menu */}
                                                    {anthropicDropdownOpen && (
                                                        <div className={`absolute top-full left-0 right-0 mt-2 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden origin-top ${anthropicDropdownClosing ? 'animate-dropdownClose' : 'animate-dropdownOpen'}`}>
                                                                {/* Corner Border Glow Effects */}
                                                                <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                                                                <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                                                                {[
                                                                    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (New)' },
                                                                    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
                                                                    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
                                                                ].map((model, index, arr) => (
                                                                    <button
                                                                        key={model.id}
                                                                        onClick={() => {
                                                                            setModelConfig(prev => ({ ...prev, anthropic: { ...prev.anthropic, model: model.id } }));
                                                                            closeAnthropicDropdown();
                                                                        }}
                                                                        className={`
                                                                            relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                                                            ${modelConfig.anthropic.model === model.id 
                                                                                ? 'bg-white/10 text-white' 
                                                                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                                                            }
                                                                            ${index === 0 ? 'rounded-t-lg' : ''}
                                                                            ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                                                        `}
                                                                    >
                                                                        <span className="font-medium">{model.name}</span>
                                                                        {modelConfig.anthropic.model === model.id && (
                                                                            <Check size={16} className="text-white" />
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Thinking Level */}
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Thinking</label>
                                                    <span className="text-[11px] font-medium text-zinc-400">
                                                        {modelConfig.anthropic.thinkingLevel === 0 ? 'Off' : ['Low', 'Medium', 'High'][modelConfig.anthropic.thinkingLevel - 1]}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 p-1 bg-white/[0.02] rounded-xl border border-white/5">
                                                    <button
                                                        onClick={() => setModelConfig(prev => ({ ...prev, anthropic: { ...prev.anthropic, thinkingLevel: 0 } }))}
                                                        className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.anthropic.thinkingLevel === 0 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                    >
                                                        None
                                                    </button>
                                                    {['Low', 'Medium', 'High'].map((label, i) => (
                                                        <button
                                                            key={i + 1}
                                                            onClick={() => setModelConfig(prev => ({ ...prev, anthropic: { ...prev.anthropic, thinkingLevel: i + 1 } }))}
                                                            className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all ${modelConfig.anthropic.thinkingLevel === i + 1 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                        >
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Add Button */}
                                            <button 
                                                onClick={() => {
                                                    const modelName = modelConfig.anthropic.model.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                                                    setModelConfig(prev => ({
                                                        ...prev,
                                                        anthropic: {
                                                            ...prev.anthropic,
                                                            savedModels: [
                                                                ...prev.anthropic.savedModels,
                                                                {
                                                                    id: Math.random().toString(36).substr(2, 9),
                                                                    modelId: prev.anthropic.model,
                                                                    name: modelName,
                                                                    thinkingLevel: prev.anthropic.thinkingLevel
                                                                }
                                                            ]
                                                        }
                                                    }));
                                                }}
                                                className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99]"
                                            >
                                                Add to Models
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Unified Global Models List */}
                                <div className="mt-8 pt-8 border-t border-white/5">
                                    <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-4">Models:</h2>
                                    <div className="space-y-4">
                                        {[
                                            ...modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' as const })),
                                            ...modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' as const })),
                                            ...modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' as const }))
                                        ].length === 0 ? (
                                            <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl text-zinc-500 text-[13px]">
                                                No model presets configured yet. Add one above to get started.
                                            </div>
                                        ) : (
                                            [
                                                ...modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' as const })),
                                                ...modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' as const })),
                                                ...modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' as const }))
                                            ].map((saved) => (
                                                <div key={saved.id} className="group relative bg-[#1c1c1c] border border-white/10 rounded-xl px-5 py-4 flex items-center justify-between transition-all hover:bg-white/5 shadow-sm">
                                                    <div className="flex items-center gap-4">
                                                        <div className={saved.provider === 'gemini' ? "text-[#fbbf24]" : "text-white"}>
                                                            {saved.provider === 'gemini' && (
                                                                <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
                                                                    <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z"/>
                                                                </svg>
                                                            )}
                                                            {saved.provider === 'openai' && (
                                                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.0462 6.0462 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729ZM12.72 1.2511a4.4938 4.4938 0 0 1 4.093 2.5022.7543.7543 0 0 1-.3682.9976l-1.6375.9463a.7543.7543 0 0 1-1.0116-.2716 3.013 3.013 0 0 0-2.6186-1.5037 3.013 3.013 0 0 0-2.6234 1.5037.7543.7543 0 0 1-1.0116.2716l-1.6375-.9463a.7543.7543 0 0 1-.3682-.9976 4.3989 4.3989 0 0 1 7.1837-2.5022Zm-9.2538 4.793a4.4938 4.4938 0 0 1 2.9818-3.0076.7543.7543 0 0 1 1.0164.3872l.9438 1.6385a.7543.7543 0 0 1-.3824 1.0543 2.9228 2.9228 0 0 0-1.8974 2.2109 2.9228 2.9228 0 0 0 1.2526 2.5211.7543.7543 0 0 1 .28.9833l-.939 1.6385a.7543.7543 0 0 1-1.026.316 4.3323 4.3323 0 0 1-2.2299-7.7423Zm13.5654 13.9048a.7543.7543 0 0 1-1.0165-.3872l-.9438-1.6384a.7543.7543 0 0 1 .3824-1.0544 2.9228 2.9228 0 0 0 1.8974-2.2108 2.9228 2.9228 0 0 0-1.2526-2.5212.7543.7543 0 0 1-.28-.9833l.939-1.6384a.7543.7543 0 0 1 1.026-.3161 4.3323 4.3323 0 0 1 2.2299 7.7424 4.4938 4.4938 0 0 1-2.9818 3.0074Zm-2.7505-1.5791-1.6375-.9462a.7543.7543 0 0 1-.3683-.9976 2.994 2.994 0 0 0 0-3.0075.7543.7543 0 0 1 .3683-.9976l1.6375-.9463a.7543.7543 0 0 1 1.0116.2716 4.3228 4.3228 0 0 1-.0047 5.352.7543.7543 0 0 1-1.0069.2716ZM8.5583 18.0664a.7543.7543 0 0 1-.3683.9976 4.4938 4.4938 0 0 1-4.093-2.5023.7543.7543 0 0 1 .3682-.9976l1.6375-.9463a.7543.7543 0 0 1 1.0116.2716 3.013 3.013 0 0 0 2.6186 1.5037 3.013 3.013 0 0 0 2.6234-1.5037.7543.7543 0 0 1 1.0116-.2716l1.6375.9463a.7543.7543 0 0 1 .3682.9976 4.3989 4.3989 0 0 1-7.1837 2.5022l-1.6316-.9975Z"/></svg>
                                                            )}
                                                            {saved.provider === 'anthropic' && (
                                                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                                                    <path d="M16.9 18.9h-1.9l-3.9-10.4h-0.1l-3.9 10.4h-1.9l5-12.8h1.7L16.9 18.9z M9.2 13h5.7L12 5.5h-0.1L9.2 13z" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-[14px] font-semibold text-white">{saved.name}</span>
                                                            <span className="text-[11px] font-medium text-zinc-500 uppercase">
                                                                {saved.provider === 'gemini' ? 'Google' : saved.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-6">
                                                        <div className="flex items-center gap-2">
                                                            {[1, 2, 3].map((level) => {
                                                                if (saved.provider === 'gemini') {
                                                                    const geminiModel = GEMINI_MODELS.find(m => m.id === saved.modelId);
                                                                    if (geminiModel && level > geminiModel.maxLevels) return null;
                                                                }
                                                                return (
                                                                    <ReasoningBulb 
                                                                        key={level}
                                                                        isActive={level <= saved.thinkingLevel}
                                                                        className={level <= saved.thinkingLevel ? "text-[#fbbf24] w-[20px] h-[20px]" : "text-zinc-600 w-[20px] h-[20px]"} 
                                                                        strokeWidth={level <= saved.thinkingLevel ? 0 : 2}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setModelConfig(prev => {
                                                                    const provider = saved.provider;
                                                                    return {
                                                                        ...prev,
                                                                        [provider]: {
                                                                            ...prev[provider],
                                                                            savedModels: prev[provider].savedModels.filter(m => m.id !== saved.id)
                                                                        }
                                                                    };
                                                                });
                                                            }}
                                                            className="p-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-full hover:bg-white/5"
                                                        >
                                                            <X size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'people' && (
                <div className="w-full h-full px-12 py-10 flex flex-col overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                        <h1 className="text-[24px] font-bold text-white">People</h1>
                    </div>
                    
                    <div className="pb-6 mb-6">
                        <p className="text-[14px] text-zinc-400">
                             Inviting people to <span className="text-white font-medium">{userProfile?.workspaceName || "My Willow"}</span> gives access to workspace shared projects and credits. You have 1 builder in this workspace.
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-center gap-1 mb-8">
                        {['All', 'Invitations', 'Collaborators'].map((tab) => (
                            <button 
                                key={tab}
                                className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-colors
                                    ${tab === 'All' 
                                        ? 'bg-[#27272a] text-white' 
                                        : 'text-zinc-500 hover:text-white'
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Search and Action Bar */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                                <input 
                                    type="text" 
                                    placeholder="Search..."
                                    className="bg-transparent border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-[13px] text-white w-64 focus:outline-none focus:border-white/20 transition-colors"
                                />
                            </div>
                            <button className="flex items-center justify-between gap-2 bg-transparent border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-white w-32 hover:bg-white/5 transition-colors">
                                <span>All roles</span>
                                <ChevronDown size={14} className="text-zinc-500" />
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <button className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/5 rounded-lg transition-colors border border-white/5">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                <span>Export</span>
                            </button>
                            <button className="flex items-center gap-2 px-4 py-1.5 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-200 transition-colors">
                                <Users size={16} />
                                <span>Invite members</span>
                            </button>
                        </div>
                    </div>

                    {/* Table Container */}
                    <div className="flex-1 min-h-0 flex flex-col border border-white/5 rounded-xl bg-[#1c1c1c] overflow-hidden">
                        <div className="grid grid-cols-[1fr_120px_140px_120px_120px_120px_40px] px-4 py-3 bg-[#242424]/40 border-b border-white/5 text-[12px] font-medium text-zinc-500">
                            {[
                                { label: 'Name', sortable: true },
                                { label: 'Role', sortable: true },
                                { label: 'Joined date', sortable: true },
                                { label: 'Dec usage', sortable: true },
                                { label: 'Total usage', sortable: true },
                                { label: 'Credit limit', sortable: true },
                            ].map((col) => (
                                <div key={col.label} className="flex items-center gap-1 cursor-pointer hover:text-white transition-colors">
                                    <span>{col.label}</span>
                                    {col.sortable && (
                                        <div className="flex flex-col gap-0.5 opacity-50">
                                            <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[4px] border-b-current" />
                                            <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current" />
                                        </div>
                                    )}
                                </div>
                            ))}
                            <div />
                        </div>
                        
                        <div className="divide-y divide-white/5">
                            <div className="grid grid-cols-[1fr_120px_140px_120px_120px_120px_40px] px-4 py-4 items-center group hover:bg-white/[0.02] transition-colors">
                                <div className="flex items-center gap-3">
                                    {userProfile?.photoURL ? (
                                        <img 
                                            src={userProfile.photoURL} 
                                            alt="User" 
                                            className="w-10 h-10 rounded-full border border-white/10 object-cover" 
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full border border-white/10 bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center text-white font-medium">
                                            {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                                        </div>
                                    )}
                                    <div className="flex flex-col">
                                        <span className="text-[13px] font-bold text-white">{userProfile?.displayName || 'User'} (you)</span>
                                        <span className="text-[12px] text-zinc-500">{user?.email || ''}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 text-[13px] text-zinc-300">
                                    <span>Owner</span>
                                    <ChevronDown size={14} className="text-zinc-500" />
                                </div>
                                <div className="text-[13px] text-zinc-300">Jun 17, 2025</div>
                                <div className="text-[13px] text-white font-bold">6 credits</div>
                                <div className="text-[13px] text-white font-bold">33 credits</div>
                                <div className="text-[13px] text-zinc-300"></div>
                                <div className="flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button className="p-1 hover:text-white transition-colors">
                                        <MoreHorizontal size={18} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'privacy' && (
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
            )}


            {activeTab === 'labs' && (
                <div className="w-full h-full px-12 py-10 overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                        <h1 className="text-[24px] font-bold text-white">Labs</h1>
                    </div>
                    
                    <div className="pb-6 border-b border-white/5 mb-0">
                        <p className="text-[14px] text-zinc-400">
                            These are experimental features, that might be modified or removed.
                        </p>
                    </div>

                    <div className="space-y-0 pb-10">
                        {/* GitHub branch switching */}
                        <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
                            <div className="flex-1 max-w-[60%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">GitHub branch switching</h3>
                                <p className="text-[14px] text-zinc-400">Select the branch to make edits to in your GitHub repository.</p>
                            </div>
                            <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
                                <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all group-hover:bg-zinc-500 translate-x-[16px] !bg-white" />
                            </div>
                        </div>

                         {/* Prototyping */}
                         <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
                            <div className="flex-1 max-w-[60%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">Prototyping</h3>
                                <p className="text-[14px] text-zinc-400">Build and share AI-powered mini-apps using natural language prompts.</p>
                            </div>
                             <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
                                <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all -translate-x-0 group-hover:bg-zinc-500" />
                            </div>
                        </div>

                         {/* Designing */}
                         <div className="py-6 flex items-start justify-between gap-8">
                            <div className="flex-1 max-w-[60%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">Designing</h3>
                                <p className="text-[14px] text-zinc-400">Generate production-ready UI designs and code from text or sketches.</p>
                            </div>
                             <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
                                <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 transition-all -translate-x-0 group-hover:bg-zinc-500" />
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {activeTab === 'account' && (
                <div className="w-full h-full relative flex flex-col">
                    <div className="flex-1 overflow-y-auto px-12 py-10 pb-32">
                        <div className="flex items-center justify-between mb-2">
                            <h1 className="text-[24px] font-bold text-white">Account settings</h1>
                        </div>
                        <div className="pb-6 border-b border-white/5 mb-6">
                            <p className="text-[14px] text-zinc-400">
                                 Personalize how others see and interact with you on Willow.
                            </p>
                        </div>

                        {/* Avatar */}
                         <div className="flex items-start gap-8 py-6 border-b border-white/5">
                            <div className="w-[50%] shrink-0">
                                <h3 className="text-[14px] font-bold text-white mb-1">Your avatar</h3>
                                <p className="text-[14px] text-zinc-400">Your avatar is either fetched from your linked identity provider or automatically generated based on your account.</p>
                            </div>
                            <div className="flex-1 flex justify-end">
                                <div className="relative group cursor-pointer">
                                    <input
                                        type="file"
                                        id="account-avatar-upload"
                                        accept="image/*"
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                                const file = e.target.files[0];
                                                const imageUrl = URL.createObjectURL(file);
                                                setLocalPhotoURL(imageUrl);
                                                setAccountSettingsChanged(true);
                                            }
                                        }}
                                        className="hidden"
                                    />
                                    <label htmlFor="account-avatar-upload" className="cursor-pointer block relative">
                                        {localPhotoURL ? (
                                            <img 
                                                src={localPhotoURL} 
                                                alt="User Avatar" 
                                                className="w-[64px] h-[64px] rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-[64px] h-[64px] rounded-full bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center">
                                                <span className="text-white text-xl font-medium">
                                                    {localDisplayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                                                </span>
                                            </div>
                                        )}
                                        {/* Hover overlay */}
                                        <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                            <PenLine size={20} className="text-white" />
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Username */}
                        <div className="py-6 border-b border-white/5">
                            <div className="flex items-start gap-8">
                                 <div className="w-[50%] shrink-0">
                                    <h3 className="text-[14px] font-bold text-white mb-1">Username</h3>
                                    <p className="text-[14px] text-zinc-400">Your public identifier and profile URL. No spaces allowed.</p>
                                </div>
                                <div className="flex-1">
                                    <input 
                                        type="text" 
                                        value={localUsername}
                                        onChange={(e) => {
                                            // Remove spaces from username
                                            const noSpaces = e.target.value.replace(/\s+/g, '');
                                            setLocalUsername(noSpaces);
                                            setAccountSettingsChanged(true);
                                        }}
                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors mb-2"
                                    />
                                    <a href="#" className="text-[13px] text-zinc-500 hover:text-zinc-400 transition-colors flex items-center gap-1">
                                        willow.dev/@{localUsername || 'user'} 
                                        <ArrowUpRight size={13} />
                                    </a>
                                </div>
                            </div>
                        </div>

                         {/* Email */}
                         <div className="py-6 border-b border-white/5">
                            <div className="flex items-start gap-8">
                                 <div className="w-[50%] shrink-0">
                                    <h3 className="text-[14px] font-bold text-white mb-1">Email</h3>
                                    <p className="text-[14px] text-zinc-400">Your email address associated with your account.</p>
                                </div>
                                <div className="flex-1">
                                    <input 
                                        type="email" 
                                        value={user?.email || ''}
                                        readOnly
                                        className="w-full bg-[#1c1c1c] border border-white/5 rounded-xl px-4 py-2.5 text-[14px] text-zinc-400 focus:outline-none cursor-not-allowed"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Name */}
                        <div className="py-6 border-b border-white/5">
                            <div className="flex items-start gap-8">
                                 <div className="w-[50%] shrink-0">
                                    <h3 className="text-[14px] font-bold text-white mb-1">Name</h3>
                                    <p className="text-[14px] text-zinc-400">Your full name, as visible to others.</p>
                                </div>
                                <div className="flex-1">
                                    <input 
                                        type="text" 
                                        value={localDisplayName}
                                        onChange={(e) => {
                                            setLocalDisplayName(e.target.value);
                                            setAccountSettingsChanged(true);
                                        }}
                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        <div className="py-6 border-b border-white/5">
                            <div className="flex items-start gap-8">
                                 <div className="w-[50%] shrink-0">
                                    <h3 className="text-[14px] font-bold text-white mb-1">Description</h3>
                                    <p className="text-[14px] text-zinc-400">A short description of yourself or your work.</p>
                                </div>
                                <div className="flex-1">
                                    <textarea 
                                        value={localDescription}
                                        onChange={(e) => {
                                            setLocalDescription(e.target.value);
                                            setAccountSettingsChanged(true);
                                        }}
                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors resize-y min-h-[100px]"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Location */}
                        <div className="py-6 border-b border-white/5">
                            <div className="flex items-start gap-8">
                                 <div className="w-[50%] shrink-0">
                                    <h3 className="text-[14px] font-bold text-white mb-1">Location</h3>
                                    <p className="text-[14px] text-zinc-400">Where you're based.</p>
                                </div>
                                <div className="flex-1">
                                    <input 
                                        type="text"
                                        value={localLocation}
                                        onChange={(e) => {
                                            setLocalLocation(e.target.value);
                                            setAccountSettingsChanged(true);
                                        }}
                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Link */}
                        <div className="py-6 border-b border-white/5">
                            <div className="flex items-start gap-8">
                                 <div className="w-[50%] shrink-0">
                                    <h3 className="text-[14px] font-bold text-white mb-1">Link</h3>
                                    <p className="text-[14px] text-zinc-400">Add a link to your personal website or portfolio.</p>
                                </div>
                                <div className="flex-1">
                                    <input 
                                        type="text" 
                                        className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Hide profile picture */}
                        <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
                            <div className="flex-1 max-w-[50%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">Hide profile picture</h3>
                            </div>
                            <div className="w-4 h-4 rounded border border-white/10 bg-transparent cursor-pointer flex items-center justify-center">
                                 {/* Checkbox Placeholder - assuming functionality not required yet or simple div */}
                            </div>
                        </div>

                        {/* Chat suggestions */}
                        <div className="py-6 flex items-start justify-between gap-8">
                            <div className="flex-1 max-w-[50%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">Chat suggestions</h3>
                                <p className="text-[14px] text-zinc-400">Show helpful suggestions in the chat interface to enhance your experience.</p>
                            </div>
                             <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
                                <div className="w-3.5 h-3.5 rounded-full bg-white transition-all translate-x-[16px]" />
                            </div>
                        </div>

                        {/* Generation complete sound */}
                        <div className="py-6 border-t border-white/5 flex items-start justify-between gap-8">
                            <div className="flex-1 max-w-[50%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">Generation complete sound</h3>
                                 <p className="text-[14px] text-zinc-400">Plays a satisfying sound notification when a generation is finished.</p>
                            </div>
                             <div className="space-y-2">
                                 <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full border border-white/20 flex items-center justify-center">
                                        <div className="w-2 h-2 bg-white rounded-full"></div>
                                    </div>
                                    <span className="text-[14px] text-white">First generation</span>
                                </div>
                                 <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full border border-white/20"></div>
                                    <span className="text-[14px] text-zinc-400">Always</span>
                                </div>
                                 <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full border border-white/20"></div>
                                    <span className="text-[14px] text-zinc-400">Never</span>
                                </div>
                            </div>
                        </div>

                         {/* Linked sign-in providers */}
                        <div className="py-6 border-t border-white/5 flex items-start justify-between gap-8">
                            <div className="flex-1 max-w-[100%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">Linked sign-in providers</h3>
                                 <p className="text-[14px] text-zinc-400 mb-3">Manage authentication providers linked to your account.</p>
                                 
                                 <div className="w-full bg-[#1c1c1c] border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                            <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center p-1">
                                                {/* Google G SVG */}
                                                <svg viewBox="0 0 24 24" className="w-full h-full">
                                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                                </svg>
                                            </div>
                                            <div>
                                                <div className="text-[13px] font-medium text-white flex items-center gap-2">
                                                    Google 
                                                    <span className="bg-zinc-800 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Primary</span>
                                                </div>
                                                <div className="text-[13px] text-zinc-500">{user?.email || ''}</div>
                                            </div>
                                      </div>
                                 </div>
                            </div>
                        </div>


                         {/* Delete account */}
                         <div className="py-6 border-t border-white/5 flex items-center justify-between gap-8 mb-8">
                            <div className="flex-1 max-w-[60%]">
                                <h3 className="text-[14px] font-bold text-white mb-1">Delete account</h3>
                                 <p className="text-[14px] text-zinc-400">Permanently delete your Willow account. This cannot be undone.</p>
                            </div>
                            <button 
                              onClick={() => setShowDeleteConfirmation(true)}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[13px] font-medium rounded-lg transition-colors"
                            >
                                Delete account
                            </button>
                        </div>

                        {/* Delete Account Confirmation Dialog */}
                        {showDeleteConfirmation && (
                          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]">
                            <div className="bg-[#1c1c1c] border border-white/10 rounded-[2rem] p-8 max-w-md w-full mx-4 shadow-2xl">
                              <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 rounded-full bg-red-600/20 flex items-center justify-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                                    <path d="M12 9v4"/>
                                    <path d="M12 17h.01"/>
                                  </svg>
                                </div>
                                <h2 className="text-[20px] font-bold text-white">Delete your account?</h2>
                              </div>
                              
                              <div className="bg-red-600/10 border border-red-600/20 rounded-xl p-4 mb-6">
                                <p className="text-[14px] text-red-200">
                                  <strong>Warning:</strong> This action is permanent and cannot be undone. All of the following will be deleted:
                                </p>
                                <ul className="text-[14px] text-red-200/80 mt-2 space-y-1 list-disc list-inside">
                                  <li>All your projects and code</li>
                                  <li>Your profile and settings</li>
                                  <li>All data in Google Drive (Willow Apps folder)</li>
                                  <li>Your account credentials</li>
                                </ul>
                              </div>
                              
                              {deleteError && (
                                <div className="bg-red-600/20 border border-red-600/30 rounded-xl p-3 mb-4">
                                  <p className="text-[13px] text-red-300">{deleteError}</p>
                                </div>
                              )}
                              
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => {
                                    setShowDeleteConfirmation(false);
                                    setDeleteError(null);
                                  }}
                                  className="flex-1 px-4 py-3 text-[14px] font-semibold text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={handleDeleteAccount}
                                  disabled={isDeleting}
                                  className="flex-1 px-4 py-3 text-[14px] font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                  {isDeleting ? (
                                    <>
                                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      Deleting...
                                    </>
                                  ) : (
                                    'Delete permanently'
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Spacer for floating footer */}
                        <div className="h-10"></div>
                    </div>
                    
                    {/* Floating Footer */}
                    <div className="absolute bottom-0 w-full bg-[#1c1c1c] border-t border-white/10 px-8 py-4 flex items-center justify-end gap-3 z-10 shadow-2xl">
                         <button 
                            onClick={handleAccountCancel}
                            className="px-4 py-2 text-[13px] font-bold text-white hover:bg-white/5 rounded-lg transition-colors"
                         >
                            Cancel
                        </button>
                        <button 
                            onClick={handleAccountUpdate}
                            disabled={!accountSettingsChanged}
                            className="px-5 py-2 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-100 transition-colors shadow-lg shadow-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Update
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'connectors' && (
                !activeConnector ? (
                    <div className="w-full h-full px-12 py-10 overflow-y-auto">
                        <div className="flex items-center justify-between mb-2">
                            <h1 className="text-[24px] font-bold text-white">Connectors</h1>
                        </div>

                        {/* Enabled connectors */}
                        <div className="mt-8">
                            <h2 className="text-[16px] font-bold text-white mb-1">Enabled connectors</h2>
                            <p className="text-[14px] text-zinc-400 mb-4 max-w-2xl">
                                Add functionality to your apps. Configured once by admins, available to everyone in your workspace.
                            </p>
                            
                            <div className="grid grid-cols-2 gap-4">
                                {/* Webcontainers */}
                                <div 
                                    onClick={() => setActiveConnector('webcontainers')}
                                    className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-[#1c1c1c] flex items-center justify-center border border-white/5">
                                            <Cloud size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="text-[14px] font-bold text-white">Webcontainers</span>
                                                <span className="text-[11px] font-bold text-[#4ade80] bg-[#4ade80]/10 px-1.5 py-0.5 rounded">Enabled</span>
                                            </div>
                                            <div className="text-[13px] text-zinc-400">Browser-based Node.js runtime</div>
                                        </div>
                                    </div>
                                    <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
                                </div>

                                {/* Willow AI */}
                                <div 
                                    onClick={() => setActiveConnector('willow-ai')}
                                    className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-[#1c1c1c] flex items-center justify-center border border-white/5">
                                            <FlaskConical size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="text-[14px] font-bold text-white">Willow AI</span>
                                                <span className="text-[11px] font-bold text-[#4ade80] bg-[#4ade80]/10 px-1.5 py-0.5 rounded">Enabled</span>
                                            </div>
                                            <div className="text-[13px] text-zinc-400">Unlock powerful AI features</div>
                                        </div>
                                    </div>
                                    <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
                                </div>
                            </div>
                        </div>

                        {/* Available connectors */}
                        <div className="mt-10 mb-12">
                            <h2 className="text-[16px] font-bold text-white mb-1">Available connectors</h2>
                            <p className="text-[14px] text-zinc-400 mb-4 max-w-2xl">
                                Connect your personal tools to provide context while building. Only you can access your connections.
                            </p>
                            
                            <div className="grid grid-cols-2 gap-4">
                                {/* Search */}
                                <div 
                                    onClick={() => setActiveConnector('search')}
                                    className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-[#1c1c1c] flex items-center justify-center border border-white/5">
                                            <Search size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <div className="text-[14px] font-bold text-white mb-0.5">Search</div>
                                            <div className="text-[13px] text-zinc-400">Allow AI Agent to search through the web</div>
                                        </div>
                                    </div>
                                    <button className="px-3 py-1.5 bg-[#1c1c1c] hover:bg-white/5 border border-white/10 rounded-lg text-white text-[12px] font-medium transition-colors">
                                        Set up
                                    </button>
                                </div>

                                {/* Drive */}
                                <div 
                                    onClick={() => setActiveConnector('drive')}
                                    className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-[#1c1c1c] flex items-center justify-center border border-white/5">
                                            <HardDrive size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <div className="text-[14px] font-bold text-white mb-0.5">Drive</div>
                                            <div className="text-[13px] text-zinc-400">Save and share your projects</div>
                                        </div>
                                    </div>
                                    <button className="px-3 py-1.5 bg-[#1c1c1c] hover:bg-white/5 border border-white/10 rounded-lg text-white text-[12px] font-medium transition-colors">
                                        Set up
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : activeConnector === 'willow-ai' ? (
                    <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
                        <button 
                            onClick={() => setActiveConnector(null)}
                            className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
                        >
                            <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
                            <span>Connectors</span>
                        </button>

                        <div className="flex items-center justify-center mb-10">
                             <div className="flex flex-col items-center gap-4 text-center">
                                <div className="w-16 h-16 rounded-2xl bg-[#272729] flex items-center justify-center border border-white/5 shadow-2xl">
                                    <FlaskConical size={32} className="text-white" />
                                </div>
                                <div>
                                    <div className="flex items-center justify-center gap-3 mb-1">
                                        <h1 className="text-[24px] font-bold text-white">Willow AI</h1>
                                        <span className="text-[12px] font-bold text-[#4ade80] bg-[#4ade80]/10 px-2 py-0.5 rounded">Enabled</span>
                                    </div>
                                    <p className="text-[16px] text-zinc-400">Unlock powerful AI features</p>
                                </div>
                             </div>
                        </div>

                        <div className="space-y-10 max-w-3xl mx-auto">
                            {/* Overview */}
                            <div>
                                <h2 className="text-[18px] font-bold text-white mb-3">Overview</h2>
                                <p className="text-[14px] leading-relaxed text-zinc-400">
                                    Enable to use AI models without needing to provide an API key and centralized billing. 
                                    Willow AI seamlessly integrates with your workflow to provide intelligent assistance, code generation, and more.
                                </p>
                            </div>

                            {/* Available models */}
                            <div>
                                <h2 className="text-[18px] font-bold text-white mb-3">Available models</h2>
                                <p className="text-[14px] text-zinc-400 mb-6">
                                    AI models you can use through Willow AI Gateway.
                                </p>
                                
                                <div className="bg-[#272729] border border-white/5 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-6">
                                    <div>
                                        <h3 className="text-[15px] font-bold text-white mb-1">Manage Models & API Keys</h3>
                                        <p className="text-[13px] text-zinc-400">
                                            Configure your model providers, API keys, and selected models in the settings menu.
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => setActiveTab('models')}
                                        className="px-4 py-2 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-200 transition-colors whitespace-nowrap"
                                    >
                                        Open Settings
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : activeConnector === 'webcontainers' ? (
                    <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
                        <button 
                            onClick={() => setActiveConnector(null)}
                            className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
                        >
                            <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
                            <span>Connectors</span>
                        </button>

                        <div className="flex items-center justify-center mb-10">
                             <div className="flex flex-col items-center gap-4 text-center">
                                <div className="w-16 h-16 rounded-2xl bg-[#272729] flex items-center justify-center border border-white/5 shadow-2xl">
                                    <Cloud size={32} className="text-white" />
                                </div>
                                <div>
                                    <div className="flex items-center justify-center gap-3 mb-1">
                                        <h1 className="text-[24px] font-bold text-white">Webcontainers</h1>
                                        <span className="text-[12px] font-bold text-[#4ade80] bg-[#4ade80]/10 px-2 py-0.5 rounded">Enabled</span>
                                    </div>
                                    <p className="text-[16px] text-zinc-400">Browser-based Node.js runtime</p>
                                </div>
                             </div>
                        </div>

                        <div className="space-y-10 max-w-3xl mx-auto">
                            {/* Overview */}
                            <div>
                                <h2 className="text-[18px] font-bold text-white mb-3">Overview</h2>
                                <p className="text-[14px] leading-relaxed text-zinc-400">
                                    Webcontainers allow you to run Node.js directly in your browser. This technology powers the instant development environment, enabling you to run build tools, servers, and scripts without any local setup or cloud latency.
                                </p>
                            </div>

                             {/* Features / Details */}
                             <div>
                                <h2 className="text-[18px] font-bold text-white mb-3">Capabilities</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                                         <h3 className="text-[14px] font-bold text-white mb-1">Instant Boot</h3>
                                         <p className="text-[13px] text-zinc-400">Environments start in milliseconds.</p>
                                    </div>
                                    <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                                         <h3 className="text-[14px] font-bold text-white mb-1">Secure by Default</h3>
                                         <p className="text-[13px] text-zinc-400">Code runs entirely within your browser sandbox.</p>
                                    </div>
                                    <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                                         <h3 className="text-[14px] font-bold text-white mb-1">Full Node.js API</h3>
                                         <p className="text-[13px] text-zinc-400">Support for standard Node.js binaries and packages.</p>
                                    </div>
                                    <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                                         <h3 className="text-[14px] font-bold text-white mb-1">Offline Capable</h3>
                                         <p className="text-[13px] text-zinc-400">Works even without an internet connection once loaded.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : activeConnector === 'search' ? (
                    <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
                        <button 
                            onClick={() => setActiveConnector(null)}
                            className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
                        >
                            <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
                            <span>Connectors</span>
                        </button>

                         <div className="flex items-center justify-center mb-10">
                             <div className="flex flex-col items-center gap-4 text-center">
                                <div className="w-16 h-16 rounded-2xl bg-[#272729] flex items-center justify-center border border-white/5 shadow-2xl">
                                    <Search size={32} className="text-white" />
                                </div>
                                <div>
                                     <div className="flex items-center justify-center gap-3 mb-1">
                                        <h1 className="text-[24px] font-bold text-white">Search</h1>
                                    </div>
                                    <p className="text-[16px] text-zinc-400">Allow AI Agent to search through the web</p>
                                </div>
                             </div>
                        </div>

                        <div className="max-w-xl mx-auto space-y-6">
                            <div className="space-y-2">
                                <label className="text-[14px] font-medium text-white">Google Custom Search API Key</label>
                                <input 
                                    type="password"
                                    placeholder="Enter your API key"
                                    className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all placeholder:text-zinc-600"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[14px] font-medium text-white">Search Engine ID (CX)</label>
                                <input 
                                    type="text"
                                    placeholder="Enter your Search Engine ID"
                                    className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all placeholder:text-zinc-600"
                                />
                            </div>

                             <div className="pt-4 flex justify-end">
                                <button className="px-6 py-2.5 bg-white text-black text-[14px] font-bold rounded-xl hover:bg-zinc-200 transition-colors shadow-lg shadow-white/5">
                                    Save Configuration
                                </button>
                            </div>
                        </div>
                    </div>
                ) : activeConnector === 'drive' ? (
                    <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
                        <button 
                            onClick={() => setActiveConnector(null)}
                            className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
                        >
                            <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
                            <span>Connectors</span>
                        </button>

                         <div className="flex items-center justify-center mb-10">
                             <div className="flex flex-col items-center gap-4 text-center">
                                <div className="w-16 h-16 rounded-2xl bg-[#272729] flex items-center justify-center border border-white/5 shadow-2xl">
                                    <HardDrive size={32} className="text-white" />
                                </div>
                                <div>
                                     <div className="flex items-center justify-center gap-3 mb-1">
                                        <h1 className="text-[24px] font-bold text-white">Drive</h1>
                                        {isDriveConnected && (
                                            <span className="text-[12px] font-bold text-[#4ade80] bg-[#4ade80]/10 px-2 py-0.5 rounded">Connected</span>
                                        )}
                                    </div>
                                    <p className="text-[16px] text-zinc-400">Save and share your projects</p>
                                </div>
                             </div>
                        </div>

                        <div className="max-w-xl mx-auto space-y-8">
                            {/* Overview */}
                            <div>
                                <h2 className="text-[18px] font-bold text-white mb-3">Overview</h2>
                                <p className="text-[14px] leading-relaxed text-zinc-400">
                                    Connect your Google Drive to save and share your projects seamlessly. Your projects will be 
                                    stored in a dedicated folder, making it easy to access them from anywhere and collaborate with your team.
                                </p>
                            </div>

                            {/* Connection Status & Action */}
                            <div className="bg-[#272729] border border-white/5 rounded-xl p-6">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isDriveConnected ? 'bg-[#4ade80]/10' : 'bg-[#1c1c1c]'} border border-white/5`}>
                                            {isDriveConnected ? (
                                                <Check size={24} className="text-[#4ade80]" />
                                            ) : (
                                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                                </svg>
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="text-[15px] font-bold text-white mb-0.5">
                                                {isDriveConnected ? 'Google Drive Connected' : 'Google Drive'}
                                            </h3>
                                            <p className="text-[13px] text-zinc-400">
                                                {isDriveConnected 
                                                    ? 'Your projects are being synced to Drive' 
                                                    : 'Connect to save projects to your Drive'}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {isDriveConnected ? (
                                        <button 
                                            onClick={disconnectDrive}
                                            className="px-4 py-2 bg-[#1c1c1c] text-zinc-400 text-[13px] font-medium rounded-lg hover:bg-[#2a2a2a] hover:text-white transition-colors border border-white/10"
                                        >
                                            Disconnect
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={connectDrive}
                                            className="px-5 py-2.5 bg-white text-black text-[13px] font-bold rounded-xl hover:bg-zinc-200 transition-colors shadow-lg shadow-white/5 flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                            </svg>
                                            Connect Google Drive
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Benefits */}
                            {!isDriveConnected && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                                        <h3 className="text-[14px] font-bold text-white mb-1">Cloud Backup</h3>
                                        <p className="text-[13px] text-zinc-400">Your projects are safely stored in the cloud.</p>
                                    </div>
                                    <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                                        <h3 className="text-[14px] font-bold text-white mb-1">Easy Sharing</h3>
                                        <p className="text-[13px] text-zinc-400">Share projects with anyone via Drive links.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : null
            )}



            {activeTab !== 'workspace' && activeTab !== 'people' && activeTab !== 'privacy' && activeTab !== 'labs' && activeTab !== 'account' && activeTab !== 'connectors' && (
                <div className="w-full h-full flex items-center justify-center text-zinc-500 italic">
                    {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} settings coming soon...
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
