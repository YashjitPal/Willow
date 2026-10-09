import React, { useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { ModelsMenu } from '@willow/ui/models/ModelsMenu';

import { launchMaterialRipple } from './material-ripple';
import { useComposerModels } from './composer/use-composer-models';

export interface MobileModelPickerProps {
  /** Provider settings from user data; shape is provider-defined. */
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  onAuthRequired?: () => void;
  /** Replaces the plain `setSelectedModelId` pick, for a host that does more on a pick (the Code tab writes the provider's model too). */
  onSelect?: (id: string) => void;
  /** Passed through to the menu; the Code tab's Agent tool adds Ultra here. */
  extraEfforts?: React.ComponentProps<typeof ModelsMenu>['extraEfforts'];
}

/**
 * The mobile/tablet top-bar model picker: Gemini's `.logo-pill-btn`, identical at 390
 * and 800px, at x 56, y 20 of whichever positioned box hosts it. The chat surface
 * mounts it in its column; a notebook page mounts it in its top bar, because Gemini's
 * notebook is a chat window and shows the same pill there. Below 961px the composer
 * hides its own model button, so this is the only way to change model on those pages.
 *
 * The styling and the reasons behind it live with `.studio-mobile-model-button` in
 * Sidebar.css. Nothing here reads `isMobileModelsOpen` on purpose — Gemini leaves the
 * button untouched while its menu is open.
 */
export const MobileModelPicker: React.FC<MobileModelPickerProps> = ({
  modelConfig,
  selectedModelId,
  setSelectedModelId,
  onAuthRequired,
  onSelect,
  extraEfforts,
}) => {
  const [isMobileModelsOpen, setIsMobileModelsOpen] = useState(false);
  const mobileModelButtonRef = useRef<HTMLButtonElement>(null);
  const mobileModelRippleHostRef = useRef<HTMLSpanElement>(null);
  const releaseMobileModelRippleRef = useRef<(() => void) | null>(null);
  const releaseMobileModelRipple = () => {
    releaseMobileModelRippleRef.current?.();
    releaseMobileModelRippleRef.current = null;
  };
  const handleMobileModelPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const host = mobileModelRippleHostRef.current;
    if (event.button !== 0 || !host) return;
    releaseMobileModelRipple();
    releaseMobileModelRippleRef.current = launchMaterialRipple(
      host,
      'studio-mobile-model-ripple',
      event.clientX,
      event.clientY,
    );
  };
  const { activeModel, activeEffortDisplayLabel } = useComposerModels({
    modelConfig,
    selectedModelId,
    setSelectedModelId,
  });
  const mobileModelInfo = useMemo(() => {
    if (!activeModel) {
      return { primary: 'Willow', secondary: '' };
    }
    const fullName = activeModel.name || '';
    const effort = activeEffortDisplayLabel;

    // Detect provider prefix (e.g. Gemini, Claude, GPT, Grok, Kimi, GLM, DeepSeek, Mistral, Llama, Qwen, etc.)
    const providerRegex = /^(Gemini|Claude|GPT|OpenAI|Google|Anthropic|DeepSeek|Meta|Mistral|Grok|Kimi|GLM|Llama|Qwen)\b/i;
    const match = fullName.match(providerRegex);
    const provider = match ? match[0] : '';
    const modelWithoutProvider = provider
      ? fullName.slice(provider.length).trim()
      : fullName;

    // Case 1: Thinking active (e.g. "High", "Medium", "Low", "Max")
    // Target format: [Model Without Provider] (White) + [Effort] (Off-white)
    // e.g. "3.8 Flash" (White) + "High" (Off-white)
    // e.g. "Opus 5.5" (White) + "High" (Off-white)
    // e.g. "6 Sol" (White) + "Medium" (Off-white)
    if (effort && effort.toLowerCase() !== 'none') {
      return {
        primary: modelWithoutProvider || fullName,
        secondary: effort,
        effort: true,
      };
    }

    // Case 2: Non-thinking
    // Target format: [Provider] (White) + [Model Without Provider] (Off-white)
    // e.g. "Gemini" (White) + "3.8 Flash" (Off-white)
    // e.g. "Claude" (White) + "Opus 5.5" (Off-white)
    // e.g. "GPT" (White) + "6 Sol" (Off-white)
    if (provider) {
      return {
        primary: provider,
        secondary: modelWithoutProvider,
      };
    }

    // Fallback for models without recognized provider prefix: split first word
    const parts = fullName.split(' ');
    if (parts.length > 1) {
      return {
        primary: parts[0],
        secondary: parts.slice(1).join(' '),
      };
    }

    return {
      primary: fullName,
      secondary: '',
    };
  }, [activeModel, activeEffortDisplayLabel]);

  return (
    <div className="min-[961px]:hidden absolute top-[20px] left-[56px] z-30 flex items-center" style={{ zIndex: 40 }}>
      <button
        ref={mobileModelButtonRef}
        type="button"
        onClick={() => setIsMobileModelsOpen((prev) => !prev)}
        onPointerDown={handleMobileModelPointerDown}
        onPointerUp={releaseMobileModelRipple}
        onPointerLeave={releaseMobileModelRipple}
        onPointerCancel={releaseMobileModelRipple}
        className="studio-mobile-model-button pointer-events-auto"
        aria-label={`Select model, currently ${mobileModelInfo.primary} ${mobileModelInfo.secondary}`.trim()}
        aria-expanded={isMobileModelsOpen}
      >
        <span className="studio-mobile-model-state" />
        <span ref={mobileModelRippleHostRef} className="studio-mobile-model-ripples" />
        <span className="studio-mobile-model-label">
          <span className="studio-mobile-model-primary">{mobileModelInfo.primary}</span>
          {mobileModelInfo.secondary && (
            <span className="studio-mobile-model-secondary">{mobileModelInfo.secondary}</span>
          )}
          <MaterialSymbol
            name="keyboard_arrow_down"
            family="luminous"
            size={20}
            weight={320}
            roundness={100}
            opticalSize={20}
            className="studio-mobile-model-chevron"
          />
        </span>
      </button>
      {isMobileModelsOpen && (
        <ModelsMenu
          triggerRef={mobileModelButtonRef}
          onClose={() => setIsMobileModelsOpen(false)}
          modelConfig={modelConfig}
          selectedId={selectedModelId}
          extraEfforts={extraEfforts}
          onSelect={(id) => {
            if (onSelect) onSelect(id);
            else setSelectedModelId(id);
            setIsMobileModelsOpen(false);
          }}
          onAuthRequired={onAuthRequired}
          geminiStyle
          mobile
          align="left"
        />
      )}
    </div>
  );
};
