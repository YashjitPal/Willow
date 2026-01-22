import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { 
  Search, 
  Files, 
  ChevronRight, 
  FileCode, 
  FileJson, 
  FileType, 
  X,
  RotateCw,
  Copy,
  Download,
  GitBranch,
  Image,
  LayoutTemplate,
  FolderOpen
} from 'lucide-react';
import { workbenchStore } from '~/lib/sandpack';

interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileNode[];
  ext?: string;
}

interface OpenTab {
  path: string;
  name: string;
}

// Convert flat file map to tree structure
function buildFileTree(filesMap: Record<string, any>): FileNode[] {
  const root: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  const paths = Object.keys(filesMap).filter(p => filesMap[p]?.type === 'file').sort();

  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean);
    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      if (isFile) {
        const ext = part.includes('.') ? part.split('.').pop() : '';
        currentLevel.push({
          id: currentPath,
          name: part,
          type: 'file',
          path: filePath,
          ext,
        });
      } else {
        let folder = folderMap.get(currentPath);
        if (!folder) {
          folder = {
            id: currentPath,
            name: part,
            type: 'folder',
            path: currentPath,
            children: [],
          };
          folderMap.set(currentPath, folder);
          currentLevel.push(folder);
        }
        currentLevel = folder.children!;
      }
    }
  }

  return root;
}

const StagingCodePanel: React.FC = () => {
  // Use bolt.diy files store
  const filesMap = useStore(workbenchStore.files);
  
  const [activeSideTab, setActiveSideTab] = useState<'files' | 'search'>('files');
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll tabs to show latest tab when new one is added
  useEffect(() => {
    if (tabsContainerRef.current && openTabs.length > 0) {
      tabsContainerRef.current.scrollTo({
        left: tabsContainerRef.current.scrollWidth,
        behavior: 'smooth'
      });
    }
  }, [openTabs.length]);

  // Build file tree from bolt store
  const fileTree = useMemo(() => buildFileTree(filesMap), [filesMap]);
  
  // Get content of active file
  const activeFile = activeFilePath ? filesMap[activeFilePath] : null;
  const activeFileContent = activeFile?.type === 'file' ? activeFile.content : '';

  const toggleFolder = (id: string) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleNodeClick = (node: FileNode) => {
    if (node.type === 'folder') {
      toggleFolder(node.id);
    } else {
      // Open file in new tab if not already open
      const existingTab = openTabs.find(t => t.path === node.path);
      if (!existingTab) {
        setOpenTabs(prev => [...prev, { path: node.path, name: node.name }]);
      }
      setActiveFilePath(node.path);
    }
  };

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs(prev => prev.filter(t => t.path !== path));
    if (activeFilePath === path) {
      const remaining = openTabs.filter(t => t.path !== path);
      setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  };

  const getFileIcon = (ext?: string, name?: string) => {
    if (name === '.gitignore') return <GitBranch size={16} className="text-white" />;
    
    switch(ext) {
      case 'tsx':
      case 'ts':
      case 'jsx':
      case 'js':
        return <FileCode size={16} className="text-white" />;
      case 'css':
      case 'scss':
        return <FileType size={16} className="text-white" />;
      case 'json':
        return <FileJson size={16} className="text-white" />;
      case 'html':
        return <LayoutTemplate size={16} className="text-white" />;
      case 'svg':
      case 'png':
      case 'jpg':
      case 'ico':
        return <Image size={16} className="text-white" />;
      default:
        return <FileType size={16} className="text-white" />;
    }
  };

  const renderTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isSelected = activeFilePath === node.path;
      const isOpen = node.type === 'folder' && openFolders.has(node.id);
      
      return (
        <React.Fragment key={node.id}>
          <div 
            onClick={() => handleNodeClick(node)}
            className={`
              flex items-center gap-2 cursor-pointer mx-2 rounded-md
              transition-colors duration-150 text-[13px] select-none
              ${isSelected ? 'bg-[#2a2d35]' : 'hover:bg-[#2a2a2a]'}
              text-white py-[9px]
            `}
            style={{ paddingLeft: `${depth * 20 + 8}px` }}
          >
            <span className="flex-shrink-0 w-5 flex justify-center">
              {node.type === 'folder' ? (
                <ChevronRight 
                  size={14} 
                  className={`text-white transition-transform duration-200 ease-out ${isOpen ? 'rotate-90' : ''}`} 
                />
              ) : (
                getFileIcon(node.ext, node.name)
              )}
            </span>
            
            <span className="truncate font-medium">{node.name}</span>
          </div>
          
          {/* Folder children with smooth animation */}
          {node.type === 'folder' && node.children && (
            <div 
              className={`overflow-hidden transition-all duration-200 ease-out ${
                isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              {renderTree(node.children, depth + 1)}
            </div>
          )}
        </React.Fragment>
      );
    });
  };

  const renderHighlightedCode = (code: string) => {
    return code.split('\n').map((line, i) => (
      <div key={i} className="flex hover:bg-[#2a2d35]/30 py-1">
         <span className="w-14 text-right pr-6 text-white text-[13px] select-none opacity-40 flex-shrink-0 font-mono">
           {i + 1}
         </span>
         <span className="font-mono text-[13px] text-white whitespace-pre tab-4">
           {line}
         </span>
      </div>
    ));
  };

  const hasFiles = Object.keys(filesMap).length > 0;

  return (
    <div className="h-full flex-1 min-h-0 w-full bg-[#1c1c1c] border border-[#27272a] rounded-[12px] flex overflow-hidden font-sans shadow-2xl">
      
      {/* Left Sidebar - Explorer - FIXED WIDTH */}
      <div className="flex flex-col w-[280px] min-w-[280px] max-w-[280px] bg-[#1c1c1c] flex-shrink-0">
        
        {/* Sidebar Header with Toggle */}
        <div className="p-3 pb-2">
            <div className="flex bg-[#272729] p-1 rounded-lg mb-3">
              <button 
                onClick={() => setActiveSideTab('files')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                  activeSideTab === 'files' 
                  ? 'bg-[#1c1c1c] text-white shadow-md' 
                  : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Files size={13} />
                Files
              </button>
              <button 
                onClick={() => setActiveSideTab('search')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                  activeSideTab === 'search' 
                  ? 'bg-[#1c1c1c] text-white shadow-md' 
                  : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Search size={13} />
                Search
              </button>
            </div>
            
            {/* Search Input */}
            <div className="relative group">
                <input 
                    type="text" 
                    placeholder="Search files"
                    className="w-full bg-[#272729] border border-transparent focus:border-[#27272a] rounded-md px-3 py-1.5 pl-3 text-[13px] text-gray-200 placeholder-gray-600 outline-none transition-all"
                />
            </div>
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar py-1">
          {hasFiles ? (
            renderTree(fileTree)
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm p-4">
              <FolderOpen size={32} className="mb-2 opacity-50" />
              <p className="text-center">No files generated yet.</p>
              <p className="text-center text-xs mt-1 opacity-70">Enter a prompt to generate code.</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Content - Editor */}
      <div className={`flex-1 flex flex-col min-w-0 ${activeFileContent ? 'bg-[#1c1c1c]' : 'bg-transparent'}`}>
        
        {/* Editor Tabs Header - Only show if there's content */}
        {activeFileContent && (
          <div ref={tabsContainerRef} className="flex items-center bg-[#1c1c1c] px-2 pt-3 pb-2 gap-1 overflow-x-auto flex-shrink-0 scroll-smooth">
             {openTabs.map((tab) => (
               <div 
                 key={tab.path}
                 onClick={() => setActiveFilePath(tab.path)}
                 className={`
                   flex items-center px-4 py-1.5 gap-2 text-[13px] rounded-md
                   relative group cursor-pointer transition-colors duration-150 flex-shrink-0
                   ${activeFilePath === tab.path 
                     ? 'bg-[#27272a] text-white' 
                     : 'text-gray-500 hover:text-gray-300 hover:bg-[#27272a]/50'
                   }
                 `}
               >
                 <span className="truncate max-w-[120px]">{tab.name}</span>
                 <button 
                   onClick={(e) => closeTab(tab.path, e)}
                   className="text-gray-400 hover:text-white p-0.5 rounded-sm hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                 >
                   <X size={13} />
                 </button>
               </div>
             ))}

             {/* Toolbar Spacer */}
             <div className="flex-1"></div>

             {/* Editor Actions */}
             <div className="flex items-center px-3 gap-1 text-gray-500 flex-shrink-0">
                 <button className="p-1.5 hover:text-gray-300 transition-colors hover:bg-white/5 rounded-md">
                    <RotateCw size={14} />
                 </button>
                 <button 
                   onClick={() => activeFileContent && navigator.clipboard.writeText(activeFileContent)}
                   className="p-1.5 hover:text-gray-300 transition-colors hover:bg-white/5 rounded-md" 
                 >
                    <Copy size={14} />
                 </button>
                 <button className="p-1.5 hover:text-gray-300 transition-colors hover:bg-white/5 rounded-md">
                    <Download size={14} />
                 </button>
             </div>
          </div>
        )}

        {/* Code Content */}
        <div className={`flex-1 overflow-auto custom-scrollbar ${activeFileContent ? 'py-3 bg-[#141414] rounded-tl-lg' : 'flex items-center justify-center bg-transparent'}`}>
          {activeFileContent ? (
            <div key={activeFilePath} className="animate-fadeIn w-full">
              {renderHighlightedCode(activeFileContent)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center opacity-40 select-none pointer-events-none">
              <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mb-4 shadow-inner ring-1 ring-white/5">
                <FileCode size={32} className="text-gray-600" />
              </div>
              <h3 className="text-gray-400 font-medium mb-1">Nothing here yet</h3>
              <p className="text-gray-600 text-sm max-w-[200px]">Select a file from the sidebar to view its code.</p>
            </div>
          )}
        </div>
      </div>

      {/* Minimal fade animation & Scrollbar fix */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0.5; }
          to { opacity: 1; }
        }
        .animate-fadeIn {
          animation: fadeIn 0.15s ease-out;
        }
        /* Custom scrollbar adjustments */
        .custom-scrollbar::-webkit-scrollbar-corner {
          background: transparent;
        }
      `}</style>
    </div>
  );
};

export default StagingCodePanel;
