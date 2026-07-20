import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize, MousePointer2, Hand, Undo2, Redo2, RotateCw } from "lucide-react";
import {
  layoutCircuit,
  renderCircuit,
  chainRoot,
  endAnchor,
  setEndAnchor,
  pinPositionsOf,
  unbindFrom,
  wireEndIndex,
  worldHalfExtents,
  localMat,
  r3,
  type Anchor,
  type CircuitState,
  type Selection,
  type Wire,
  type WireEnd,
} from "@/lib/circuit";
import { matApply, matInverse, matMul } from "@/lib/circuit-pen";
import { SYMBOLS } from "@/lib/circuit-symbols";
import type { MutateFn } from "@/hooks/use-history";

export type CircuitMutate = MutateFn<CircuitState>;

type Tool = "select" | "hand";
type Drag =
  | { kind: "pan"; x: number; y: number; sl: number; st: number }
  | { kind: "comp"; id: string; dx: number; dy: number }
  | {
      kind: "tip";
      wire: string;
      end: WireEnd;
      spawned: boolean; // freshly pulled from a pin/tip — Esc or a no-move release removes it
      moved: boolean;
      pending: Anchor | null; // snap candidate to bind on release
    }
  | { kind: "vertex"; wire: string; i: number };

const ZMIN = 0.2;
const ZMAX = 6;
/* interaction thresholds, screen px (canvas px == CSS px in this stage) */
const SNAP_R = 12; // magnetic tip/pin snapping while dragging a wire tip
const HIT_TIP = 10;
const HIT_VERTEX = 8;
const HIT_PIN = 10;
const HIT_SEG = 6;
const GRID_SNAP = 0.5; // cells

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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

function distSeg(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { d: number; t: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return { d: Math.hypot(px - qx, py - qy), t };
}

export interface SelectionOps {
  rotateSel: (dir: 1 | -1) => void;
  deleteSel: () => void;
  duplicateSel: () => void;
}

export function CircuitStage({
  state,
  mutate,
  sel,
  setSel,
  ops,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  viewCenterRef,
}: {
  state: CircuitState;
  mutate: CircuitMutate;
  sel: Selection;
  setSel: (s: Selection) => void;
  ops: SelectionOps;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  viewCenterRef?: React.MutableRefObject<[number, number]>; // world coords of the viewport centre, for palette inserts
}) {
  const opsRef = useRef(ops);
  opsRef.current = ops;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const dragRef = useRef<Drag | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const selRef = useRef(sel);
  selRef.current = sel;
  const [zoomPct, setZoomPct] = useState(100);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
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

  const effTool: Tool = spaceHeld || tool === "hand" ? "hand" : "select";
  const liveTool = () => (spaceRef.current || toolRef.current === "hand" ? "hand" : "select");
  const restingCursor = () => (liveTool() === "hand" ? "grab" : "default");

  const getLayout = useCallback(
    () => layoutCircuit(stateRef.current, stateRef.current.grid * zoomRef.current),
    [],
  );

  const updateViewCenter = useCallback(() => {
    if (!viewCenterRef) return;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const sr = stage.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const lay = getLayout();
    const px = ((sr.left + sr.width / 2 - cr.left) * lay.W) / cr.width;
    const py = ((sr.top + sr.height / 2 - cr.top) * lay.H) / cr.height;
    const [wx, wy] = lay.toWorld(px, py);
    viewCenterRef.current = [
      clamp(Math.round(wx * 2) / 2, 2, stateRef.current.sheet.w - 2),
      clamp(Math.round(wy * 2) / 2, 2, stateRef.current.sheet.h - 2),
    ];
  }, [getLayout, viewCenterRef]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    const lay = getLayout();
    canvas.width = Math.round(lay.W * dpr);
    canvas.height = Math.round(lay.H * dpr);
    canvas.style.width = lay.W + "px";
    canvas.style.height = lay.H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderCircuit(ctx, s, s.grid * zoomRef.current, {
      showHandles: true,
      background: null,
      selection: selRef.current,
      hover: hoverRef.current,
    });
    updateViewCenter();
  }, [getLayout, updateViewCenter]);

  useEffect(() => {
    draw();
  }, [state, sel, hover, draw]);

  // Drop the selection if the entity it referred to no longer exists (undo, delete, load).
  useEffect(() => {
    if (!sel) return;
    const exists =
      sel.kind === "comp"
        ? state.components.some((c) => c.id === sel.id)
        : state.wires.some((w) => w.id === sel.id);
    if (!exists) setSel(null);
  }, [state, sel, setSel]);

  /* ---------- hit-testing (positions in canvas px) ---------- */

  const evtPos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    const lay = getLayout();
    return [((e.clientX - r.left) * lay.W) / r.width, ((e.clientY - r.top) * lay.H) / r.height];
  };

  const hitTip = (pos: [number, number]): { wire: Wire; end: WireEnd } | null => {
    const lay = getLayout();
    let best: { wire: Wire; end: WireEnd } | null = null;
    let bd = HIT_TIP;
    // later wires draw on top — prefer them on ties by iterating forward and using <=
    for (const w of stateRef.current.wires) {
      for (const end of [0, 1] as const) {
        const p = w.pts[wireEndIndex(w, end)];
        const [qx, qy] = lay.toPx(p[0], p[1]);
        const d = Math.hypot(qx - pos[0], qy - pos[1]);
        if (d <= bd) {
          bd = d;
          best = { wire: w, end };
        }
      }
    }
    return best;
  };

  const hitVertex = (pos: [number, number]): { wire: Wire; i: number } | null => {
    const lay = getLayout();
    let best: { wire: Wire; i: number } | null = null;
    let bd = HIT_VERTEX;
    for (const w of stateRef.current.wires) {
      for (let i = 1; i < w.pts.length - 1; i++) {
        const [qx, qy] = lay.toPx(w.pts[i][0], w.pts[i][1]);
        const d = Math.hypot(qx - pos[0], qy - pos[1]);
        if (d <= bd) {
          bd = d;
          best = { wire: w, i };
        }
      }
    }
    return best;
  };

  const hitPin = (pos: [number, number]): { compId: string; pin: number } | null => {
    const lay = getLayout();
    let best: { compId: string; pin: number } | null = null;
    let bd = HIT_PIN;
    for (const c of stateRef.current.components) {
      const pins = pinPositionsOf(c);
      for (let i = 0; i < pins.length; i++) {
        const [qx, qy] = lay.toPx(pins[i][0], pins[i][1]);
        const d = Math.hypot(qx - pos[0], qy - pos[1]);
        if (d <= bd) {
          bd = d;
          best = { compId: c.id, pin: i };
        }
      }
    }
    return best;
  };

  const hitBody = (pos: [number, number]): string | null => {
    const lay = getLayout();
    const [wx, wy] = lay.toWorld(pos[0], pos[1]);
    const comps = stateRef.current.components;
    for (let i = comps.length - 1; i >= 0; i--) {
      const c = comps[i];
      const spec = SYMBOLS[c.kind];
      const [lx, ly] = matApply(matInverse(localMat(c)), wx, wy);
      if (Math.abs(lx) <= spec.span / 2 + 0.2 && Math.abs(ly) <= spec.h + 0.2) return c.id;
    }
    return null;
  };

  const hitSegment = (
    pos: [number, number],
  ): { wire: Wire; seg: number; at: [number, number] } | null => {
    const lay = getLayout();
    const [wx, wy] = lay.toWorld(pos[0], pos[1]);
    let best: { wire: Wire; seg: number; at: [number, number] } | null = null;
    let bd = HIT_SEG / lay.u; // compare in world units
    for (const w of stateRef.current.wires) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const [x1, y1] = w.pts[i];
        const [x2, y2] = w.pts[i + 1];
        const { d, t } = distSeg(wx, wy, x1, y1, x2, y2);
        if (d <= bd) {
          bd = d;
          best = { wire: w, seg: i, at: [x1 + t * (x2 - x1), y1 + t * (y2 - y1)] };
        }
      }
    }
    return best;
  };

  const clampSnap = ([wx, wy]: [number, number], noSnap = false): [number, number] => {
    const s = stateRef.current;
    wx = clamp(wx, 0, s.sheet.w);
    wy = clamp(wy, 0, s.sheet.h);
    if (s.snap && !noSnap) {
      wx = Math.round(wx / GRID_SNAP) * GRID_SNAP;
      wy = Math.round(wy / GRID_SNAP) * GRID_SNAP;
    }
    return [r3(wx), r3(wy)];
  };

  /* ---------- wire-tip drag: candidates + binding ---------- */

  /* Everything a dragged tip may magnetically snap to. Excludes its own wire's tips,
     tips whose chain resolves back to the dragged tip (cycle guard), and whatever the
     wire's OTHER end is bound to (a wire must not collapse onto a single point). */
  const snapCandidates = (wireId: string, end: WireEnd) => {
    const s = stateRef.current;
    const w = s.wires.find((x) => x.id === wireId)!;
    const other = endAnchor(w, (1 - end) as WireEnd);
    const out: { x: number; y: number; anchor: Anchor }[] = [];
    for (const c of s.components) {
      const pins = pinPositionsOf(c);
      for (let i = 0; i < pins.length; i++) {
        if (other.t === "pin" && other.comp === c.id && other.pin === i) continue;
        out.push({ x: pins[i][0], y: pins[i][1], anchor: { t: "pin", comp: c.id, pin: i } });
      }
    }
    for (const w2 of s.wires) {
      if (w2.id === wireId) continue;
      for (const e2 of [0, 1] as const) {
        const root = chainRoot(s, w2.id, e2);
        if (root.wire === wireId) continue; // binding would chain back into the dragged wire
        if (other.t === "wire" && other.wire === w2.id && other.end === e2) continue;
        const p = w2.pts[wireEndIndex(w2, e2)];
        out.push({ x: p[0], y: p[1], anchor: { t: "wire", wire: w2.id, end: e2 } });
      }
    }
    return out;
  };

  /* Resolve a bind-target through chain roots so stored anchors always point at a root
     (a pin, or a tip whose own anchor is free). */
  const resolveBind = (s: CircuitState, pending: Anchor, selfWire: string): Anchor => {
    if (pending.t !== "wire") return pending;
    const root = chainRoot(s, pending.wire, pending.end);
    if (root.wire === selfWire) return { t: "free" };
    if (root.anchor.t === "pin") return root.anchor;
    return { t: "wire", wire: root.wire, end: root.end };
  };

  const spawnWire = (bind: Anchor, at: [number, number]): string => {
    let id = "";
    mutateRef.current((s) => {
      id = `w${s.seq++}`;
      s.wires.push({ id, pts: [[...at], [...at]], a: bind, b: { t: "free" } });
    });
    return id;
  };

  /* ---------- pointer handlers ---------- */

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (e.button === 2) return; // context-menu handler owns right-clicks
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
    const pos = evtPos(e);
    const lay = getLayout();

    const tip = hitTip(pos);
    if (tip) {
      const p = tip.wire.pts[wireEndIndex(tip.wire, tip.end)];
      if (e.shiftKey) {
        // chain a NEW wire off this tip
        const bind = resolveBind(
          stateRef.current,
          { t: "wire", wire: tip.wire.id, end: tip.end },
          "",
        );
        const id = spawnWire(bind, [p[0], p[1]]);
        dragRef.current = {
          kind: "tip",
          wire: id,
          end: 1,
          spawned: true,
          moved: false,
          pending: null,
        };
        setSel({ kind: "wire", id });
      } else {
        // grab = detach and drag this tip
        mutateRef.current((s) => {
          const w = s.wires.find((x) => x.id === tip.wire.id);
          if (w) setEndAnchor(w, tip.end, { t: "free" });
        });
        dragRef.current = {
          kind: "tip",
          wire: tip.wire.id,
          end: tip.end,
          spawned: false,
          moved: false,
          pending: null,
        };
        setSel({ kind: "wire", id: tip.wire.id });
      }
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }

    const vtx = hitVertex(pos);
    if (vtx) {
      dragRef.current = { kind: "vertex", wire: vtx.wire.id, i: vtx.i };
      setSel({ kind: "wire", id: vtx.wire.id });
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }

    const pin = hitPin(pos);
    if (pin) {
      // pull a new lead wire out of the pin
      const c = stateRef.current.components.find((x) => x.id === pin.compId)!;
      const at = pinPositionsOf(c)[pin.pin];
      const id = spawnWire({ t: "pin", comp: pin.compId, pin: pin.pin }, at);
      dragRef.current = {
        kind: "tip",
        wire: id,
        end: 1,
        spawned: true,
        moved: false,
        pending: null,
      };
      setSel({ kind: "wire", id });
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }

    const bodyId = hitBody(pos);
    if (bodyId) {
      const c = stateRef.current.components.find((x) => x.id === bodyId)!;
      const [wx, wy] = lay.toWorld(pos[0], pos[1]);
      dragRef.current = { kind: "comp", id: bodyId, dx: wx - c.x, dy: wy - c.y };
      setSel({ kind: "comp", id: bodyId });
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }

    const seg = hitSegment(pos);
    if (seg) {
      // press a wire to bend it: insert a vertex right here and drag it
      const i = seg.seg + 1;
      mutateRef.current((s) => {
        const w = s.wires.find((x) => x.id === seg.wire.id);
        if (w) w.pts.splice(i, 0, [r3(seg.at[0]), r3(seg.at[1])]);
      });
      dragRef.current = { kind: "vertex", wire: seg.wire.id, i };
      setSel({ kind: "wire", id: seg.wire.id });
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }

    setSel(null);
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
    const lay = getLayout();
    const pos = evtPos(e);

    const showReadout = (wx: number, wy: number) => {
      const root = rootRef.current;
      if (!root) return;
      const rr = root.getBoundingClientRect();
      setReadout({ x: wx, y: wy, left: e.clientX - rr.left, top: e.clientY - rr.top });
    };

    if (d?.kind === "comp") {
      const [wx, wy] = lay.toWorld(pos[0], pos[1]);
      const [nx, ny] = clampSnap([wx - d.dx, wy - d.dy], e.altKey);
      mutateRef.current((s) => {
        const c = s.components.find((x) => x.id === d.id);
        if (c) {
          c.x = nx;
          c.y = ny;
        }
      });
      showReadout(nx, ny);
      return;
    }

    if (d?.kind === "vertex") {
      const p = clampSnap(lay.toWorld(pos[0], pos[1]), e.altKey);
      mutateRef.current((s) => {
        const w = s.wires.find((x) => x.id === d.wire);
        if (w && d.i > 0 && d.i < w.pts.length - 1) w.pts[d.i] = p;
      });
      showReadout(p[0], p[1]);
      return;
    }

    if (d?.kind === "tip") {
      d.moved = true;
      // magnetic snap to the nearest pin / other wire tip within SNAP_R
      let target: { x: number; y: number; anchor: Anchor } | null = null;
      let bd = SNAP_R;
      for (const cand of snapCandidates(d.wire, d.end)) {
        const [qx, qy] = lay.toPx(cand.x, cand.y);
        const dist = Math.hypot(qx - pos[0], qy - pos[1]);
        // pins beat tips at equal distance: candidates list pins first
        if (dist < bd || (dist === bd && !target)) {
          bd = dist;
          target = cand;
        }
      }
      let p: [number, number];
      if (target) {
        p = [target.x, target.y];
        d.pending = target.anchor;
        setHover({ x: target.x, y: target.y });
      } else {
        p = clampSnap(lay.toWorld(pos[0], pos[1]), e.altKey);
        d.pending = null;
        setHover(null);
      }
      mutateRef.current((s) => {
        const w = s.wires.find((x) => x.id === d.wire);
        if (w) w.pts[wireEndIndex(w, d.end)] = p;
      });
      showReadout(p[0], p[1]);
      return;
    }

    // hover feedback (no active drag)
    if (liveTool() === "hand") {
      canvas.style.cursor = "grab";
      return;
    }
    canvas.style.cursor =
      hitTip(pos) || hitVertex(pos) || hitPin(pos)
        ? "crosshair"
        : hitBody(pos)
          ? "move"
          : hitSegment(pos)
            ? "copy"
            : "default";
  };

  const endDrag = () => {
    const d = dragRef.current;
    if (d?.kind === "tip") {
      const s = stateRef.current;
      if (d.spawned && !d.moved) {
        // a mere click on a pin/tip: no wire was meant, remove the zero-length spawn
        mutateRef.current((st) => {
          st.wires = st.wires.filter((w) => w.id !== d.wire);
        });
        setSel(null);
      } else if (d.pending) {
        const bind = resolveBind(s, d.pending, d.wire);
        mutateRef.current((st) => {
          const w = st.wires.find((x) => x.id === d.wire);
          if (w) setEndAnchor(w, d.end, bind); // settle() snaps the coord exactly on target
        });
      }
    }
    dragRef.current = null;
    setHover(null);
    setReadout(null);
    if (canvasRef.current) canvasRef.current.style.cursor = restingCursor();
  };

  const cancelDrag = () => {
    const d = dragRef.current;
    if (d?.kind === "tip" && d.spawned) {
      mutateRef.current((st) => {
        st.wires = st.wires.filter((w) => w.id !== d.wire);
      });
      setSel(null);
    }
    dragRef.current = null;
    setHover(null);
    setReadout(null);
    if (canvasRef.current) canvasRef.current.style.cursor = restingCursor();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (liveTool() === "hand") return;
    const bodyId = hitBody(evtPos(e));
    if (!bodyId) return;
    mutateRef.current((s) => {
      const c = s.components.find((x) => x.id === bodyId);
      if (!c) return;
      if (c.kind === "switch") c.closed = !c.closed;
      else if (c.kind === "lamp") c.on = !c.on;
    });
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (liveTool() === "hand") return;
    e.preventDefault();
    const pos = evtPos(e);

    const vtx = hitVertex(pos);
    if (vtx) {
      mutateRef.current((s) => {
        const w = s.wires.find((x) => x.id === vtx.wire.id);
        if (w && w.pts.length > 2) w.pts.splice(vtx.i, 1);
      });
      return;
    }
    const tip = hitTip(pos);
    if (tip) {
      mutateRef.current((s) => {
        unbindFrom(s, tip.wire.id);
        s.wires = s.wires.filter((w) => w.id !== tip.wire.id);
      });
      setSel(null);
      return;
    }
    const bodyId = hitBody(pos);
    if (bodyId) {
      mutateRef.current((s) => {
        unbindFrom(s, bodyId);
        s.components = s.components.filter((c) => c.id !== bodyId);
      });
      setSel(null);
      return;
    }
    const seg = hitSegment(pos);
    if (seg) {
      mutateRef.current((s) => {
        unbindFrom(s, seg.wire.id);
        s.wires = s.wires.filter((w) => w.id !== seg.wire.id);
      });
      setSel(null);
    }
  };

  /* ---------- zoom (on-screen only) ---------- */

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

  const fitZoom = useCallback(() => {
    const stage = stageRef.current!;
    const nat = layoutCircuit(stateRef.current, stateRef.current.grid);
    applyZoom(Math.min((stage.clientWidth - 100) / nat.W, (stage.clientHeight - 100) / nat.H));
  }, [applyZoom]);

  // fit the sheet on first mount so the whole page is visible
  useEffect(() => {
    fitZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const isTyping = (el: Element | null) =>
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        (el as HTMLElement).isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if (e.key === "Escape") {
        cancelDrag();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if ((e.key === "d" || e.key === "D") && selRef.current) {
          e.preventDefault();
          opsRef.current.duplicateSel();
        }
        return; // let Ctrl/⌘ undo-redo pass through to the history hook
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceHeld(true);
          if (!dragRef.current && canvasRef.current) canvasRef.current.style.cursor = "grab";
        }
      } else if (e.key === "v" || e.key === "V") {
        setTool("select");
      } else if (e.key === "h" || e.key === "H") {
        setTool("hand");
      } else if (e.key === "r" || e.key === "R") {
        opsRef.current.rotateSel(e.shiftKey ? -1 : 1);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selRef.current) {
          e.preventDefault();
          opsRef.current.deleteSel();
        }
      } else if (e.key.startsWith("Arrow")) {
        const s = selRef.current;
        if (!s || liveTool() === "hand") return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : GRID_SNAP;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (!dx && !dy) return;
        mutateRef.current((st) => {
          if (s.kind === "comp") {
            const c = st.components.find((x) => x.id === s.id);
            if (c) {
              c.x = r3(clamp(c.x + dx, 0, st.sheet.w));
              c.y = r3(clamp(c.y + dy, 0, st.sheet.h));
            }
          } else {
            const w = st.wires.find((x) => x.id === s.id);
            // nudging a wire shifts its free geometry; bound ends stay put via settle()
            if (w) w.pts = w.pts.map((p) => [r3(p[0] + dx), r3(p[1] + dy)]);
          }
        });
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

  useEffect(() => {
    if (!dragRef.current && canvasRef.current)
      canvasRef.current.style.cursor = effTool === "hand" ? "grab" : "default";
  }, [effTool]);

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
      <div
        ref={stageRef}
        className="stage-dots absolute inset-0 overflow-auto"
        onScroll={updateViewCenter}
      >
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

      {/* floating toolbar: undo/redo · tools · rotate · zoom · fit · preview background */}
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
          title="Select tool (V) — move parts, pull and shape wires"
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
        <button
          type="button"
          onClick={() => ops.rotateSel(1)}
          disabled={sel?.kind !== "comp"}
          title="Rotate selected 90° (R; Shift+R rotates back)"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCw className="h-4 w-4" />
        </button>

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
          title="Fit sheet to view"
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

      {readout && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md bg-foreground/90 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-background shadow"
          style={{ left: readout.left, top: readout.top - 12 }}
        >
          {readout.x}, {readout.y}
        </div>
      )}

      <p className="pointer-events-none absolute bottom-4 left-4 hidden max-w-60 text-[11px] leading-relaxed text-muted-foreground lg:block">
        Drag parts · drag a pin to pull a wire · drag wire ends onto pins to connect · press a wire
        to bend it · Shift-drag a tip to chain · right-click deletes · double-click toggles
        switch/lamp · R rotates · Alt bypasses snap · Space pans
      </p>
    </div>
  );
}
