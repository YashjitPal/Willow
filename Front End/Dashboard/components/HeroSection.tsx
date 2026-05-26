import React, { useState } from 'react';
import { InputBar } from './InputBar';
import { useAuth } from '../context/AuthContext';
import { useBackground } from '../context/BackgroundContext';

export type Mode = 'ship' | 'design' | 'proto' | 'chat';

export const HeroSection: React.FC<{
  onPromptSubmit?: (prompt: string, mode: string) => void;
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  onAuthRequired?: () => void;
  isAuthenticated?: boolean;
  agentSwarmEnabled?: boolean;
  onSwarmToggle?: (enabled: boolean) => void;
  initialMode?: Mode;
  /** Chat-mode live-voice toggle. Only provided by DashboardChat; Develop leaves it undefined. */
  onStartLive?: () => void;
  dashboardMode?: 'develop' | 'media';
}> = ({ onPromptSubmit, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated, agentSwarmEnabled, onSwarmToggle, initialMode = 'ship', onStartLive, dashboardMode }) => {
  const { userProfile } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);

  // Get user's first name
  const firstName = userProfile?.displayName?.split(' ')[0] || 'there';

  const getHeadingText = () => {
    if (dashboardMode === 'media') {
      return isAuthenticated
        ? `Time to create media, ${firstName}`
        : 'Time to create media';
    }

    // Show generic text when not authenticated
    if (!isAuthenticated) {
      switch (mode) {
        case 'ship':
          return 'Time to build';
        case 'proto':
          return 'Time to prototype';
        case 'design':
          return 'Time to design';
        case 'chat':
          return "Let's chat";
        default:
          return 'Time to build';
      }
    }
    
    // Show personalized text when authenticated
    switch (mode) {
      case 'ship':
        return `Time to ship, ${firstName}`;
      case 'proto':
        return `Time to prototype, ${firstName}`;
      case 'design':
        return `Time to design, ${firstName}`;
      case 'chat':
        return `Let's chat, ${firstName}`;
      default:
        return `Time to ship, ${firstName}`;
    }
  };

  const { background } = useBackground();

  return (
    <div className={`flex-1 flex flex-col items-center justify-center min-h-[85vh] w-full px-4 relative z-30 ${background === 'solid' ? '-mt-20' : ''}`}>
      {/* Main Heading */}
      <h1 className={`text-white text-center transition-all duration-300 ${background === 'solid' ? 'text-[26px] font-medium tracking-normal mb-8' : 'text-2xl md:text-3xl font-bold tracking-tight mb-10 drop-shadow-sm'}`}>
        {getHeadingText()}
      </h1>

      {/* Input Component */}
      <InputBar
        currentMode={mode}
        onModeChange={setMode}
        onSubmit={onPromptSubmit}
        modelConfig={modelConfig}
        selectedModelId={selectedModelId}
        setSelectedModelId={setSelectedModelId}
        onAuthRequired={onAuthRequired}
        isAuthenticated={isAuthenticated}
        agentSwarmEnabled={agentSwarmEnabled}
        onSwarmToggle={onSwarmToggle}
        chatVariant={initialMode === 'chat'}
        onStartLive={onStartLive}
      />
    </div>
  );
};