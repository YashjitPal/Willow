
import React, { useState, Suspense } from 'react';
import { Routes, Route, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Sidebar, ViewType } from './components/Sidebar';
import { HeroSection } from './components/HeroSection';
import { BottomPanel } from './components/BottomPanel';
import { ShaderAnimation } from './components/ui/shader-lines';
import { WaveShaderBackground } from './components/ui/wave-shader';
import { SearchModal } from './components/SearchModal';
import { SettingsModal } from './components/SettingsModal';
import { ProjectsPage } from './components/ProjectsPage';
import { RainbowButton } from './components/ui/rainbow-button';
// Lazy-load StagingView to prevent WebContainer boot on login page
const StagingView = React.lazy(() => import('./components/staging/StagingView'));
import { LoginPage } from './components/LoginPage';
import { Onboarding } from './components/Onboarding';
import { useAuth } from './context/AuthContext';
import { BackgroundProvider, useBackground } from './context/BackgroundContext';

// Dynamic background renderer based on context
const BackgroundRenderer: React.FC<{ isAuthenticated: boolean; isSidebarCollapsed?: boolean }> = ({ isAuthenticated, isSidebarCollapsed }) => {
  const { background } = useBackground();
  
  // Force 'lines' background for non-authenticated users
  const effectiveBackground = isAuthenticated ? background : 'lines';
  
  switch (effectiveBackground) {
    case 'waves':
      return <WaveShaderBackground isSidebarCollapsed={isSidebarCollapsed} />;
    case 'lines':
      return <ShaderAnimation />;
    case 'solid':
    default:
      return null;
  }
};

// Auth buttons for non-authenticated users
const AuthButtons: React.FC = () => {
  return (
    <div className="absolute top-4 right-6 z-50 flex items-center gap-3">
      <Link to="/login?mode=login">
        <button className="px-4 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors">
          Log in
        </button>
      </Link>
      <Link to="/login?mode=signup">
        <RainbowButton className="px-4 py-2 text-sm font-bold">
          Sign up
        </RainbowButton>
      </Link>
    </div>
  );
};

const DashboardLayout: React.FC<{
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  children: React.ReactNode;
  onSettingsClick: () => void;
  isAuthenticated: boolean;
}> = ({ isSearchOpen, setIsSearchOpen, currentView, setCurrentView, children, onSettingsClick, isAuthenticated }) => {
  const { background } = useBackground();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Calculate effective background (non-authenticated users get 'lines')
  const effectiveBackground = isAuthenticated ? background : 'lines';
  
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#1c1c1c] text-white selection:bg-pink-500/30 relative">
      {/* Background rendered at root level ONLY for waves (to cover sidebar) */}
      {currentView === 'home' && effectiveBackground === 'waves' && (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <BackgroundRenderer isAuthenticated={isAuthenticated} isSidebarCollapsed={isSidebarCollapsed} />
            <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
            <div className="absolute inset-0 z-[2] bg-[radial-gradient(circle_at_center,transparent_30%,#1c1c1c_110%)] pointer-events-none" />
        </div>
      )}

      {/* Only show sidebar when authenticated */}
      {isAuthenticated && (
        <Sidebar 
          onSearchClick={() => setIsSearchOpen(true)} 
          currentView={currentView}
          onViewChange={setCurrentView}
          onSettingsClick={onSettingsClick}
          backgroundType={effectiveBackground}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />
      )}
      
      {/* Show auth buttons when not authenticated */}
      {!isAuthenticated && <AuthButtons />}
      
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      <div className="flex-1 relative flex flex-col min-w-0 bg-transparent">
        {/* Background rendered in content area for lines only (solid is just plain color) */}
        {currentView === 'home' && effectiveBackground === 'lines' && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
              <BackgroundRenderer isAuthenticated={isAuthenticated} isSidebarCollapsed={isSidebarCollapsed} />
              <div className="absolute inset-0 z-[1] pointer-events-none opacity-[0.06] mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`}} />
              <div className="absolute inset-0 z-[2] bg-[radial-gradient(circle_at_center,transparent_30%,#1c1c1c_110%)] pointer-events-none" />
          </div>
        )}
        {/* Solid background: No overlays, just plain color from parent */}
        <main className="flex-1 relative z-10 overflow-y-auto scroll-smooth flex flex-col">
             {children}
        </main>
      </div>
    </div>
  );
};

const ProjectIframe: React.FC = () => {
    const [searchParams] = useSearchParams();
    const prompt = searchParams.get('prompt') || '';
    
    return (
        <iframe 
            src={`http://localhost:3001/?prompt=${encodeURIComponent(prompt)}`}
            className="w-full h-full border-none"
            title="Project Content"
        />
    );
};

const App: React.FC = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'workspace' | 'people' | 'models' | 'cloud' | 'privacy' | 'account' | 'labs' | 'connectors' | 'github' | undefined>(undefined);
  const [settingsInitialConnector, setSettingsInitialConnector] = useState<string | null | undefined>(undefined);
  const [currentView, setCurrentView] = useState<ViewType>('home');

  // Model Config State - Lifted for synchronization
  const [modelConfig, setModelConfig] = React.useState({
    gemini: { 
        model: 'gemini-3-flash-preview', 
        thinkingLevel: 3, // 3 = high thinking level (0=none, 1=low, 2=medium, 3=high)
        savedModels: [
          { id: 'default-flash-high', name: 'Gemini 3 Flash', thinkingLevel: 3, modelId: 'gemini-3-flash-preview' }
        ] as Array<{ id: string; name: string; thinkingLevel: number; modelId: string }> 
    },
    openai: { 
        model: 'gpt-5.2-thinking',
        thinkingLevel: 2,
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>
    },
    anthropic: { 
        model: 'claude-sonnet-4.5',
        thinkingLevel: 2,
        savedModels: [] as Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>
    }
  });

  const [selectedModelId, setSelectedModelId] = useState("");

  const navigate = useNavigate();
  const { user, userProfile, loading } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Check if user needs onboarding
  React.useEffect(() => {
    if (user && userProfile && !userProfile.onboardingComplete) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [user, userProfile]);

  const handlePromptSubmit = (prompt: string, mode: string = 'ship') => {
    if (!user) {
      navigate('/login');
      return;
    }
    const encodedPrompt = encodeURIComponent(prompt);
    navigate(`/project1?prompt=${encodedPrompt}&mode=${mode}`);
  };

  // Helper to open settings to Drive connector
  const openDriveSettings = () => {
    setSettingsInitialTab('connectors');
    setSettingsInitialConnector('drive');
    setIsSettingsOpen(true);
  };

  // Reset settings initial state when modal closes
  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
    setSettingsInitialTab(undefined);
    setSettingsInitialConnector(undefined);
  };

  // Show loading screen while auth state is being determined
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#030303]">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // Show onboarding for new users
  if (showOnboarding && user) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <BackgroundProvider>
      <Routes>
        <Route path="/" element={
          <>
            <SettingsModal 
              isOpen={isSettingsOpen} 
              onClose={handleSettingsClose} 
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              initialTab={settingsInitialTab}
              initialConnector={settingsInitialConnector}
            />
            <DashboardLayout 
              isSearchOpen={isSearchOpen} 
              setIsSearchOpen={setIsSearchOpen} 
              currentView={currentView} 
              setCurrentView={setCurrentView}
              onSettingsClick={() => setIsSettingsOpen(true)}
              isAuthenticated={!!user}
            >
              {currentView === 'home' ? (
                <div className="flex flex-col min-h-full">
                  <HeroSection 
                    onPromptSubmit={handlePromptSubmit} 
                    modelConfig={modelConfig}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    onAuthRequired={!user ? () => navigate('/login') : undefined}
                    isAuthenticated={!!user}
                  />
                  {/* Only show BottomPanel (projects showcase) when authenticated */}
                  {user && (
                    <div className="pb-20">
                      <BottomPanel onOpenDriveSettings={openDriveSettings} />
                    </div>
                  )}
                </div>
              ) : (
                <ProjectsPage view={currentView} onOpenDriveSettings={openDriveSettings} />
              )}
            </DashboardLayout>
          </>
        } />
        
        <Route path="/project1" element={
          <div className="h-screen w-screen overflow-hidden">
            <SettingsModal 
              isOpen={isSettingsOpen} 
              onClose={() => setIsSettingsOpen(false)} 
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
            />
            <Suspense fallback={<div className="h-screen w-screen bg-[#1c1c1c] flex items-center justify-center text-white">Loading...</div>}>
              <StagingView 
                onSettingsClick={() => setIsSettingsOpen(true)} 
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
              />
            </Suspense>
          </div>
        } />

        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </BackgroundProvider>
  );
};

export default App;
