import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize } from "lucide-react";
import { layout, render, type GraphState } from "@/lib/graph";

export type Mutate = (fn: (s: GraphState) => void) => void;

const ZMIN = 0.2;
const ZMAX = 6;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function GraphStage({ state, mutate }: { state: GraphState; mutate: Mutate }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const dragRef = useRef<{ si: number; pi: number } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [zoomPct, setZoomPct] = useState(100);

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
    render(ctx, s, s.scale * zoomRef.current, { showHandles: true, background: "#fff" });
  }, []);

  useEffect(() => {
    draw();
  }, [state, draw]);

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

  const hitPoint = (pos: [number, number]) => {
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
    return best;
  };

  const clampSnap = ([wx, wy]: [number, number]): [number, number] => {
    const { x: ax, y: ay } = stateRef.current.axes;
    wx = Math.min(ax.max, Math.max(ax.min, wx));
    wy = Math.min(ay.max, Math.max(ay.min, wy));
    if (stateRef.current.snap) {
      const mx = ax.step / Math.max(1, ax.minorPerMajor || 1);
      const my = ay.step / Math.max(1, ay.minorPerMajor || 1);
      if (mx > 0) wx = Math.round(wx / mx) * mx;
      if (my > 0) wy = Math.round(wy / my) * my;
    }
    return [r3(wx), r3(wy)];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = hitPoint(evtPos(e));
    if (!hit) return;
    dragRef.current = hit;
    canvasRef.current!.setPointerCapture(e.pointerId);
    canvasRef.current!.style.cursor = "grabbing";
    mutate((s) => {
      s.active = hit.si;
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (!dragRef.current) {
      canvas.style.cursor = hitPoint(evtPos(e)) ? "grab" : "crosshair";
      return;
    }
    const { si, pi } = dragRef.current;
    const [wx, wy] = clampSnap(getLayout().toWorld(...evtPos(e)));
    mutate((s) => {
      const pts = s.series[si].points;
      pts[pi] = [wx, wy];
      const target = pts[pi];
      pts.sort((a, b) => a[0] - b[0]);
      dragRef.current = { si, pi: pts.indexOf(target) };
    });
  };

  const endDrag = () => {
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (hitPoint(evtPos(e))) return;
    const p = clampSnap(getLayout().toWorld(...evtPos(e)));
    mutate((s) => {
      const pts = s.series[s.active].points;
      pts.push(p);
      pts.sort((a, b) => a[0] - b[0]);
    });
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitPoint(evtPos(e));
    if (!hit) return;
    e.preventDefault();
    mutate((s) => {
      const pts = s.series[hit.si].points;
      if (pts.length > 2) pts.splice(hit.pi, 1);
    });
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls the stage instead
      e.preventDefault();
      applyZoom(zoomRef.current * Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  return (
    <div className="relative h-full w-full">
      <div ref={stageRef} className="stage-dots absolute inset-0 overflow-auto">
        <div className="flex min-h-full w-max min-w-full items-center justify-center p-12">
          <div className="rounded-xl border border-border bg-card p-3 shadow-card">
            <canvas
              ref={canvasRef}
              className="block cursor-crosshair touch-none"
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

      {/* floating zoom toolbar */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-1 shadow-card">
        <button
          onClick={() => applyZoom(zoomRef.current / 1.25)}
          title="Zoom out"
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={() => applyZoom(1)}
          title="Reset to 100%"
          className="min-w-14 rounded-full px-2 py-1.5 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-muted"
        >
          {zoomPct}%
        </button>
        <button
          onClick={() => applyZoom(zoomRef.current * 1.25)}
          title="Zoom in"
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          onClick={fitZoom}
          title="Fit graph to view"
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Maximize className="h-3.5 w-3.5" />
          Fit
        </button>
      </div>

      {/* interaction tips */}
      <p className="pointer-events-none absolute bottom-4 left-4 hidden max-w-52 text-[11px] leading-relaxed text-muted-foreground lg:block">
        Drag points · double-click to add · right-click to delete · Ctrl/⌘ + scroll to zoom
      </p>
    </div>
  );
}
