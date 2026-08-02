import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, Pipette } from 'lucide-react';
import { useStore } from '@nanostores/react';
import { themeColors, requestThemeColors, getIframeRef } from '@willow/code/visual-editing/engine/visual-editor-store';
import { 
  rgbToHex, hexToRgb, rgbToHsv, hsvToRgb, rgbToHsl, rgbToOklch,
  oklchToRgb, parseRgba, parseHsla, parseOklch
} from '@willow/core/color';

interface ColorPickerMenuProps {
  onSelect: (value: string) => void;
  onClose: () => void;
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLElement>;
  /** Current computed CSS color (e.g., "rgb(239, 68, 68)") to sync the Custom picker */
  currentColor?: string;
}

// --- Color Categories ---
const SEMANTIC_COLORS = [
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'destructive', 'destructive-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'popover', 'popover-foreground',
  'card', 'card-foreground', 'warning', 'warning-foreground',
  'success', 'success-foreground', 'sidebar', 'sidebar-foreground',
  'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent',
  'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
  'border', 'input', 'ring', 'background', 'foreground',
];

const COLOR_SCALES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose',
];
const SCALE_VALUES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

const SPECIAL_COLORS = ['inherit', 'current', 'transparent', 'black', 'white'];



// Generate full scale colors
const SCALE_COLORS = COLOR_SCALES.flatMap(color => 
  SCALE_VALUES.map(value => `${color}-${value}`)
);

const COLORS = [...SCALE_COLORS, ...SPECIAL_COLORS];

// Tailwind color palette hex values
const TAILWIND_COLORS: Record<string, string> = {
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827', 'gray-950': '#030712',
  'zinc-50': '#fafafa', 'zinc-100': '#f4f4f5', 'zinc-200': '#e4e4e7', 'zinc-300': '#d4d4d8', 'zinc-400': '#a1a1aa', 'zinc-500': '#71717a', 'zinc-600': '#52525b', 'zinc-700': '#3f3f46', 'zinc-800': '#27272a', 'zinc-900': '#18181b', 'zinc-950': '#09090b',
  'neutral-50': '#fafafa', 'neutral-100': '#f5f5f5', 'neutral-200': '#e5e5e5', 'neutral-300': '#d4d4d4', 'neutral-400': '#a3a3a3', 'neutral-500': '#737373', 'neutral-600': '#525252', 'neutral-700': '#404040', 'neutral-800': '#262626', 'neutral-900': '#171717', 'neutral-950': '#0a0a0a',
  'stone-50': '#fafaf9', 'stone-100': '#f5f5f4', 'stone-200': '#e7e5e4', 'stone-300': '#d6d3d1', 'stone-400': '#a8a29e', 'stone-500': '#78716c', 'stone-600': '#57534e', 'stone-700': '#44403c', 'stone-800': '#292524', 'stone-900': '#1c1917', 'stone-950': '#0c0a09',
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca', 'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b', 'red-900': '#7f1d1d', 'red-950': '#450a0a',
  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-200': '#fed7aa', 'orange-300': '#fdba74', 'orange-400': '#fb923c', 'orange-500': '#f97316', 'orange-600': '#ea580c', 'orange-700': '#c2410c', 'orange-800': '#9a3412', 'orange-900': '#7c2d12', 'orange-950': '#431407',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a', 'amber-300': '#fcd34d', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e', 'amber-900': '#78350f', 'amber-950': '#451a03',
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a', 'yellow-300': '#fde047', 'yellow-400': '#facc15', 'yellow-500': '#eab308', 'yellow-600': '#ca8a04', 'yellow-700': '#a16207', 'yellow-800': '#854d0e', 'yellow-900': '#713f12', 'yellow-950': '#422006',
  'lime-50': '#f7fee7', 'lime-100': '#ecfccb', 'lime-200': '#d9f99d', 'lime-300': '#bef264', 'lime-400': '#a3e635', 'lime-500': '#84cc16', 'lime-600': '#65a30d', 'lime-700': '#4d7c0f', 'lime-800': '#3f6212', 'lime-900': '#365314', 'lime-950': '#1a2e05',
  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-200': '#bbf7d0', 'green-300': '#86efac', 'green-400': '#4ade80', 'green-500': '#22c55e', 'green-600': '#16a34a', 'green-700': '#15803d', 'green-800': '#166534', 'green-900': '#14532d', 'green-950': '#052e16',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0', 'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46', 'emerald-900': '#064e3b', 'emerald-950': '#022c22',
  'teal-50': '#f0fdfa', 'teal-100': '#ccfbf1', 'teal-200': '#99f6e4', 'teal-300': '#5eead4', 'teal-400': '#2dd4bf', 'teal-500': '#14b8a6', 'teal-600': '#0d9488', 'teal-700': '#0f766e', 'teal-800': '#115e59', 'teal-900': '#134e4a', 'teal-950': '#042f2e',
  'cyan-50': '#ecfeff', 'cyan-100': '#cffafe', 'cyan-200': '#a5f3fc', 'cyan-300': '#67e8f9', 'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4', 'cyan-600': '#0891b2', 'cyan-700': '#0e7490', 'cyan-800': '#155e75', 'cyan-900': '#164e63', 'cyan-950': '#083344',
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-200': '#bae6fd', 'sky-300': '#7dd3fc', 'sky-400': '#38bdf8', 'sky-500': '#0ea5e9', 'sky-600': '#0284c7', 'sky-700': '#0369a1', 'sky-800': '#075985', 'sky-900': '#0c4a6e', 'sky-950': '#082f49',
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe', 'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af', 'blue-900': '#1e3a8a', 'blue-950': '#172554',
  'indigo-50': '#eef2ff', 'indigo-100': '#e0e7ff', 'indigo-200': '#c7d2fe', 'indigo-300': '#a5b4fc', 'indigo-400': '#818cf8', 'indigo-500': '#6366f1', 'indigo-600': '#4f46e5', 'indigo-700': '#4338ca', 'indigo-800': '#3730a3', 'indigo-900': '#312e81', 'indigo-950': '#1e1b4b',
  'violet-50': '#f5f3ff', 'violet-100': '#ede9fe', 'violet-200': '#ddd6fe', 'violet-300': '#c4b5fd', 'violet-400': '#a78bfa', 'violet-500': '#8b5cf6', 'violet-600': '#7c3aed', 'violet-700': '#6d28d9', 'violet-800': '#5b21b6', 'violet-900': '#4c1d95', 'violet-950': '#2e1065',
  'purple-50': '#faf5ff', 'purple-100': '#f3e8ff', 'purple-200': '#e9d5ff', 'purple-300': '#d8b4fe', 'purple-400': '#c084fc', 'purple-500': '#a855f7', 'purple-600': '#9333ea', 'purple-700': '#7e22ce', 'purple-800': '#6b21a8', 'purple-900': '#581c87', 'purple-950': '#3b0764',
  'fuchsia-50': '#fdf4ff', 'fuchsia-100': '#fae8ff', 'fuchsia-200': '#f5d0fe', 'fuchsia-300': '#f0abfc', 'fuchsia-400': '#e879f9', 'fuchsia-500': '#d946ef', 'fuchsia-600': '#c026d3', 'fuchsia-700': '#a21caf', 'fuchsia-800': '#86198f', 'fuchsia-900': '#701a75', 'fuchsia-950': '#4a044e',
  'pink-50': '#fdf2f8', 'pink-100': '#fce7f3', 'pink-200': '#fbcfe8', 'pink-300': '#f9a8d4', 'pink-400': '#f472b6', 'pink-500': '#ec4899', 'pink-600': '#db2777', 'pink-700': '#be185d', 'pink-800': '#9d174d', 'pink-900': '#831843', 'pink-950': '#500724',
  'rose-50': '#fff1f2', 'rose-100': '#ffe4e6', 'rose-200': '#fecdd3', 'rose-300': '#fda4af', 'rose-400': '#fb7185', 'rose-500': '#f43f5e', 'rose-600': '#e11d48', 'rose-700': '#be123c', 'rose-800': '#9f1239', 'rose-900': '#881337', 'rose-950': '#4c0519',
  'black': '#000000', 'white': '#ffffff',
};

// Helper to get preview color for swatch
const getPreviewColor = (colorName: string): string => {
  // Semantic colors - use CSS variable
  if (SEMANTIC_COLORS.includes(colorName)) {
    return `hsl(var(--${colorName}))`;
  }
  // Scale colors - use Tailwind hex
  if (TAILWIND_COLORS[colorName]) {
    return TAILWIND_COLORS[colorName];
  }
  // Special colors
  if (colorName === 'transparent') return 'transparent';
  if (colorName === 'black') return '#000000';
  if (colorName === 'white') return '#ffffff';
  if (colorName === 'inherit' || colorName === 'current') return 'currentColor';
  return '#888888'; // fallback
};

// Helper to get output value when color is selected
// Returns the Tailwind class name suffix (e.g., 'red-500', 'primary', 'transparent')
// The consumer (visual editor) will add the appropriate prefix (text-, bg-, border-)
const getOutputValue = (colorName: string): string => {
  // Semantic colors - for CSS variable colors, return hsl(var(...)) format
  // These will be used with arbitrary value syntax: text-[hsl(var(--primary))]
  if (SEMANTIC_COLORS.includes(colorName)) {
    return `hsl(var(--${colorName}))`;
  }
  // Scale colors and special colors - return the name directly
  // This allows creating clean classes like text-red-500 instead of text-[#ef4444]
  return colorName;
};

type ColorFormat = 'HEX' | 'RGBA' | 'HSLA' | 'OKLCH';

export const ColorPickerMenu: React.FC<ColorPickerMenuProps> = ({ onSelect, onClose, isOpen, triggerRef, currentColor }) => {
  const [activeTab, setActiveTab] = useState<'styles' | 'custom'>('styles');
  const [searchQuery, setSearchQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  
  // Subscribe to theme colors from iframe
  const resolvedThemeColors = useStore(themeColors);

  // Reactive helper to get preview color - uses resolved theme colors when available
  const getPreviewColorWithTheme = (colorName: string): string => {
    // For semantic colors, try to use resolved value from iframe first
    if (SEMANTIC_COLORS.includes(colorName)) {
      const resolved = resolvedThemeColors[colorName];
      if (resolved) {
        // Detect format
        const val = resolved.trim();
        // If it's a direct color value (Hex, function, or named color)
        // Check for #, rgb(), hsl(), oklch(), or just letters (named color)
        if (val.startsWith('#') || val.includes('(') || /^[a-zA-Z]+$/.test(val)) {
             return val;
        }
        
        // Assume space-separated HSL channels (Tailwind/Shadcn standard)
        // Convert "H S L" -> "hsl(H, S, L)"
        const parts = val.split(/\s+/);
        if (parts.length >= 3) {
          return `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`;
        }
        
        // Fallback wrap
        return `hsl(${val})`;
      }
    }
    // For non-semantic colors, use the static helper
    return getPreviewColor(colorName);
  };

  // Custom Color State (HSVA)
  const [hsva, setHsva] = useState({ h: 0, s: 100, v: 100, a: 1 });

  // Sync Custom picker with currentColor when menu opens or currentColor changes
  useEffect(() => {
    if (!isOpen || !currentColor) return;

    // Parse the currentColor (can be rgb(), rgba(), hex, etc.)
    const color = currentColor.trim().toLowerCase();

    try {
      let r = 0, g = 0, b = 0, a = 1;

      // Parse rgb/rgba
      const rgbaMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
      if (rgbaMatch) {
        r = parseInt(rgbaMatch[1], 10);
        g = parseInt(rgbaMatch[2], 10);
        b = parseInt(rgbaMatch[3], 10);
        a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
      }
      // Parse hex
      else if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 3) {
          r = parseInt(hex[0] + hex[0], 16);
          g = parseInt(hex[1] + hex[1], 16);
          b = parseInt(hex[2] + hex[2], 16);
        } else if (hex.length >= 6) {
          r = parseInt(hex.slice(0, 2), 16);
          g = parseInt(hex.slice(2, 4), 16);
          b = parseInt(hex.slice(4, 6), 16);
          if (hex.length === 8) {
            a = parseInt(hex.slice(6, 8), 16) / 255;
          }
        }
      }

      // Convert RGB to HSV
      const hsv = rgbToHsv(r, g, b);
      setHsva({ h: hsv.h, s: hsv.s, v: hsv.v, a });
    } catch (e) {
      // Ignore parse errors
    }
  }, [isOpen, currentColor]);
  
  // Format State
  const [format, setFormat] = useState<ColorFormat>('HEX');
  const [inputValue, setInputValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // Format Menu State
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [isFormatMenuVisible, setIsFormatMenuVisible] = useState(false);
  const [formatMenuPosition, setFormatMenuPosition] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null);
  const formatTriggerRef = useRef<HTMLDivElement>(null);
  
  const gradientRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const opacityRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'gradient' | 'hue' | 'opacity' | null>(null);

  // Derived Values
  const rgb = hsvToRgb(hsva.h, hsva.s, hsva.v);
  const displayColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${hsva.a})`;
  const hueColor = `hsl(${hsva.h}, 100%, 50%)`;

  // --- Format Conversion ---
  const getFormattedValue = () => {
    const { r, g, b } = rgb;
    const a = Math.round(hsva.a * 100) / 100;

    switch (format) {
      case 'HEX':
        return rgbToHex(r, g, b) + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '');
      case 'RGBA':
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      case 'HSLA':
        const hsl = rgbToHsl(r, g, b);
        return `hsla(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%, ${a})`;
      case 'OKLCH':
        const oklch = rgbToOklch(r, g, b);
        // Display as oklch(L C H / A)
        return `oklch(${oklch.l.toFixed(3)} ${oklch.c.toFixed(3)} ${oklch.h.toFixed(1)} / ${a})`;
    }
  };

  // Sync Input when color changes externally (drag)
  useEffect(() => {
    if (!isEditing) {
        setInputValue(getFormattedValue());
    }
  }, [hsva, format, isEditing]);

  // Request theme colors from iframe when menu opens and showing Styles tab
  useEffect(() => {
    if (!isOpen || activeTab !== 'styles') return;

    // Listener for theme colors response from iframe
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'THEME_COLORS_RESPONSE' && e.data.colors) {
        themeColors.set(e.data.colors);
        console.log('[ColorPickerMenu] Theme colors received via message:', Object.keys(e.data.colors).length);
      }
    };
    window.addEventListener('message', handleMessage);

    // Directly read CSS variables from iframe's document
    // This allows colors to be dynamic even if Visual Edit mode isn't active
    const readThemeColorsFromIframe = () => {
      const iframe = getIframeRef();
      // Try to access contentDocument (works for same-origin/blob)
      if (!iframe?.contentDocument) {
        // Fallback to message passing if direct access fails
        console.log('[ColorPickerMenu] Direct access failed, sending message');
        requestThemeColors();
        return;
      }

      try {
        const root = iframe.contentWindow?.getComputedStyle(iframe.contentDocument.documentElement);
        if (!root) {
             throw new Error("No root element");
        }

        const semanticColors = [
          'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
          'destructive', 'destructive-foreground', 'muted', 'muted-foreground',
          'accent', 'accent-foreground', 'popover', 'popover-foreground',
          'card', 'card-foreground', 'warning', 'warning-foreground',
          'success', 'success-foreground', 'sidebar', 'sidebar-foreground',
          'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent',
          'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
          'border', 'input', 'ring', 'background', 'foreground'
        ];

        const colors: Record<string, string> = {};
        for (const name of semanticColors) {
          const value = root.getPropertyValue('--' + name).trim();
          if (value) {
            colors[name] = value;
          }
        }

        if (Object.keys(colors).length > 0) {
          themeColors.set(colors);
          console.log('[ColorPickerMenu] Theme colors read from iframe:', Object.keys(colors).length);
        } else {
             // If we read 0 colors, maybe style isn't ready? Try message fallback
             throw new Error("Read 0 colors");
        }
      } catch (e) {
        console.log('[ColorPickerMenu] Error reading theme colors, using fallback:', e);
        requestThemeColors();
      }
    };

    // Try immediately
    readThemeColorsFromIframe();

    // Also try after a short delay in case iframe is still loading/rendering
    const timer = setTimeout(readThemeColorsFromIframe, 500);

    return () => {
        clearTimeout(timer);
        window.removeEventListener('message', handleMessage);
    };
  }, [isOpen, activeTab]);



// ... (previous code)

  const handleValueChange = (val: string) => {
      setInputValue(val);
      setIsEditing(true);
      
      let newHsva: { h: number, s: number, v: number, a: number } | null = null;

      if (format === 'HEX') {
        const cleanHex = val.startsWith('#') ? val : '#' + val;
        // Allow partial typing, but only valid hex updates state
        if (/^#[0-9A-Fa-f]{6}$/.test(cleanHex)) {
            const rgb = hexToRgb(cleanHex);
            const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
            newHsva = { h, s, v, a: hsva.a };
        }
      } else if (format === 'RGBA') {
          const rgba = parseRgba(val);
          if (rgba) {
              const { h, s, v } = rgbToHsv(rgba.r, rgba.g, rgba.b);
              newHsva = { h, s, v, a: rgba.a };
          }
      } else if (format === 'HSLA') {
          const hsl = parseHsla(val);
          if (hsl) {
              // Convert HSL -> HSV for internal state
              // Simple conversion: H is same, S/L -> S/V
              // But we can go HSL -> RGB -> HSV to reusing utils
              // Need helper HSL->RGB, but I didn't export it. 
              // Wait, HSL -> RGB is standard. I'll add a helper inline or assume I can get it.
              // Actually, I can just do:
              // HSL -> H = H, S = ..., L = ...
              // Let's do HSL -> RGB -> HSV for safety if I extract helper, 
              // OR simplistic inline math.
              // Let's use a quick inline HSL->RGB standard logic:
              const h = hsl.h, s = hsl.s / 100, l = hsl.l / 100;
              const k = (n: number) => (n + h / 30) % 12;
              const a = s * Math.min(l, 1 - l);
              const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
              const r = Math.round(f(0) * 255);
              const g = Math.round(f(8) * 255);
              const b = Math.round(f(4) * 255);
              
              const hsv = rgbToHsv(r, g, b);
              newHsva = { h: hsv.h, s: hsv.s, v: hsv.v, a: hsl.a };
          }
      } else if (format === 'OKLCH') {
          const oklch = parseOklch(val);
          if (oklch) {
              const rgb = oklchToRgb(oklch.l, oklch.c, oklch.h);
              const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
              newHsva = { h: hsv.h, s: hsv.s, v: hsv.v, a: oklch.a };
          }
      }

      if (newHsva) {
          setHsva(newHsva);
      }
  };

  // Reset to Styles tab when menu closes
  useEffect(() => {
    if (!isOpen) {
      // Delay reset slightly to allow close animation
      const timer = setTimeout(() => {
        setActiveTab('styles');
        setSearchQuery('');
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // --- Animation & Positioning ---
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current) {
      const updatePosition = () => {
        if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          setPosition({ top: rect.bottom + 8, left: rect.left });
        }
      };
      updatePosition();
      requestAnimationFrame(() => setIsVisible(true));
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      document.body.style.overflow = 'hidden';
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
        document.body.style.overflow = '';
      };
    } else {
        setIsVisible(false);
        const timer = setTimeout(() => setPosition(null), 200);
        return () => clearTimeout(timer);
    }
  }, [isOpen, triggerRef]);

  // --- Format Menu Positioning & Animation ---
  useLayoutEffect(() => {
      if (isFormatMenuOpen && formatTriggerRef.current) {
          const rect = formatTriggerRef.current.getBoundingClientRect();
          const menuHeight = 130; // approx height
          const spaceBelow = window.innerHeight - rect.bottom;
          const placement = spaceBelow >= menuHeight ? 'bottom' : 'top';
          
          setFormatMenuPosition({
              left: rect.left,
              top: placement === 'bottom' ? rect.bottom + 4 : rect.top - 4,
              placement
          });
          
          // Trigger Fade In
          requestAnimationFrame(() => setIsFormatMenuVisible(true));
      } else {
          // Trigger Fade Out
          setIsFormatMenuVisible(false);
          const timer = setTimeout(() => setFormatMenuPosition(null), 150); // Unmount after transition
          return () => clearTimeout(timer);
      }
  }, [isFormatMenuOpen]);


  // --- Interaction Handlers ---
  const handleMouseDown = (e: React.MouseEvent, type: 'gradient' | 'hue' | 'opacity') => {
    draggingRef.current = type;
    handleMouseMove(e.nativeEvent, type);
    
    const moveHandler = (ev: MouseEvent) => handleMouseMove(ev, type);
    const upHandler = () => {
      draggingRef.current = null;
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
    };
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
  };

  const handleMouseMove = (e: MouseEvent, type: 'gradient' | 'hue' | 'opacity') => {
    e.preventDefault();
    if (type === 'gradient' && gradientRef.current) {
        const rect = gradientRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setHsva(prev => ({ ...prev, s: x * 100, v: (1 - y) * 100 }));
    } else if (type === 'hue' && hueRef.current) {
        const rect = hueRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setHsva(prev => ({ ...prev, h: x * 360 }));
    } else if (type === 'opacity' && opacityRef.current) {
        const rect = opacityRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setHsva(prev => ({ ...prev, a: x }));
    }
  };

  const filteredColors = COLORS.filter(c => c.toLowerCase().includes(searchQuery.toLowerCase()));

  if (!isOpen && !position) return null;

  return (
    <>
    {createPortal(
    <>
        <div className="fixed inset-0 z-[99999] bg-transparent" onClick={onClose} />
        <div 
            className={`fixed z-[100000] w-[240px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl overflow-hidden transition-[opacity,transform] duration-200 origin-top-left ${
                isVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2'
            }`}
            style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
        >
      {/* Tabs */}
      <div className="flex p-1 border-b border-white/5">
        <button onClick={() => setActiveTab('styles')} className={`flex-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${activeTab === 'styles' ? 'bg-[#27272a] text-white' : 'text-gray-500 hover:text-gray-300'}`}>Styles</button>
        <button onClick={() => setActiveTab('custom')} className={`flex-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${activeTab === 'custom' ? 'bg-[#27272a] text-white' : 'text-gray-500 hover:text-gray-300'}`}>Custom</button>
      </div>

      {activeTab === 'styles' ? (
        <>
          <div className="p-1 border-b border-white/5">
            <div className="relative group">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-gray-300 transition-colors" />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search colors..." className="w-full bg-transparent text-white text-[13px] pl-8 pr-3 py-1.5 rounded-md outline-none transition-all placeholder:text-gray-600" autoFocus />
            </div>
          </div>
          <div className="max-h-[220px] overflow-y-auto py-1 custom-scrollbar">
            {filteredColors.length === 0 ? <div className="px-4 py-8 text-center text-gray-500 text-[13px]">No colors found</div> : filteredColors.map(color => {
                const isSemantic = SEMANTIC_COLORS.includes(color);
                const resolvedVal = resolvedThemeColors[color];
                const displayVal = getPreviewColorWithTheme(color);
                
                return (
                <button 
                  key={color} 
                  onClick={() => { onSelect(getOutputValue(color)); onClose(); }} 
                  className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-white/5 transition-colors group"
                  title={isSemantic ? (resolvedVal ? `Raw: "${resolvedVal}"` : "Variable not found (using default)") : color}
                >
                    <div 
                        className={`w-4 h-4 rounded-[4px] border border-white/10 shadow-sm ${color === 'transparent' ? 'bg-[linear-gradient(45deg,#ccc_25%,transparent_25%),linear-gradient(-45deg,#ccc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ccc_75%),linear-gradient(-45deg,transparent_75%,#ccc_75%)] bg-[length:4px_4px] bg-white' : ''}`} 
                        style={{ backgroundColor: color !== 'transparent' ? displayVal : undefined }} 
                    />
                    <span className="text-gray-300 text-[13px] group-hover:text-white transition-colors">{color}</span>
                </button>
            )})}
          </div>
        </>
      ) : (
      <div className="max-h-[340px] overflow-y-auto p-3 custom-scrollbar space-y-4 select-none">
        
        {/* Saturation/Brightness Area */}
        {/* Saturation/Brightness Area */}
        <div 
            ref={gradientRef}
            onMouseDown={(e) => handleMouseDown(e, 'gradient')}
            className="w-full aspect-[4/3] relative cursor-crosshair shadow-inner ring-1 ring-white/10 rounded-lg group" // Added group, removed overflow-hidden
            style={{ backgroundColor: hueColor }}
        >
            <div className="absolute inset-0 rounded-lg overflow-hidden"> {/* Inner clipped container */}
                <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
            </div>
            <div 
                className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 border-2 border-white rounded-full shadow-md pointer-events-none" 
                style={{ top: `${100 - hsva.v}%`, left: `${hsva.s}%`, backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` }} 
            />
        </div>

        {/* Sliders */}
        <div className="space-y-3">
            <div className="flex items-center gap-3">
                <div
                    className="w-6 h-6 rounded-full border border-white/20 shadow-sm flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-white/30 transition-all"
                    style={{ backgroundColor: displayColor }}
                    title="Click to apply this color"
                    onClick={() => {
                        // Always output hex for custom colors (direct-style-service wraps in arbitrary value)
                        const hexColor = rgbToHex(rgb.r, rgb.g, rgb.b);
                        onSelect(hexColor);
                        onClose();
                    }}
                />
                <div className="flex-1 space-y-3">
                    {/* Hue Slider */}
                    <div 
                        ref={hueRef}
                        onMouseDown={(e) => handleMouseDown(e, 'hue')}
                        className="h-2.5 relative cursor-pointer"
                    >
                         <div className="absolute inset-0 rounded-full overflow-hidden ring-1 ring-white/5">
                            <div className="absolute inset-0 bg-gradient-to-r from-[#f00] via-[#ff0] via-[#0f0] via-[#0ff] via-[#00f] via-[#f0f] to-[#f00]" />
                        </div>
                        <div 
                            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-md -translate-x-2 pointer-events-none border-2 border-white" 
                            style={{ left: `${(hsva.h / 360) * 100}%`, backgroundColor: `hsl(${hsva.h}, 100%, 50%)` }} 
                        />
                    </div>
                     {/* Opacity Slider */}
                    <div 
                        ref={opacityRef}
                        onMouseDown={(e) => handleMouseDown(e, 'opacity')}
                        className="h-2.5 relative cursor-pointer"
                    >
                         <div className="absolute inset-0 rounded-full overflow-hidden ring-1 ring-white/5 bg-[linear-gradient(45deg,#ccc_25%,transparent_25%),linear-gradient(-45deg,#ccc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ccc_75%),linear-gradient(-45deg,transparent_75%,#ccc_75%)] bg-[length:6px_6px] bg-white">
                            <div 
                                className="absolute inset-0"
                                style={{ background: `linear-gradient(to right, transparent, ${hueColor})` }} 
                            />
                        </div>
                        <div 
                            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-md -translate-x-2 pointer-events-none border-2 border-white" 
                            style={{ left: `${hsva.a * 100}%`, backgroundColor: displayColor }} 
                        />
                    </div>
                </div>
            </div>
        </div>

        <div className="space-y-3 pt-1">
             {/* Value Input */}
            <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-gray-400">Value</label>
                <div className="flex items-center bg-[#3f3f46] rounded-md border border-transparent focus-within:ring-1 focus-within:ring-white/20 px-3 py-1.5 transition-colors h-[34px]">
                    <input 
                        type="text" 
                        value={inputValue} 
                        onChange={(e) => handleValueChange(e.target.value)}
                        onBlur={() => { setIsEditing(false); setInputValue(getFormattedValue()); }}
                        className="bg-transparent text-white text-[13px] font-mono w-full outline-none uppercase placeholder-gray-500" 
                    />
                </div>
            </div>

            {/* Format Input */}
            <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-gray-400">Format</label>
                 <div className="flex gap-2 relative">
                    <div 
                        ref={formatTriggerRef}
                        onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)}
                        className="flex-1 flex items-center justify-between bg-[#27272a] rounded-lg border border-transparent hover:bg-[#323236] cursor-pointer px-3 py-2 transition-colors h-[34px]"
                    >
                        <span className="text-gray-300 text-[13px]">{format}</span>
                        <ChevronDown size={14} className="text-gray-500" />
                    </div>
                     <button 
                        onClick={async () => {
                            if (!('EyeDropper' in window)) {
                                alert('EyeDropper API is not supported in this browser. Try Chrome 95+ or Edge 95+.');
                                return;
                            }
                            try {
                                // @ts-ignore - EyeDropper is a relatively new API
                                const eyeDropper = new (window as any).EyeDropper();
                                const result = await eyeDropper.open();
                                const pickedHex = result.sRGBHex;
                                
                                // Convert picked color to HSV and update state
                                const pickedRgb = hexToRgb(pickedHex);
                                const pickedHsv = rgbToHsv(pickedRgb.r, pickedRgb.g, pickedRgb.b);
                                setHsva(prev => ({ ...prev, h: pickedHsv.h, s: pickedHsv.s, v: pickedHsv.v }));
                            } catch (e) {
                                // User cancelled or error occurred
                                console.log('EyeDropper cancelled or error:', e);
                            }
                        }}
                        className="flex items-center justify-center w-[38px] h-[34px] bg-[#27272a] rounded-lg border border-transparent hover:bg-[#323236] text-gray-400 hover:text-white transition-colors" 
                        title="Pick color from screen"
                     >
                        <Pipette size={15} />
                     </button>
                 </div>
            </div>

            {/* Apply Button */}
            <button
                onClick={() => {
                    const hexColor = rgbToHex(rgb.r, rgb.g, rgb.b);
                    onSelect(hexColor);
                    onClose();
                }}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-medium rounded-lg transition-colors"
            >
                Apply Color
            </button>
        </div>
      </div>
      )}
    </div>
    </>, document.body)}

    {/* Smart Format Menu Portal */}
    {formatMenuPosition && createPortal(
        <>
        <div className="fixed inset-0 z-[100001] bg-transparent" onClick={() => setIsFormatMenuOpen(false)} />
        <div 
            className={`fixed z-[100002] w-[140px] bg-[#121212] border border-white/10 rounded-lg shadow-xl overflow-hidden flex flex-col p-1 transition-all duration-150 origin-top-left ${
                isFormatMenuVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1'
            }`}
            style={{ 
                top: formatMenuPosition.placement === 'bottom' ? formatMenuPosition.top : undefined,
                bottom: formatMenuPosition.placement === 'top' ? window.innerHeight - formatMenuPosition.top - 34 : undefined, // Align bottom
                left: formatMenuPosition.left,
                transformOrigin: formatMenuPosition.placement === 'bottom' ? 'top left' : 'bottom left'
            }}
        >
            {(['HEX', 'RGBA', 'HSLA', 'OKLCH'] as ColorFormat[]).map(fmt => (
                <button
                    key={fmt}
                    onClick={() => { setFormat(fmt); setIsFormatMenuOpen(false); }}
                    className="flex items-center justify-between px-3 py-2 text-[13px] text-gray-300 hover:bg-white/10 hover:text-white rounded-md transition-colors text-left"
                >
                    {fmt}
                    {format === fmt && <Check size={14} />}
                </button>
            ))}
        </div>
        </>,
        document.body
    )}
    </>
  );
};
