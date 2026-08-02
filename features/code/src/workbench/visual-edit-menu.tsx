// The visual-edit inspector panel: the surface that replaces the chat sidebar
// while the user is picking elements in the preview and nudging their styles.
//
// Split out of WorkbenchSidebar.tsx, which was doing too much at once. Everything
// here is driven by the visual-editing engine's nanostores rather than props, so
// the only contract with the sidebar is `onBack` plus the compact-width flag.
// `VisualEditLoader` and `DynamicStylingWarning` are its two private sub-views,
// and the *_OPTIONS arrays back the style dropdowns.
import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Check,
  Copy,
  X,
  Maximize2,
  CodeXml,
  CornerUpLeft,
  Palette,
  Scan,
  AlignVerticalSpaceAround,
  AlignHorizontalSpaceAround,
} from 'lucide-react';
import { useStore } from '@nanostores/react';
import {
  inspectorReady,
  isScanning,
  isSaving,
  isVisualEditing,
  selectedElement,
  selectedElements,
  type SelectedElement,
  visualEditQueue,
  canUndo,
  undoLastVisualEdit,
  selectParentElement,
  applyDirectStyle,
  getCurrentStyles,
  getFreshComputedStyles,
  formatColorForDisplay,
  isTransparent,
  tailwindColorToCss,
  TAILWIND_SPACING,
  requestSelectionBoundsRefresh,
  selectionStyleRefreshRequest,
} from '../visual-editing/engine/index';
import { ColorPickerMenu } from '@willow/design/ColorPickerMenu';
import { VisualEditorSelectMenu } from '../visual-editing/VisualEditorSelectMenu';
import { sandpackStore } from '../runtime/sandpack/sandpack-store';
import {
  VisualEditsIcon,
  MarginLeftIcon,
  MarginRightIcon,
  MarginTopIcon,
  MarginBottomIcon,
  PaddingHorizontalIcon,
  PaddingVerticalIcon,
  PaddingLeftIcon,
  PaddingRightIcon,
  PaddingTopIcon,
  PaddingBottomIcon,
} from './sidebar-icons';

const VisualEditLoader = ({ 
  title = "Starting live preview...", 
  subtitle = "Hang on while we get everything set up" 
}: { 
  title?: string; 
  subtitle?: string; 
}) => (
  <div className="flex flex-col items-center justify-center">
    <div className="relative w-5 h-5 flex items-center justify-center mb-6">
      <div className="absolute w-full h-full rounded-full border-2 border-white opacity-0 animate-ripple ring-wait" />
      <div className="absolute w-full h-full rounded-full border-2 border-white opacity-0 animate-ripple" />
    </div>
    <div className="text-center space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
      <h3 className="text-white font-medium text-lg">{title}</h3>
      <p className="text-[#81888f] text-sm">{subtitle}</p>
    </div>
    <style>{`
      @keyframes ripple {
        0% {
          transform: scale(0);
          opacity: 1;
          border-width: 5px;
        }
        100% {
          transform: scale(1.5);
          opacity: 0;
          border-width: 0px;
        }
      }
      .animate-ripple {
        animation: ripple 2s cubic-bezier(0, 0.2, 0.8, 1) infinite;
      }
      .ring-wait {
        animation-delay: -1s;
      }
    `}</style>
  </div>
);

// Warning shown for elements with dynamic/inline styles (Centered UI)
const DynamicStylingWarning = () => (
  <div className="relative flex flex-col items-center">
    <div className="mb-6">
       <CodeXml size={20} className="text-white" strokeWidth={1.5} />
    </div>
    
    <h2 className="text-lg font-semibold text-white mb-2">Element with dynamic styling</h2>
    
    <p className="text-[#81888f] leading-relaxed mb-0 max-w-[280px] text-center">
      This element has dynamic styling that can't be edited directly. Ask Lovable AI to modify it, or reset to static classes.
    </p>
    
    <div className="absolute top-full pt-4">
      <button className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-md text-[13px] font-medium transition-colors">
        Reset styling
      </button>
    </div>
  </div>
);



const OPACITY_OPTIONS = Array.from({ length: 11 }, (_, i) => `${(10 - i) * 10}%`); // 100% down to 0%
const BORDER_RADIUS_OPTIONS = ['None', 'Small', 'Default', 'Medium', 'Large', 'Extra Large', '2XL', '3XL', 'Full'];
const SHADOW_OPTIONS = ['None', 'Small', 'Default', 'Medium', 'Large', 'Extra Large', '2XL', 'Inner shadow'];
const FONT_SIZE_OPTIONS = ['Extra Small', 'Small', 'Base', 'Large', 'Extra Large', '2XL', '3XL', '4XL', '5XL'];
const FONT_WEIGHT_OPTIONS = ['Thin', 'Extra Light', 'Light', 'Normal', 'Medium', 'Semibold', 'Bold', 'Extra Bold', 'Black'];
const TEXT_ALIGN_OPTIONS = ['Left', 'Center', 'Right', 'Justify'];
const BORDER_WIDTH_OPTIONS = ['None', '1px', '2px', '4px', '8px'];
const BORDER_STYLE_OPTIONS = ['Solid', 'Dashed', 'Dotted', 'Double', 'None'];

const VisualEditMenu = ({ onBack, isCompact = false }: { onBack: () => void; isCompact?: boolean }) => {
  const isReady = useStore(inspectorReady);
  const scanning = useStore(isScanning);
  const saving = useStore(isSaving);
  const files = useStore(sandpackStore.files);
  const selection = useStore(selectedElement);
  const selectedEls = useStore(selectedElements);
  const isEditing = useStore(isVisualEditing); // Track visual edit state
  const editQueue = useStore(visualEditQueue); // Track visual edit queue
  const hasUndo = useStore(canUndo); // Track undo history availability
  const styleRefresh = useStore(selectionStyleRefreshRequest); // Track undo/discard style refresh
  const [expandMargin, setExpandMargin] = useState(false);
  const [expandPadding, setExpandPadding] = useState(false);
  const [activeColorMenu, setActiveColorMenu] = useState<'text' | 'bg' | 'border' | null>(null);
  const [activeEffectMenu, setActiveEffectMenu] = useState<'opacity' | 'radius' | 'shadow' | null>(null);
  const [activeTypographyMenu, setActiveTypographyMenu] = useState<'fontSize' | 'fontWeight' | 'textAlign' | null>(null);
  const [activeBorderMenu, setActiveBorderMenu] = useState<'borderWidth' | 'borderStyle' | null>(null);
  const textInheritRef = useRef<HTMLDivElement>(null);
  const bgInheritRef = useRef<HTMLDivElement>(null);
  const borderColorRef = useRef<HTMLDivElement>(null);
  const opacityRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const borderRadiusRef = useRef<HTMLDivElement>(null);
  const fontSizeRef = useRef<HTMLDivElement>(null);
  const fontWeightRef = useRef<HTMLDivElement>(null);
  const textAlignRef = useRef<HTMLDivElement>(null);
  const borderWidthRef = useRef<HTMLDivElement>(null);
  const borderStyleRef = useRef<HTMLDivElement>(null);

  // Spacing input values - derived from selection's computed/class styles
  const [marginX, setMarginX] = useState('0');
  const [marginY, setMarginY] = useState('0');
  const [marginTop, setMarginTop] = useState('0');
  const [marginRight, setMarginRight] = useState('0');
  const [marginBottom, setMarginBottom] = useState('0');
  const [marginLeft, setMarginLeft] = useState('0');
  const [paddingX, setPaddingX] = useState('0');
  const [paddingY, setPaddingY] = useState('0');
  const [paddingTop, setPaddingTop] = useState('0');
  const [paddingRight, setPaddingRight] = useState('0');
  const [paddingBottom, setPaddingBottom] = useState('0');
  const [paddingLeft, setPaddingLeft] = useState('0');

  // Current style values for display
  const [currentStyles, setCurrentStyles] = useState<Record<string, string>>({});

  // Helper to check if a string contains only emojis (and whitespace)
  // Emojis include: emoticons, symbols, dingbats, and extended pictographics
  const isEmojiOnly = (text: string): boolean => {
    // Remove all emoji characters and whitespace, check if anything remains
    // This regex matches most common emoji ranges including:
    // - Emoticons (1F600-1F64F)
    // - Misc Symbols & Pictographs (1F300-1F5FF)
    // - Transport & Map Symbols (1F680-1F6FF)
    // - Supplemental Symbols (1F900-1F9FF)
    // - Symbols & Pictographs Extended-A (1FA00-1FAFF)
    // - Regional Indicators (1F1E0-1F1FF)
    // - Various common symbols (2600-26FF, 2700-27BF)
    // - Variation selectors and ZWJ sequences
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
    const withoutEmojis = text.replace(emojiRegex, '').trim();
    return withoutEmojis.length === 0 && text.trim().length > 0;
  };

  // Determine if the selected element has text content (for showing/hiding text-related options)
  // Excludes emoji-only content since emojis don't benefit from text styling
  // TODO: To properly check for DIRECT text nodes only (not descendant text), we need to add
  // a `hasDirectText` property to SelectedElement computed in the iframe
  const NON_TEXT_TAGS = ['img', 'svg', 'hr', 'br', 'video', 'audio', 'iframe', 'canvas'];
  const hasText = selection && (
    !NON_TEXT_TAGS.includes(selection.tagName) &&
    selection.textContent.trim().length > 0 &&
    !isEmojiOnly(selection.textContent)
  );

  // Elements that don't meaningfully support box styling (void elements)
  const VOID_ELEMENTS = ['br', 'hr', 'wbr', 'col', 'embed', 'source', 'track'];
  // Inline text elements where border/effects don't make visual sense
  const INLINE_TEXT_ELEMENTS = ['span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'sub', 'sup', 'code', 'kbd', 'samp', 'var', 'cite', 'q', 'abbr', 'time', 'dfn', 'label'];

  // Check if element supports box model styling
  const hasBoxModel = selection && !VOID_ELEMENTS.includes(selection.tagName);

  // Check if the element can have border/effects
  // Hide for void elements AND inline text elements (they don't benefit visually)
  const isInlineText = selection && INLINE_TEXT_ELEMENTS.includes(selection.tagName);
  const canHaveBorder = hasBoxModel && !isInlineText;
  const canHaveEffects = hasBoxModel && !isInlineText;

  // Track the UID of the last selected element to avoid overwriting user input
  const lastSelectedUidRef = useRef<string | null>(null);
  // Track the last style refresh to detect undo/discard changes
  const lastStyleRefreshRef = useRef<number>(0);

  // Update current styles when selection changes - but only sync spacing when element changes
  useEffect(() => {
    if (selection) {
      const styles = getCurrentStyles(selection);

      // On style refresh (undo/discard), re-derive computed color values from the
      // Tailwind class names (already read from source by getCurrentStyles above).
      // We can't use getFreshComputedStyles here because the iframe is mid-HMR reload.
      const isStyleRefresh = styleRefresh !== lastStyleRefreshRef.current;
      if (isStyleRefresh) {
        lastStyleRefreshRef.current = styleRefresh;
        // Derive _computedBgColor from bgColor class name
        if (styles.bgColor) {
          const cssColor = tailwindColorToCss(styles.bgColor);
          if (cssColor) styles._computedBgColor = cssColor;
        } else {
          styles._computedBgColor = 'rgba(0, 0, 0, 0)';
        }
        // Derive _computedColor from textColor class name
        if (styles.textColor) {
          const cssColor = tailwindColorToCss(styles.textColor);
          if (cssColor) styles._computedColor = cssColor;
        }
      }

      setCurrentStyles(styles);

      // Update spacing inputs when a DIFFERENT element is selected OR when a style refresh
      // is triggered (undo/discard). This prevents overwriting user input during preview
      // refresh, but ensures spacing values are re-synced after undo/discard.
      const currentUid = selection.uid;

      if (lastSelectedUidRef.current !== currentUid || isStyleRefresh) {
        lastSelectedUidRef.current = currentUid;

        // Convert Tailwind spacing keys to pixel values for display
        // If the value is a Tailwind key like "4", convert to pixel "16"
        // If it's already a pixel value like "[14px]", extract just the number
        const toPx = (val: string | undefined): string => {
          if (!val) return '0';
          // Handle arbitrary value syntax like "[14px]"
          if (val.startsWith('[') && val.endsWith(']')) {
            return val.slice(1, -1).replace('px', '');
          }
          // Check if it's a Tailwind key
          const px = TAILWIND_SPACING[val];
          return px || val;
        };

        // Parse computed CSS margin/padding values (e.g., "16px" or "16px 8px 16px 8px")
        // Returns [top, right, bottom, left] as strings
        const parseComputedSpacing = (computed: string | undefined): [string, string, string, string] => {
          if (!computed) return ['0', '0', '0', '0'];
          const parts = computed.split(' ').map(p => p.replace('px', '').trim());
          if (parts.length === 1) {
            return [parts[0], parts[0], parts[0], parts[0]];
          } else if (parts.length === 2) {
            return [parts[0], parts[1], parts[0], parts[1]];
          } else if (parts.length === 3) {
            return [parts[0], parts[1], parts[2], parts[1]];
          } else if (parts.length >= 4) {
            return [parts[0], parts[1], parts[2], parts[3]];
          }
          return ['0', '0', '0', '0'];
        };

        // Get computed margins as fallback
        const [computedMarginTop, computedMarginRight, computedMarginBottom, computedMarginLeft] = parseComputedSpacing(styles._computedMargin);
        const [computedPaddingTop, computedPaddingRight, computedPaddingBottom, computedPaddingLeft] = parseComputedSpacing(styles._computedPadding);

        // Update margin inputs - use Tailwind class values if available, else computed values
        setMarginX(toPx(styles.marginX) || computedMarginLeft);
        setMarginY(toPx(styles.marginY) || computedMarginTop);
        setMarginTop(toPx(styles.marginTop) || computedMarginTop);
        setMarginRight(toPx(styles.marginRight) || computedMarginRight);
        setMarginBottom(toPx(styles.marginBottom) || computedMarginBottom);
        setMarginLeft(toPx(styles.marginLeft) || computedMarginLeft);

        // Update padding inputs - use Tailwind class values if available, else computed values
        setPaddingX(toPx(styles.paddingX) || computedPaddingLeft);
        setPaddingY(toPx(styles.paddingY) || computedPaddingTop);
        setPaddingTop(toPx(styles.paddingTop) || computedPaddingTop);
        setPaddingRight(toPx(styles.paddingRight) || computedPaddingRight);
        setPaddingBottom(toPx(styles.paddingBottom) || computedPaddingBottom);
        setPaddingLeft(toPx(styles.paddingLeft) || computedPaddingLeft);
      }
    } else {
      // Reset tracking when no selection
      lastSelectedUidRef.current = null;
    }
  }, [selection, styleRefresh]);

  // Text-related style types that should be applied to the text source element
  const TEXT_STYLE_TYPES = ['textColor', 'fontSize', 'fontWeight', 'fontFamily', 'textAlign', 'lineHeight', 'letterSpacing'];

  // Helper to apply a style change
  const handleStyleChange = async (type: string, value: string) => {
    if (!selection) {
      return;
    }

    // For text-related styles, use textSourceElement if available
    const isTextStyle = TEXT_STYLE_TYPES.includes(type);
    const targetElement = isTextStyle && selection.textSourceElement
      ? {
          ...selection,
          uid: selection.textSourceElement.uid,
          tagName: selection.textSourceElement.tagName,
          classNames: selection.textSourceElement.classNames,
          sourceLocation: selection.textSourceElement.sourceLocation
        }
      : selection;

    if (!targetElement.sourceLocation) {
      return;
    }
    try {
      const result = await applyDirectStyle(targetElement, { type: type as any, value });
      if (result.success) {
        // IMMEDIATELY update the state with the value we just set
        // Don't wait for file re-read - we already know the value
        const updates: Record<string, string> = { [type]: value };

        // Also update computed color preview for color types
        if (type === 'textColor') {
          const cssColor = tailwindColorToCss(value);
          if (cssColor) {
            updates._computedColor = cssColor;
          }
        } else if (type === 'bgColor') {
          const cssColor = tailwindColorToCss(value);
          if (cssColor) {
            updates._computedBgColor = cssColor;
          }
        } else if (type === 'borderColor') {
          const cssColor = tailwindColorToCss(value);
          if (cssColor) {
            updates._computedBorderColor = cssColor;
          }
        }

        setCurrentStyles(prev => ({
          ...prev,
          ...updates
        }));
        // Note: Spacing input state is already set by handleSpacingChange before calling this function,
        // so we don't update it again here to avoid overwriting user's typed input

        // Trigger selection bounds refresh after a small delay to let the preview re-layout
        // This makes the selection overlay follow the element when margin/padding shifts it
        setTimeout(() => {
          requestSelectionBoundsRefresh();
        }, 50);
      }
    } catch (error) {
      // Style application failed silently
    }
  };

  // Ordered pixel values for stepping (corresponding to Tailwind spacing scale)
  const SPACING_STEPS = ['0', '2', '4', '6', '8', '10', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '56', '64', '80', '96'];

  // Convert Tailwind spacing key to display value (px) - kept for backward compatibility
  const spacingToDisplay = (key: string): string => {
    if (!key || key === '0') return '0';
    const px = TAILWIND_SPACING[key];
    return px || key;
  };

  // Step spacing up/down through pixel values
  const stepSpacing = (type: string, currentValue: string, direction: 1 | -1, setter: (v: string) => void) => {
    const currentPx = parseInt(currentValue, 10) || 0;
    
    // Find the nearest step
    let currentIndex = SPACING_STEPS.findIndex(s => parseInt(s, 10) >= currentPx);
    if (currentIndex === -1) currentIndex = SPACING_STEPS.length - 1;
    
    // If current value is exactly a step, use that index; otherwise we're between steps
    if (SPACING_STEPS[currentIndex] !== currentValue && direction === -1 && currentIndex > 0) {
      // Going down from a non-standard value: go to the step below
      currentIndex = currentIndex;
    }
    
    let newIndex = Math.max(0, Math.min(SPACING_STEPS.length - 1, currentIndex + direction));
    const newValue = SPACING_STEPS[newIndex];
    setter(newValue);
    handleStyleChange(type, newValue);
  };


  // Spacing change handler for manual text input - NO DEBOUNCE for immediate feedback
  const handleSpacingChange = (type: string, value: string, setter: (v: string) => void) => {
    setter(value);
    // Apply immediately like color changes
    handleStyleChange(type, value);
  };

  // Normalize empty spacing inputs to "0" on blur
  const handleSpacingBlur = (value: string, setter: (v: string) => void, type: string) => {
    if (value.trim() === '') {
      setter('0');
      handleStyleChange(type, '0');
    }
  };

  // Toggle margin expand with value synchronization
  // When expanding: Copy X to Left/Right, Y to Top/Bottom
  // When collapsing: Copy Left to X, Top to Y (consistent with which inputs are visible first)
  const toggleExpandMargin = () => {
    if (!expandMargin) {
      // Expanding: 2-option → 4-option
      // Copy X (horizontal) to Left and Right
      setMarginLeft(marginX);
      setMarginRight(marginX);
      // Copy Y (vertical) to Top and Bottom
      setMarginTop(marginY);
      setMarginBottom(marginY);
    } else {
      // Collapsing: 4-option → 2-option
      // Use Left for X (it's the first horizontal input shown)
      setMarginX(marginLeft);
      // Use Top for Y (it's the first vertical input shown)
      setMarginY(marginTop);
    }
    setExpandMargin(!expandMargin);
  };

  // Toggle padding expand with value synchronization
  const toggleExpandPadding = () => {
    if (!expandPadding) {
      // Expanding: 2-option → 4-option
      setPaddingLeft(paddingX);
      setPaddingRight(paddingX);
      setPaddingTop(paddingY);
      setPaddingBottom(paddingY);
    } else {
      // Collapsing: 4-option → 2-option
      setPaddingX(paddingLeft);
      setPaddingY(paddingTop);
    }
    setExpandPadding(!expandPadding);
  };

  // Track if user has ever selected something in this visual edit session
  // This persists even after selection is cleared (when prompt is submitted)
  const [hasEverSelected, setHasEverSelected] = useState(false);

  // Update hasEverSelected when selection changes
  useEffect(() => {
    if (selection) {
      setHasEverSelected(true);
    }
  }, [selection]);

  const handleBack = () => {
     onBack();
  };

  // Check if there's an actual app in the codebase (files beyond just initial empty state)
  const hasApp = Object.keys(files).length > 0;

  // Minimum loader display time so the entrance animation always plays fully
  const [minLoaderActive, setMinLoaderActive] = useState(true);
  useEffect(() => {
    // Reset minimum loader on each mount (re-entering visual edit)
    setMinLoaderActive(true);
    const timer = setTimeout(() => setMinLoaderActive(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Show loading during scan or init or saving, with minimum display time
  const showLoading = scanning || !isReady || !hasApp || saving || minLoaderActive;

  // Handle undo button click
  const handleUndo = () => {
    undoLastVisualEdit();
  };

  // Handle select parent button click
  const handleSelectParent = () => {
    selectParentElement();
  };

  // Show buttons if user has ever selected something (not just current selection)
  const showButtons = hasEverSelected;

  return (
    // Add top padding of 40px to account for the persistent Design Header
    // Use z-30 to sit above header background but below header text
    <div className="flex flex-col bg-[#1c1c1c] absolute inset-x-0 bottom-0 top-14 z-30 pt-[40px] animate-in fade-in zoom-in-95 duration-200">
      
      {showLoading ? (
         <div className="flex-1 flex flex-col items-center justify-center -mt-72">
            {saving ? (
              <VisualEditLoader 
                title="Saving edits..." 
                subtitle="Hang tight while we save your changes" 
              />
            ) : (
              <VisualEditLoader />
            )}
         </div>
      ) : isEditing ? (
             <div className="flex-1 flex flex-col relative select-none">
                 {/* New Ripple Indicator - Positioned absolutely at top, independent of content center */}
                 {/* Positioned at top-14px to sit closer to header text, with z-40 to float above opaque header background */}
                 <div className="absolute top-[14px] inset-x-0 flex justify-center z-40">
                 <div className="flex items-center gap-3 px-4 py-2 bg-[#27272a]/50 rounded-full backdrop-blur-sm">
                    <div className="relative w-4 h-4 flex items-center justify-center">
                        <div className="absolute w-full h-full rounded-full border-[1.5px] border-white opacity-0 animate-ripple ring-wait" />
                        <div className="absolute w-full h-full rounded-full border-[1.5px] border-white opacity-0 animate-ripple" />
                    </div>
                    <span className="text-sm text-gray-200 font-medium tracking-wide">AI is working...</span>
                 </div>
             </div>

             {/* Centered Content - Matches "Visual edits" empty state exact position (-mt-72) */}
             <div className="flex-1 flex flex-col items-center justify-center -mt-72">
                 <div className="mb-6 relative">
                     <VisualEditsIcon size={20} className="text-white" />
                 </div>
                 <h2 className="text-white text-xl font-medium mb-3">Agent is working</h2>
                 <p className="text-[#81888f] max-w-[280px] leading-relaxed text-center text-sm">
                     You can still select elements and queue visual edit requests using the floating panel in the preview
                 </p>
             </div>
             
             {/* Ensure ripple styles are available specifically for this view if not global */}
             <style>{`
              @keyframes ripple {
                0% { transform: scale(0); opacity: 1; border-width: 1.5px; }
                100% { transform: scale(1.5); opacity: 0; border-width: 0px; }
              }
              .animate-ripple { animation: ripple 2s cubic-bezier(0, 0.2, 0.8, 1) infinite; }
              .ring-wait { animation-delay: -1s; }
             `}</style>
         </div>
      ) : selection ? (
        selection.hasDynamicStyles ? (
            <div className="flex-1 flex flex-col items-center justify-center -mt-72 select-none">
                <DynamicStylingWarning />
            </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 no-scrollbar pb-64">
             <div className="p-6 space-y-8">
                
                {/* Colors Section */}
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Colors</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                      {hasText && (
                      <div className="space-y-1.5 relative">
                         <label className="text-[13px] text-gray-400">Text color</label>
                         <div
                           tabIndex={0}
                           ref={textInheritRef}
                           onClick={() => setActiveColorMenu(activeColorMenu === 'text' ? null : 'text')}
                           className={`flex items-center gap-2 p-2 bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors ${activeColorMenu === 'text' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                         >
                             <div
                               className="w-5 h-5 rounded-full border border-white/10 relative overflow-hidden flex-shrink-0"
                               style={{
                                 backgroundColor: currentStyles.textColor ? currentStyles._computedColor || '#ffffff' : 'transparent',
                                 backgroundImage: !currentStyles.textColor
                                   ? 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)'
                                   : 'none',
                                 backgroundSize: '8px 8px',
                                 backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                               }}
                             />
                             <span className="text-white text-[13px] truncate">{formatColorForDisplay(currentStyles.textColor)}</span>
                         </div>
                         <ColorPickerMenu
                            isOpen={activeColorMenu === 'text'}
                            onClose={() => setActiveColorMenu(null)}
                            triggerRef={textInheritRef}
                            currentColor={currentStyles._computedColor}
                            onSelect={(color) => {
                                handleStyleChange('textColor', color);
                                setActiveColorMenu(null);
                            }}
                         />
                      </div>
                      )}
                      <div className="space-y-1.5 relative">
                         <label className="text-[13px] text-gray-400">Background color</label>
                         <div
                           tabIndex={0}
                           ref={bgInheritRef}
                           onClick={() => setActiveColorMenu(activeColorMenu === 'bg' ? null : 'bg')}
                           className={`flex items-center gap-2 p-2 bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors ${activeColorMenu === 'bg' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                         >
                             <div
                               className="w-5 h-5 rounded-full border border-white/10 relative overflow-hidden flex-shrink-0"
                               style={{
                                 backgroundColor: (!currentStyles.bgColor || isTransparent(currentStyles._computedBgColor)) ? 'transparent' : currentStyles._computedBgColor,
                                 backgroundImage: (!currentStyles.bgColor || isTransparent(currentStyles._computedBgColor))
                                   ? 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)'
                                   : 'none',
                                 backgroundSize: '8px 8px',
                                 backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                               }}
                             />
                             <span className="text-white text-[13px] truncate">
                               {currentStyles.bgColor === 'transparent'
                                 ? 'Transparent'
                                 : formatColorForDisplay(currentStyles.bgColor)}
                             </span>
                         </div>
                         <ColorPickerMenu
                            isOpen={activeColorMenu === 'bg'}
                            onClose={() => setActiveColorMenu(null)}
                            triggerRef={bgInheritRef}
                            currentColor={currentStyles._computedBgColor}
                            onSelect={(color) => {
                                handleStyleChange('bgColor', color);
                                setActiveColorMenu(null);
                            }}
                         />
                      </div>
                   </div>

                </div>

                {/* Spacing Section */}
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Spacing</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                      {/* Margin */}
                      <div className="space-y-1.5">
                         <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[13px] text-gray-400">Margin</label>
                         </div>
                         <div className="space-y-2">
                             <div className="grid grid-cols-[1fr_1fr_32px] gap-3">
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandMargin ? 'marginLeft' : 'marginX', expandMargin ? marginLeft : marginX, 1, expandMargin ? setMarginLeft : setMarginX)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandMargin ? <MarginLeftIcon size={14} /> : <AlignHorizontalSpaceAround size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandMargin ? marginLeft : marginX}
                                       onChange={(e) => handleSpacingChange(expandMargin ? 'marginLeft' : 'marginX', e.target.value, expandMargin ? setMarginLeft : setMarginX)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandMargin ? setMarginLeft : setMarginX, expandMargin ? 'marginLeft' : 'marginX')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandMargin ? 'marginTop' : 'marginY', expandMargin ? marginTop : marginY, 1, expandMargin ? setMarginTop : setMarginY)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandMargin ? <MarginTopIcon size={14} /> : <AlignVerticalSpaceAround size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandMargin ? marginTop : marginY}
                                       onChange={(e) => handleSpacingChange(expandMargin ? 'marginTop' : 'marginY', e.target.value, expandMargin ? setMarginTop : setMarginY)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandMargin ? setMarginTop : setMarginY, expandMargin ? 'marginTop' : 'marginY')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <button
                                    onClick={toggleExpandMargin}
                                    className={`w-8 h-8 flex items-center justify-center transition-colors rounded-md ${expandMargin ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                 >
                                    <Maximize2 size={14} />
                                 </button>
                             </div>

                             {/* Expanded Margin Inputs */}
                             <div className={`overflow-hidden transition-all duration-300 ease-out grid grid-cols-[1fr_1fr_32px] gap-3 ${expandMargin ? 'max-h-[40px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('marginRight', marginRight, 1, setMarginRight)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <MarginRightIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={marginRight}
                                       onChange={(e) => handleSpacingChange('marginRight', e.target.value, setMarginRight)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setMarginRight, 'marginRight')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('marginBottom', marginBottom, 1, setMarginBottom)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <MarginBottomIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={marginBottom}
                                       onChange={(e) => handleSpacingChange('marginBottom', e.target.value, setMarginBottom)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setMarginBottom, 'marginBottom')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div /> {/* Spacer to align with button above */}
                             </div>
                         </div>
                      </div>

                      {/* Padding */}
                      <div className="space-y-1.5">
                         <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[13px] text-gray-400">Padding</label>
                         </div>
                         <div className="space-y-2">
                             <div className="grid grid-cols-[1fr_1fr_32px] gap-3">
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandPadding ? 'paddingLeft' : 'paddingX', expandPadding ? paddingLeft : paddingX, 1, expandPadding ? setPaddingLeft : setPaddingX)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandPadding ? <PaddingLeftIcon size={14} /> : <PaddingHorizontalIcon size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandPadding ? paddingLeft : paddingX}
                                       onChange={(e) => handleSpacingChange(expandPadding ? 'paddingLeft' : 'paddingX', e.target.value, expandPadding ? setPaddingLeft : setPaddingX)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandPadding ? setPaddingLeft : setPaddingX, expandPadding ? 'paddingLeft' : 'paddingX')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandPadding ? 'paddingTop' : 'paddingY', expandPadding ? paddingTop : paddingY, 1, expandPadding ? setPaddingTop : setPaddingY)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandPadding ? <PaddingTopIcon size={14} /> : <PaddingVerticalIcon size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandPadding ? paddingTop : paddingY}
                                       onChange={(e) => handleSpacingChange(expandPadding ? 'paddingTop' : 'paddingY', e.target.value, expandPadding ? setPaddingTop : setPaddingY)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandPadding ? setPaddingTop : setPaddingY, expandPadding ? 'paddingTop' : 'paddingY')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <button
                                    onClick={toggleExpandPadding}
                                    className={`w-8 h-8 flex items-center justify-center transition-colors rounded-md ${expandPadding ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                 >
                                    <Maximize2 size={14} />
                                 </button>
                             </div>

                             {/* Expanded Padding Inputs */}
                             <div className={`overflow-hidden transition-all duration-300 ease-out grid grid-cols-[1fr_1fr_32px] gap-3 ${expandPadding ? 'max-h-[40px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('paddingRight', paddingRight, 1, setPaddingRight)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <PaddingRightIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={paddingRight}
                                       onChange={(e) => handleSpacingChange('paddingRight', e.target.value, setPaddingRight)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setPaddingRight, 'paddingRight')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('paddingBottom', paddingBottom, 1, setPaddingBottom)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <PaddingBottomIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={paddingBottom}
                                       onChange={(e) => handleSpacingChange('paddingBottom', e.target.value, setPaddingBottom)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setPaddingBottom, 'paddingBottom')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div /> {/* Spacer */}
                             </div>
                         </div>
                      </div>
                   </div>
                </div>

                {/* Typography Section - only shown for elements with text */}
                {hasText && (
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Typography</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Font size</label>
                           <div
                                tabIndex={0}
                                ref={fontSizeRef}
                                onClick={() => setActiveTypographyMenu(activeTypographyMenu === 'fontSize' ? null : 'fontSize')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeTypographyMenu === 'fontSize' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.fontSize || 'Select size'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeTypographyMenu === 'fontSize'}
                                onClose={() => setActiveTypographyMenu(null)}
                                triggerRef={fontSizeRef}
                                options={FONT_SIZE_OPTIONS}
                                selected={currentStyles.fontSize}
                                onSelect={(val) => {
                                    handleStyleChange('fontSize', val);
                                    setActiveTypographyMenu(null);
                                }}
                                label="Select font size"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Font weight</label>
                           <div
                                tabIndex={0}
                                ref={fontWeightRef}
                                onClick={() => setActiveTypographyMenu(activeTypographyMenu === 'fontWeight' ? null : 'fontWeight')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeTypographyMenu === 'fontWeight' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.fontWeight || 'Select weight'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeTypographyMenu === 'fontWeight'}
                                onClose={() => setActiveTypographyMenu(null)}
                                triggerRef={fontWeightRef}
                                options={FONT_WEIGHT_OPTIONS}
                                selected={currentStyles.fontWeight}
                                onSelect={(val) => {
                                    handleStyleChange('fontWeight', val);
                                    setActiveTypographyMenu(null);
                                }}
                                label="Select font weight"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Text align</label>
                           <div
                                tabIndex={0}
                                ref={textAlignRef}
                                onClick={() => setActiveTypographyMenu(activeTypographyMenu === 'textAlign' ? null : 'textAlign')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeTypographyMenu === 'textAlign' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.textAlign || 'Select align'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeTypographyMenu === 'textAlign'}
                                onClose={() => setActiveTypographyMenu(null)}
                                triggerRef={textAlignRef}
                                options={TEXT_ALIGN_OPTIONS}
                                selected={currentStyles.textAlign}
                                onSelect={(val) => {
                                    handleStyleChange('textAlign', val);
                                    setActiveTypographyMenu(null);
                                }}
                                label="Select alignment"
                                width={160}
                           />
                       </div>
                   </div>
                </div>
                )}

                {/* Border Section - hidden for void elements */}
                {canHaveBorder && (
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Border</h3>
                   <div className="space-y-3">
                       <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                           <div className="space-y-1.5 min-w-[140px] flex-1">
                               <label className="text-[13px] text-gray-400">Border width</label>
                               <div
                                 tabIndex={0}
                                 ref={borderWidthRef}
                                 onClick={() => setActiveBorderMenu(activeBorderMenu === 'borderWidth' ? null : 'borderWidth')}
                                 className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeBorderMenu === 'borderWidth' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                               >
                                   <span className="text-gray-300 text-[13px] whitespace-nowrap">{currentStyles.borderWidth || 'Select width'}</span>
                                   <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                               </div>
                               <VisualEditorSelectMenu
                                    isOpen={activeBorderMenu === 'borderWidth'}
                                    onClose={() => setActiveBorderMenu(null)}
                                    triggerRef={borderWidthRef}
                                    options={BORDER_WIDTH_OPTIONS}
                                    selected={currentStyles.borderWidth}
                                    onSelect={(val) => {
                                        handleStyleChange('borderWidth', val);
                                        setActiveBorderMenu(null);
                                    }}
                                    label="Select border width"
                                    width={160}
                               />
                           </div>
                           <div className="space-y-1.5 min-w-[140px] flex-1">
                               <label className="text-[13px] text-gray-400">Border color</label>
                               <div
                                 tabIndex={0}
                                 ref={borderColorRef}
                                 onClick={() => setActiveColorMenu(activeColorMenu === 'border' ? null : 'border')}
                                 className={`flex items-center gap-2 p-2 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors ${activeColorMenu === 'border' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                               >
                                   <div
                                     className="w-5 h-5 rounded-full border border-white/10 relative overflow-hidden flex-shrink-0"
                                     style={{
                                       backgroundColor: currentStyles.borderColor ? (tailwindColorToCss(currentStyles.borderColor) || 'transparent') : 'transparent',
                                       backgroundImage: !currentStyles.borderColor
                                         ? 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)'
                                         : 'none',
                                       backgroundSize: '8px 8px',
                                       backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                                     }}
                                   />
                                   <span className="text-white text-[13px] truncate">{formatColorForDisplay(currentStyles.borderColor)}</span>
                               </div>
                               <ColorPickerMenu
                                  isOpen={activeColorMenu === 'border'}
                                  onClose={() => setActiveColorMenu(null)}
                                  triggerRef={borderColorRef}
                                  currentColor={undefined}
                                  onSelect={(color) => {
                                      handleStyleChange('borderColor', color);
                                      setActiveColorMenu(null);
                                  }}
                               />
                           </div>
                       </div>

                       <div className="flex flex-wrap gap-4">
                           <div className="space-y-1.5 w-full">
                               <label className="text-[13px] text-gray-400">Border style</label>
                               <div
                                 tabIndex={0}
                                 ref={borderStyleRef}
                                 onClick={() => setActiveBorderMenu(activeBorderMenu === 'borderStyle' ? null : 'borderStyle')}
                                 className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeBorderMenu === 'borderStyle' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                               >
                                   <span className="text-gray-300 text-[13px] whitespace-nowrap">{currentStyles.borderStyle || 'Select style'}</span>
                                   <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                               </div>
                               <VisualEditorSelectMenu
                                    isOpen={activeBorderMenu === 'borderStyle'}
                                    onClose={() => setActiveBorderMenu(null)}
                                    triggerRef={borderStyleRef}
                                    options={BORDER_STYLE_OPTIONS}
                                    selected={currentStyles.borderStyle}
                                    onSelect={(val) => {
                                        handleStyleChange('borderStyle', val);
                                        setActiveBorderMenu(null);
                                    }}
                                    label="Select border style"
                                    width={160}
                               />
                           </div>
                       </div>
                   </div>
                </div>
                )}

                   {/* Effects Section - hidden for void elements */}
                {canHaveEffects && (
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Effects</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <div className="flex items-center gap-1">
                               <label className="text-[13px] text-gray-400">Border radius</label>
                           </div>
                           <div
                                tabIndex={0}
                                ref={borderRadiusRef}
                                onClick={() => setActiveEffectMenu(activeEffectMenu === 'radius' ? null : 'radius')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeEffectMenu === 'radius' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.borderRadius || 'Select radius'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeEffectMenu === 'radius'}
                                onClose={() => setActiveEffectMenu(null)}
                                triggerRef={borderRadiusRef}
                                options={BORDER_RADIUS_OPTIONS}
                                selected={currentStyles.borderRadius}
                                onSelect={(val) => {
                                    handleStyleChange('borderRadius', val);
                                    setActiveEffectMenu(null);
                                }}
                                label="Select border radius"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Shadow</label>
                           <div
                                tabIndex={0}
                                ref={shadowRef}
                                onClick={() => setActiveEffectMenu(activeEffectMenu === 'shadow' ? null : 'shadow')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeEffectMenu === 'shadow' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.shadow || 'Select shadow'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeEffectMenu === 'shadow'}
                                onClose={() => setActiveEffectMenu(null)}
                                triggerRef={shadowRef}
                                options={SHADOW_OPTIONS}
                                selected={currentStyles.shadow}
                                onSelect={(val) => {
                                    handleStyleChange('shadow', val);
                                    setActiveEffectMenu(null);
                                }}
                                label="Select shadow"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Opacity</label>
                           <div
                                tabIndex={0}
                                ref={opacityRef}
                                onClick={() => setActiveEffectMenu(activeEffectMenu === 'opacity' ? null : 'opacity')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeEffectMenu === 'opacity' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px] whitespace-nowrap">{currentStyles.opacity || 'Select opacity'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                            <VisualEditorSelectMenu
                                isOpen={activeEffectMenu === 'opacity'}
                                onClose={() => setActiveEffectMenu(null)}
                                triggerRef={opacityRef}
                                options={OPACITY_OPTIONS}
                                selected={currentStyles.opacity}
                                onSelect={(val) => {
                                    handleStyleChange('opacity', val);
                                    setActiveEffectMenu(null);
                                }}
                                label="Select opacity"
                                width={160}
                           />
                       </div>
                   </div>
                </div>
                )}


             </div>
          </div>
        )
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center -mt-72 select-none">
           <div className="mb-6 relative">
              <VisualEditsIcon size={20} className="text-white" />
           </div>
           <h2 className="text-xl font-semibold text-white mb-2">Visual edits</h2>
           <p className="text-[#81888f] mb-8">Select an element to edit it</p>
           
           <p className="text-[#52525b] text-sm">
             Hold <span className="bg-[#27272a] px-1.5 py-0.5 rounded text-gray-400 font-mono border border-white/5 mx-1">Ctrl</span> to select multiple elements
           </p>
         </div>
       )}

       {/* Footer - shown when element is selected */}
       {selection && (
         <div className="absolute bottom-0 left-0 right-0 bg-[#1c1c1c] border-t border-white/5 p-4 space-y-3">
            <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
               <CornerUpLeft size={14} />
               Back to Chat
            </button>
            
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-[#27272a] rounded-xl px-3 h-[36px] py-0 border border-white/5">
                  <Palette size={14} className="text-gray-400" />
                  <span className="text-white text-sm font-medium">Design</span>
                  <div className="flex items-center justify-center gap-1.5 px-2 h-[21px] bg-[#1e40af] text-white rounded-full text-[11px] font-medium font-mono leading-none select-none flex-shrink-0">
                     <Scan size={12} className="stroke-dashed opacity-90 text-white" />
                     <span className="translate-y-[0.5px]">{selection.tagName.toLowerCase()}</span>
                  </div>
               </div>
            </div>

            <div className="w-full bg-[#27272a] rounded-xl border border-white/5 p-3">
               <input 
                  type="text" 
                  placeholder="Ask Lovable to modify the selected element..." 
                  className="w-full bg-transparent text-gray-300 placeholder-gray-500 text-sm outline-none"
               />
            </div>
         </div>
       )}
    </div>
  );
};

export { VisualEditMenu };
