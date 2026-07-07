import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize, MousePointer2, Hand, Undo2, Redo2 } from "lucide-react";
import { layout, render, type GraphState } from "@/lib/graph";

export type Mutate = (fn: (s: GraphState) => void) => void;

type Tool = "select" | "hand";
type Drag =
  | { kind: "point"; si: number; pi: number }
  | { kind: "pan"; x: number; y: number; sl: number; st: number };

const ZMIN = 0.2;
const ZMAX = 6;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/* Preview-only background swatches — for eyeballing the graph against different host
   themes. This never touches the exported PNG (that stays controlled by the Export tab). */
const checker = (px: number) =>
  `repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 0 0 / ${px}px ${px}px`;
const BG_SWATCHES = [
  "transparent",
  "#ffffff",
  "#f3f4f6",
  "#e5e7eb",
  "#9ca3af",
  "#4b5563",
  "#1f2937",
  "#000000",
  "#0b1220",
  "#fdf6e3",
];

function Divider() {
  return <div className="mx-1 h-4 w-px shrink-0 bg-border" />;
}

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function GraphStage({
  state,
  mutate,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  state: GraphState;
  mutate: Mutate;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const dragRef = useRef<Drag | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const [zoomPct, setZoomPct] = useState(100);
  const [selected, setSelected] = useState<{ si: number; pi: number } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [readout, setReadout] = useState<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const spaceRef = useRef(false);
  const [previewBg, setPreviewBg] = useState("#ffffff");
  const [bgOpen, setBgOpen] = useState(false);
  const bgBtnRef = useRef<HTMLButtonElement | null>(null);
  const bgPanelRef = useRef<HTMLDivElement | null>(null);

  // Effective tool: Space (or an explicit hand selection) temporarily gives the hand.
  const effTool: Tool = spaceHeld || tool === "hand" ? "hand" : "select";
  const liveTool = () => (spaceRef.current || toolRef.current === "hand" ? "hand" : "select");
  const restingCursor = () => (liveTool() === "hand" ? "grab" : "crosshair");

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    const lay = layout(ctx, s, s.scale * zoomRef.current);
    canvas.width = Math.round(lay.W * dpr);
    canvas.height = Math.round(lay.H * dpr);
    canvas.style.width = lay.W + "px";
    canvas.style.height = lay.H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // background stays null on screen; the chosen preview colour is a CSS layer under the canvas.
    // Hide the selection ring while actively dragging a point (its index is in flux).
    const sel = dragRef.current?.kind === "point" ? null : selectedRef.current;
    render(ctx, s, s.scale * zoomRef.current, {
      showHandles: true,
      background: null,
      selected: sel,
    });
  }, []);

  useEffect(() => {
    draw();
  }, [state, selected, draw]);

  // Drop the selection if the point it referred to no longer exists.
  useEffect(() => {
    if (selected && !state.series[selected.si]?.points[selected.pi]) setSelected(null);
  }, [state, selected]);

  /* ---------- pointer editing ---------- */
  const getLayout = () => {
    const ctx = canvasRef.current!.getContext("2d")!;
    return layout(ctx, stateRef.current, stateRef.current.scale * zoomRef.current);
  };

  const evtPos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    const lay = getLayout();
    return [((e.clientX - r.left) * lay.W) / r.width, ((e.clientY - r.top) * lay.H) / r.height];
  };

  const hitPoint = (pos: [number, number]): { si: number; pi: number } | null => {
    const lay = getLayout();
    let best: { si: number; pi: number } | null = null;
    let bd = 110; // ~10 px radius, squared
    stateRef.current.series.forEach((s, si) =>
      s.points.forEach((pt, pi) => {
        const [qx, qy] = lay.toPx(pt[0], pt[1]);
        const d = (qx - pos[0]) ** 2 + (qy - pos[1]) ** 2;
        if (d < bd) {
          bd = d;
          best = { si, pi };
        }
      }),
    );
    return best as { si: number; pi: number } | null;
  };

  const clampSnap = ([wx, wy]: [number, number], noSnap = false): [number, number] => {
    const { x: ax, y: ay } = stateRef.current.axes;
    wx = Math.min(ax.max, Math.max(ax.min, wx));
    wy = Math.min(ay.max, Math.max(ay.min, wy));
    if (stateRef.current.snap && !noSnap) {
      const mx = ax.step / Math.max(1, ax.minorPerMajor || 1);
      const my = ay.step / Math.max(1, ay.minorPerMajor || 1);
      if (mx > 0) wx = Math.round(wx / mx) * mx;
      if (my > 0) wy = Math.round(wy / my) * my;
    }
    return [r3(wx), r3(wy)];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (liveTool() === "hand") {
      const stage = stageRef.current!;
      dragRef.current = {
        kind: "pan",
        x: e.clientX,
        y: e.clientY,
        sl: stage.scrollLeft,
        st: stage.scrollTop,
      };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }
    const hit = hitPoint(evtPos(e));
    if (!hit) {
      setSelected(null); // click on empty space clears the selection
      return;
    }
    dragRef.current = { kind: "point", si: hit.si, pi: hit.pi };
    setSelected({ si: hit.si, pi: hit.pi });
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
    mutate((s) => {
      s.active = hit.si;
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const d = dragRef.current;
    if (d?.kind === "pan") {
      const stage = stageRef.current!;
      stage.scrollLeft = d.sl - (e.clientX - d.x);
      stage.scrollTop = d.st - (e.clientY - d.y);
      return;
    }
    if (d?.kind === "point") {
      const { si, pi } = d;
      const [wx, wy] = clampSnap(getLayout().toWorld(...evtPos(e)), e.altKey); // Alt bypasses snap
      mutate((s) => {
        const pts = s.series[si].points;
        pts[pi] = [wx, wy];
        const target = pts[pi];
        pts.sort((a, b) => a[0] - b[0]);
        dragRef.current = { kind: "point", si, pi: pts.indexOf(target) };
      });
      const root = rootRef.current;
      if (root) {
        const rr = root.getBoundingClientRect();
        setReadout({ x: wx, y: wy, left: e.clientX - rr.left, top: e.clientY - rr.top });
      }
      return;
    }
    // hover feedback (no active drag)
    if (liveTool() === "hand") {
      canvas.style.cursor = "grab";
      return;
    }
    canvas.style.cursor = hitPoint(evtPos(e)) ? "grab" : "crosshair";
  };

  const endDrag = () => {
    const d = dragRef.current;
    if (d?.kind === "point") setSelected({ si: d.si, pi: d.pi }); // land the selection on the final index
    dragRef.current = null;
    setReadout(null);
    if (canvasRef.current) canvasRef.current.style.cursor = restingCursor();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (liveTool() === "hand") return; // hand tool never edits points
    if (hitPoint(evtPos(e))) return;
    const p = clampSnap(getLayout().toWorld(...evtPos(e)), e.altKey);
    mutate((s) => {
      const pts = s.series[s.active].points;
      pts.push(p);
      pts.sort((a, b) => a[0] - b[0]);
    });
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (liveTool() === "hand") return;
    const hit = hitPoint(evtPos(e));
    if (!hit) return;
    e.preventDefault();
    mutate((s) => {
      const pts = s.series[hit.si].points;
      if (pts.length > 2) pts.splice(hit.pi, 1);
    });
    setSelected(null);
  };

  /* ---------- zoom (on-screen only; leaves the data + export untouched) ---------- */
  const applyZoom = useCallback(
    (nz: number, cx?: number, cy?: number) => {
      nz = clamp(nz, ZMIN, ZMAX);
      const stage = stageRef.current!;
      const canvas = canvasRef.current!;
      const before = canvas.getBoundingClientRect();
      if (cx == null || cy == null) {
        const s = stage.getBoundingClientRect();
        cx = s.left + s.width / 2;
        cy = s.top + s.height / 2;
      }
      const fx = clamp((cx - before.left) / before.width, 0, 1);
      const fy = clamp((cy - before.top) / before.height, 0, 1);
      zoomRef.current = nz;
      draw();
      setZoomPct(Math.round(nz * 100));
      const after = canvas.getBoundingClientRect();
      stage.scrollLeft += after.left + fx * after.width - cx;
      stage.scrollTop += after.top + fy * after.height - cy;
    },
    [draw],
  );

  const fitZoom = () => {
    const stage = stageRef.current!;
    const ctx = canvasRef.current!.getContext("2d")!;
    const nat = layout(ctx, stateRef.current, stateRef.current.scale);
    applyZoom(Math.min((stage.clientWidth - 120) / nat.W, (stage.clientHeight - 120) / nat.H));
  };

  // Ctrl/⌘ + wheel zooms anywhere over the stage (not just the canvas) so it never
  // slips through to the browser's page zoom. Plain wheel scrolls the stage natively.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      applyZoom(zoomRef.current * Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  /* ---------- keyboard: Space = hold-to-pan · V = select · H = hand ---------- */
  useEffect(() => {
    const isTyping = (el: Element | null) =>
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        (el as HTMLElement).isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if (e.ctrlKey || e.metaKey) return; // let Ctrl/⌘ shortcuts (undo/redo, paste) through
      if (e.code === "Space") {
        e.preventDefault(); // stop page scroll + button re-trigger while panning
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceHeld(true);
          if (!dragRef.current && canvasRef.current) canvasRef.current.style.cursor = "grab";
        }
      } else if (e.key === "v" || e.key === "V") {
        setTool("select");
      } else if (e.key === "h" || e.key === "H") {
        setTool("hand");
      } else if (e.key.startsWith("Arrow")) {
        // nudge the selected point by one minor step (Shift = one major step)
        const sp = selectedRef.current;
        if (!sp || liveTool() === "hand") return;
        const s = stateRef.current;
        const ser = s.series[sp.si];
        const cur = ser?.points[sp.pi];
        if (!cur) return;
        e.preventDefault();
        const { x: ax, y: ay } = s.axes;
        const dX =
          ax.step > 0
            ? e.shiftKey
              ? ax.step
              : ax.step / Math.max(1, ax.minorPerMajor || 1)
            : (ax.max - ax.min) / 50;
        const dY =
          ay.step > 0
            ? e.shiftKey
              ? ay.step
              : ay.step / Math.max(1, ay.minorPerMajor || 1)
            : (ay.max - ay.min) / 50;
        let nx = cur[0];
        let ny = cur[1];
        if (e.key === "ArrowLeft") nx -= dX;
        else if (e.key === "ArrowRight") nx += dX;
        else if (e.key === "ArrowUp") ny += dY;
        else if (e.key === "ArrowDown") ny -= dY;
        else return;
        nx = r3(clamp(nx, ax.min, ax.max));
        ny = r3(clamp(ny, ay.min, ay.max));
        const pts = ser.points.map((p, i) =>
          i === sp.pi ? ([nx, ny] as [number, number]) : ([p[0], p[1]] as [number, number]),
        );
        const moved = pts[sp.pi];
        pts.sort((a, b) => a[0] - b[0]);
        const npi = pts.indexOf(moved);
        mutateRef.current((st) => {
          st.series[sp.si].points = pts;
        });
        setSelected({ si: sp.si, pi: npi });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceRef.current) {
        spaceRef.current = false;
        setSpaceHeld(false);
        if (!dragRef.current && canvasRef.current) canvasRef.current.style.cursor = restingCursor();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the resting cursor in sync when the tool (or Space state) changes mid-hover.
  useEffect(() => {
    if (!dragRef.current && canvasRef.current)
      canvasRef.current.style.cursor = effTool === "hand" ? "grab" : "crosshair";
  }, [effTool]);

  // Close the background dropdown on outside click or Escape.
  useEffect(() => {
    if (!bgOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (bgPanelRef.current?.contains(t) || bgBtnRef.current?.contains(t)) return;
      setBgOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBgOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [bgOpen]);

  return (
    <div ref={rootRef} className="relative h-full w-full">
      <div ref={stageRef} className="stage-dots absolute inset-0 overflow-auto">
        <div className="flex min-h-full w-max min-w-full items-center justify-center p-12">
          <div className="rounded-xl border border-border bg-card p-3 shadow-card">
            <canvas
              ref={canvasRef}
              className="block touch-none"
              style={{ background: previewBg === "transparent" ? checker(16) : previewBg }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
            />
          </div>
        </div>
      </div>

      {/* floating toolbar: undo/redo · tools · zoom · fit · preview background */}
      <div className="absolute bottom-4 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card px-1.5 py-1 shadow-card">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl/⌘ + Z)"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl/⌘ + Shift + Z)"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <Divider />

        <ToolButton
          active={effTool === "select"}
          title="Select tool (V) — drag points"
          onClick={() => setTool("select")}
        >
          <MousePointer2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          active={effTool === "hand"}
          title="Hand tool (H, or hold Space) — drag to pan"
          onClick={() => setTool("hand")}
        >
          <Hand className="h-4 w-4" />
        </ToolButton>

        <Divider />

        <button
          type="button"
          onClick={() => applyZoom(zoomRef.current / 1.25)}
          title="Zoom out"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => applyZoom(1)}
          title="Reset to 100%"
          className="min-w-14 shrink-0 rounded-full px-2 py-1.5 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-muted"
        >
          {zoomPct}%
        </button>
        <button
          type="button"
          onClick={() => applyZoom(zoomRef.current * 1.25)}
          title="Zoom in"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>

        <Divider />

        <button
          type="button"
          onClick={fitZoom}
          title="Fit graph to view"
          className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Maximize className="h-3.5 w-3.5" />
          Fit
        </button>

        <Divider />

        <button
          ref={bgBtnRef}
          type="button"
          onClick={() => setBgOpen((o) => !o)}
          title="Preview background (on-screen only, not exported)"
          aria-expanded={bgOpen}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
        >
          <span
            className="h-4 w-4 rounded-full border border-border shadow-inner"
            style={{ background: previewBg === "transparent" ? checker(6) : previewBg }}
          />
        </button>
      </div>

      {/* preview-background dropdown — rendered outside the toolbar so its overflow can't clip it */}
      {bgOpen && (
        <div
          ref={bgPanelRef}
          className="absolute bottom-16 left-1/2 z-20 w-56 -translate-x-1/2 rounded-xl border border-border bg-card p-2.5 text-foreground shadow-card"
        >
          <p className="mb-2 text-xs font-medium">Preview background</p>
          <div className="grid grid-cols-5 gap-1.5">
            {BG_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                title={c === "transparent" ? "Transparent" : c}
                onClick={() => setPreviewBg(c)}
                className={`h-7 w-7 rounded-md border transition ${
                  previewBg === c
                    ? "border-primary ring-2 ring-primary ring-offset-1 ring-offset-card"
                    : "border-border hover:border-primary/60"
                }`}
                style={{ background: c === "transparent" ? checker(6) : c }}
              />
            ))}
          </div>
          <label className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            Custom colour
            <input
              type="color"
              value={previewBg.startsWith("#") ? previewBg : "#ffffff"}
              onChange={(e) => setPreviewBg(e.target.value)}
              className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
          </label>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground/80">
            On-screen preview only — the exported PNG is set in the Export tab.
          </p>
        </div>
      )}

      {/* live x,y readout while dragging a point */}
      {readout && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md bg-foreground/90 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-background shadow"
          style={{ left: readout.left, top: readout.top - 12 }}
        >
          {readout.x}, {readout.y}
        </div>
      )}

      {/* interaction tips */}
      <p className="pointer-events-none absolute bottom-4 left-4 hidden max-w-56 text-[11px] leading-relaxed text-muted-foreground lg:block">
        Drag points · double-click to add · right-click to delete · arrow keys nudge · Alt bypasses
        snap · Space to pan · Ctrl/⌘ + scroll to zoom
      </p>
    </div>
  );
}
