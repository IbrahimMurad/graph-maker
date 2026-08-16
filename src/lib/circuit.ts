/* Circuit engine: pure rendering + document model.
   Mirrors the graph engine's architecture — one plain-data state object rendered by
   (ctx, state, scale) -> pixels for the live editor and the PNG exporter, plus an SVG
   mirror — but the two backends share ALL geometry through the Pen abstraction, so
   canvas, SVG and palette previews cannot drift apart.

   World units are grid cells on a fixed sheet (y grows downward, like the screen).
   `scale` is device px per cell: the editor passes grid × zoom, exporters pass grid
   and apply their export multiplier via ctx.setTransform, exactly like graph.ts. */

import {
  CanvasPen,
  FONT,
  INK,
  matApply,
  matMul,
  matRot,
  SvgPen,
  type Mat,
  type PathCmd,
  type Pen,
} from "./circuit-pen";
import { SYMBOLS } from "./circuit-symbols";

export type SymbolStyle = "iec" | "ansi";
export type Rot = 0 | 90 | 180 | 270;

export type ComponentKind =
  | "resistor"
  | "rheostat"
  | "battery"
  | "dcSource"
  | "acSource"
  | "lamp"
  | "capacitor"
  | "inductor"
  | "straightWire"
  | "loop"
  | "solenoid"
  | "ammeter"
  | "voltmeter"
  | "galvanometer"
  | "switch"
  | "transformer"
  | "ground"
  | "fuse"
  | "diode"
  | "led"
  | "terminal";

export interface CircuitComponent {
  id: string;
  kind: ComponentKind;
  x: number; // world units (cells), symbol centre
  y: number;
  rot: Rot;
  flip?: boolean; // mirror across the local x-axis
  label?: string; // "_" starts a subscript run: "R_1" renders as R₁
  value?: string; // free text under the symbol: "10 Ω"
  on?: boolean; // lamp
  closed?: boolean; // switch
  core?: boolean; // inductor / solenoid / transformer iron core
  cells?: number; // battery plate pairs, 1..5
}

export type WireEnd = 0 | 1; // pts[0] vs pts[pts.length - 1]

export type Anchor =
  | { t: "free" }
  | { t: "pin"; comp: string; pin: number }
  | { t: "wire"; wire: string; end: WireEnd }; // invariant: target end is a chain ROOT

export interface CurrentArrow {
  t: number; // 0..1 position along the wire's arc length
  dir: 1 | -1; // along pts order, or against it
  label?: string; // e.g. "I" or "I_1"
}

export interface Wire {
  id: string;
  pts: [number, number][]; // world coords, length >= 2
  a: Anchor; // binding of pts[0]
  b: Anchor; // binding of pts[last]
  arrow?: CurrentArrow; // current-direction marker drawn on the conductor
}

export interface Note {
  id: string;
  x: number; // world coords of the text anchor (centre)
  y: number;
  text: string; // "_" makes subscripts, same as labels
}

export interface FieldRegion {
  id: string;
  x: number; // top-left corner, world units
  y: number;
  w: number;
  h: number;
  mode: "in" | "out"; // ⊗ into the page · ⊙ out of the page
  spacing: number; // cells between marks
}

export interface CircuitState {
  version: 1;
  name: string;
  style: SymbolStyle;
  grid: number; // device px per cell at 100% zoom
  sheet: { w: number; h: number }; // cells
  snap: boolean;
  showGrid: boolean;
  hops: boolean; // draw a hop where wires cross without connecting
  fontSize: number; // label px at 100% zoom
  lineWidth: number; // conductor stroke px at 100% zoom
  components: CircuitComponent[];
  wires: Wire[];
  notes: Note[];
  fields: FieldRegion[];
  seq: number; // id counter
}

export type Selection = { kind: "comp" | "wire"; id: string } | null;

export const DEFAULT_GRID = 24;
export const PAD = 12; // device px of breathing room around the view box

export const r3 = (v: number) => Math.round(v * 1000) / 1000;

const GRID_C = {
  wash: "rgba(41, 171, 226, 0.08)",
  minor: "rgba(0, 113, 188, 0.28)",
  major: "rgba(0, 113, 188, 0.48)",
  border: "#0071bc",
};

export function defaultCircuit(): CircuitState {
  return {
    version: 1,
    name: "circuit",
    style: "iec",
    grid: DEFAULT_GRID,
    sheet: { w: 48, h: 32 },
    snap: true,
    showGrid: true,
    hops: true,
    fontSize: 15,
    lineWidth: 1.8,
    notes: [],
    fields: [],
    components: [
      { id: "c1", kind: "battery", x: 24, y: 22, rot: 0, cells: 2, value: "6 V" },
      { id: "c2", kind: "switch", x: 18, y: 16, rot: 90, label: "S" },
      { id: "c3", kind: "lamp", x: 30, y: 16, rot: 90 },
    ],
    wires: [
      {
        id: "w4",
        pts: [
          [22, 22],
          [18, 22],
          [18, 18],
        ],
        a: { t: "pin", comp: "c1", pin: 0 },
        b: { t: "pin", comp: "c2", pin: 1 },
      },
      {
        id: "w5",
        pts: [
          [18, 14],
          [18, 10],
          [30, 10],
          [30, 14],
        ],
        a: { t: "pin", comp: "c2", pin: 0 },
        b: { t: "pin", comp: "c3", pin: 0 },
      },
      {
        id: "w6",
        pts: [
          [30, 18],
          [30, 22],
          [26, 22],
        ],
        a: { t: "pin", comp: "c3", pin: 1 },
        b: { t: "pin", comp: "c1", pin: 1 },
      },
    ],
    seq: 7,
  };
}

/* ---------- geometry ---------- */

export function localMat(c: CircuitComponent): Mat {
  let m = matMul({ a: 1, b: 0, c: 0, d: 1, e: c.x, f: c.y }, matRot(c.rot));
  if (c.flip) m = matMul(m, { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 });
  return m;
}

export function localToWorld(c: CircuitComponent, lx: number, ly: number): [number, number] {
  const [x, y] = matApply(localMat(c), lx, ly);
  return [r3(x), r3(y)];
}

export function pinPositionsOf(c: CircuitComponent): [number, number][] {
  return SYMBOLS[c.kind].pins.map(([px, py]) => localToWorld(c, px, py));
}

/* Half-extents of the rotated body box in world axes (for hit-testing / selection). */
export function worldHalfExtents(c: CircuitComponent): [number, number] {
  const spec = SYMBOLS[c.kind];
  const hx = spec.span / 2;
  const hy = spec.h;
  return c.rot === 90 || c.rot === 270 ? [hy, hx] : [hx, hy];
}

export const wireEndIndex = (w: Wire, end: WireEnd) => (end === 0 ? 0 : w.pts.length - 1);
export const endAnchor = (w: Wire, end: WireEnd) => (end === 0 ? w.a : w.b);
export function setEndAnchor(w: Wire, end: WireEnd, a: Anchor) {
  if (end === 0) w.a = a;
  else w.b = a;
}

export function resolveAnchor(state: CircuitState, a: Anchor): [number, number] | null {
  if (a.t === "pin") {
    const c = state.components.find((x) => x.id === a.comp);
    if (!c) return null;
    const pins = pinPositionsOf(c);
    return a.pin < pins.length ? pins[a.pin] : null;
  }
  if (a.t === "wire") {
    const w = state.wires.find((x) => x.id === a.wire);
    if (!w) return null;
    const p = w.pts[wireEndIndex(w, a.end)];
    return [p[0], p[1]];
  }
  return null;
}

/* Follow wire→wire anchors to the terminal tip of a chain (whose own anchor is free or
   a pin). Cycles can only appear in hand-edited files; they resolve as free. */
export function chainRoot(
  state: CircuitState,
  wireId: string,
  end: WireEnd,
): { wire: string; end: WireEnd; anchor: Anchor } {
  const seen = new Set<string>();
  let w = wireId;
  let e: WireEnd = end;
  for (;;) {
    const key = w + ":" + e;
    if (seen.has(key)) return { wire: w, end: e, anchor: { t: "free" } };
    seen.add(key);
    const wire = state.wires.find((x) => x.id === w);
    if (!wire) return { wire: w, end: e, anchor: { t: "free" } };
    const a = endAnchor(wire, e);
    if (a.t !== "wire") return { wire: w, end: e, anchor: a };
    w = a.wire;
    e = a.end;
  }
}

/* Normalization pass, run after EVERY mutation (wired through the history hook):
   re-materializes bound endpoint coordinates from their targets and frees anchors whose
   target vanished. Keeps the state self-consistent so the renderer, hit-testing and
   exports never chase references. */
export function settle(state: CircuitState): void {
  const comps = new Map(state.components.map((c) => [c.id, c]));
  const wires = new Map(state.wires.map((w) => [w.id, w]));

  for (const w of state.wires) {
    for (const end of [0, 1] as const) {
      const a = endAnchor(w, end);
      if (a.t !== "pin") continue;
      const c = comps.get(a.comp);
      if (!c || a.pin >= SYMBOLS[c.kind].pins.length) {
        setEndAnchor(w, end, { t: "free" }); // dangling lead keeps its last coordinate
      } else {
        w.pts[wireEndIndex(w, end)] = pinPositionsOf(c)[a.pin];
      }
    }
  }

  // Anchors point at chain roots, so one pass normally converges; the cap covers
  // hand-edited files with longer chains.
  for (let pass = 0; pass < Math.max(1, state.wires.length); pass++) {
    let moved = false;
    for (const w of state.wires) {
      for (const end of [0, 1] as const) {
        const a = endAnchor(w, end);
        if (a.t !== "wire") continue;
        const t = wires.get(a.wire);
        if (!t || t === w) {
          setEndAnchor(w, end, { t: "free" });
          continue;
        }
        const p = t.pts[wireEndIndex(t, a.end)];
        const i = wireEndIndex(w, end);
        if (w.pts[i][0] !== p[0] || w.pts[i][1] !== p[1]) {
          w.pts[i] = [p[0], p[1]];
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/* Free every anchor that references the entity about to be deleted. Wires survive their
   target's deletion and simply dangle in place. */
export function unbindFrom(state: CircuitState, deletedId: string): void {
  for (const w of state.wires) {
    for (const end of [0, 1] as const) {
      const a = endAnchor(w, end);
      if ((a.t === "pin" && a.comp === deletedId) || (a.t === "wire" && a.wire === deletedId))
        setEndAnchor(w, end, { t: "free" });
    }
  }
}

/* Junction dots are derived, never stored: any point where >= 3 conductor ends meet.
   A pin with at least one bound lead counts once for the component's own terminal. */
export function junctions(state: CircuitState): [number, number][] {
  const acc = new Map<string, { x: number; y: number; n: number }>();
  const bump = (x: number, y: number) => {
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    const e = acc.get(k);
    if (e) e.n++;
    else acc.set(k, { x, y, n: 1 });
  };
  for (const w of state.wires) {
    bump(w.pts[0][0], w.pts[0][1]);
    bump(w.pts[w.pts.length - 1][0], w.pts[w.pts.length - 1][1]);
  }
  const boundPins = new Set<string>();
  for (const w of state.wires)
    for (const end of [0, 1] as const) {
      const a = endAnchor(w, end);
      if (a.t === "pin") boundPins.add(a.comp + ":" + a.pin);
    }
  for (const c of state.components) {
    const pins = pinPositionsOf(c);
    pins.forEach((p, i) => {
      if (boundPins.has(c.id + ":" + i)) bump(p[0], p[1]);
    });
  }
  return [...acc.values()].filter((e) => e.n >= 3).map((e) => [e.x, e.y]);
}

/* ---------- wire geometry: arc positions & crossings ---------- */

/* Point + unit direction at arc-length fraction t (0..1) along a polyline. */
export function wireArcPoint(w: Wire, t: number): { x: number; y: number; ux: number; uy: number } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < w.pts.length - 1; i++) {
    const l = Math.hypot(w.pts[i + 1][0] - w.pts[i][0], w.pts[i + 1][1] - w.pts[i][1]);
    lens.push(l);
    total += l;
  }
  let rem = Math.min(0.999, Math.max(0.001, t)) * (total || 1);
  for (let i = 0; i < lens.length; i++) {
    if (rem <= lens[i] || i === lens.length - 1) {
      const k = lens[i] === 0 ? 0 : rem / lens[i];
      const [x1, y1] = w.pts[i];
      const [x2, y2] = w.pts[i + 1];
      const l = lens[i] || 1;
      return {
        x: x1 + (x2 - x1) * k,
        y: y1 + (y2 - y1) * k,
        ux: (x2 - x1) / l,
        uy: (y2 - y1) / l,
      };
    }
    rem -= lens[i];
  }
  return { x: w.pts[0][0], y: w.pts[0][1], ux: 1, uy: 0 };
}

/* Proper interior intersection of segments AB and CD (excludes shared endpoints). */
function segIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { t: number; x: number; y: number } | null {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((cx - ax) * sY - (cy - ay) * sX) / denom;
  const u = ((cx - ax) * rY - (cy - ay) * rX) / denom;
  const EPS = 0.02;
  if (t < EPS || t > 1 - EPS || u < EPS || u > 1 - EPS) return null;
  return { t, x: ax + t * rX, y: ay + t * rY };
}

const HOP_R = 0.35; // cells

/* For each wire (by index), the crossing points per segment where IT should hop —
   the later-drawn wire hops over the earlier one, and near-endpoint crossings are
   ignored (those are junctions/tips, not crossings). */
function wireHopMap(state: CircuitState): Map<string, Map<number, number[]>> {
  const map = new Map<string, Map<number, number[]>>();
  if (!state.hops) return map;
  const ws = state.wires;
  for (let i = 1; i < ws.length; i++) {
    for (let si = 0; si < ws[i].pts.length - 1; si++) {
      const [ax, ay] = ws[i].pts[si];
      const [bx, by] = ws[i].pts[si + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen < HOP_R * 3) continue;
      for (let j = 0; j < i; j++) {
        for (let sj = 0; sj < ws[j].pts.length - 1; sj++) {
          const [cx2, cy2] = ws[j].pts[sj];
          const [dx2, dy2] = ws[j].pts[sj + 1];
          const hit = segIntersect(ax, ay, bx, by, cx2, cy2, dx2, dy2);
          if (!hit) continue;
          // keep the hop fully inside the segment
          const d = hit.t * segLen;
          if (d < HOP_R * 1.2 || segLen - d < HOP_R * 1.2) continue;
          let bySeg = map.get(ws[i].id);
          if (!bySeg) map.set(ws[i].id, (bySeg = new Map()));
          const list = bySeg.get(si) ?? [];
          list.push(hit.t);
          bySeg.set(si, list);
        }
      }
    }
  }
  for (const bySeg of map.values()) for (const list of bySeg.values()) list.sort((a, b) => a - b);
  return map;
}

/* ---------- layout ---------- */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CircuitLayout {
  W: number;
  H: number;
  u: number; // device px per cell
  view: ViewBox;
  mat: Mat; // world -> device px
  toPx(wx: number, wy: number): [number, number];
  toWorld(px: number, py: number): [number, number];
}

export function layoutCircuit(
  state: CircuitState,
  scale: number,
  viewBox?: ViewBox,
): CircuitLayout {
  const view = viewBox ?? { x: 0, y: 0, w: state.sheet.w, h: state.sheet.h };
  const u = scale;
  const W = Math.round(view.w * u + PAD * 2);
  const H = Math.round(view.h * u + PAD * 2);
  const mat: Mat = { a: u, b: 0, c: 0, d: u, e: PAD - view.x * u, f: PAD - view.y * u };
  return {
    W,
    H,
    u,
    view,
    mat,
    toPx: (wx, wy) => [PAD + (wx - view.x) * u, PAD + (wy - view.y) * u],
    toWorld: (px, py) => [view.x + (px - PAD) / u, view.y + (py - PAD) / u],
  };
}

/* ---------- scene (shared by canvas and SVG through the Pen) ---------- */

function drawScene(
  mkPen: (mat: Mat, lw: number) => Pen,
  state: CircuitState,
  lay: CircuitLayout,
  border: boolean,
) {
  const zf = lay.u / state.grid; // zoom factor: keeps strokes/text WYSIWYG across zoom
  const lwz = state.lineWidth * zf;
  const fontPx = state.fontSize * zf;
  const world = mkPen(lay.mat, lwz);

  if (state.showGrid) {
    const { view } = lay;
    const x0 = Math.max(view.x, 0);
    const y0 = Math.max(view.y, 0);
    const x1 = Math.min(view.x + view.w, state.sheet.w);
    const y1 = Math.min(view.y + view.h, state.sheet.h);
    if (x1 > x0 && y1 > y0) {
      const rect: PathCmd[] = [["M", x0, y0], ["L", x1, y0], ["L", x1, y1], ["L", x0, y1], ["Z"]];
      world.path(rect, { fill: GRID_C.wash, stroke: null });
      const minors: PathCmd[] = [];
      const majors: PathCmd[] = [];
      for (let gx = Math.ceil(x0); gx <= Math.floor(x1); gx++)
        (gx % 5 === 0 ? majors : minors).push(["M", gx, y0], ["L", gx, y1]);
      for (let gy = Math.ceil(y0); gy <= Math.floor(y1); gy++)
        (gy % 5 === 0 ? majors : minors).push(["M", x0, gy], ["L", x1, gy]);
      if (minors.length) world.path(minors, { stroke: GRID_C.minor, width: 1, cap: "butt" });
      if (majors.length) world.path(majors, { stroke: GRID_C.major, width: 1.2, cap: "butt" });
      if (border) world.path(rect, { stroke: GRID_C.border, width: 1.4, cap: "butt" });
    }
  }

  // magnetic-field regions sit under the circuit: a lattice of ⊗ (into page) / ⊙ (out)
  for (const f of state.fields) {
    const sp = Math.max(0.75, f.spacing);
    const r = Math.min(0.32, sp * 0.22);
    const d = r * 0.62; // half-extent of the × strokes / dot radius
    const marks: PathCmd[] = [];
    for (let my = f.y + sp / 2; my <= f.y + f.h - sp * 0.25; my += sp) {
      for (let mx = f.x + sp / 2; mx <= f.x + f.w - sp * 0.25; mx += sp) {
        if (f.mode === "in")
          marks.push(
            ["M", mx - d, my - d],
            ["L", mx + d, my + d],
            ["M", mx - d, my + d],
            ["L", mx + d, my - d],
          );
        else world.circle(mx, my, d * 0.55, { fill: INK, stroke: null });
        world.circle(mx, my, r, { stroke: INK, width: lwz * 0.7 });
      }
    }
    if (marks.length) world.path(marks, { width: lwz * 0.7, cap: "butt" });
  }

  // wires, hopping over earlier-drawn wires at genuine crossings
  const hops = wireHopMap(state);
  for (const w of state.wires) {
    const bySeg = hops.get(w.id);
    const cmds: PathCmd[] = [["M", w.pts[0][0], w.pts[0][1]]];
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [x1, y1] = w.pts[i];
      const [x2, y2] = w.pts[i + 1];
      const ts = bySeg?.get(i);
      if (ts?.length) {
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        // sweep=1 bulges to the left of travel (screen coords); prefer an upward bulge
        const leftY = -ux; // y of the left-of-travel normal (uy, -ux)
        const sweep: 0 | 1 = leftY < 0 || (leftY === 0 && uy < 0) ? 1 : 0;
        for (const t of ts) {
          const hx = x1 + (x2 - x1) * t;
          const hy = y1 + (y2 - y1) * t;
          cmds.push(["L", hx - ux * HOP_R, hy - uy * HOP_R]);
          cmds.push(["A", HOP_R, HOP_R, 0, 0, sweep, hx + ux * HOP_R, hy + uy * HOP_R]);
        }
      }
      cmds.push(["L", x2, y2]);
    }
    world.path(cmds, { width: lwz });
  }

  for (const [jx, jy] of junctions(state))
    world.circle(jx, jy, Math.max(2.6, lwz * 1.9) / lay.u, { fill: INK, stroke: null });

  // current-direction arrows: an open head astride the conductor + an upright label
  for (const w of state.wires) {
    if (!w.arrow) continue;
    const { x, y, ux: dux, uy: duy } = wireArcPoint(w, w.arrow.t);
    const ux = dux * w.arrow.dir;
    const uy = duy * w.arrow.dir;
    const L = 0.55; // head stroke length
    const HW = 0.34; // head half-width
    world.path(
      [
        ["M", x - ux * L + -uy * HW, y - uy * L + ux * HW],
        ["L", x, y],
        ["L", x - ux * L - -uy * HW, y - uy * L - ux * HW],
      ],
      { width: lwz * 1.1 },
    );
    const label = w.arrow.label?.trim();
    if (label) {
      // put the label on the side of the wire that reads best (up / left)
      let nx = -uy;
      let ny = ux;
      if (ny > 0 || (ny === 0 && nx > 0)) {
        nx = -nx;
        ny = -ny;
      }
      world.text(label, x + nx * 0.75, y + ny * 0.75, { size: fontPx, italic: true });
    }
  }

  for (const c of state.components) {
    const spec = SYMBOLS[c.kind];
    const pen = mkPen(matMul(lay.mat, localMat(c)), lwz);
    const textPen = mkPen(matMul(lay.mat, { a: 1, b: 0, c: 0, d: 1, e: c.x, f: c.y }), lwz);
    spec.draw({ pen, textPen, style: state.style, lw: lwz, u: lay.u, comp: c });

    // Labels & values render upright in world space: above/below for horizontal
    // components, beside for vertical ones.
    const vertical = c.rot === 90 || c.rot === 270;
    const label = c.label?.trim();
    const value = c.value?.trim();
    if (!label && !value) continue;
    if (!vertical) {
      if (label)
        world.text(label, c.x, c.y - spec.h - 0.3, {
          size: fontPx,
          italic: true,
          baseline: "bottom",
        });
      if (value) world.text(value, c.x, c.y + spec.h + 0.32, { size: fontPx, baseline: "top" });
    } else {
      const bx = c.x + spec.h + 0.35; // body half-height becomes half-width when vertical
      const dy = label && value ? 0.55 : 0;
      if (label) world.text(label, bx, c.y - dy, { size: fontPx, italic: true, align: "left" });
      if (value) world.text(value, bx, c.y + dy, { size: fontPx, align: "left" });
    }
  }

  for (const n of state.notes) {
    const text = n.text.trim();
    if (text) world.text(text, n.x, n.y, { size: fontPx });
  }
}

/* ---------- canvas renderer ---------- */

export interface CircuitRenderOptions {
  background?: string | null;
  showHandles?: boolean;
  selection?: Selection;
  multi?: string[]; // marquee multi-selection (component/wire ids)
  hover?: { x: number; y: number } | null; // snap-target highlight
  viewBox?: ViewBox;
}

export function renderCircuit(
  ctx: CanvasRenderingContext2D,
  state: CircuitState,
  scale: number,
  opts: CircuitRenderOptions = {},
): CircuitLayout {
  const lay = layoutCircuit(state, scale, opts.viewBox);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, lay.W, lay.H);
  }
  drawScene((mat, lw) => new CanvasPen(ctx, mat, lw), state, lay, !opts.viewBox);

  if (opts.showHandles) {
    const zf = lay.u / state.grid;
    const lwz = state.lineWidth * zf;

    // faint outlines make field regions grabbable in the editor (never exported)
    for (const f of state.fields) {
      const [x0, y0] = lay.toPx(f.x, f.y);
      const [x1, y1] = lay.toPx(f.x + f.w, f.y + f.h);
      ctx.save();
      ctx.strokeStyle = "rgba(100, 116, 139, 0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }

    // marquee multi-selection boxes
    if (opts.multi?.length) {
      ctx.save();
      ctx.strokeStyle = "#0071bc";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 3]);
      for (const id of opts.multi) {
        const c = state.components.find((x) => x.id === id);
        if (c) {
          const [hx, hy] = worldHalfExtents(c);
          const [x0, y0] = lay.toPx(c.x - hx, c.y - hy);
          const [x1, y1] = lay.toPx(c.x + hx, c.y + hy);
          ctx.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
          continue;
        }
        const w = state.wires.find((x) => x.id === id);
        if (w) {
          let mnx = Infinity,
            mny = Infinity,
            mxx = -Infinity,
            mxy = -Infinity;
          for (const p of w.pts) {
            mnx = Math.min(mnx, p[0]);
            mny = Math.min(mny, p[1]);
            mxx = Math.max(mxx, p[0]);
            mxy = Math.max(mxy, p[1]);
          }
          const [x0, y0] = lay.toPx(mnx, mny);
          const [x1, y1] = lay.toPx(mxx, mxy);
          ctx.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
        }
      }
      ctx.restore();
    }

    // selection highlight under the handles
    if (opts.selection) {
      const sel = opts.selection;
      ctx.save();
      if (sel.kind === "comp") {
        const c = state.components.find((x) => x.id === sel.id);
        if (c) {
          const [hx, hy] = worldHalfExtents(c);
          const [x0, y0] = lay.toPx(c.x - hx, c.y - hy);
          const [x1, y1] = lay.toPx(c.x + hx, c.y + hy);
          ctx.strokeStyle = "#0071bc";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
        }
      } else {
        const w = state.wires.find((x) => x.id === sel.id);
        if (w) {
          ctx.strokeStyle = "rgba(0, 113, 188, 0.30)";
          ctx.lineWidth = lwz + 6;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.beginPath();
          w.pts.forEach((p, i) => {
            const [px, py] = lay.toPx(p[0], p[1]);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.save();
    // component pins: hollow blue circles
    for (const c of state.components) {
      for (const [px, py] of pinPositionsOf(c)) {
        const [x, y] = lay.toPx(px, py);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#0071bc";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // wire tips (bound = blue, dangling = orange) and interior vertices
    for (const w of state.wires) {
      for (let i = 1; i < w.pts.length - 1; i++) {
        const [x, y] = lay.toPx(w.pts[i][0], w.pts[i][1]);
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      for (const end of [0, 1] as const) {
        const p = w.pts[wireEndIndex(w, end)];
        const [x, y] = lay.toPx(p[0], p[1]);
        const free = endAnchor(w, end).t === "free";
        ctx.beginPath();
        ctx.arc(x, y, free ? 3.4 : 2.9, 0, Math.PI * 2);
        ctx.fillStyle = free ? "#e67e22" : "#0071bc";
        ctx.fill();
      }
    }
    // snap-target ring
    if (opts.hover) {
      const [x, y] = lay.toPx(opts.hover.x, opts.hover.y);
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#16a34a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(22, 163, 74, 0.15)";
      ctx.fill();
    }
    ctx.restore();
  }
  return lay;
}

/* ---------- SVG renderer ---------- */

export function renderCircuitSVG(
  state: CircuitState,
  scale: number,
  opts: { background?: string | null; viewBox?: ViewBox } = {},
): string {
  const lay = layoutCircuit(state, scale, opts.viewBox);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lay.W}" height="${lay.H}" viewBox="0 0 ${lay.W} ${lay.H}">`,
  );
  if (opts.background)
    out.push(`<rect x="0" y="0" width="${lay.W}" height="${lay.H}" fill="${opts.background}"/>`);
  drawScene((mat, lw) => new SvgPen(out, mat, lw), state, lay, !opts.viewBox);
  out.push(`</svg>`);
  return out.join("");
}

/* ---------- export bounds ---------- */

/* World-space bounding box of everything drawn (wires, symbol bodies, labels), snapped
   out to whole cells with a one-cell margin — the exporters crop to this. */
export function contentBounds(ctx: CanvasRenderingContext2D, state: CircuitState): ViewBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const w of state.wires) for (const p of w.pts) grow(p[0], p[1]);
  for (const c of state.components) {
    const [hx, hy] = worldHalfExtents(c);
    grow(c.x - hx, c.y - hy);
    grow(c.x + hx, c.y + hy);
    const vertical = c.rot === 90 || c.rot === 270;
    const measure = (t: string, italic: boolean) => {
      ctx.font = `${italic ? "italic " : ""}${state.fontSize}px ${FONT}`;
      return ctx.measureText(t.replace(/_/g, "")).width / state.grid;
    };
    const textH = (state.fontSize * 1.25) / state.grid;
    const label = c.label?.trim();
    const value = c.value?.trim();
    if (!vertical) {
      if (label) {
        const w2 = measure(label, true) / 2;
        grow(c.x - w2, c.y - hy - 0.3 - textH);
        grow(c.x + w2, c.y - hy);
      }
      if (value) {
        const w2 = measure(value, false) / 2;
        grow(c.x - w2, c.y + hy);
        grow(c.x + w2, c.y + hy + 0.32 + textH);
      }
    } else {
      const bx = c.x + SYMBOLS[c.kind].h + 0.35;
      if (label) grow(bx + measure(label, true), c.y - 0.55 - textH / 2);
      if (value) grow(bx + measure(value, false), c.y + 0.55 + textH / 2);
    }
  }
  const measurePlain = (t: string, italic: boolean) => {
    ctx.font = `${italic ? "italic " : ""}${state.fontSize}px ${FONT}`;
    return ctx.measureText(t.replace(/_/g, "")).width / state.grid;
  };
  const noteH = (state.fontSize * 1.3) / state.grid;
  for (const n of state.notes) {
    const t = n.text.trim();
    if (!t) continue;
    const w2 = measurePlain(t, false) / 2;
    grow(n.x - w2, n.y - noteH / 2);
    grow(n.x + w2, n.y + noteH / 2);
  }
  for (const f of state.fields) {
    grow(f.x, f.y);
    grow(f.x + f.w, f.y + f.h);
  }
  for (const w of state.wires) {
    if (!w.arrow) continue;
    const { x, y } = wireArcPoint(w, w.arrow.t);
    const lw2 = w.arrow.label ? measurePlain(w.arrow.label, true) : 0;
    grow(x - 0.8 - lw2, y - 0.9 - noteH);
    grow(x + 0.8 + lw2, y + 0.9 + noteH);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: state.sheet.w, h: state.sheet.h };
  const x = Math.floor(minX) - 1;
  const y = Math.floor(minY) - 1;
  return { x, y, w: Math.ceil(maxX) + 1 - x, h: Math.ceil(maxY) + 1 - y };
}

/* ---------- hydration (load / batch / hand-edited JSON) ---------- */

const ROTS: Rot[] = [0, 90, 180, 270];

export function hydrateCircuit(raw: unknown): CircuitState {
  const d = defaultCircuit();
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number, min?: number, max?: number) => {
    let n = typeof v === "number" && isFinite(v) ? v : fb;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  const next: CircuitState = {
    version: 1,
    name: str(o.name)?.trim() || "circuit",
    style: o.style === "ansi" ? "ansi" : "iec",
    grid: num(o.grid, d.grid, 8, 96),
    sheet: {
      w: Math.round(num((o.sheet as { w?: unknown } | undefined)?.w, d.sheet.w, 8, 300)),
      h: Math.round(num((o.sheet as { h?: unknown } | undefined)?.h, d.sheet.h, 8, 300)),
    },
    snap: o.snap !== false,
    showGrid: o.showGrid !== false,
    hops: o.hops !== false,
    fontSize: num(o.fontSize, d.fontSize, 6, 64),
    lineWidth: num(o.lineWidth, d.lineWidth, 0.5, 8),
    components: [],
    wires: [],
    notes: [],
    fields: [],
    seq: 1,
  };

  const usedIds = new Set<string>();
  let auto = 1;
  const claimId = (v: unknown, prefix: string) => {
    let id = str(v) || "";
    if (!id || usedIds.has(id)) id = `${prefix}${auto}`;
    while (usedIds.has(id)) id = `${prefix}${auto++}-${Math.random().toString(36).slice(2, 6)}`;
    usedIds.add(id);
    auto++;
    return id;
  };

  const rawComps = Array.isArray(o.components) ? o.components : [];
  for (const rc of rawComps) {
    if (!rc || typeof rc !== "object") continue;
    const c = rc as Record<string, unknown>;
    const kind = str(c.kind) as ComponentKind | undefined;
    if (!kind || !(kind in SYMBOLS)) continue;
    next.components.push({
      id: claimId(c.id, "c"),
      kind,
      x: r3(num(c.x, next.sheet.w / 2)),
      y: r3(num(c.y, next.sheet.h / 2)),
      rot: ROTS.includes(c.rot as Rot) ? (c.rot as Rot) : 0,
      flip: c.flip === true || undefined,
      label: str(c.label),
      value: str(c.value),
      on: c.on === true || undefined,
      closed: c.closed === true || undefined,
      core: typeof c.core === "boolean" ? c.core : undefined,
      cells: c.cells !== undefined ? Math.round(num(c.cells, 2, 1, 5)) : undefined,
    });
  }

  const isPt = (p: unknown): p is [number, number] =>
    Array.isArray(p) && p.length >= 2 && isFinite(p[0] as number) && isFinite(p[1] as number);
  const rawWires = Array.isArray(o.wires) ? o.wires : [];
  const anchor = (v: unknown): Anchor => {
    const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    if (a.t === "pin" && typeof a.comp === "string" && typeof a.pin === "number")
      return { t: "pin", comp: a.comp, pin: Math.max(0, Math.round(a.pin)) };
    if (a.t === "wire" && typeof a.wire === "string" && (a.end === 0 || a.end === 1))
      return { t: "wire", wire: a.wire, end: a.end };
    return { t: "free" };
  };
  for (const rw of rawWires) {
    if (!rw || typeof rw !== "object") continue;
    const w = rw as Record<string, unknown>;
    const pts = (Array.isArray(w.pts) ? w.pts : [])
      .filter(isPt)
      .map((p): [number, number] => [r3(p[0]), r3(p[1])]);
    if (pts.length < 2) continue;
    const ar = (w.arrow && typeof w.arrow === "object" ? w.arrow : null) as Record<
      string,
      unknown
    > | null;
    next.wires.push({
      id: claimId(w.id, "w"),
      pts,
      a: anchor(w.a),
      b: anchor(w.b),
      arrow: ar
        ? {
            t: num(ar.t, 0.5, 0.02, 0.98),
            dir: ar.dir === -1 ? -1 : 1,
            label: str(ar.label),
          }
        : undefined,
    });
  }

  for (const rn of Array.isArray(o.notes) ? o.notes : []) {
    if (!rn || typeof rn !== "object") continue;
    const n = rn as Record<string, unknown>;
    const text = str(n.text);
    if (!text?.trim()) continue;
    next.notes.push({
      id: claimId(n.id, "n"),
      x: r3(num(n.x, next.sheet.w / 2)),
      y: r3(num(n.y, next.sheet.h / 2)),
      text,
    });
  }

  for (const rf of Array.isArray(o.fields) ? o.fields : []) {
    if (!rf || typeof rf !== "object") continue;
    const f = rf as Record<string, unknown>;
    next.fields.push({
      id: claimId(f.id, "f"),
      x: r3(num(f.x, 2)),
      y: r3(num(f.y, 2)),
      w: num(f.w, 8, 1, 300),
      h: num(f.h, 6, 1, 300),
      mode: f.mode === "out" ? "out" : "in",
      spacing: num(f.spacing, 2, 0.75, 10),
    });
  }

  // anchors referencing ids that didn't survive validation resolve to free
  const compIds = new Set(next.components.map((c) => c.id));
  const wireIds = new Set(next.wires.map((w) => w.id));
  for (const w of next.wires) {
    for (const end of [0, 1] as const) {
      const a = endAnchor(w, end);
      if (
        (a.t === "pin" && !compIds.has(a.comp)) ||
        (a.t === "wire" && (!wireIds.has(a.wire) || a.wire === w.id))
      )
        setEndAnchor(w, end, { t: "free" });
    }
  }

  let maxSeq = 0;
  for (const id of usedIds) {
    const m = /(\d+)/.exec(id);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  next.seq = maxSeq + 1;

  settle(next);
  return next;
}
