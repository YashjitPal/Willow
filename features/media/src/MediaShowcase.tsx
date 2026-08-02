import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
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
import { 
  ArrowRight, 
  Star, 
  MoreHorizontal, 
  SquareDashed, 
  Folder, 
  RotateCcw, 
  Pencil, 
  Settings, 
  Trash2 
} from 'lucide-react';
import { RECENT_PROJECTS } from '@willow/studio/shell/sample-projects';
import { loadAllProjectCovers, deleteProjectData, getMediaIndex, PROJECT_COVERS_UPDATED_EVENT } from '@willow/storage/media-storage';
import { deleteCodeSessions } from '@willow/storage/indexeddb/willow-db';
import { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { transactionalRenameProject } from '@willow/projects/rename';

interface ProjectMenuProps {
  onClose: () => void;
  onDelete?: () => void;
  onRename?: () => void;
}

const ProjectMenu: React.FC<ProjectMenuProps> = ({ onClose, onDelete, onRename }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<'top' | 'bottom'>('bottom');

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom > viewportHeight - 20) {
        setPosition('top');
      } else {
        setPosition('bottom');
      }
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const menuItems: { label: string; icon: any; variant?: string; onClick?: () => void }[] = [
    { label: 'Select', icon: SquareDashed },
    { label: 'Move to folder', icon: Folder },
    { label: 'Remix', icon: RotateCcw },
    { label: 'Rename', icon: Pencil, onClick: onRename },
    { label: 'Settings', icon: Settings },
    { label: 'Delete', icon: Trash2, variant: 'danger', onClick: onDelete },
  ];

  return (
    <div
      ref={menuRef}
      className={`absolute right-0 w-fit min-w-[160px] bg-zinc-900/40 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl p-1 z-50
        ${position === 'bottom' ? 'top-[32px]' : 'bottom-[32px]'}`}
    >
      {menuItems.map((item, idx) => (
        <button
          key={idx}
          onClick={() => {
            if (item.onClick) item.onClick();
            onClose();
          }}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] font-medium rounded-lg hover:bg-white/15 transition-colors whitespace-nowrap
            ${item.variant === 'danger' ? 'text-red-400 hover:text-red-300 hover:bg-red-500/20' : 'text-zinc-100 hover:text-white'}`}
        >
          <item.icon size={14} strokeWidth={2} className="shrink-0" />
          {item.label}
        </button>
      ))}
    </div>
  );
};

import { useBackground } from '@willow/studio/shell/BackgroundContext';
import { useAuth } from '@willow/auth/AuthContext';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { HardDrive } from 'lucide-react';

interface BottomPanelProps {
  onOpenDriveSettings?: () => void;
  mode?: 'media' | 'develop';
  /** Render even when the background is 'solid' (e.g. the Code view paints its own bg). */
  forceVisible?: boolean;
  /** Show every matching project instead of only the top 9. */
  showAll?: boolean;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({ onOpenDriveSettings, mode, forceVisible, showAll }) => {
  const navigate = useNavigate();
  const [starredProjects, setStarredProjects] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [animatingStar, setAnimatingStar] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState('Recents');
  // Inline rename state (menu → Rename turns the card title into an input).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Set when Enter/Escape already resolved the edit, so the input's onBlur
  // (which fires as it unmounts) doesn't commit a second time / after cancel.
  const renameResolvedRef = useRef(false);
  const { background } = useBackground();
  const { isDriveConnected } = useAuth();
  const { deleteLocalFSProject, renameLocalFSProject, isLocalFolderConnected } = useLocalFS();

  const [projectsList, setProjectsList] = useState<{ id: string; name: string; hasCover?: boolean; isStarred?: boolean; coverUrl?: string }[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});

  const openProject = (project: { id: string; name: string; kind?: string }) => {
    sessionStorage.setItem('staging-nav', 'true');
    if (project.kind === 'code') {
      navigate(`/project1?projectId=${encodeURIComponent(project.id)}`);
    } else {
      navigate(`/media?projectId=${encodeURIComponent(project.id)}`);
    }
  };
  const coverLoadSequence = useRef(0);

  const persistProjectRename = React.useCallback(async (projectId: string, rawName: string) => {
    const result = await transactionalRenameProject({
      projectId,
      rawName,
      isLocalFolderConnected,
      renameLocalFSProject,
    });
    if (!result.ok) console.error('Failed to rename project:', result.error);
  }, [isLocalFolderConnected, renameLocalFSProject]);

  const startRename = (project: { id: string; name: string }) => {
    renameResolvedRef.current = false;
    setRenameValue(project.name);
    setRenamingId(project.id);
  };

  const commitRename = (projectId: string, value: string) => {
    setRenamingId(null);
    void persistProjectRename(projectId, value);
  };

  // Permanently delete a project across IndexedDB, disk, and the registry.
  const handleDeleteProject = async (id: string, name: string) => {
    const ok = window.confirm(`Delete "${name}"? This permanently removes it from this device.`);
    if (!ok) return;
    try {
      const diskDeleted = await deleteLocalFSProject(id, name);
      if (!diskDeleted) throw new Error('The project folder could not be deleted. Nothing was removed from browser storage.');
      await deleteProjectData(id);
      // Code-editor sessions are keyed by project NAME — remove them too so a
      // "permanent" delete doesn't leave orphaned session data in IndexedDB.
      void deleteCodeSessions(`willow_chat_sessions_${name}`);
      const list = readProjectRegistry() as any[];
      const updated = list.filter((p: any) => p.id !== id);
      writeProjectRegistry(updated);
      window.dispatchEvent(new Event('willow_projects_updated'));
      setProjectsList(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  useEffect(() => {
    const loadProjects = () => {
      try {
        const list = readProjectRegistry() as any[];
          // Match the showcase to the active mode. The Media tab also includes any
          // project that actually HAS media (per the realtime index), so media you
          // generated into a 'code' project still shows up here.
          let filtered = list;
          if (mode === 'media') {
            const idx = getMediaIndex();
            filtered = list.filter((p: any) => p.kind === 'media' || (idx[p.id]?.count || 0) > 0);
          } else if (mode === 'develop') {
            filtered = list.filter((p: any) => p.kind === 'code');
          }
          // Registry array order is CREATION order (new projects are appended)
          // — reverse for display so the newest project is first, and so the
          // top-9 slice below actually shows the 9 most RECENT (it used to
          // take the 9 oldest). Display-only; the registry itself is never
          // written back reordered (invariant #1). `filtered` is always a
          // fresh array here, so in-place reverse is safe.
          const ordered = filtered.reverse();
          setProjectsList(showAll ? ordered : ordered.slice(0, 9)); // Show newest 9 projects (or all)
          setStarredProjects(new Set(list.filter((p: any) => p.isStarred).map((p: any) => p.id)));

          const sequence = ++coverLoadSequence.current;
          loadAllProjectCovers().then(covers => {
            if (sequence === coverLoadSequence.current) setCoverUrls(covers);
          });
      } catch (e) {}
    };

    loadProjects();
    window.addEventListener('willow_projects_updated', loadProjects);
    window.addEventListener('willow_media_updated', loadProjects);
    window.addEventListener(PROJECT_COVERS_UPDATED_EVENT, loadProjects);
    return () => {
      window.removeEventListener('willow_projects_updated', loadProjects);
      window.removeEventListener('willow_media_updated', loadProjects);
      window.removeEventListener(PROJECT_COVERS_UPDATED_EVENT, loadProjects);
    };
  }, [mode, showAll]);

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

    // Persist the starred flag so it survives reloads and matches ProjectsPage.
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

  if (background === 'solid' && !forceVisible) {
    return null;
  }

  // Match sidebar opacity (90%) for waves, keep original (70%) for others.
  // When forced visible over a solid backdrop (Code view), use an opaque panel.
  const panelBgClass = forceVisible && background === 'solid'
    ? 'bg-[#0d0d0d]'
    : background === 'waves'
    ? 'bg-[#0d0d0d]/90'
    : 'bg-[#0d0d0d]/70';

  return (
    <div className="mx-12 pt-7 pb-8 px-8 mt-auto relative z-20 transition-colors duration-300">
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
      {(!forceVisible && !isDriveConnected && !isLocalFolderConnected) && (
        <div className="absolute inset-0 z-30 rounded-2xl overflow-hidden bg-[#0d0d0d]/80 backdrop-blur-md">
          <div className="relative z-10 h-full flex flex-col items-center justify-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-[#272729] flex items-center justify-center border border-white/10 shadow-xl">
              <HardDrive size={28} className="text-white/70" />
            </div>
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-white mb-2">Connect Google Drive to have Projects</h3>
              <p className="text-[14px] text-zinc-400 max-w-md">Save and access your projects from anywhere by connecting your Google Drive.</p>
            </div>
            <button 
              onClick={onOpenDriveSettings}
              className="px-6 py-3 bg-white text-black text-[14px] font-bold rounded-xl hover:bg-zinc-200 transition-all shadow-lg shadow-white/10 flex items-center gap-2"
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

      {/* "My Apps" Center Aligned */}
      <div className="flex flex-col items-center justify-center gap-1.5 mb-6">
        <h2 
          className="text-[#fbfcfe] text-center select-none font-bold antialiased" 
          style={{ 
            fontFamily: '"Plus Jakarta Sans", "Outfit", "Ginto", "ui-sans-serif", "system-ui", "sans-serif"', 
            fontSize: '34px', 
            lineHeight: '48px', 
            letterSpacing: '-0.035em', 
            fontWeight: 800 
          }}
        >
          My Apps
        </h2>
      </div>
      <div className="h-[1px] bg-white/10 w-full mb-8" />

      {/* Horizontal Tabs / Pills Center Aligned */}
      <div className="flex items-center justify-center gap-5 select-none mb-8">
        {['Recents', 'Starred', 'Published', 'All Apps', 'Archived'].map((filter) => {
          const isActive = selectedFilter === filter;
          return (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`text-[13.5px] font-semibold tracking-normal transition-all duration-200 cursor-pointer h-[32px] flex items-center justify-center rounded-full
                ${isActive 
                  ? 'bg-white/10 text-white px-5' 
                  : 'text-[#81888f] hover:text-white px-2'
                }`}
            >
              {filter}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {projectsList.map((project, index) => {
          const isStarred = starredProjects.has(project.id);
          const isAnimating = animatingStar === project.id;
          const isMenuOpen = openMenuId === project.id;
          const thumbnail = coverUrls[project.id] || project.coverUrl;

          return (
            <div
              key={project.id}
              className="group relative flex bg-[#1f1f1f]/50 border border-white/5 rounded-2xl p-3 transition-all hover:border-white/10 cursor-pointer"
              onClick={() => openProject(project as any)}
            >
                <div className="relative w-[240px] aspect-[16/9] bg-[#2c2c2e] rounded-xl overflow-hidden shrink-0 border border-white/5">
                    {thumbnail ? (
                      isCoverVideo(thumbnail) ? (
                        <video src={thumbnail} className="w-full h-full object-cover opacity-90" autoPlay loop muted playsInline />
                      ) : (
                        <img src={thumbnail} className="w-full h-full object-cover opacity-90" alt={project.name} />
                      )
                    ) : (
                      <div className="w-full h-full bg-[#2c2c2e]" />
                    )}
                    <div className="absolute top-2 right-2">
                      <button 
                        onClick={(e) => toggleStar(e, project.id)}
                        className={`w-8 h-8 flex items-center justify-center backdrop-blur-xl rounded-xl border active:scale-95
                          ${isStarred 
                            ? 'opacity-100 bg-black/60 border-white/10 text-yellow-400 shadow-lg shadow-yellow-500/10' 
                            : 'opacity-0 group-hover:opacity-100 bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'}`}
                      >
                        <div className={isAnimating ? 'star-jump-icon' : ''}>
                          <Star size={14} fill={isStarred ? "currentColor" : "none"} />
                        </div>
                      </button>
                    </div>
                </div>
                
                <div className="flex flex-col flex-1 min-w-0 pl-5 pt-1 pb-0">
                    <div className="flex items-center justify-between gap-4">
                        {renamingId === project.id ? (
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameResolvedRef.current = true;
                                commitRename(project.id, renameValue);
                              }
                              if (e.key === 'Escape') {
                                renameResolvedRef.current = true;
                                setRenamingId(null);
                              }
                            }}
                            onBlur={() => {
                              // Enter/Escape already resolved it — the blur that
                              // fires as the input unmounts must not re-commit.
                              if (renameResolvedRef.current) return;
                              renameResolvedRef.current = true;
                              commitRename(project.id, renameValue);
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 bg-transparent border-b border-white/20 text-white text-[18px] font-bold outline-none"
                          />
                        ) : (
                          <h3 className="text-[18px] font-bold text-white truncate">
                            {project.name}
                          </h3>
                        )}

                        <div className="relative shrink-0">
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => toggleMenu(e, project.id)}
                            className={`p-1.5 rounded-lg transition-opacity
                              ${isMenuOpen
                                ? 'opacity-100 text-white bg-transparent'
                                : 'opacity-0 group-hover:opacity-100 text-[#8e8e93] hover:text-white hover:bg-white/5'}`}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {isMenuOpen && (
                            <ProjectMenu
                              onClose={() => setOpenMenuId(null)}
                              onDelete={() => handleDeleteProject(project.id, project.name)}
                              onRename={() => startRename(project)}
                            />
                          )}
                        </div>
                    </div>

                    <p className="text-[13px] text-[#71717a] line-clamp-2 leading-relaxed max-w-[500px] mt-1">
                      {(project as any).kind === 'code' ? 'A React application built with Willow Code. Automatically saved to your workspace.' : 'A multimedia project with generated assets and content.'}
                    </p>

                    <div className="mt-auto flex items-center justify-end gap-1.5 pt-4">
                        <button className="px-3 py-1 rounded-full text-[11.5px] font-medium bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors">
                            Archive
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openProject(project as any);
                          }}
                          className="px-3 py-1 rounded-full text-[11.5px] font-medium bg-white text-black hover:bg-zinc-200 transition-colors"
                        >
                            Open
                        </button>
                    </div>
                </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
