import React, { useState } from 'react';
import { InputBar } from './InputBar';
import { useAuth } from '../context/AuthContext';

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
}> = ({ onPromptSubmit, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated, agentSwarmEnabled, onSwarmToggle }) => {
  const { userProfile } = useAuth();
  const [mode, setMode] = useState<Mode>('ship');

  // Get user's first name
  const firstName = userProfile?.displayName?.split(' ')[0] || 'there';

  const getHeadingText = () => {
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

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[85vh] w-full px-4 relative z-30">
      {/* Main Heading */}
      <h1 className="text-2xl md:text-3xl font-bold text-white mb-10 tracking-tight text-center drop-shadow-sm transition-all duration-300">
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
      />
    </div>
  );
};