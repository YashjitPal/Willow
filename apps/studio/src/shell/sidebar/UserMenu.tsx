import React, { useState, useRef, useEffect } from 'react';
import { Settings, Contrast, ChevronRight, Users, LogOut } from 'lucide-react';
import { useAuth } from '@willow/auth/AuthContext';
import { AppearanceMenu } from './AppearanceMenu';

export const UserMenu: React.FC<{ isOpen: boolean; onClose: () => void; isCollapsed: boolean; onSettingsClick?: () => void; backgroundType?: string }> = ({ isOpen, onClose, isCollapsed, onSettingsClick, backgroundType }) => {
  const { user, signInWithGoogle, signOut } = useAuth();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showAppearance, setShowAppearance] = useState(false);
  const [shouldRenderAppearance, setShouldRenderAppearance] = useState(false);
  const [isAppearanceClosing, setIsAppearanceClosing] = useState(false);
  const [isAppearanceMounted, setIsAppearanceMounted] = useState(false);

  // Handle appearance submenu animation
  useEffect(() => {
    if (showAppearance) {
      setShouldRenderAppearance(true);
      setIsAppearanceClosing(false);
      // Trigger mount animation after render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAppearanceMounted(true);
        });
      });
    } else if (shouldRenderAppearance) {
      setIsAppearanceClosing(true);
      setIsAppearanceMounted(false);
      const timer = setTimeout(() => {
        setShouldRenderAppearance(false);
        setIsAppearanceClosing(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [showAppearance]);

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
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const sidebarBgClass = backgroundType === 'waves' 
    ? 'bg-[#1f1f1f]/90 backdrop-blur-xl'
    : 'bg-[#1f1f1f]';

  return (
    <div 
      ref={menuRef}
      style={{ 
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset'
      }}
      className={`absolute bottom-[46px] left-0 w-[200px] ${sidebarBgClass} rounded-xl shadow-2xl py-2 z-[60] origin-bottom-left ${isClosing ? 'menu-fade-out' : 'menu-fade-in'}`}
    >
      <div className="px-3.5 py-2.5 flex items-center gap-2.5 border-b border-white/5 mb-1.5">
        {user ? (
          <>
            <img 
              src={user.photoURL || 'https://picsum.photos/64/64?random=42'} 
              alt="User" 
              className="w-6 h-6 rounded-full border border-white/10 shrink-0" 
            />
            <span className="text-[13.5px] font-bold text-white truncate tracking-tight">{user.email}</span>
          </>
        ) : (
          <button
            onClick={async () => {
              try {
                await signInWithGoogle();
                onClose();
              } catch (error) {
                console.error('Sign in failed:', error);
              }
            }}
            className="w-full flex items-center gap-2.5 text-[13.5px] font-medium text-white hover:text-blue-400 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>Sign in with Google</span>
          </button>
        )}
      </div>

      <div className="px-1.5 space-y-0.5">
        <button 
            onClick={() => {
                onClose();
                onSettingsClick?.();
            }}
            className="w-full flex items-center gap-3 px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
        >
          <Settings size={18} strokeWidth={2} />
          <span>Settings</span>
        </button>
        
        <div 
          className="relative"
          onMouseEnter={() => setShowAppearance(true)}
          onMouseLeave={() => setShowAppearance(false)}
        >
          <button 
             onClick={() => setShowAppearance(!showAppearance)}
             className="w-full flex items-center justify-between px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl group/btn"
          >
            <div className="flex items-center gap-3">
              <Contrast size={18} strokeWidth={2} />
              <span>Appearance</span>
            </div>
            <ChevronRight size={14} className="text-white/60 group-hover/btn:text-white" />
          </button>
          
          {shouldRenderAppearance && (
            <AppearanceMenu onClose={() => setShowAppearance(false)} isClosing={isAppearanceClosing} isMounted={isAppearanceMounted} backgroundType={backgroundType} />
          )}
        </div>

        <button 
          onClick={() => window.open('https://discord.gg/7TEtRfxGtP', '_blank')}
          className="w-full flex items-center gap-3 px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
        >
          <Users size={18} strokeWidth={2} />
          <span>Community</span>
        </button>
      </div>

      {user && (
        <div className="mt-1.5 pt-1.5 px-1.5 border-t border-white/5">
          <button 
            onClick={async () => {
              try {
                await signOut();
                onClose();
              } catch (error) {
                console.error('Sign out failed:', error);
              }
            }}
            className="w-full flex items-center gap-3 px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl"
          >
            <LogOut size={18} strokeWidth={2} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
};
