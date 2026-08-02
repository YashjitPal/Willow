// Testing Indicator Component
// Displays the current test action being performed

import React from 'react';
import { FlaskConical, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { TestStatus } from '@willow/ai/computer-use/test-store';

interface TestingIndicatorProps {
  status: TestStatus;
  currentAction?: string | null;
  isStreaming?: boolean;
}

export const TestingIndicator: React.FC<TestingIndicatorProps> = ({ 
  status, 
  currentAction, 
  isStreaming = false 
}) => {
  const getStatusDisplay = () => {
    switch (status) {
      case 'testing':
        return { text: 'Testing', icon: Loader2, spin: true };
      case 'executing-action':
        return { text: currentAction || 'Executing action', icon: Loader2, spin: true };
      case 'capturing':
        return { text: 'Capturing screenshot', icon: Loader2, spin: true };
      case 'complete':
        return { text: 'Test complete', icon: CheckCircle2, spin: false };
      default:
        return { text: 'Ready to test', icon: FlaskConical, spin: false };
    }
  };

  const { text, icon: Icon, spin } = getStatusDisplay();
  
  // Animation class - only during streaming
  const animClass = isStreaming ? ' animate-textFadeIn' : '';
  
  // Shimmer only when actively testing
  const shouldShimmer = isStreaming && (status === 'testing' || status === 'executing-action' || status === 'capturing');
  const shimmerClass = shouldShimmer ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
  const shimmerStyle = shouldShimmer 
    ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } 
    : { color: '#81888f' };

  return (
    <div className={`flex items-center gap-2.5${animClass}`} style={{ color: '#81888f' }}>
      <div className="flex items-center justify-center w-[18px] h-[18px]">
        <Icon 
          size={18} 
          className={spin ? 'animate-spin' : ''} 
        />
      </div>
      <span className={`text-[15.15px] ${shimmerClass}`} style={shimmerStyle}>
        {text}
      </span>
    </div>
  );
};

interface TestResultIndicatorProps {
  passed: boolean;
  summary: string;
  suggestion?: string;
}

export const TestResultIndicator: React.FC<TestResultIndicatorProps> = ({
  passed,
  summary,
  suggestion
}) => {
  return (
    <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
      <div className="flex items-center gap-2 mb-2">
        {passed ? (
          <CheckCircle2 size={18} className="text-green-400" />
        ) : (
          <XCircle size={18} className="text-red-400" />
        )}
        <span className={`font-medium ${passed ? 'text-green-400' : 'text-red-400'}`}>
          {passed ? 'Test Passed' : 'Test Failed'}
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-2">{summary}</p>
      {suggestion && (
        <div className="mt-3 p-2 rounded bg-blue-500/10 border border-blue-500/20">
          <p className="text-sm text-blue-300">
            <span className="font-medium">Suggestion:</span> {suggestion}
          </p>
        </div>
      )}
    </div>
  );
};

export default TestingIndicator;
