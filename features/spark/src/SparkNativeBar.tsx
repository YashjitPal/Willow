import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { CHIP_GLYPH_AXES, CHIP_LABEL_STYLE } from '@willow/chat/composer/Composer';
import { GeminiMenuCard, GeminiMenuDivider, GeminiMenuRow, GeminiMenuTheme } from '@willow/chat/composer/PlusDropdownMenu';
import { isDesktopApp, pickDirectory } from '@willow/core/desktop-bridge';
import { useThemeMode } from '@willow/core/theme-mode';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  addSparkProject,
  ensureSparkProjectsLoaded,
  setSparkActiveProject,
  setSparkTaskApprovalMode,
  sparkProjects,
  sparkTaskApprovalMode,
  sparkTaskProject,
  type SparkProject,
} from './spark-projects';

/**
 * The desktop app's chips in Spark's composer, where a picked tool's chip goes and
 * drawn exactly as one: the folder a new task will work in, and a task's full
 * access. Neither shows unless it applies, so a composer working across the
 * computer with the default policy looks as it does on the web.
 */

const MENU_WIDTH = 249;

/** Adds a folder from the system picker, which becomes where the next task works. Null if the user cancelled. */
export const addSparkFolderFromPicker = async (): Promise<SparkProject | null> => {
  const path = await pickDirectory('Add a folder to Spark');
  if (!path) return null;
  const project = addSparkProject(path);
  setSparkActiveProject(project.id);
  return project;
};

/** The tool chip's surface, from `InputBar`'s `ToolChip`. */
const chipClass = (isLight: boolean, interactive: string) =>
  `group flex h-6 shrink-0 select-none items-center justify-center rounded-full ${isLight ? 'bg-black/[0.08]' : 'bg-[rgba(255,255,255,0.12)]'} pl-1 ${interactive} outline-none focus-visible:ring-2 ${isLight ? 'focus-visible:ring-black/25' : 'focus-visible:ring-white/25'}`;

const ChipGlyph = ({ name, family = 'google-symbols' }: { name: string; family?: 'google-symbols' | 'luminous' }) => {
  const { isLight } = useThemeMode();
  return (
    <MaterialSymbol
      name={name}
      family={family}
      size={16}
      weight={330}
      variationSettings={family === 'luminous' ? CHIP_GLYPH_AXES : '"wght" 330'}
      className={isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}
    />
  );
};

const ChipLabel = ({ children }: { children: React.ReactNode }) => {
  const { isLight } = useThemeMode();
  return (
    <span
      className={`max-w-[180px] truncate whitespace-nowrap text-[13px] font-normal leading-[17px] ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}`}
      style={CHIP_LABEL_STYLE}
    >
      {children}
    </span>
  );
};

/** The folder chip's menu: Gemini's plus-menu card, opened beside the chip as that menu opens beside the plus. */
const FolderMenu = ({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) => {
  const { isLight } = useThemeMode();
  const state = useStore(sparkProjects);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = window.innerHeight - rect.bottom;
    const left = Math.min(rect.left - 4, window.innerWidth - MENU_WIDTH - 8);
    setPosition(below >= height + 16 || below >= rect.top ? { left, top: rect.bottom + 8 } : { left, bottom: window.innerHeight - rect.top + 8 });
  }, [anchor, state.projects.length]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      anchor.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [anchor, onClose]);

  const choose = (projectId: string | null) => {
    setSparkActiveProject(projectId);
    onClose();
  };

  return createPortal(
    <GeminiMenuTheme.Provider value={{ isLight }}>
      <div
        ref={menuRef}
        className="fixed z-[1000]"
        style={{ left: position?.left ?? 0, top: position?.top, bottom: position?.bottom, visibility: position ? undefined : 'hidden' }}
      >
        <GeminiMenuCard width={MENU_WIDTH} origin={position?.bottom !== undefined ? '0 100%' : '0 0'} label="Where the task works">
          {state.projects.map((project) => (
            <GeminiMenuRow
              key={project.id}
              glyph="folder"
              label={project.name}
              tooltip={project.path}
              selected={project.id === state.activeProjectId}
              onClick={() => choose(project.id)}
            />
          ))}
          <GeminiMenuRow glyph="computer" family="google-symbols" label="This computer" tooltip="Works anywhere, starting in your home folder" onClick={() => choose(null)} />
          <GeminiMenuDivider />
          <GeminiMenuRow
            glyph="create_new_folder"
            family="google-symbols"
            label="Add folder"
            onClick={() => {
              onClose();
              void addSparkFolderFromPicker();
            }}
          />
        </GeminiMenuCard>
      </div>
    </GeminiMenuTheme.Provider>,
    document.body,
  );
};

/**
 * The folder a new task will work in, beside the plus. Opens a menu to change it.
 * `compact` drops the name, for a composer too narrow to hold it beside the model pill.
 */
const SparkFolderChip = ({ project, compact }: { project: SparkProject; compact: boolean }) => {
  const { isLight } = useThemeMode();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Working in ${project.name}. Change where the task works`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={compact ? `Working in ${project.name}` : project.path}
        onClick={() => setOpen((value) => !value)}
        className={chipClass(isLight, 'cursor-pointer pr-1')}
      >
        <span className="flex items-center gap-1">
          <ChipGlyph name="folder" />
          {!compact && <ChipLabel>{project.name}</ChipLabel>}
          <MaterialSymbol
            name="keyboard_arrow_down"
            family="luminous"
            size={16}
            weight={330}
            variationSettings={CHIP_GLYPH_AXES}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''} ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}`}
          />
        </span>
      </button>
      {open && buttonRef.current && <FolderMenu anchor={buttonRef.current} onClose={() => setOpen(false)} />}
    </>
  );
};

/**
 * A task's full access, beside the plus while it is on. Like a tool chip, it
 * deselects: pressing it turns full access off, and Spark asks before commands again.
 */
const SparkFullAccessChip = ({ taskId }: { taskId: string }) => {
  const { isLight } = useThemeMode();
  return (
    <button
      type="button"
      aria-label="Turn off full access. Spark will ask before running commands"
      title="Spark runs commands and edits files without asking. Press to ask again."
      onClick={() => setSparkTaskApprovalMode(taskId, 'ask')}
      className={chipClass(isLight, 'cursor-default pr-2 hover:pr-1 focus-visible:pr-1')}
    >
      <span className="flex items-center gap-1">
        <ChipGlyph name="shield" />
        <ChipLabel>Full access</ChipLabel>
        <span className="hidden group-hover:flex group-focus-visible:flex">
          <ChipGlyph name="close" family="luminous" />
        </span>
      </span>
    </button>
  );
};

/** The new-task composer's folder chip, in the desktop app, when a folder is chosen. */
export const useSparkFolderChip = (compact = false): React.ReactNode | undefined => {
  const state = useStore(sparkProjects);
  useEffect(() => ensureSparkProjectsLoaded(), []);
  if (!isDesktopApp()) return undefined;
  const project = state.projects.find((entry) => entry.id === state.activeProjectId);
  return project ? <SparkFolderChip project={project} compact={compact} /> : undefined;
};

/** A task's follow-up composer chip, in the desktop app, while the task has full access. */
export const useSparkAccessChip = (taskId: string): React.ReactNode | undefined => {
  useStore(sparkProjects);
  useEffect(() => ensureSparkProjectsLoaded(), []);
  if (!isDesktopApp() || sparkTaskApprovalMode(taskId) !== 'full') return undefined;
  return <SparkFullAccessChip taskId={taskId} />;
};

/** The folder a task works in, ahead of its title in the task header: "landing-site / Title". */
export function SparkTaskFolderCrumb({ taskId }: { taskId: string }): React.ReactElement | null {
  const { isLight } = useThemeMode();
  useStore(sparkProjects);
  useEffect(() => ensureSparkProjectsLoaded(), []);
  const project = isDesktopApp() ? sparkTaskProject(taskId) : null;
  if (!project) return null;
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-2 text-[13px] font-normal leading-[17px]">
      <span className={`max-w-[180px] truncate ${isLight ? 'text-black/55' : 'text-white/55'}`} title={project.path}>
        {project.name}
      </span>
      <span aria-hidden="true" className={isLight ? 'text-black/30' : 'text-white/30'}>/</span>
    </span>
  );
}
