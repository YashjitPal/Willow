import clsx from "clsx";
import {
  Children,
  createContext,
  isValidElement,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type Key,
  type ReactElement,
  type ReactNode,
} from "react";

const css = { TransitionGroupChild: "_TransitionGroupChild_nbx58_1" } as const;

/** Module classes for the transition groups below; chunks that bundle their own copy of the component use other hashes. */
export const TransitionGroupClassNames = createContext<Record<keyof typeof css, string>>(css);

interface TransitionState {
  enter: boolean;
  enterActive: boolean;
  exit: boolean;
  exitActive: boolean;
  interrupted: boolean;
}

type TransitionAction = "enter-before" | "enter-active" | "exit-before" | "exit-active" | "done";

const idleState: TransitionState = { enter: false, enterActive: false, exit: false, exitActive: false, interrupted: false };

function transitionReducer(state: TransitionState, action: TransitionAction): TransitionState {
  switch (action) {
    case "enter-before":
      return { enter: true, enterActive: false, exit: false, exitActive: false, interrupted: state.interrupted || state.exit };
    case "enter-active":
      return { enter: true, enterActive: true, exit: false, exitActive: false, interrupted: false };
    case "exit-before":
      return { enter: false, enterActive: false, exit: true, exitActive: false, interrupted: state.interrupted || state.enter };
    case "exit-active":
      return { enter: false, enterActive: false, exit: true, exitActive: true, interrupted: false };
    case "done":
      return idleState;
  }
}

/** Runs `callback` after two animation frames (`Isn`), so the start state is painted before the active state applies. */
export function afterFrames(callback: () => void) {
  if (typeof window.requestAnimationFrame !== "function" || document.visibilityState === "hidden") {
    const timer = window.setTimeout(callback);
    return () => window.clearTimeout(timer);
  }
  let remaining = 2;
  let frame = window.requestAnimationFrame(function tick() {
    remaining -= 1;
    if (remaining === 0) callback();
    else frame = window.requestAnimationFrame(tick);
  });
  return () => window.cancelAnimationFrame(frame);
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type KeyedElement = ReactElement & { key: Key };

function keyedChildren(children: ReactNode) {
  const result: KeyedElement[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.key != null) result.push(child as KeyedElement);
  });
  return result;
}

interface TransitionEntry {
  component: KeyedElement;
  shouldRender: boolean;
  preventMountTransition?: boolean;
}

/** `ECe`: keeps removed children (now exiting) in place and appends new ones. */
function mergeEntries(children: KeyedElement[], entries: TransitionEntry[]): TransitionEntry[] {
  const present = new Set(children.map((child) => child.key));
  const known = new Set(entries.map((entry) => entry.component.key));
  const kept = entries.map((entry) => ({
    ...entry,
    component: children.find((child) => child.key === entry.component.key) ?? entry.component,
    shouldRender: present.has(entry.component.key),
  }));
  return kept.concat(children.filter((child) => !known.has(child.key)).map((component) => ({ component, shouldRender: true })));
}

interface TransitionItemProps {
  as: ElementType;
  children: ReactNode;
  className?: string;
  entryKey: Key;
  enterDuration: number;
  exitDuration: number;
  preventMountTransition?: boolean;
  shouldRender: boolean;
  style?: CSSProperties;
  removeChild: (key: Key) => void;
}

/** `ICe`: one child of a transition group, flagged with `data-entering` / `data-exiting` (+ `-active`) for CSS. */
function TransitionItem({
  as: Component,
  children,
  className,
  entryKey,
  enterDuration,
  exitDuration,
  preventMountTransition = false,
  shouldRender,
  style,
  removeChild,
}: TransitionItemProps) {
  const classNames = use(TransitionGroupClassNames);
  const [state, dispatch] = useReducer(transitionReducer, preventMountTransition, (prevent) => ({ ...idleState, enter: !prevent }));
  const skippedMountTransition = useRef(false);
  const durations = useRef({ enter: enterDuration, exit: exitDuration });
  useLayoutEffect(() => {
    durations.current = { enter: enterDuration, exit: exitDuration };
  });

  useLayoutEffect(() => {
    let timer: number | undefined;
    if (!shouldRender) {
      dispatch("exit-before");
      const cancel = afterFrames(() => {
        dispatch("exit-active");
        timer = window.setTimeout(() => removeChild(entryKey), durations.current.exit);
      });
      return () => {
        cancel();
        window.clearTimeout(timer);
      };
    }
    if (preventMountTransition && !skippedMountTransition.current) {
      skippedMountTransition.current = true;
      return;
    }
    dispatch("enter-before");
    const cancel = afterFrames(() => {
      dispatch("enter-active");
      timer = window.setTimeout(() => dispatch("done"), durations.current.enter);
    });
    return () => {
      cancel();
      window.clearTimeout(timer);
    };
  }, [entryKey, preventMountTransition, removeChild, shouldRender]);

  useEffect(
    () => () => {
      skippedMountTransition.current = false;
    },
    [],
  );

  return (
    <Component
      className={clsx(className, classNames.TransitionGroupChild)}
      style={style}
      data-entering={state.enter ? "" : undefined}
      data-entering-active={state.enterActive ? "" : undefined}
      data-exiting={state.exit ? "" : undefined}
      data-exiting-active={state.exitActive ? "" : undefined}
      data-interrupted={state.interrupted ? "" : undefined}
    >
      {children}
    </Component>
  );
}

export interface TransitionGroupProps {
  as?: ElementType;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  enterDuration?: number;
  exitDuration?: number;
  /** Children present on mount appear without an enter transition. */
  preventInitialTransition?: boolean;
  disableAnimations?: boolean;
}

/**
 * Keyed enter/exit transitions (`_sn` / `RCe` in app-shared): wraps each child in `as` with `className` and keeps
 * removed children mounted for `exitDuration`. Animations are off under `prefers-reduced-motion`.
 */
export function TransitionGroup({
  as = "span",
  children,
  className,
  style,
  enterDuration = 0,
  exitDuration = 0,
  preventInitialTransition = true,
  disableAnimations = prefersReducedMotion(),
}: TransitionGroupProps) {
  const [entries, setEntries] = useState<TransitionEntry[]>(() =>
    keyedChildren(children).map((component) => ({ component, shouldRender: true, preventMountTransition: preventInitialTransition })),
  );
  const removeChild = useCallback((key: Key) => setEntries((current) => current.filter((entry) => entry.component.key !== key)), []);

  useLayoutEffect(() => {
    setEntries((current) => mergeEntries(keyedChildren(children), current));
  }, [children]);

  const Component = as;
  if (disableAnimations) {
    return (
      <>
        {keyedChildren(children).map((child) => (
          <Component key={child.key} className={className} style={style}>
            {child}
          </Component>
        ))}
      </>
    );
  }
  const latest = new Map(keyedChildren(children).map((child) => [child.key, child]));
  return (
    <>
      {entries.map(({ component, shouldRender, preventMountTransition }) => (
        <TransitionItem
          key={component.key}
          as={Component}
          className={className}
          entryKey={component.key}
          enterDuration={enterDuration}
          exitDuration={exitDuration}
          preventMountTransition={preventMountTransition}
          shouldRender={shouldRender}
          style={style}
          removeChild={removeChild}
        >
          {latest.get(component.key) ?? component}
        </TransitionItem>
      ))}
    </>
  );
}
