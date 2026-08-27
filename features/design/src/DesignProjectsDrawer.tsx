import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Folder, Clock, ExternalLink, Plus, Search } from 'lucide-react';
import { readProjectRegistry, ProjectRegistryEntry } from '@willow/projects/registry';
import { loadAllProjectCovers, PROJECT_COVERS_UPDATED_EVENT } from '@willow/storage/media-storage';

// This drawer began as a copy of the chat thinking-steps box, but it is a copy and
// not a shared module: every animation value below is a local literal and nothing
// here is imported by `features/chat`. Tune it freely — it cannot reach
// GeminiThinkingVisualizer or ChatResponseChrome.

// Entry uses the Material 3 "emphasized decelerate" curve and exit the accelerate
// one, so the panel arrives softly and leaves briskly instead of using one
// symmetric easing for both.
const ENTER_TRANSITION = { duration: 0.4, ease: [0.05, 0.7, 0.1, 1] } as const;
const EXIT_TRANSITION = { duration: 0.2, ease: [0.3, 0, 0.8, 0.15] } as const;

// The same two curves as a CSS shorthand, for plain CSS transitions elsewhere in the
// design view that have to move in step with this panel — the header's Projects pill
// slides aside to clear the panel, and it looked sloppy on its own separate easing.
// Derived from the objects above so the framer-motion and CSS halves cannot drift.
// Still local to `features/design`: exported, but only DesignView consumes it.
const asCssTransition = (t: { duration: number; ease: readonly number[] }) =>
  `${t.duration}s cubic-bezier(${t.ease.join(',')})`;
export const PANEL_ENTER_CSS = asCssTransition(ENTER_TRANSITION);
export const PANEL_EXIT_CSS = asCssTransition(EXIT_TRANSITION);

interface DesignProjectsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenProjectsPage?: () => void;
  onSelectProject?: (projectId: string, projectName: string) => void;
  onCreateProject?: () => void;
}

export const DesignProjectsDrawer: React.FC<DesignProjectsDrawerProps> = ({
  isOpen,
  onClose,
  onOpenProjectsPage,
  onSelectProject,
  onCreateProject,
}) => {
  const [projects, setProjects] = useState<ProjectRegistryEntry[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const coverSequenceRef = useRef(0);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const load = useCallback(() => {
    try {
      const rawList = readProjectRegistry() as ProjectRegistryEntry[];
      const reversed = rawList.filter((project) => project.kind === 'design').slice().reverse();
      setProjects(reversed);

      const seq = ++coverSequenceRef.current;
      loadAllProjectCovers().then((loadedCovers) => {
        if (seq !== coverSequenceRef.current) return;
        setCovers(loadedCovers);
      });
    } catch (err) {
      console.error('Failed to load projects in DesignProjectsDrawer', err);
    }
  }, []);

  // Load projects & covers once on mount, then only when something says they changed.
  //
  // Deliberately NOT keyed on `isOpen`, and deliberately with no refresh-on-open.
  // Profiled 2026-08-25: keying it on `isOpen` put a synchronous
  // `readProjectRegistry()` (12.7ms of localStorage + JSON.parse) and an IndexedDB
  // cover cursor (22.9-90ms, followed by a `setCovers` re-render) in the frames the
  // drawer needed to slide in, and moving it to a timer just after the slide-in
  // traded that for a 90ms stall the moment the panel settled. Event coverage is
  // thorough enough not to need either: every registry write path dispatches
  // `willow_projects_updated` (20 call sites), `setProjectStorageScope` dispatches
  // it on scope changes, and cover writes dispatch PROJECT_COVERS_UPDATED_EVENT.
  useEffect(() => {
    load();
    window.addEventListener('willow_projects_updated', load);
    window.addEventListener(PROJECT_COVERS_UPDATED_EVENT, load);
    return () => {
      window.removeEventListener('willow_projects_updated', load);
      window.removeEventListener(PROJECT_COVERS_UPDATED_EVENT, load);
    };
  }, [load]);

  const filteredProjects = projects.filter((p) =>
    (p.name || '').toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop on mobile */}
          <motion.button
            type="button"
            aria-label="Close projects panel"
            className="fixed inset-0 z-40 bg-black/55 min-[1024px]:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Drawer Panel */}
          <motion.aside
            aria-label="Projects"
            // Travel is a percentage of the panel's own width, so the narrow-screen
            // `max-w-[calc(100%_-_32px)]` case parks itself correctly too. 105%
            // clears the 12px `right-3` gap with room to spare, and the design root
            // is `overflow-hidden`, so the panel is genuinely invisible at rest.
            initial={{ x: '105%' }}
            animate={{ x: 0 }}
            exit={{ x: '105%', transition: EXIT_TRANSITION }}
            transition={ENTER_TRANSITION}
            // The panel is opaque and fully offscreen at rest, so it needs no opacity
            // track to hide its arrival — dropping it matters because fading a
            // `backdrop-blur-2xl` layer makes the compositor re-sample the blur every
            // frame. Sliding alone leaves the blur a static texture the GPU can reuse.
            // `willChange` promotes the layer up front rather than mid-gesture.
            style={{ willChange: 'transform' }}
            className="absolute bottom-4 right-3 top-4 z-50 flex w-[400px] max-w-[calc(100%_-_32px)] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1e1f21]/95 backdrop-blur-2xl text-[#e3e3e3] shadow-2xl font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
          >
            {/* Header */}
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] py-3 pl-6 pr-3">
              <div className="flex items-center gap-2">
                <h2
                  className="text-[20px] font-medium text-[#e3e3e3]"
                  style={{ fontVariationSettings: '"ROND" 20, "slnt" 0, "wdth" 94, "wght" 470' }}
                >
                  Projects
                </h2>
                {projects.length > 0 && (
                  <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs font-normal text-[#9aa0a6]">
                    {projects.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {onCreateProject && (
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#9aa0a6] transition-colors hover:bg-white/[0.08] hover:text-[#e3e3e3]"
                    title="Start a Design project"
                  >
                    <Plus size={14} />
                    <span>Start Project</span>
                  </button>
                )}
                {onOpenProjectsPage && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenProjectsPage();
                    }}
                    className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#9aa0a6] transition-colors hover:bg-white/[0.08] hover:text-[#e3e3e3]"
                    title="View all in Projects page"
                  >
                    <span>View All</span>
                    <ExternalLink size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#c4c7c5] transition-colors hover:bg-white/[0.08] hover:text-[#e3e3e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                  aria-label="Close sidebar"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            {/* Search Bar */}
            {projects.length > 3 && (
              <div className="px-4 pt-3 pb-1 shrink-0">
                <div className="relative flex items-center">
                  <Search size={14} className="absolute left-3 text-[#9aa0a6] pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search projects..."
                    className="w-full rounded-xl bg-white/[0.05] border border-white/[0.08] pl-9 pr-3 py-1.5 text-xs text-[#e3e3e3] placeholder-[#9aa0a6] focus:border-white/20 focus:bg-white/[0.08] focus:outline-none transition-all"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 text-[#9aa0a6] hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Projects List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]">
              {filteredProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-[#9aa0a6]">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-[#9aa0a6] border border-white/[0.06]">
                    <Folder size={22} />
                  </div>
                  <p className="text-sm font-medium text-[#c4c7c5]">
                    {searchQuery ? 'No matching projects' : 'No projects yet'}
                  </p>
                  <p className="mt-1 text-xs text-[#9aa0a6] max-w-[200px]">
                    {searchQuery
                      ? 'Try searching with a different keyword'
                      : 'Your created projects and saved designs will appear here.'}
                  </p>
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const coverUrl = covers[project.id];
                  const editedDate = project.updatedAt || project.createdAt;
                  const formattedDate = editedDate
                    ? new Date(editedDate as string | number).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : null;

                  return (
                    <div
                      key={project.id}
                      onClick={() => {
                        onSelectProject?.(project.id, project.name);
                      }}
                      className="group flex items-center gap-3.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-all duration-150 hover:border-white/[0.14] hover:bg-white/[0.07] cursor-pointer"
                    >
                      {/* Thumbnail Cover */}
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.04] border border-white/[0.06]">
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt={project.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Folder size={18} className="text-[#9aa0a6] group-hover:text-[#e3e3e3] transition-colors" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium text-[#e3e3e3] group-hover:text-white transition-colors">
                          {project.name}
                        </h3>
                        {formattedDate && (
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#9aa0a6]">
                            <Clock size={11} />
                            <span>{formattedDate}</span>
                          </div>
                        )}
                      </div>

                      <ExternalLink
                        size={14}
                        className="text-[#9aa0a6] opacity-0 group-hover:opacity-100 transition-opacity pr-1"
                      />
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

export default DesignProjectsDrawer;
