import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const isCoverVideo = (url: string): boolean => {
  if (!url) return false;
  // For data: URLs trust ONLY the MIME type. Never substring-match the base64
  // payload — random base64 routinely contains "veo"/"/video"/etc., which would
  // mis-render image covers inside a <video> tag (they appear blank/gray).
  if (url.startsWith('data:')) return url.startsWith('data:video');
  const lowercaseUrl = url.toLowerCase();
  return (
    lowercaseUrl.endsWith('.mp4') ||
    lowercaseUrl.endsWith('.webm') ||
    lowercaseUrl.includes('/video') ||
    lowercaseUrl.includes('generatevideo') ||
    lowercaseUrl.includes('veo')
  );
};
import { ViewType } from './Sidebar';
import { 
  Search, 
  ChevronDown, 
  LayoutGrid, 
  List, 
  MoreHorizontal, 
  Plus, 
  Star,
  SquareDashed,
  Folder,
  RotateCcw,
  Pencil,
  Settings,
  Trash2,
  Image as ImageIcon,
  Check,
  HardDrive
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBackground } from '../context/BackgroundContext';
import { loadAllProjectCovers, deleteProjectData, PROJECT_COVERS_UPDATED_EVENT } from '../lib/mediaStorage';
import { deleteCodeSessions } from '../lib/willowDB';
import { useLocalFS } from '../context/LocalFSContext';
import { readProjectRegistry, writeProjectRegistry } from '../lib/projectStorage';

interface ProjectCardProps {
  id: string;
  title: string;
  edited: string;
  createdAt: string;
  creator: string;
  thumbnail: string;
  isStarred?: boolean;
  hasChat?: boolean;
  isShared?: boolean;
  kind?: 'media' | 'code';
}

// Removed static PROJECT_DATA. It will be loaded dynamically.

const SortMenu: React.FC<{
  sortBy: string;
  setSortBy: (val: string) => void;
  order: string;
  setOrder: (val: string) => void;
}> = ({ sortBy, setSortBy, order, setOrder }) => {
  const sortItems = [
    { id: 'last-edited', label: 'Last edited' },
    { id: 'date-created', label: 'Date created' },
    { id: 'alphabetical', label: 'Alphabetical' },
  ];

  const orderItems = [
    { id: 'newest', label: 'Newest first' },
    { id: 'oldest', label: 'Oldest first' },
  ];

  return (
    <div 
      className="w-[210px] bg-[#1c1c1c] border border-white/10 rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.7)] py-2.5 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 pb-1 text-[14px] font-normal text-white tracking-tight">
        Sort by
      </div>
      <div className="h-[1px] bg-white/5 mx-2 mb-1" />
      <div className="px-2 pb-1.5">
        {sortItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setSortBy(item.id)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-[14px] font-medium transition-all duration-200 text-white hover:bg-[#2596be]"
          >
            <span>{item.label}</span>
            {sortBy === item.id && <Check size={16} strokeWidth={3} className="ml-2" />}
          </button>
        ))}
      </div>
      <div className="h-[1px] bg-white/10 mx-1 mb-2" />
      <div className="px-5 pb-1 text-[14px] font-normal text-white tracking-tight">
        Order
      </div>
      <div className="h-[1px] bg-white/5 mx-2 mb-1" />
      <div className="px-2 pb-1">
        {orderItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setOrder(item.id)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-[14px] font-medium transition-all duration-200 text-white hover:bg-[#2596be]"
          >
            <span>{item.label}</span>
            {order === item.id && <Check size={16} strokeWidth={3} className="ml-2" />}
          </button>
        ))}
      </div>
    </div>
  );
};

const VisibilityMenu: React.FC<{
  value: string;
  onChange: (val: string) => void;
}> = ({ value, onChange }) => {
  const items = [
    { id: 'any', label: 'Any visibility' },
    { id: 'public', label: 'Public' },
    { id: 'workspace', label: 'Workspace' },
  ];

  return (
    <div 
      className="w-[210px] bg-[#1c1c1c] border border-white/10 rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.7)] py-2.5 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 pb-1 text-[14px] font-normal text-white tracking-tight">
        Visibility
      </div>
      <div className="h-[1px] bg-white/5 mx-2 mb-1" />
      <div className="px-2 pb-1">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-[14px] font-medium transition-all duration-200 text-white hover:bg-[#2596be]"
          >
            <span>{item.label}</span>
            {value === item.id && <Check size={16} strokeWidth={3} className="ml-2" />}
          </button>
        ))}
      </div>
    </div>
  );
};

const StatusMenu: React.FC<{
  value: string;
  onChange: (val: string) => void;
}> = ({ value, onChange }) => {
  const items = [
    { id: 'any', label: 'Any status' },
    { id: 'all-published', label: 'All published' },
    { id: 'internally-published', label: 'Internally published' },
    { id: 'externally-published', label: 'Externally published' },
    { id: 'not-published', label: 'Not published' },
  ];

  return (
    <div 
      className="w-[210px] bg-[#1c1c1c] border border-white/10 rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.7)] py-2.5 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 pb-1 text-[14px] font-normal text-white tracking-tight">
        Publish status
      </div>
      <div className="h-[1px] bg-white/5 mx-2 mb-1" />
      <div className="px-2 pb-1">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-[14px] font-medium transition-all duration-200 text-white hover:bg-[#2596be]"
          >
            <span>{item.label}</span>
            {value === item.id && <Check size={16} strokeWidth={3} className="ml-2" />}
          </button>
        ))}
      </div>
    </div>
  );
};

const CreatorMenu: React.FC<{
  value: string;
  onChange: (val: string) => void;
}> = ({ value, onChange }) => {
  const [search, setSearch] = useState('');
  const items = [
    { id: 'all', label: 'All creators' },
    { id: 'redacted@example.com', label: 'redacted@example.com (You)' },
  ].filter(item => item.label.toLowerCase().includes(search.toLowerCase()));

  return (
    <div 
      className="w-[240px] bg-[#1c1c1c] border border-white/10 rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.7)] py-2.5 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 pb-1 text-[14px] font-normal text-white tracking-tight">
        Creator
      </div>
      <div className="h-[1px] bg-white/5 mx-2 mb-2" />
      
      <div className="px-3 mb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creators..."
            className="w-full bg-[#141414] border border-white/5 rounded-lg pl-9 pr-3 py-2 text-[13px] text-white focus:outline-none focus:border-white/10 placeholder-zinc-600"
          />
        </div>
      </div>

      <div className="px-2 space-y-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-[14px] font-medium transition-all duration-200 text-white hover:bg-[#2596be]"
          >
            <span className="truncate">{item.label}</span>
            {value === item.id && <Check size={16} strokeWidth={3} className="ml-2 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
};

const ProjectMenu: React.FC<{ onClose: () => void; onDelete?: () => void }> = ({ onClose, onDelete }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<'top' | 'bottom'>('bottom');

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 20) setPosition('top');
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const menuItems: { label: string; icon: any; variant?: string; onClick?: () => void }[] = [
    { label: 'Select', icon: SquareDashed },
    { label: 'Move to folder', icon: Folder },
    { label: 'Remix', icon: RotateCcw },
    { label: 'Rename', icon: Pencil },
    { label: 'Settings', icon: Settings },
    { label: 'Delete', icon: Trash2, variant: 'danger', onClick: onDelete },
  ];

  return (
    <div
      ref={menuRef}
      onMouseDown={(e) => e.stopPropagation()}
      className={`absolute right-0 w-fit min-w-[150px] bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl py-1.5 z-[100]
        ${position === 'bottom' ? 'top-[50px]' : 'bottom-[50px]'}`}
    >
      {menuItems.map((item, idx) => (
        <button
          key={idx}
          onClick={() => {
            if (item.onClick) item.onClick();
            onClose();
          }}
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium hover:bg-white/5 first:rounded-t-xl last:rounded-b-xl whitespace-nowrap
            ${item.variant === 'danger' ? 'text-[#ef4444]' : 'text-white/90'}`}
        >
          <item.icon size={15} strokeWidth={2.2} className="shrink-0" />
          {item.label}
        </button>
      ))}
    </div>
  );
};

const FilterButton: React.FC<{ 
  label: string; 
  children?: React.ReactNode;
}> = ({ label, children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative z-20 flex-shrink-0">
      <button 
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`flex items-center justify-between gap-3 px-4 h-[40px] max-w-[160px] rounded-2xl border transition-all shadow-sm group select-none flex-shrink-0
          ${isOpen 
            ? 'border-white/20 bg-white/10 text-white' 
            : 'border-white/10 bg-[#1c1c1c] hover:bg-white/[0.04] text-white'}`}
      >
        <span className="text-[13px] font-medium truncate pointer-events-none">{label}</span>
        <ChevronDown size={14} className={`text-zinc-400 group-hover:text-white transition-all duration-200 pointer-events-none shrink-0 ${isOpen ? 'rotate-180 text-white' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute top-[calc(100%+8px)] left-0 z-[1000] animate-in fade-in zoom-in-95 duration-150">
          {children}
        </div>
      )}
    </div>
  );
};

export const ProjectsPage: React.FC<{ view?: ViewType; onOpenDriveSettings?: () => void }> = ({ view = 'projects', onOpenDriveSettings }) => {
  const { background } = useBackground();
  const { isDriveConnected } = useAuth();
  const { deleteLocalFSProject, isLocalFolderConnected } = useLocalFS();
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid');
  const [projectsData, setProjectsData] = useState<ProjectCardProps[]>([]);
  const [starredProjects, setStarredProjects] = useState<Set<string>>(new Set());

  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const coverLoadSequence = useRef(0);
  const navigate = useNavigate();

  // Permanently delete a project across all storage layers (IndexedDB media +
  // cover, disk folder, and the localStorage registry).
  const handleDeleteProject = async (id: string, title: string) => {
    const ok = window.confirm(`Delete "${title}"? This permanently removes it from this device.`);
    if (!ok) return;
    try {
      const diskDeleted = await deleteLocalFSProject(id, title);
      if (!diskDeleted) throw new Error('The project folder could not be deleted. Nothing was removed from browser storage.');
      await deleteProjectData(id);
      // Code-editor sessions are keyed by project NAME — remove them too so a
      // "permanent" delete doesn't leave orphaned session data in IndexedDB.
      void deleteCodeSessions(`willow_chat_sessions_${title}`);
      const list = readProjectRegistry() as any[];
      const updated = list.filter((p: any) => p.id !== id);
      writeProjectRegistry(updated);
      window.dispatchEvent(new Event('willow_projects_updated'));
      setProjectsData(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  const formatProjectDate = (date: Date): string => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');
    // "10.15", not "10:15" — the name becomes the project's disk folder name,
    // and ':' is a reserved character on Windows: getDirectoryHandle threw
    // "Name is not allowed" on every save, so default-named projects silently
    // never appeared in the connected folder until manually renamed.
    return `${month} ${day}, ${hoursStr}.${minutes} ${ampm}`;
  };

  const handleCreateNewProject = () => {
    const dateName = formatProjectDate(new Date());

    const existingProjects = readProjectRegistry() as any[];

    // Mint an id no existing project already uses — the temp id's "#XXXX"
    // suffix becomes the real project id on materialization, and a duplicate
    // id cross-links two projects' covers/media in IndexedDB.
    const usedIds = new Set(existingProjects.map((p: any) => p?.id).filter(Boolean));
    let mintedId = `#${Math.floor(1000 + Math.random() * 9000)}`;
    while (usedIds.has(mintedId)) {
      mintedId = `#${Math.floor(1000 + Math.random() * 9000)}`;
    }
    const tempId = `temp_${mintedId}`;

    let uniqueName = dateName;
    let counter = 1;
    while (existingProjects.some(p => p.name.toLowerCase() === uniqueName.toLowerCase())) {
      uniqueName = `${dateName} (${counter})`;
      counter++;
    }
    
    sessionStorage.setItem('staging-nav', 'true');
    navigate(`/media?projectId=${encodeURIComponent(tempId)}&tempName=${encodeURIComponent(uniqueName)}`);
  };

  const handleOpenProject = (project: ProjectCardProps) => {
    sessionStorage.setItem('staging-nav', 'true');
    if (project.kind === 'code') {
      navigate(`/project1?projectId=${encodeURIComponent(project.id)}`);
    } else {
      navigate(`/media?projectId=${encodeURIComponent(project.id)}`);
    }
  };

  useEffect(() => {
    const loadProjects = () => {
      try {
          const list = readProjectRegistry() as any[];
          
          const sequence = ++coverLoadSequence.current;
          loadAllProjectCovers().then(covers => {
            if (sequence !== coverLoadSequence.current) return;
            setCoverUrls(covers);
            // Registry array order is CREATION order (new projects are
            // appended) — reverse for display so newest comes first, matching
            // the Media grid and the Code tab's My Apps panel. Display-only;
            // the registry is never written back reordered (invariant #1).
            const mapped: ProjectCardProps[] = list.slice().reverse().map((p: any) => ({
              id: p.id,
              title: p.name,
              edited: 'Edited recently',
              createdAt: 'Recently',
              creator: 'redacted@example.com',
              thumbnail: covers[p.id] || p.coverUrl || '',
              hasChat: true,
              isStarred: p.isStarred,
              kind: p.kind === 'code' ? 'code' : 'media',
            }));
            setProjectsData(mapped);
            setStarredProjects(new Set(mapped.filter((p: any) => p.isStarred).map((p: any) => p.id)));
          });
      } catch (e) {}
    };
    loadProjects();
    window.addEventListener('willow_projects_updated', loadProjects);
    window.addEventListener(PROJECT_COVERS_UPDATED_EVENT, loadProjects);
    return () => {
      window.removeEventListener('willow_projects_updated', loadProjects);
      window.removeEventListener(PROJECT_COVERS_UPDATED_EVENT, loadProjects);
    };
  }, []);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [animatingStar, setAnimatingStar] = useState<string | null>(null);

  // Filter States
  const [sortBy, setSortBy] = useState('last-edited');
  const [order, setOrder] = useState('newest'); // Changed default to newest as it's more common
  const [visibility, setVisibility] = useState('any');
  const [status, setStatus] = useState('any');
  const [creator, setCreator] = useState('all');

  const getSortLabel = () => {
    const items = [
      { id: 'last-edited', label: 'Last edited' },
      { id: 'date-created', label: 'Date created' },
      { id: 'alphabetical', label: 'Alphabetical' },
    ];
    return items.find(i => i.id === sortBy)?.label || 'Last edited';
  };

  const getVisibilityLabel = () => {
    const items = [
      { id: 'any', label: 'Any visibility' },
      { id: 'public', label: 'Public' },
      { id: 'workspace', label: 'Workspace' },
    ];
    return items.find(i => i.id === visibility)?.label || 'Any visibility';
  };

  const getStatusLabel = () => {
    const items = [
      { id: 'any', label: 'Any status' },
      { id: 'all-published', label: 'All published' },
      { id: 'internally-published', label: 'Internally published' },
      { id: 'externally-published', label: 'Externally published' },
      { id: 'not-published', label: 'Not published' },
    ];
    return items.find(i => i.id === status)?.label || 'Any status';
  };

  const getCreatorLabel = () => {
    const items = [
      { id: 'all', label: 'All creators' },
      { id: 'redacted@example.com', label: 'redacted@example.com (You)' },
    ];
    const found = items.find(i => i.id === creator);
    return found?.label || 'All creators';
  };

  const displayedProjects = view === 'starred' 
    ? projectsData.filter(p => starredProjects.has(p.id))
    : view === 'shared'
      ? projectsData.filter(p => p.isShared)
      : projectsData;

  const toggleStar = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newStarred = new Set(starredProjects);
    if (newStarred.has(id)) {
      newStarred.delete(id);
    } else {
      newStarred.add(id);
      setAnimatingStar(id);
      setTimeout(() => setAnimatingStar(null), 300);
    }
    setStarredProjects(newStarred);

    // Persist the starred flag into the project registry so it survives reloads
    // and stays in sync across surfaces (e.g. the BottomPanel).
    try {
      const list = readProjectRegistry() as any[];
      const updated = list.map((p: any) => (p.id === id ? { ...p, isStarred: newStarred.has(id) } : p));
      writeProjectRegistry(updated);
      window.dispatchEvent(new Event('willow_projects_updated'));
    } catch {}
  };

  const toggleMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === id ? null : id);
  };

  return (
    <div className={`flex-1 w-full h-full ${background === 'solid' ? 'bg-[#212121]' : 'bg-[#1c1c1c]'} flex flex-col relative`}>
       <style>{`
        @keyframes subtle-star-jump {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        .star-jump-icon {
          animation: subtle-star-jump 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
      `}</style>

      {/* Drive Not Connected Overlay */}
      {(!isDriveConnected && !isLocalFolderConnected) && (
        <div className="absolute inset-0 z-30 overflow-hidden">
          <div className="absolute inset-0 backdrop-blur-md bg-[#1c1c1c]/90" />
          <div className="relative z-10 h-full flex flex-col items-center justify-center gap-6">
            <div className="w-20 h-20 rounded-2xl bg-[#272729] flex items-center justify-center border border-white/10 shadow-xl">
              <HardDrive size={36} className="text-white/70" />
            </div>
            <div className="text-center">
              <h3 className="text-[22px] font-bold text-white mb-2">Connect Google Drive to have Projects</h3>
              <p className="text-[15px] text-zinc-400 max-w-lg">Save and access your projects from anywhere by connecting your Google Drive.</p>
            </div>
            <button 
              onClick={onOpenDriveSettings}
              className="px-8 py-3.5 bg-white text-black text-[15px] font-bold rounded-xl hover:bg-zinc-200 transition-all shadow-lg shadow-white/10 flex items-center gap-2.5"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Connect Google Drive
            </button>
          </div>
        </div>
      )}

       <div className="flex-1 w-full max-w-[1600px] mx-auto px-16 pt-12 overflow-y-auto scroll-smooth">
          
          <div className="flex flex-col gap-10 mb-12">
              <div className="flex items-center gap-3">
                <h1 className="text-[28px] font-bold text-white tracking-tight">
                  {view === 'starred' ? 'Starred' : view === 'shared' ? 'Shared' : 'Projects'}
                </h1>
                {view === 'projects' && (
                  <button className="text-zinc-500 hover:text-white transition-colors p-1 translate-y-0.5">
                    <MoreHorizontal size={22} />
                  </button>
                )}
              </div>

              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 overflow-visible">
                <div className="relative group w-full lg:w-[380px]">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-white transition-colors" size={18} />
                  <input 
                    type="text" 
                    placeholder="Search projects..." 
                    className="w-full h-[46px] bg-[#1a1a1a] border border-white/5 rounded-2xl pl-12 pr-4 text-[15px] text-white placeholder-zinc-500 outline-none focus:border-white/10 focus:bg-white/[0.02] transition-all font-normal shadow-lg"
                  />
                </div>

                <div className="flex items-center gap-3 w-full lg:w-auto">
                    <FilterButton label={getSortLabel()}>
                      <SortMenu 
                        sortBy={sortBy} setSortBy={setSortBy}
                        order={order} setOrder={setOrder}
                      />
                    </FilterButton>
                    <FilterButton label={getVisibilityLabel()}>
                      <VisibilityMenu value={visibility} onChange={setVisibility} />
                    </FilterButton>
                    <FilterButton label={getStatusLabel()}>
                      <StatusMenu value={status} onChange={setStatus} />
                    </FilterButton>
                    <FilterButton label={getCreatorLabel()}>
                      <CreatorMenu value={creator} onChange={setCreator} />
                    </FilterButton>
                    
                    <div className="w-[1px] h-7 bg-white/10 mx-2 shrink-0" />
                    
                    <div className="flex items-center bg-[#1a1a1a] rounded-2xl p-1 border border-white/5 shrink-0 h-[46px] shadow-lg">
                      <button 
                        onClick={() => setLayoutMode('grid')}
                        className={`h-full px-4 rounded-xl transition-all ${layoutMode === 'grid' ? 'bg-white/10 text-white shadow-inner' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                      >
                        <LayoutGrid size={18} />
                      </button>
                      <button 
                        onClick={() => setLayoutMode('list')}
                        className={`h-full px-4 rounded-xl transition-all ${layoutMode === 'list' ? 'bg-white/10 text-white shadow-inner' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                      >
                        <List size={18} />
                      </button>
                    </div>
                </div>
              </div>
          </div>

          {layoutMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-14 pb-24">
              <div className="group cursor-pointer" onClick={handleCreateNewProject}>
                <button className="w-full aspect-[16/9] rounded-xl border-2 border-dashed border-white/10 hover:border-white/20 hover:bg-white/[0.02] transition-all flex flex-col items-center justify-center gap-3 cursor-pointer">
                  <div className="w-12 h-12 flex items-center justify-center text-zinc-600 group-hover:text-white group-hover:scale-110 transition-all duration-300">
                    <Plus size={36} strokeWidth={1.5} />
                  </div>
                </button>
                <div className="mt-5 px-1">
                  <h3 className="text-[16px] font-bold text-white leading-tight tracking-tight">Create new project</h3>
                </div>
              </div>

              {displayedProjects.map((project, index) => {
                const isStarred = starredProjects.has(project.id);
                const isAnimating = animatingStar === project.id;
                const isMenuOpen = openMenuId === project.id;

                return (
                  <div key={project.id} className="group cursor-pointer" onClick={() => handleOpenProject(project)}>
                      <div className="relative aspect-[16/9] bg-[#2c2c2e] rounded-xl overflow-hidden border border-white/5 mb-4 transition-all group-hover:shadow-xl">
                          {project.thumbnail ? (
                            isCoverVideo(project.thumbnail) ? (
                              <video 
                                src={project.thumbnail} 
                                className="w-full h-full object-cover opacity-90" 
                                autoPlay 
                                loop 
                                muted 
                                playsInline 
                              />
                            ) : (
                              <img 
                                src={project.thumbnail} 
                                className="w-full h-full object-cover opacity-90" 
                                alt={project.title} 
                              />
                            )
                          ) : (
                            <div className="w-full h-full bg-[#2c2c2e]" />
                          )}
                          
                          <div className="absolute top-3 right-3">
                            <button 
                              onClick={(e) => toggleStar(e, project.id)}
                              className={`w-10 h-10 flex items-center justify-center backdrop-blur-xl rounded-xl border active:scale-95 transition-all
                                ${isStarred 
                                  ? 'opacity-100 bg-black/60 border-white/10 text-yellow-400 shadow-lg shadow-yellow-500/10' 
                                  : 'opacity-0 group-hover:opacity-100 bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'}`}
                            >
                              <div className={isAnimating ? 'star-jump-icon' : ''}>
                                <Star size={18} fill={isStarred ? "currentColor" : "none"} strokeWidth={isStarred ? 0 : 2} />
                              </div>
                            </button>
                          </div>

                          {project.hasChat && (
                            <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-xl px-2.5 py-1.5 rounded-lg border border-white/10 flex items-center gap-1.5 shadow-xl">
                               <span className="text-[10px] font-bold text-white/90 uppercase tracking-widest">Chat</span>
                            </div>
                          )}
                      </div>
                      
                      <div className="flex items-center justify-between px-1 relative">
                          <div className="flex items-center gap-3">
                              <img 
                                src={`https://picsum.photos/32/32?random=${index + 10}`} 
                                className="w-8 h-8 rounded-full border border-white/10 shrink-0"
                                alt="Project Owner"
                              />
                              <div className="flex flex-col min-w-0">
                                  <p className="text-[14px] font-bold text-white leading-tight truncate tracking-tight">
                                    {project.title}
                                  </p>
                                  <p className="text-[12px] font-medium text-[#52525b] mt-0.5">
                                    {project.edited}
                                  </p>
                              </div>
                          </div>

                          <div className="relative">
                            <button 
                              onClick={(e) => toggleMenu(e, project.id)}
                              className={`p-2 rounded-xl transition-all
                                ${isMenuOpen 
                                  ? 'opacity-100 text-white bg-transparent' 
                                  : 'opacity-0 group-hover:opacity-100 text-[#52525b] hover:text-white hover:bg-white/5'}`}
                            >
                              <MoreHorizontal size={20} />
                            </button>
                            
                            {isMenuOpen && (
                              <ProjectMenu onClose={() => setOpenMenuId(null)} onDelete={() => handleDeleteProject(project.id, project.title)} />
                            )}
                          </div>
                      </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col pb-32">
              <div className="grid grid-cols-[1.8fr_1fr_1fr_140px] gap-6 px-8 py-5 border-b border-white/5">
                <div className="text-[13px] font-bold text-zinc-600 uppercase tracking-widest">Name</div>
                <div className="text-[13px] font-bold text-zinc-600 uppercase tracking-widest">Created at</div>
                <div className="text-[13px] font-bold text-zinc-600 uppercase tracking-widest">Created by</div>
                <div className="w-[140px]"></div>
              </div>

              <div className="flex flex-col">
                {displayedProjects.map((project, index) => {
                  const isStarred = starredProjects.has(project.id);
                  const isAnimating = animatingStar === project.id;
                  const isMenuOpen = openMenuId === project.id;

                  return (
                    <div 
                      key={project.id} 
                      className="grid grid-cols-[1.8fr_1fr_1fr_140px] gap-6 px-8 py-6 border-b border-white/5 items-center group/row hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => handleOpenProject(project)}
                    >
                      <div className="flex items-center gap-6 min-w-0">
                        <div className="relative w-[130px] aspect-[16/9] rounded-xl overflow-hidden border border-white/5 bg-[#2c2c2e] shrink-0 shadow-lg">
                           {project.thumbnail ? (
                             isCoverVideo(project.thumbnail) ? (
                               <video 
                                 src={project.thumbnail} 
                                 className="w-full h-full object-cover opacity-90 group-hover/row:opacity-100 transition-opacity" 
                                 autoPlay 
                                 loop 
                                 muted 
                                 playsInline 
                               />
                             ) : (
                               <img src={project.thumbnail} className="w-full h-full object-cover opacity-90 group-hover/row:opacity-100 transition-opacity" alt="" />
                             )
                           ) : (
                             <div className="w-full h-full bg-[#2c2c2e]" />
                           )}
                           {project.hasChat && (
                            <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-xl px-2 py-1 rounded border border-white/10 flex items-center shadow-xl">
                               <span className="text-[9px] font-bold text-white/90 uppercase tracking-widest">Chat</span>
                            </div>
                           )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[14px] font-bold text-white truncate group-hover/row:text-white transition-colors tracking-tight">
                            {project.title}
                          </span>
                          <span className="text-[12px] font-medium text-[#52525b] mt-0.5">
                            {project.edited}
                          </span>
                        </div>
                      </div>

                      <div className="text-[14px] font-medium text-[#71717a]">
                        {project.createdAt}
                      </div>

                      <div className="flex items-center gap-4">
                         <img 
                          src={`https://picsum.photos/32/32?random=${index + 50}`} 
                          className="w-8 h-8 rounded-full border border-white/10 shrink-0 shadow-md"
                          alt=""
                        />
                        <span className="text-[14px] font-medium text-[#71717a] truncate">
                          {project.creator}
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-3 pr-2">
                        <button 
                          onClick={(e) => toggleStar(e, project.id)}
                          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all active:scale-90
                            ${isStarred 
                              ? 'text-yellow-400 opacity-100 bg-white/5 shadow-inner' 
                              : 'text-zinc-600 opacity-0 group-hover/row:opacity-100 hover:text-white hover:bg-white/5'}`}
                        >
                          <div className={isAnimating ? 'star-jump-icon' : ''}>
                            <Star size={20} fill={isStarred ? "currentColor" : "none"} strokeWidth={isStarred ? 0 : 2} />
                          </div>
                        </button>

                        <div className="relative">
                          <button 
                            onClick={(e) => toggleMenu(e, project.id)}
                            className={`p-2.5 rounded-xl transition-all
                              ${isMenuOpen 
                                ? 'opacity-100 text-white bg-white/10' 
                                : 'opacity-0 group-hover/row:opacity-100 text-zinc-600 hover:text-white hover:bg-white/5'}`}
                          >
                            <MoreHorizontal size={22} />
                          </button>
                          
                          {isMenuOpen && (
                            <ProjectMenu onClose={() => setOpenMenuId(null)} onDelete={() => handleDeleteProject(project.id, project.title)} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
       </div>
    </div>
  );
};
