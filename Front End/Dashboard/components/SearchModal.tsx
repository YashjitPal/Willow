import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import './SearchModal.css';
import { useAuth } from '../context/AuthContext';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose }) => {
  const { user, userProfile } = useAuth();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState('melody-maker');

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
  }, [isOpen]);

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
    <div className={`fixed inset-0 z-[100] flex items-center justify-center px-4 ${isClosing ? 'search-fade-out' : 'search-fade-in'}`}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-[640px] bg-[#1c1c1c] rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        
        {/* Search Header */}
        <div className="flex items-center px-4 h-[60px] border-b border-white/5 gap-3">
          <Search className="w-5 h-5 text-zinc-500 shrink-0" strokeWidth={2.5} />
          <input 
            type="text"
            placeholder="Search projects"
            className="flex-1 bg-transparent border-none outline-none text-[16px] text-white placeholder-zinc-500 h-full font-normal"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          <button 
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-zinc-500 transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-3 h-[320px] overflow-y-auto">
            <div className="px-3 pt-2 pb-3 text-[10.5px] font-bold text-zinc-500 uppercase tracking-widest">
              RECENT PROJECTS
            </div>
            
            <div 
              onClick={() => setSelectedId('melody-maker')}
              className={`group flex items-center gap-4 py-3 px-3 rounded-xl cursor-pointer transition-none
                ${selectedId === 'melody-maker' 
                  ? 'bg-[#272729] text-white shadow-sm ring-1 ring-white/5' 
                  : 'hover:bg-[#272729] text-zinc-300'}`}
            >
                <div className={`w-11 h-11 rounded-lg border flex items-center justify-center overflow-hidden shrink-0
                  ${selectedId === 'melody-maker' ? 'border-white/20' : 'bg-[#27272a] border-white/5'}`}>
                   <img src="https://picsum.photos/seed/melody/200/200" alt="Thumbnail" className={`w-full h-full object-cover ${selectedId === 'melody-maker' ? 'opacity-100' : 'opacity-80'}`} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                         <span className={`text-[14.5px] font-bold leading-tight ${selectedId === 'melody-maker' ? 'text-white' : 'text-white'}`}>
                           Melody Maker Studio
                         </span>
                         <span className={`text-[12px] font-medium ${selectedId === 'melody-maker' ? 'text-zinc-500' : 'text-zinc-500'}`}>
                           2 days ago
                         </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {userProfile?.photoURL ? (
                            <img src={userProfile.photoURL} className={`w-4 h-4 rounded-full border object-cover ${selectedId === 'melody-maker' ? 'border-white/30' : 'border-white/10'}`} alt="User" />
                        ) : (
                            <div className={`w-4 h-4 rounded-full border bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center text-white text-[8px] font-medium ${selectedId === 'melody-maker' ? 'border-white/30' : 'border-white/10'}`}>
                                {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                            </div>
                        )}
                        <span className={`text-[12px] font-medium truncate ${selectedId === 'melody-maker' ? 'text-zinc-500' : 'text-zinc-500'}`}>
                          {user?.email || 'unknown'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};