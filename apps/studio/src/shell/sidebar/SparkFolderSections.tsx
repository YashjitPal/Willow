import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { useThemeMode } from '@willow/core/theme-mode';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { goToSparkHome, goToSparkTask, sparkLocation, sparkTasks, type SparkTask } from '@willow/spark/spark-store';
import {
  ensureSparkProjectsLoaded,
  removeSparkProject,
  setSparkProjectFullAccess,
  sparkProjects,
  startSparkTaskInProject,
  toggleSparkProjectCollapsed,
  type SparkProject,
} from '@willow/spark/spark-projects';

/**
 * The Spark sidebar's folders, in the desktop app: one section per folder the user
 * added, holding the tasks that work in it, as Recents holds chats.
 *
 * A heading reads as Spark's own section headings ("Your Bots") and folds the same
 * way; its rows are Recents rows, text only, with the label set on the heading's
 * inset so a section reads as one column. Like a Codex project row, the heading
 * reveals its actions on hover: a new task in the folder, and the folder's menu.
 *
 * Nothing shows on the collapsed rail, where Recents shows nothing either.
 */

const ROWS_SHOWN = 6;

const MENU_ITEM_CLASS =
  'flex h-9 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left text-[13px] leading-[17px] font-normal tracking-normal transition-colors';

const time = (value: string | number | undefined): number => {
  const parsed = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const statusDot = (task: SparkTask): { color: string; pulse: boolean; label: string } | null => {
  if (task.status === 'running') return { color: '#a8c7fa', pulse: true, label: 'Working' };
  if (task.status === 'needs-input') return { color: '#fdd663', pulse: false, label: 'Needs input' };
  if (task.hasUnreadCompletion) return { color: '#a8c7fa', pulse: false, label: 'Unread' };
  return null;
};

const FolderMenu: React.FC<{ project: SparkProject; onNewTask: () => void; onOpenChange: (open: boolean) => void }> = ({ project, onNewTask, onOpenChange }) => {
  const { isLight } = useThemeMode();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const close = () => {
    setPosition(null);
    setConfirming(false);
    onOpenChangeRef.current(false);
  };

  useEffect(() => {
    if (!position) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const isAbove = window.innerHeight - rect.bottom < 140;
    setPosition({ top: isAbove ? undefined : rect.bottom, bottom: isAbove ? window.innerHeight - rect.top : undefined, left: rect.left });
    onOpenChangeRef.current(true);
  };

  const itemClass = `${MENU_ITEM_CLASS} ${isLight ? 'text-[#1f1f1f] hover:bg-[rgba(0,0,0,0.06)]' : 'text-[#e6e6e6] hover:bg-[rgba(230,230,230,0.08)]'}`;
  // The bot row menu's glyphs (`SparkDotRowMenu`).
  const symbolProps = { family: 'luminous' as const, size: 20, weight: 320, roundness: 100, opticalSize: 20, className: '!w-6 shrink-0' };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More options for ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={position != null}
        onClick={() => (position ? close() : open())}
        className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'} before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08]`}
      >
        <MaterialSymbol name="more_vert" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} className="relative" />
      </button>
      {position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${project.name}`}
          className={`fixed z-[9999] box-border min-w-[200px] max-w-[300px] rounded-[20px] p-2 willow-mat-menu-enter ${
            isLight ? 'border border-black/5 bg-[#ffffff] text-[#1f1f1f] shadow-[0_0_20px_rgba(0,0,0,0.04)]' : 'bg-[#1f1f1f] text-[#e6e6e6] shadow-[0_0_20px_rgba(0,0,0,0.28)]'
          } ${position.top === undefined ? 'origin-bottom-left' : 'origin-top-left'}`}
          style={{ ...(position.top !== undefined ? { top: position.top } : {}), ...(position.bottom !== undefined ? { bottom: position.bottom } : {}), left: position.left }}
        >
          <div className={`truncate px-2 pb-1 pt-0.5 text-[12px] leading-4 ${isLight ? 'text-black/55' : 'text-white/55'}`} title={project.path}>{project.path}</div>
          <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onNewTask(); }}>
            <MaterialSymbol name="edit_square" {...symbolProps} />
            <span className="truncate">New task</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={project.fullAccess === true}
            className={itemClass}
            onClick={() => { close(); setSparkProjectFullAccess(project.id, !project.fullAccess); }}
          >
            <MaterialSymbol name="lock" {...symbolProps} />
            <span className="min-w-0 flex-1 truncate">Full access for new tasks</span>
            {project.fullAccess && <MaterialSymbol name="check" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} className="shrink-0" />}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              close();
              removeSparkProject(project.id);
            }}
          >
            <MaterialSymbol name="do_not_disturb_on" {...symbolProps} />
            <span className="truncate">{confirming ? 'Click again to remove' : 'Remove folder'}</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};

const FolderHeading: React.FC<{
  project: SparkProject;
  isExpanded: boolean;
  controlsId: string;
  onNewTask: () => void;
}> = ({ project, isExpanded, controlsId, onNewTask }) => {
  const { isLight } = useThemeMode();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="group/folder relative mx-3 mt-3 flex h-8 items-center">
      <button
        type="button"
        aria-label={`Toggle ${project.name}`}
        aria-expanded={isExpanded}
        aria-controls={controlsId}
        title={project.path}
        onClick={() => toggleSparkProjectCollapsed(project.id)}
        className={`group/section flex h-8 min-w-0 flex-1 items-center pl-1.5 pr-16 text-left text-[13px] font-normal leading-[17px] outline-none max-[960px]:pl-2 ${isLight ? 'text-black/55' : 'text-white/55'}`}
      >
        <span className="min-w-0 truncate">{project.name}</span>
        <span
          aria-hidden="true"
          className="luminous-symbols ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[16px] leading-4 opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover/section:opacity-100 group-focus-visible/section:opacity-100"
          style={{ fontFamily: "'Luminous Symbols', sans-serif", fontWeight: 330, fontVariationSettings: '"FILL" 0, "wght" 330, "GRAD" 0, "opsz" 16, "ROND" 100' }}
        >
          {isExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}
        </span>
      </button>
      <div className={`absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5 ${menuOpen ? 'visible' : 'invisible group-hover/folder:visible group-focus-within/folder:visible max-[960px]:visible'}`}>
        <button
          type="button"
          aria-label={`New task in ${project.name}`}
          title={`New task in ${project.name}`}
          data-tooltip-position="right"
          onClick={onNewTask}
          className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'} before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08]`}
        >
          <MaterialSymbol name="edit_square" family="luminous" size={18} weight={320} roundness={100} opticalSize={18} className="relative" />
        </button>
        <FolderMenu project={project} onNewTask={onNewTask} onOpenChange={setMenuOpen} />
      </div>
    </div>
  );
};

const FolderTaskRow: React.FC<{ task: SparkTask; active: boolean; onOpen: () => void }> = ({ task, active, onOpen }) => {
  const { isLight } = useThemeMode();
  const dot = statusDot(task);
  const label = task.title?.trim() || 'New task';
  return (
    <div className="pl-1.5 pr-0 max-[960px]:px-2">
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        title={label}
        className={`sidebar-item-row relative flex h-8 w-full items-center gap-1.5 rounded-full pl-[12px] pr-1.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-white/25 max-[960px]:h-11 max-[960px]:pl-4 max-[960px]:pr-4 ${
          isLight
            ? `text-[#000000] hover:bg-black/[0.05] ${active ? 'is-active !bg-[#f2f0f0]' : ''}`
            : `text-[#e6e6e6] hover:bg-[rgba(230,230,230,0.08)] ${active ? 'is-active bg-[#171717] max-[960px]:!bg-[#141414]' : ''}`
        }`}
      >
        <span className={`sidebar-item-label min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[17px] max-[960px]:!text-[17px] max-[960px]:!leading-6 ${active ? 'font-medium' : 'font-normal'} ${isLight ? '!text-[#000000]' : active ? 'text-white' : 'text-[#e6e6e6]'}`}>
          {label}
        </span>
        {dot && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center" title={dot.label}>
            <span className={`h-2 w-2 rounded-full ${dot.pulse ? 'animate-pulse' : ''}`} style={{ background: dot.color }} />
          </span>
        )}
      </button>
    </div>
  );
};

export const SparkFolderSections: React.FC<{
  isCollapsed: boolean;
  isSparkWorkspaceOpen: boolean;
  /** Brings the Spark workspace forward, as the other Spark rows do before navigating. */
  onOpenSpark: () => void;
}> = ({ isCollapsed, isSparkWorkspaceOpen, onOpenSpark }) => {
  const { isLight } = useThemeMode();
  const state = useStore(sparkProjects);
  const tasks = useStore(sparkTasks);
  const location = useStore(sparkLocation);
  const [expandedLists, setExpandedLists] = useState<Record<string, true>>({});
  useEffect(() => ensureSparkProjectsLoaded(), []);
  const mutedRowClass = `flex h-8 w-full items-center rounded-full pl-[12px] pr-1.5 text-left text-[13px] leading-[17px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-white/25 max-[960px]:h-11 max-[960px]:pl-4 max-[960px]:!text-[17px] ${
    isLight ? 'text-black/55 hover:bg-black/[0.05]' : 'text-white/55 hover:bg-[rgba(230,230,230,0.08)]'
  }`;

  const tasksByFolder = useMemo(() => {
    const byFolder = new Map<string, SparkTask[]>();
    for (const task of tasks) {
      const folderId = state.taskProjects[task.id];
      if (!folderId) continue;
      const list = byFolder.get(folderId) ?? [];
      list.push(task);
      byFolder.set(folderId, list);
    }
    for (const list of byFolder.values()) list.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
    return byFolder;
  }, [tasks, state.taskProjects]);

  if (isCollapsed || state.projects.length === 0) return null;

  const openTaskId = isSparkWorkspaceOpen && location.page === 'task' ? location.taskId : null;

  return (
    <>
      {state.projects.map((project) => {
        const isExpanded = !state.collapsed[project.id];
        const controlsId = `willow-spark-folder-${project.id}`;
        const folderTasks = tasksByFolder.get(project.id) ?? [];
        const showAll = Boolean(expandedLists[project.id]);
        const shown = showAll ? folderTasks : folderTasks.slice(0, ROWS_SHOWN);
        const newTask = () => {
          onOpenSpark();
          startSparkTaskInProject(project.id);
          goToSparkHome();
        };
        return (
          <React.Fragment key={project.id}>
            <FolderHeading project={project} isExpanded={isExpanded} controlsId={controlsId} onNewTask={newTask} />
            <div
              id={controlsId}
              className="grid min-h-0"
              style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr', transition: 'grid-template-rows 200ms cubic-bezier(0.2, 0, 0, 1)' }}
            >
              <div className="min-h-0 overflow-hidden">
                {shown.map((task) => (
                  <FolderTaskRow
                    key={task.id}
                    task={task}
                    active={openTaskId === task.id}
                    onOpen={() => {
                      onOpenSpark();
                      goToSparkTask(task.id);
                    }}
                  />
                ))}
                {folderTasks.length === 0 && (
                  <div className="pl-1.5 pr-0 max-[960px]:px-2">
                    <button type="button" onClick={newTask} className={mutedRowClass}>
                      New task
                    </button>
                  </div>
                )}
                {folderTasks.length > ROWS_SHOWN && (
                  <div className="pl-1.5 pr-0 max-[960px]:px-2">
                    <button
                      type="button"
                      onClick={() => setExpandedLists((current) => {
                        const { [project.id]: wasShown, ...rest } = current;
                        return wasShown ? rest : { ...rest, [project.id]: true };
                      })}
                      className={mutedRowClass}
                    >
                      {showAll ? 'Show less' : `Show ${folderTasks.length - ROWS_SHOWN} more`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};
