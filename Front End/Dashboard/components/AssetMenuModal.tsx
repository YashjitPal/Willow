import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  ChevronDown, Search, LayoutGrid, Image as ImageIcon, Video, Mic,
  User, Smile, FolderUp, Upload, Palette, Eraser, Trash2
} from 'lucide-react';
import { useBackground } from '../context/BackgroundContext';

interface AssetMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  buttonRef: React.RefObject<any>;
  onAddPrompt?: (assetId: string, assetUrl?: string, assetTitle?: string, assetKind?: 'image' | 'video') => void;
  onFileSelect?: () => void;
  projectName?: string;
  mediaItems?: Array<{
    id: string;
    kind: 'image' | 'video';
    status: string;
    url?: string;
    prompt: string;
  }>;
  openedFrom?: 'main' | 'sidebar' | 'instruction-reference';
}

type Asset = { id: string; title: string; type: string; url: string };

const SIDEBAR_ITEMS = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'videos', label: 'Videos', icon: Video },
  { id: 'voices', label: 'Voices', icon: Mic },
  { id: 'characters', label: 'Characters', icon: User },
  { id: 'avatar', label: 'Avatar', icon: Smile },
  { id: 'uploads', label: 'Uploads', icon: FolderUp },
];

const SORT_OPTIONS = ['Recent', 'Most Used', 'Newest', 'Oldest', 'Favorites'];

export const AssetMenuModal: React.FC<AssetMenuModalProps> = ({
  isOpen,
  onClose,
  buttonRef,
  onAddPrompt,
  onFileSelect,
  projectName = 'May 25, 05:55 AM',
  mediaItems,
  openedFrom = 'main',
}) => {
  const [sketches, setSketches] = useState<Asset[]>([]);

  const assetsList = React.useMemo<Asset[]>(() => {
    const fromMedia: Asset[] = (mediaItems || [])
      .filter(item => item.status === 'completed' && !!item.url)
      .map(item => ({
        id: item.id,
        title: (item.prompt && item.prompt.trim()) || 'Untitled',
        type: item.kind === 'video' ? 'Video' : 'Image',
        url: item.url as string,
      }));
    return [...sketches, ...fromMedia];
  }, [mediaItems, sketches]);

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  useEffect(() => {
    if (!selectedAsset && assetsList.length > 0) {
      setSelectedAsset(assetsList[0]);
    } else if (selectedAsset && !assetsList.find(a => a.id === selectedAsset.id)) {
      setSelectedAsset(assetsList[0] || null);
    }
  }, [assetsList, selectedAsset]);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('Recent');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  
  const [currentProject, setCurrentProject] = useState(projectName);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  
  const [isSketchMode, setIsSketchMode] = useState(false);

  useEffect(() => {
    setCurrentProject(projectName);
  }, [projectName]);

  useEffect(() => {
    if (!isOpen) {
      setIsSketchMode(false);
    }
  }, [isOpen]);

  const handleSaveSketch = (dataUrl: string) => {
    const newId = `sketch-${Date.now()}`;
    const newAsset: Asset = {
      id: newId,
      title: `Sketch ${sketches.length + 1}`,
      type: 'Image',
      url: dataUrl
    };

    setSketches(prev => [newAsset, ...prev]);
    setSelectedAsset(newAsset);
    setIsSketchMode(false);

    if (onAddPrompt) onAddPrompt(newId, dataUrl, newAsset.title);
    onClose();
  };
  
  const [side, setSide] = useState<'bottom' | 'top'>('bottom');
  const [maxHeight, setMaxHeight] = useState<number>(600);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sidebarPromptPos, setSidebarPromptPos] = useState({ bottom: 0, right: 0 });

  // Mount/show state machine — drives a pure-CSS transition (smoother than
  // framer-motion for elements with backdrop-filter, because the browser can
  // cache the blurred bitmap on a GPU layer and just transform it).
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isShown, setIsShown] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      // Give the DOM one frame to mount in the "hidden" state, then flip to
      // "shown" so the CSS transition has something to animate from.
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsShown(true));
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setIsShown(false);
      // Match the transition duration (0.22s) before unmounting.
      const timer = setTimeout(() => setIsMounted(false), 230);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const { background } = useBackground();
  
  useLayoutEffect(() => {
    if (!isOpen) return;

    // Instruction-reference: screen-centered, simple height cap
    if (openedFrom === 'instruction-reference') {
      const recomputeCentered = () => {
        setMaxHeight(Math.min(600, window.innerHeight - 80));
      };
      recomputeCentered();
      window.addEventListener('resize', recomputeCentered);
      return () => window.removeEventListener('resize', recomputeCentered);
    }

    // Sidebar prompt-box: anchor above the sidebar prompt, right-aligned
    if (openedFrom === 'sidebar') {
      const recomputeSidebar = () => {
        const btn = buttonRef.current;
        if (!btn) return;
        const promptBox = btn.closest('[class*="rounded-[24px]"]') as HTMLElement | null;
        const anchorRect = (promptBox || btn).getBoundingClientRect();
        const gap = 8;
        setSidebarPromptPos({
          bottom: window.innerHeight - anchorRect.top + gap,
          right: window.innerWidth - anchorRect.right,
        });
        setMaxHeight(Math.max(250, Math.min(600, anchorRect.top - gap - 16)));
      };
      recomputeSidebar();
      window.addEventListener('resize', recomputeSidebar);
      const promptBox = buttonRef.current?.closest('[class*="rounded-[24px]"]') as HTMLElement | null;
      let resizeObs: ResizeObserver | undefined;
      if (promptBox) {
        resizeObs = new ResizeObserver(recomputeSidebar);
        resizeObs.observe(promptBox);
      }
      return () => {
        window.removeEventListener('resize', recomputeSidebar);
        resizeObs?.disconnect();
      };
    }

    // Main prompt-box: anchor above the main prompt container
    const recompute = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const gap = 8;
      const promptBox = btn.closest('[class*="rounded-[22px]"]') as HTMLElement | null;
      const spaceAbove = promptBox ? promptBox.getBoundingClientRect().top : rect.top;
      const availableSpace = spaceAbove - gap;
      setMaxHeight(Math.max(250, Math.min(600, availableSpace - 8)));
    };
    recompute();
    window.addEventListener('resize', recompute);
    const promptBox = buttonRef.current?.closest('[class*="rounded-[22px]"]') as HTMLElement | null;
    let resizeObs: ResizeObserver | undefined;
    if (promptBox) {
      resizeObs = new ResizeObserver(recompute);
      resizeObs.observe(promptBox);
    }
    return () => {
      window.removeEventListener('resize', recompute);
      resizeObs?.disconnect();
    };
  }, [isOpen, buttonRef, openedFrom]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, buttonRef]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node) &&
        sortButtonRef.current && !sortButtonRef.current.contains(e.target as Node)
      ) {
        setIsSortMenuOpen(false);
      }
    };
    if (isSortMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSortMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node) &&
        projectButtonRef.current && !projectButtonRef.current.contains(e.target as Node)
      ) {
        setIsProjectMenuOpen(false);
      }
    };
    if (isProjectMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProjectMenuOpen]);

  const filteredAndSortedAssets = React.useMemo(() => {
    let assets = [...assetsList];

    // Filter by category
    if (selectedCategory !== 'all') {
      if (selectedCategory === 'images') {
        assets = assets.filter(a => a.type === 'Image');
      } else if (selectedCategory === 'videos') {
        assets = assets.filter(a => a.type === 'Video');
      } else {
        assets = [];
      }
    }

    // Filter by search query
    if (searchQuery.trim()) {
      assets = assets.filter(a => a.title.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    // Sort by selection
    if (sortBy === 'Oldest') {
      return [...assets].reverse();
    } else if (sortBy === 'Newest' || sortBy === 'Recent') {
      return assets;
    } else if (sortBy === 'Most Used') {
      return [...assets].sort((a, b) => b.title.length - a.title.length);
    }

    return assets;
  }, [assetsList, selectedCategory, searchQuery, sortBy]);

  const isScreenCentered = openedFrom === 'instruction-reference';
  const isSidebarPrompt = openedFrom === 'sidebar';
  const modalBg = 'bg-[#141517]/90 backdrop-blur-[80px]';

  return (
    isMounted ? (
      <>
        {openedFrom === 'instruction-reference' && (
          <div
            onClick={onClose}
            style={{
              opacity: isShown ? 1 : 0,
              transition: 'opacity 0.22s ease-out',
              pointerEvents: isShown ? 'auto' : 'none',
            }}
            className="fixed inset-0 bg-black/55 backdrop-blur-[4px] z-[99]"
          />
        )}
        <div
          ref={menuRef}
          style={{
            height: maxHeight,
            ...(isScreenCentered ? {
              top: '50%',
              bottom: 'auto',
              transformOrigin: 'center center',
              transform: isShown
                ? 'translate(-50%, -50%) scale(1)'
                : 'translate(-50%, -48%) scale(0.96)',
            } : isSidebarPrompt ? {
              bottom: `${sidebarPromptPos.bottom}px`,
              right: `${sidebarPromptPos.right}px`,
              transformOrigin: 'bottom right',
              transform: isShown
                ? 'scale(1)'
                : 'translateY(8px) scale(0.96)',
            } : {
              bottom: 'calc(100% + 6px)',
              transformOrigin: 'bottom center',
              transform: isShown
                ? 'translateX(-50%) translateY(0px) scale(1)'
                : 'translateX(-50%) translateY(8px) scale(0.96)',
            }),
            opacity: isShown ? 1 : 0,
            transition:
              'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.16s ease-out',
            willChange: 'transform, opacity',
            isolation: 'isolate',
            contain: 'layout paint',
            backfaceVisibility: 'hidden',
            pointerEvents: isShown ? 'auto' : 'none',
          }}
          className={`${isScreenCentered ? 'fixed left-1/2' : isSidebarPrompt ? 'fixed' : 'absolute left-1/2'} w-[800px] max-w-[90vw] ${modalBg} rounded-2xl shadow-2xl z-[100] border border-white/5 flex overflow-hidden asset-menu-modal-container`}
        >
      {/* Left Sidebar */}
      <div className="w-[160px] shrink-0 flex flex-col">
        <div className="pl-3 pr-1.5 pt-3 pb-3">
          <div className="relative w-full">
            <button 
              ref={projectButtonRef}
              onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
              className="bg-[#666970]/50 backdrop-blur-md hover:bg-[#777a82]/50 transition-colors rounded-2xl flex items-center justify-between px-3 h-[40px] w-full cursor-pointer outline-none border-none"
            >
              <span className="text-[#e0e0e0] font-semibold text-[13px] truncate mr-2 min-w-0">{currentProject}</span>
              <ChevronDown size={14} className={`text-[#a0a0a0] shrink-0 transition-transform duration-200 ${isProjectMenuOpen ? 'rotate-180' : ''}`} strokeWidth={2.5} />
            </button>
            {isProjectMenuOpen && (
              <div 
                ref={projectMenuRef}
                className="absolute left-0 right-0 top-[calc(100%+6px)] bg-[#141517]/90 backdrop-blur-[80px] rounded-[16px] p-1 shadow-2xl z-[110] flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-2 duration-150"
              >
                {['May 25, 05:55 AM', 'Project 1', 'Project 2', 'Project 3'].map((proj) => {
                  const isSelected = currentProject === proj;
                  return (
                    <button
                      key={proj}
                      type="button"
                      onClick={() => {
                        setCurrentProject(proj);
                        setIsProjectMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 rounded-[12px] text-[13px] font-normal transition-colors truncate ${
                        isSelected
                          ? 'bg-[#4a4a4a] text-white'
                          : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {proj}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto no-scrollbar py-2 pl-3 pr-1.5 flex flex-col gap-0.5">
          {SIDEBAR_ITEMS.map((item) => {
            const isSelected = !isSketchMode && selectedCategory === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedCategory(item.id);
                  setIsSketchMode(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-xl transition-all outline-none ${
                  isSelected 
                    ? 'bg-[#505153] text-white' 
                    : 'text-[#a0a0a0] hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon size={16} strokeWidth={isSelected ? 2 : 1.8} />
                <span className="text-[13px] font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
        
        <div className="py-3 pl-3 pr-1.5 flex flex-col gap-1.5">
          <button 
            type="button"
            onClick={() => setIsSketchMode(true)}
            className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-xl transition-colors font-medium text-[13px] outline-none ${
              isSketchMode ? 'bg-[#505153] text-white font-semibold' : 'text-[#e0e0e0] hover:bg-white/5'
            }`}
          >
            <Palette size={16} strokeWidth={2} />
            <span>Add sketch</span>
          </button>
          <button 
            onClick={() => {
              if (onFileSelect) onFileSelect();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-1.5 rounded-xl text-[#e0e0e0] hover:bg-white/5 transition-colors font-medium text-[13px]"
          >
            <Upload size={16} strokeWidth={2} />
            <span>Upload media</span>
          </button>
        </div>
      </div>

      {/* Right Content Area (Middle + Right Columns) */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Unified Top Header */}
        <div className="flex items-center pl-1.5 pr-3 pt-3 pb-3 gap-3">
          <div className="bg-[#666970]/50 backdrop-blur-md rounded-2xl flex items-center px-3 h-[40px] transition-colors border-none flex-1">
            <Search size={16} className="text-[#a0a0a0] shrink-0 mr-2" />
            <input 
              type="text" 
              placeholder="Search assets"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-[13.5px] text-white w-full placeholder-[#8e8e8e]"
            />
          </div>
          <div className="relative">
            <button 
              ref={sortButtonRef}
              onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
              className="flex items-center gap-2 bg-[#666970]/50 backdrop-blur-md hover:bg-[#777a82]/50 transition-colors px-4 h-[40px] rounded-2xl text-[13px] font-medium text-[#e0e0e0] border-none outline-none shrink-0"
            >
              <span>{sortBy}</span>
              <ChevronDown size={14} className={`text-[#a0a0a0] transition-transform duration-200 ${isSortMenuOpen ? 'rotate-180' : ''}`} strokeWidth={2.5} />
            </button>
            {isSortMenuOpen && (
              <div 
                ref={sortMenuRef}
                className="absolute right-0 top-[calc(100%+6px)] w-[140px] bg-[#141517]/90 backdrop-blur-[80px] rounded-[16px] p-1 shadow-2xl z-[110] flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-2 duration-150"
              >
                {SORT_OPTIONS.map((option) => {
                  const isSelected = sortBy === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setSortBy(option);
                        setIsSortMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 rounded-[12px] text-[13px] font-normal transition-colors ${
                        isSelected
                          ? 'bg-[#4a4a4a] text-white'
                          : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex flex-1 min-h-0 overflow-y-auto">
          {/* Middle Column: Asset List */}
          {!isSketchMode && (
            <div className="w-[260px] shrink-0 flex flex-col">
              <div className="flex-1 overflow-y-auto no-scrollbar pl-1.5 pr-3 pb-3 flex flex-col gap-0.5">
                {filteredAndSortedAssets.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center px-3 py-8 text-center text-[12px] text-[#8e8e8e]">
                    No assets yet
                  </div>
                ) : filteredAndSortedAssets.map((asset) => {
                  const isSelected = selectedAsset?.id === asset.id;
                  return (
                    <div
                      key={asset.id}
                      onClick={() => setSelectedAsset(asset)}
                      className={`flex items-center gap-3 p-1.5 rounded-2xl cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#505153]' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-black/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.url} alt={asset.title} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex flex-col justify-center h-10 min-w-0">
                        <span className={`text-[14px] truncate leading-tight ${isSelected ? 'text-white font-semibold' : 'text-[#e0e0e0] font-medium'}`}>
                          {asset.title}
                        </span>
                        <span className="text-[12px] text-[#8e8e8e] mt-0.5">{asset.type}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Right Column: Preview or Sketchpad */}
          <div className="flex-1 flex flex-col pr-3 pb-3 min-h-0">
            <div className="flex-1 flex flex-col bg-[#1e1f21]/50 backdrop-blur-md rounded-2xl p-3 min-h-0">
              {isSketchMode ? (
                <SketchPad
                  onSave={handleSaveSketch}
                  onCancel={() => setIsSketchMode(false)}
                />
              ) : selectedAsset ? (
                <>
                  <div className="flex-1 flex items-center justify-center min-h-0 relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedAsset.url}
                      alt={selectedAsset.title}
                      className="max-w-full max-h-full object-contain rounded-2xl shadow-xl"
                    />
                  </div>

                  <div className="pt-3 shrink-0">
                    <button
                      onClick={() => {
                        if (onAddPrompt) onAddPrompt(selectedAsset.id, selectedAsset.url, selectedAsset.title, selectedAsset.type.toLowerCase() === 'video' ? 'video' : 'image');
                        onClose();
                      }}
                      className="w-full bg-white hover:bg-gray-100 text-black py-2 rounded-xl font-semibold text-[13px] transition-colors shadow-lg"
                    >
                      Add to Prompt
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-center text-[13px] text-[#8e8e8e] px-6">
                  Generate something in the canvas — your media will appear here.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
      </>
    ) : null
  );
};

interface SketchPadProps {
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}

const SketchPad: React.FC<SketchPadProps> = ({ onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(5);
  const [isEraser, setIsEraser] = useState(false);
  
  const lastX = useRef(0);
  const lastY = useRef(0);

  // Initialize canvas size and keep it responsive
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      
      // Save canvas contents before resize
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.drawImage(canvas, 0, 0);
      }
      
      canvas.width = width;
      canvas.height = height;

      // Restore drawing settings
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = isEraser ? '#1e1f21' : brushColor;
        ctx.lineWidth = brushSize;
        if (isEraser) {
          ctx.globalCompositeOperation = 'destination-out';
        } else {
          ctx.globalCompositeOperation = 'source-over';
        }
        
        // Restore canvas contents
        ctx.drawImage(tempCanvas, 0, 0);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [brushColor, brushSize, isEraser]);

  // Update canvas brush settings on color/size/eraser changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushSize * 2.5;
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
  }, [brushColor, brushSize, isEraser]);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    lastX.current = x;
    lastY.current = y;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!canvas || !ctx) return;

    const { x, y } = getCoordinates(e);

    ctx.beginPath();
    ctx.moveTo(lastX.current, lastY.current);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastX.current = x;
    lastY.current = y;

    if (e.cancelable) e.preventDefault();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleDone = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL('image/png'));
  };

  const COLORS = [
    { value: '#ffffff', label: 'White' },
    { value: '#a0a0a0', label: 'Gray' },
    { value: '#ef4444', label: 'Red' },
    { value: '#10b981', label: 'Green' },
    { value: '#3b82f6', label: 'Blue' },
    { value: '#f59e0b', label: 'Yellow' }
  ];

  const SIZES = [
    { value: 2, label: 'S' },
    { value: 5, label: 'M' },
    { value: 12, label: 'L' },
    { value: 24, label: 'XL' }
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Sketchpad Toolbar */}
      <div className="flex items-center justify-between pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold text-white">Draw Sketch</span>
        </div>
        
        {/* Brush Controls */}
        <div className="flex items-center gap-4">
          {/* Colors */}
          <div className="flex items-center gap-1.5 bg-black/20 p-1 rounded-xl">
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => {
                  setBrushColor(c.value);
                  setIsEraser(false);
                }}
                className="w-5 h-5 rounded-full transition-transform active:scale-90 relative"
                style={{ backgroundColor: c.value }}
                title={c.label}
              >
                {!isEraser && brushColor === c.value && (
                  <span className="absolute inset-0 rounded-full border border-black/50 ring-2 ring-white" />
                )}
              </button>
            ))}
          </div>

          {/* Sizes */}
          <div className="flex items-center bg-black/20 p-1 rounded-xl gap-0.5">
            {SIZES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setBrushSize(s.value)}
                className={`w-6 h-6 rounded-lg text-[10px] font-bold flex items-center justify-center transition-all ${
                  brushSize === s.value
                    ? 'bg-white/15 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div 
        ref={containerRef}
        className="flex-1 bg-black/30 rounded-xl border border-white/5 relative overflow-hidden min-h-0"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
        />
      </div>

      {/* Footer Controls */}
      <div className="pt-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* Eraser */}
          <button
            type="button"
            onClick={() => setIsEraser(!isEraser)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] font-medium transition-colors ${
              isEraser
                ? 'bg-white/10 text-white border border-white/10'
                : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
            title="Eraser tool"
          >
            <Eraser size={16} />
            <span>Eraser</span>
          </button>
          
          {/* Clear */}
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] font-medium text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors border border-transparent"
            title="Clear all"
          >
            <Trash2 size={16} />
            <span>Clear</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Cancel */}
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-zinc-300 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          
          {/* Add to Prompt */}
          <button
            type="button"
            onClick={handleDone}
            className="bg-white hover:bg-gray-100 text-black px-4 py-2 rounded-xl font-semibold text-[13px] transition-colors shadow-lg"
          >
            Add to Prompt
          </button>
        </div>
      </div>
    </div>
  );
};
