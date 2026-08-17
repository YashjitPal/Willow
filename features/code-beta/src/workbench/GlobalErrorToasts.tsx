import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

/**
 * A single build/runtime error surfaced to the user.
 *
 * `isClosing` drives the exit animation and is set before the entry is dropped,
 * so the toast can finish animating out before it unmounts.
 */
export interface GlobalError {
  id: string;
  message: string;
  isClosing: boolean;
  action?: 'set-api-key';
}

interface GlobalErrorToastsProps {
  globalErrors: GlobalError[];
  dismissGlobalError: (id: string) => void;
  onSettingsClick?: (tab?: string) => void;
}

/**
 * The error toast stack, portalled to document.body.
 *
 * It has to escape the sidebar to avoid inheriting its stacking context. The
 * keyframes ship with the toasts rather than living in a global stylesheet so
 * the animation cannot go missing when this renders outside the sidebar tree.
 *
 * The last remaining toast fades out in place; the others collapse their grid
 * row so the stack above them slides down instead of snapping.
 */
export const GlobalErrorToasts: React.FC<GlobalErrorToastsProps> = ({
  globalErrors,
  dismissGlobalError,
  onSettingsClick,
}) => {
  if (globalErrors.length === 0) return null;

  return createPortal(
    <>
      <style>{`
            @keyframes errorSlideDown {
              from { opacity: 0; transform: translateY(-12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes errorFadeOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
          `}</style>
      <div className="fixed top-20 bottom-4 right-6 z-50 flex flex-col overflow-y-auto no-scrollbar">
        {globalErrors.map((err) => {
          const isLastOne = globalErrors.length === 1;
          return isLastOne && err.isClosing ? (
            <div
              key={err.id}
              className="flex items-center gap-4 px-4 py-5 bg-[#18181b]/80 backdrop-blur-md border border-white/10 rounded-xl"
              style={{ animation: 'errorFadeOut 0.2s ease-out forwards' }}
            >
              <div className="flex-shrink-0">
                <AlertTriangle className="text-red-400" size={20} />
              </div>
              <div className="flex-1 min-w-[200px] max-w-[400px]">
                <p className="text-sm font-medium text-gray-200 leading-snug">
                  {err.message}
                </p>
              </div>
              {err.action === 'set-api-key' ? (
                <button 
                  className="flex-shrink-0 text-red-400 text-sm font-medium"
                >
                  Set
                </button>
              ) : (
                <button 
                  className="flex-shrink-0 text-red-400 text-sm font-medium"
                >
                  Dismiss
                </button>
              )}
            </div>
          ) : (
            <div
              key={err.id}
              className="grid transition-[grid-template-rows] duration-[250ms] ease-in-out"
              style={{ gridTemplateRows: err.isClosing ? '0fr' : '1fr' }}
            >
              <div className="overflow-hidden">
                <div className="pb-3">
                  <div 
                    className="flex items-center gap-4 px-4 py-5 bg-[#18181b]/80 backdrop-blur-md border border-white/10 rounded-xl transition-opacity duration-[250ms] ease-out"
                    style={{
                      animation: !err.isClosing ? 'errorSlideDown 0.25s ease-out forwards' : undefined,
                      opacity: err.isClosing ? 0 : undefined
                    }}
                  >
                    <div className="flex-shrink-0">
                      <AlertTriangle className="text-red-400" size={20} />
                    </div>
                    <div className="flex-1 min-w-[200px] max-w-[400px]">
                      <p className="text-sm font-medium text-gray-200 leading-snug">
                        {err.message}
                      </p>
                    </div>
                    {err.action === 'set-api-key' ? (
                      <button 
                        onClick={() => {
                          dismissGlobalError(err.id);
                          onSettingsClick?.('models');
                        }}
                        className="flex-shrink-0 text-red-400 hover:text-red-300 text-sm font-medium transition-colors cursor-pointer"
                      >
                        Set
                      </button>
                    ) : (
                      <button 
                        onClick={() => dismissGlobalError(err.id)}
                        className="flex-shrink-0 text-red-400 hover:text-red-300 text-sm font-medium transition-colors cursor-pointer"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>,
    document.body
  );
};
