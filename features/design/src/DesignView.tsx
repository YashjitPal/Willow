import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { ArrowLeft, ChevronDown, CirclePlay, Download, Menu, MoreHorizontal, Rocket, Share2 } from 'lucide-react';
import { experimentsStore } from '@willow/core/experiments-store';
import { StitchAurora } from './StitchAurora';
import { StitchDotGrid } from './StitchDotGrid';
import { DesignLogo } from './DesignLogo';
import { InputBar } from './composer/Composer';
import { DesignProjectsDrawer, PANEL_ENTER_CSS, PANEL_EXIT_CSS } from './DesignProjectsDrawer';
import { DesignCanvas } from './DesignCanvas';
import { DesignChat, DesignChatHandle } from './DesignChat';
import { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';

export interface DesignViewProps {
  modelConfig?: any;
  selectedModelId?: string;
  setSelectedModelId?: (id: string) => void;
  onAuthRequired?: () => void;
  isAuthenticated?: boolean;
  onWorkspaceActive?: (active: boolean) => void;
}

export const DesignView: React.FC<DesignViewProps> = ({
  modelConfig,
  selectedModelId: externalSelectedModelId,
  setSelectedModelId: externalSetSelectedModelId,
  onAuthRequired,
  isAuthenticated,
  onWorkspaceActive,
}) => {
  const experiments = useStore(experimentsStore);
  const isDarker = experiments['darker-design-background'];

  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [canvasPrompt, setCanvasPrompt] = useState<string | undefined>();
  const [activeProjectName, setActiveProjectName] = useState('Untitled Design');
  const designChatRef = useRef<DesignChatHandle | null>(null);
  const { saveLocalFSDesignProject } = useLocalFS();
  const [internalModelId, setInternalModelId] = useState('gemini-2.5-flash');
  const selectedModelId = externalSelectedModelId || internalModelId;
  const setSelectedModelId = externalSetSelectedModelId || setInternalModelId;

  // The extracted Stitch editor is a true full-screen surface. Ask the host
  // shell to slide its navigation rail away while the workspace is active;
  // this is scoped to Design and leaves the Code tab untouched.
  useEffect(() => {
    onWorkspaceActive?.(isCanvasOpen);
    return () => onWorkspaceActive?.(false);
  }, [isCanvasOpen, onWorkspaceActive]);

  const createDesignProject = useCallback(() => {
    const list = readProjectRegistry();
    const usedIds = new Set(list.map((project) => project.id));
    let id = `design_${Date.now()}`;
    while (usedIds.has(id)) id = `design_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const base = 'Untitled Design';
    let name = base;
    let suffix = 2;
    while (list.some((project) => project.name.toLowerCase() === name.toLowerCase())) name = `${base} ${suffix++}`;
    writeProjectRegistry([...list, { id, name, kind: 'design' }]);
    window.dispatchEvent(new Event('willow_projects_updated'));
    void saveLocalFSDesignProject(name, []);
    return name;
  }, [saveLocalFSDesignProject]);

  const openDesignProject = useCallback((projectName: string, prompt?: string) => {
    setActiveProjectName(projectName);
    setCanvasPrompt(prompt?.trim() || undefined);
    setIsProjectsOpen(false);
    setIsCanvasOpen(true);
  }, []);

  const handleCreateProject = useCallback(() => {
    openDesignProject(createDesignProject());
  }, [createDesignProject, openDesignProject]);

  const handleSubmit = useCallback((prompt: string) => {
    if (!prompt.trim()) return;
    if (!isCanvasOpen) {
      openDesignProject(createDesignProject(), prompt);
    }
  }, [createDesignProject, isCanvasOpen, openDesignProject]);

  // Keep this hook before the workspace branch so toggling the full-screen
  // editor never changes DesignView's hook order.
  const hero = useMemo(
    () => (
      <main className="relative z-10 flex h-full w-full flex-col items-center justify-center px-6 pt-16 pb-8">
        <div className="mb-8 flex max-w-[660px] flex-col items-center gap-3 px-4 text-center">
          <h1
            style={{
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
            }}
            className="text-4xl font-medium tracking-tight text-white md:text-[56px] md:leading-[64px]"
          >
            Design at the speed of AI
          </h1>
          <p
            style={{
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
            }}
            className="max-w-[620px] text-base font-normal text-[#9aa0a6] md:text-[18px] md:leading-8"
          >
            Transform ideas into UI designs for mobile and web applications
          </p>
        </div>

        <div className="w-full max-w-[660px]">
          <InputBar
            chatVariant
            currentMode="design"
            placeholder="What native mobile app shall we design?"
            onSubmit={handleSubmit}
            modelConfig={modelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            onAuthRequired={onAuthRequired}
            isAuthenticated={isAuthenticated}
          />
        </div>
      </main>
    ),
    [handleSubmit, isAuthenticated, modelConfig, onAuthRequired, selectedModelId, setSelectedModelId]
  );

  if (isCanvasOpen) {
    return (
      <div className="fixed inset-0 z-[180] flex h-screen w-screen flex-col overflow-hidden bg-[#171717] text-[#e3e3e3]">
        {/* Stitch's editor toolbar floats over the canvas; the canvas texture
            continues uninterrupted beneath it with no header strip. */}
        <header className="absolute inset-x-0 top-0 z-40 flex h-[80px] items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => { setIsCanvasOpen(false); setCanvasPrompt(undefined); }}
              aria-label="Back to design home"
              title="Back to design home"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#c4c7c5] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <ArrowLeft size={20} />
            </button>
            <button
              type="button"
              onClick={() => setIsProjectsOpen(true)}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
              title="Open projects"
            >
              <Menu size={20} className="shrink-0 text-[#c4c7c5]" />
              <span className="truncate text-[16px] font-medium text-[#e3e3e3]">{activeProjectName}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Preview project" title="Preview project" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.14] text-[#e3e3e3] transition-colors hover:bg-white/[0.08]"><CirclePlay size={18} /></button>
            <button type="button" aria-label="Export project" title="Export project" className="hidden h-10 items-center gap-2 rounded-full border border-white/[0.14] px-4 text-sm font-medium text-[#e3e3e3] transition-colors hover:bg-white/[0.08] sm:flex"><Download size={17} />Export</button>
            <button type="button" aria-label="Share project" title="Share project" className="hidden h-10 items-center gap-2 rounded-full border border-white/[0.14] px-4 text-sm font-medium text-[#e3e3e3] transition-colors hover:bg-white/[0.08] md:flex"><Share2 size={16} />Share</button>
            <button type="button" aria-label="More project actions" title="More project actions" className="flex h-10 w-10 items-center justify-center rounded-full text-[#c4c7c5] transition-colors hover:bg-white/[0.08]"><MoreHorizontal size={19} /></button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <aside className="absolute inset-x-auto bottom-0 left-0 top-[80px] z-30 flex w-[382px] shrink-0 flex-col gap-3 bg-[#171717] p-4 transition-[opacity,transform] duration-200 max-lg:pointer-events-none max-lg:-translate-x-full max-lg:opacity-0">
            <div className="min-h-0 flex-1 overflow-hidden rounded-[20px] border border-[#36373a] bg-[#1b1b1d]">
              <DesignChat ref={designChatRef} modelConfig={modelConfig} selectedModelId={selectedModelId || null} initialPrompt={canvasPrompt} hideComposer />
            </div>
            <button
              type="button"
              className="flex h-16 shrink-0 items-center justify-between rounded-[18px] border border-[#36373a] bg-[#1b1b1d] px-5 text-[#e3e3e3] transition-colors hover:bg-[#202023]"
            >
              <span className="flex items-center gap-3 text-[15px] font-medium"><Rocket size={17} />Agent Log</span>
              <ChevronDown size={18} className="text-[#c4c7c5]" />
            </button>
          </aside>
          <main className="absolute inset-0 min-w-0 bg-[#0f0f0f]">
            <DesignCanvas />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 sm:pb-7">
              <div className="pointer-events-auto w-full max-w-[730px]">
                <InputBar
                  chatVariant
                  currentMode="design"
                  placeholder="What would you like to change or create?"
                  modelConfig={modelConfig}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  onAuthRequired={onAuthRequired}
                  isAuthenticated={isAuthenticated}
                  onSubmit={(prompt) => designChatRef.current?.submit(prompt)}
                />
              </div>
            </div>
          </main>
        </div>

        <DesignProjectsDrawer
          isOpen={isProjectsOpen}
          onClose={() => setIsProjectsOpen(false)}
          onSelectProject={(projectId, projectName) => {
            openDesignProject(projectName || projectId);
          }}
          onCreateProject={handleCreateProject}
        />
      </div>
    );
  }

  // Hero Section with Headline, Subtitle, and Expanded Prompt Box.
  //
  // Stays centred on the full view at every width: the projects drawer overlays it
  // rather than pushing it, so the hero keeps its alignment with the aurora glow.
  //
  // Memoised on its own inputs so that toggling `isProjectsOpen` cannot rebuild it.
  // Profiled 2026-08-25: opening the drawer used to re-create this whole subtree
  // (~54ms of `jsxDEV` + `createElement`, the composer is ~33KB of JSX) and it
  // produced 3 attribute mutations and zero DOM structure changes for the trouble.
  // That JS landed in exactly the frames the drawer's slide-in needed.
  return (
    <div
      className={`relative h-full w-full overflow-hidden select-none transition-colors duration-300 ${
        isDarker ? 'bg-black' : 'bg-[#0f0f0f]'
      }`}
    >
      <StitchAurora className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-80 mix-blend-screen" />
      <StitchDotGrid className="pointer-events-none absolute inset-0 z-10 h-full w-full" />

      {/* Top Header Bar */}
      <header
        // The pill has to slide left to clear the drawer, since the drawer overlays
        // the view at z-50 and would otherwise cover it. That makes it a second,
        // coupled motion: it is driven by the panel arriving, so it borrows the
        // panel's own curve and duration rather than easing on its own schedule
        // (it used to be a flat 300ms both ways, which read as two separate moves).
        // The padding itself stays a Tailwind class because it is width-conditional.
        style={{ transition: `padding ${isProjectsOpen ? PANEL_ENTER_CSS : PANEL_EXIT_CSS}` }}
        className={`absolute top-0 left-0 right-0 z-30 pointer-events-auto flex items-center justify-between px-8 py-6 ${
          isProjectsOpen ? 'min-[1024px]:pr-[436px]' : ''
        }`}
      >
        <DesignLogo />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsProjectsOpen((prev) => !prev);
          }}
          className={`cursor-pointer pointer-events-auto rounded-full border-none px-6 py-2.5 text-sm font-medium shadow-sm transition-all duration-150 active:scale-[0.98] select-none ${
            isProjectsOpen
              ? 'bg-white/90 text-black ring-2 ring-white/30'
              : 'bg-white text-[#1f1f1f] hover:opacity-[0.88]'
          }`}
          style={{
            fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
          }}
        >
          Projects
        </button>
      </header>

      {/* Hero Section with Headline, Subtitle, and Expanded Prompt Box */}
      {hero}

      {/* Projects Side Drawer */}
      <DesignProjectsDrawer
        isOpen={isProjectsOpen}
        onClose={() => setIsProjectsOpen(false)}
        onSelectProject={(projectId, projectName) => {
          openDesignProject(projectName || projectId);
        }}
        onCreateProject={handleCreateProject}
      />
    </div>
  );
};

export default DesignView;
