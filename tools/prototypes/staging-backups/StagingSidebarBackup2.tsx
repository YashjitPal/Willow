
import React, { useState, useRef, useEffect } from 'react';
import { 
  ChevronDown, 
  Clock, 
  PanelLeftClose, 
  Lightbulb, 
  FileCode2, 
  Plus, 
  MessageSquare, 
  MoreHorizontal,
  ThumbsUp,
  ThumbsDown,
  Copy,
  AudioLines,
  ArrowUp,
  ArrowLeft
} from 'lucide-react';
import { ALL_TOOLS } from '@willow/code/workbench/WorkbenchTopBar';

const AnnotateIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M4 12c0-4 4-7 8-7s8 3 8 7-4 7-8 7-8-3-8-7Z" className="opacity-40" strokeWidth="1.5" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

interface SidebarProps {
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
  prompt?: string;
  activeTab: string;
  onTabChange: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ width, isCollapsed, onToggle, prompt, activeTab, onTabChange }) => {
  const isCompact = width < 405;
  const [promptValue, setPromptValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftGradient, setShowLeftGradient] = useState(false);
  const [showRightGradient, setShowRightGradient] = useState(true);

  const activeTool = ALL_TOOLS.find(t => t.id === activeTab);
  const showContextHeader = activeTool && activeTool.id !== 'preview';

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setShowLeftGradient(scrollLeft > 5);
      setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  useEffect(() => {
    handleScroll();
  }, []);

  // Auto-expand textarea upwards
  useEffect(() => {
    if (textareaRef.current) {
      // Base height for single line is 44px
      textareaRef.current.style.height = '44px';
      const scrollHeight = textareaRef.current.scrollHeight;
      
      if (scrollHeight > 44) {
        // Expand up to 270px before scrolling
        const newHeight = Math.min(scrollHeight, 270);
        textareaRef.current.style.height = `${newHeight}px`;
      }
    }
  }, [promptValue]);
  
  return (
    <div style={{ width: `${width}px` }} className="flex flex-col bg-[#1c1c1c] h-full overflow-hidden relative">
      {/* Header */}
      <div className="h-14 px-[27px] flex items-center justify-between z-20 bg-[#1c1c1c] flex-shrink-0">
        <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1.5 rounded-md transition-colors min-w-0">
          <span className="font-semibold text-gray-200 truncate">Melody Maker Studio</span>
          <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
        </div>
        <div className="flex items-center gap-3 text-gray-400 flex-shrink-0">
          <div className="flex items-center gap-1">
            <button className="p-1.5 hover:text-white transition-colors"><Clock size={16} /></button>
            <button onClick={onToggle} className="p-1.5 hover:text-white transition-colors"><PanelLeftClose size={16} /></button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-[27px] pt-5 pb-44 space-y-8 no-scrollbar">
        {prompt && (
          <div className="flex justify-end">
            <div className="bg-[#27272a] text-gray-200 px-4 py-3 rounded-2xl max-w-[78%] text-[15px] leading-relaxed shadow-sm">
              {prompt}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
            <Lightbulb size={18} />
            <span className="text-[15.15px] font-medium">Thought for 12s</span>
          </div>

          <div className="text-gray-300 text-[15px] leading-[1.65] space-y-5">
            <p>
              I'll build a sleek music creation app with a dark, neon-synth aesthetic inspired by DAWs and drum machines.
            </p>

            <div className="space-y-2">
              <p className="font-semibold text-white">First version features:</p>
              <ul className="list-disc pl-5 space-y-1 text-gray-400 marker:text-gray-600">
                <li>Beat sequencer grid (4 tracks × 16 steps)</li>
                <li>Tempo and volume controls</li>
                <li>Play/pause functionality</li>
                <li>Visual beat indicators with animations</li>
                <li>Different synth sounds per track</li>
              </ul>
            </div>

            <div className="space-y-1">
              <p><strong className="text-white">Design:</strong> Dark cyberpunk theme with glowing cyan/teal accents, warm amber highlights, smooth animations, and a futuristic feel.</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
            <FileCode2 size={18} />
            <span className="text-[15.15px]">Editing <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded" style={{ color: '#81888f' }}>index.css</span></span>
          </div>
          
          <div className="flex items-center gap-3 pt-4 border-t border-white/5">
             <div className="flex items-center gap-1">
                <button className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"><ThumbsUp size={14} /></button>
                <button className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"><ThumbsDown size={14} /></button>
             </div>
             <button className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"><Copy size={14} /></button>
             <button className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors ml-auto"><MoreHorizontal size={14} /></button>
          </div>
        </div>
      </div>

      {/* Footer Container */}
      <div className="absolute bottom-0 left-0 w-full z-30 pointer-events-none">
        <div className="h-4 w-full bg-gradient-to-t from-[#1c1c1c] via-[#1c1c1c]/90 to-transparent" />
        <div className="bg-[#1c1c1c] pointer-events-auto">
          <div className="relative">
            <div 
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex gap-2 overflow-x-auto no-scrollbar px-[14px] scroll-smooth"
            >
               {['Add preset patterns', 'Add audio effects', 'Add MIDI support', 'Customize synth', 'Add more'].map((text, i) => (
                 <button key={i} className="whitespace-nowrap px-4 py-2 rounded-xl bg-[#27272a] text-sm text-gray-200 hover:bg-[#3f3f46] transition-colors font-medium border border-transparent">
                    {text}
                 </button>
               ))}
            </div>
            <div className={`absolute top-0 right-0 w-12 h-full bg-gradient-to-l from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showRightGradient ? 'opacity-100' : 'opacity-0'}`} />
            <div className={`absolute top-0 left-0 w-12 h-full bg-gradient-to-r from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showLeftGradient ? 'opacity-100' : 'opacity-0'}`} />
          </div>

          <div className="px-[14px] pb-4 pt-4">
            <div className={`bg-[#27272a] rounded-[26px] p-3.5 relative flex flex-col shadow-lg border border-white/5 transition-all duration-300 ease-in-out`}>
               <div 
                 className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showContextHeader ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
               >
                 <div className="overflow-hidden">
                   <div className={`flex flex-col gap-3 pb-2 transition-opacity duration-300 ${showContextHeader ? 'opacity-100' : 'opacity-0'}`}>
                     {activeTool && (
                       <>
                         <button 
                           onClick={() => onTabChange('preview')}
                           className="flex items-center gap-2 text-[#a1a1aa] hover:text-white transition-colors text-sm font-medium self-start ml-1"
                         >
                           <ArrowLeft size={14} />
                           <span>Back to Preview</span>
                         </button>
                         
                         <div className="flex items-center gap-2 bg-[#3f3f46]/50 rounded-xl px-4 py-3 text-white">
                           <activeTool.icon size={18} />
                           <span className="font-medium">{activeTool.label}</span>
                         </div>
                       </>
                     )}
                   </div>
                 </div>
               </div>

               <textarea 
                  ref={textareaRef}
                  placeholder="Ask Lovable..." 
                  className="w-full bg-transparent text-gray-100 placeholder-gray-400 resize-none outline-none min-h-[44px] px-3 py-1.5 mb-2 text-[16px] leading-relaxed font-normal overflow-y-auto"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  rows={1}
               />
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <button className="p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors flex-shrink-0">
                        <Plus size={18} />
                     </button>
                     <button 
                        className={`flex items-center gap-2 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors text-[13px] font-medium flex-shrink-0
                          ${isCompact ? 'p-2.5 justify-center' : 'px-4 py-2.5'}
                        `}
                        title="Annotate app"
                     >
                        <AnnotateIcon size={16} />
                        {!isCompact && <span>Annotate app</span>}
                     </button>
                  </div>
                  
                  <div className="flex items-center gap-2">
                     <button 
                        className={`flex items-center gap-2 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors text-[13px] font-medium flex-shrink-0
                          ${isCompact ? 'p-2.5 justify-center' : 'px-4 py-2.5'}
                        `}
                        title="Chat"
                     >
                        <MessageSquare size={16} />
                        {!isCompact && <span>Chat</span>}
                     </button>
                     <button className="p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-colors flex-shrink-0">
                        <AudioLines size={18} />
                     </button>
                     <button className="p-2.5 rounded-full bg-[#d4d4d8] text-black hover:bg-white transition-colors flex items-center justify-center shadow-md flex-shrink-0">
                        <ArrowUp size={18} strokeWidth={2.5} />
                     </button>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
