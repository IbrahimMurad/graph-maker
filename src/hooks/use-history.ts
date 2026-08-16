import { useCallback, useEffect, useRef, useState } from "react";

export type MutateFn<T> = (fn: (draft: T) => void) => void;

/* Burst-collapsing undo/redo over any structuredClone-able document state.
   Edits within a short idle window (a drag, a run of keystrokes) collapse into a single
   history entry, so undo steps by meaningful change rather than by pixel or character.
   `normalize`, when given, runs on every new draft (mutate and replace alike) — for
   consistency passes that must hold after any edit, e.g. re-settling bound wire tips. */
export function useDocHistory<T>(init: () => T, normalize?: (draft: T) => void) {
  const normRef = useRef(normalize);
  normRef.current = normalize;
  const [state, setState] = useState<T>(() => {
    const s = init();
    normRef.current?.(s);
    return s;
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [uiKey, setUiKey] = useState(0); // bump to remount panels holding uncontrolled inputs

  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const burstBase = useRef<T | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, bumpHist] = useState(0);

  const commitBurst = useCallback(() => {
    if (burstTimer.current) {
      clearTimeout(burstTimer.current);
      burstTimer.current = null;
    }
    if (burstBase.current) {
      past.current.push(burstBase.current);
      if (past.current.length > 200) past.current.shift();
      burstBase.current = null;
      bumpHist((t) => t + 1);
    }
  }, []);

  const mutate: MutateFn<T> = useCallback(
    (fn) => {
      if (burstBase.current === null) burstBase.current = stateRef.current; // pre-edit snapshot
      setState((prev) => {
        const next = structuredClone(prev);
        fn(next);
        normRef.current?.(next);
        return next;
      });
      future.current = []; // a fresh edit invalidates redo
      if (burstTimer.current) clearTimeout(burstTimer.current);
      burstTimer.current = setTimeout(commitBurst, 500);
      bumpHist((t) => t + 1);
    },
    [commitBurst],
  );

  const undo = useCallback(() => {
    commitBurst();
    const prevState = past.current.pop();
    if (prevState === undefined) return;
    future.current.push(stateRef.current);
    setState(prevState);
    setUiKey((k) => k + 1);
    bumpHist((t) => t + 1);
  }, [commitBurst]);

  const redo = useCallback(() => {
    commitBurst();
    const nextState = future.current.pop();
    if (nextState === undefined) return;
    past.current.push(stateRef.current);
    setState(nextState);
    setUiKey((k) => k + 1);
    bumpHist((t) => t + 1);
  }, [commitBurst]);

  /* Swap in a whole new document (load, reset) and start history fresh. */
  const replace = useCallback((next: T) => {
    normRef.current?.(next);
    past.current = [];
    future.current = [];
    burstBase.current = null;
    if (burstTimer.current) {
      clearTimeout(burstTimer.current);
      burstTimer.current = null;
    }
    setState(next);
    setUiKey((k) => k + 1);
    bumpHist((t) => t + 1);
  }, []);

  const canUndo = past.current.length > 0 || burstBase.current !== null;
  const canRedo = future.current.length > 0;

  useEffect(() => () => void (burstTimer.current && clearTimeout(burstTimer.current)), []);

  // Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z or Ctrl/⌘+Y redo (skipped while typing in a field).
  useEffect(() => {
    const isTyping = (el: Element | null) =>
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        (el as HTMLElement).isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(document.activeElement)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return { state, stateRef, mutate, undo, redo, canUndo, canRedo, replace, uiKey };
}
