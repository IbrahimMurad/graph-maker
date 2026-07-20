/* The circuit symbol registry.
   Each symbol draws in LOCAL coordinates (grid-cell units): body centred on the origin,
   terminal pins on the local x-axis (except ground/transformer). The engine hands the
   draw function two pens over the same origin:
   - `pen`     carries the component's rotation/flip — all geometry goes through it;
   - `textPen` carries only translation+scale — lettering (A, V, G) stays upright at
     any rotation.
   Stroke widths are device px (`lw`); `u` is device px per cell for sizing text. */

import type { CircuitComponent, ComponentKind, SymbolStyle } from "./circuit";
import { SvgPen, type Mat, type PathCmd, type Pen } from "./circuit-pen";

export interface SymbolDrawArgs {
  pen: Pen;
  textPen: Pen;
  style: SymbolStyle;
  lw: number;
  u: number;
  comp: CircuitComponent;
}

export interface SymbolSpec {
  kind: ComponentKind;
  name: string; // palette label
  span: number; // pin-to-pin extent along local x (cells)
  h: number; // half-height of the body for hit-testing / label placement (cells)
  pins: [number, number][]; // local coords
  defaultLabel?: string; // auto-numbered on insert: R -> R_1, R_2, ...
  draw(o: SymbolDrawArgs): void;
}

/* ---- tiny path-command helpers ---- */
const M = (x: number, y: number): PathCmd => ["M", x, y];
const L = (x: number, y: number): PathCmd => ["L", x, y];
const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): PathCmd => [
  "C",
  x1,
  y1,
  x2,
  y2,
  x,
  y,
];
/* circular arc to (x,y); sweep 1 bulges left of travel is false — in y-down screen space
   sweep=1 walks clockwise, so an arc travelling +x with sweep=1 bulges UP (-y). */
const A = (r: number, sweep: 0 | 1, x: number, y: number, large: 0 | 1 = 0): PathCmd => [
  "A",
  r,
  r,
  0,
  large,
  sweep,
  x,
  y,
];
const Z: PathCmd = ["Z"];

const WHITE = "#ffffff";

/* horizontal leads from the pins to the body edge at ±bx */
const leads = (bx: number, span: number): PathCmd[] => [
  M(-span / 2, 0),
  L(-bx, 0),
  M(bx, 0),
  L(span / 2, 0),
];

/* n-tip zigzag between x = -1 and 1 (ANSI resistor family body) */
const zigzag = (): PathCmd[] => {
  const out: PathCmd[] = [L(-1, 0)];
  for (let i = 0; i < 6; i++) out.push(L(-1 + (i + 0.5) / 3, i % 2 === 0 ? -0.4 : 0.4));
  out.push(L(1, 0));
  return out;
};

const resistorBody = (style: SymbolStyle): PathCmd[] =>
  style === "iec"
    ? [M(-2, 0), L(-1, 0), M(1, 0), L(2, 0), M(-1, -0.4), L(1, -0.4), L(1, 0.4), L(-1, 0.4), Z]
    : [M(-2, 0), ...zigzag(), L(2, 0)];

/* arrow shaft + head from (x1,y1) to (x2,y2) */
const arrow = (x1: number, y1: number, x2: number, y2: number, head = 0.36): PathCmd[] => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const hw = head * 0.5;
  return [
    M(x1, y1),
    L(x2, y2),
    M(x2 - ux * head + px * hw, y2 - uy * head + py * hw),
    L(x2, y2),
    L(x2 - ux * head - px * hw, y2 - uy * head - py * hw),
  ];
};

/* run of semicircular humps along +x at y=0 (IEC coil) */
const humps = (x0: number, x1: number, n: number): PathCmd[] => {
  const step = (x1 - x0) / n;
  const out: PathCmd[] = [];
  for (let i = 1; i <= n; i++) out.push(A(step / 2, 1, x0 + i * step, 0));
  return out;
};

/* run of >180° loops along +x (ANSI coil) */
const loops = (x0: number, x1: number, n: number): PathCmd[] => {
  const step = (x1 - x0) / n;
  const out: PathCmd[] = [];
  for (let i = 1; i <= n; i++) out.push(A(step * 0.567, 1, x0 + i * step, 0, 1));
  return out;
};

const coreLines = (hw: number, y: number, gap = 0.16): PathCmd[] => [
  M(-hw, y),
  L(hw, y),
  M(-hw, y - gap),
  L(hw, y - gap),
];

const plusGlyph = (x: number, y: number, s = 0.17): PathCmd[] => [
  M(x - s, y),
  L(x + s, y),
  M(x, y - s),
  L(x, y + s),
];

const circleKinds: Partial<Record<ComponentKind, string>> = {
  ammeter: "A",
  voltmeter: "V",
  galvanometer: "G",
};

function meterDraw(o: SymbolDrawArgs) {
  o.pen.path(leads(0.9, 4));
  o.pen.circle(0, 0, 0.9, { fill: WHITE });
  o.textPen.text(circleKinds[o.comp.kind]!, 0, 0.02, { size: o.u, halo: false });
}

export const SYMBOLS: Record<ComponentKind, SymbolSpec> = {
  resistor: {
    kind: "resistor",
    name: "Resistor",
    span: 4,
    h: 0.55,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    defaultLabel: "R",
    draw: (o) => o.pen.path(resistorBody(o.style)),
  },

  rheostat: {
    kind: "rheostat",
    name: "Rheostat",
    span: 4,
    h: 1.05,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    defaultLabel: "R",
    draw: (o) => {
      o.pen.path(resistorBody(o.style));
      o.pen.path(arrow(-1.45, 0.9, 1.45, -0.9));
    },
  },

  battery: {
    kind: "battery",
    name: "Battery",
    span: 4,
    h: 1.25,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      const n = Math.min(5, Math.max(1, Math.round(o.comp.cells ?? 2)));
      const totalW = 0.35 + (n - 1) * 0.8;
      const xs = -totalW / 2;
      o.pen.path([M(-2, 0), L(xs, 0), M(xs + totalW, 0), L(2, 0)]);
      for (let k = 0; k < n; k++) {
        const sx = xs + k * 0.8;
        // short thick plate = −, long thin plate = +
        o.pen.path([M(sx, -0.4), L(sx, 0.4)], { width: o.lw * 2.4, cap: "butt" });
        o.pen.path([M(sx + 0.35, -0.85), L(sx + 0.35, 0.85)]);
      }
      o.pen.path(plusGlyph(totalW / 2 + 0.5, -0.95), { width: o.lw * 0.9 });
    },
  },

  dcSource: {
    kind: "dcSource",
    name: "DC source",
    span: 4,
    h: 0.85,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      o.pen.path(leads(0.8, 4));
      o.pen.circle(0, 0, 0.8, { fill: WHITE });
      o.pen.path([M(-0.52, 0.02), L(-0.22, 0.02)], { width: o.lw * 0.9 });
      o.pen.path(plusGlyph(0.37, 0.02, 0.15), { width: o.lw * 0.9 });
    },
  },

  acSource: {
    kind: "acSource",
    name: "AC source",
    span: 4,
    h: 0.85,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      o.pen.path(leads(0.8, 4));
      o.pen.circle(0, 0, 0.8, { fill: WHITE });
      o.pen.path([
        M(-0.45, 0),
        C(-0.28, -0.55, -0.17, -0.55, 0, 0),
        C(0.17, 0.55, 0.28, 0.55, 0.45, 0),
      ]);
    },
  },

  lamp: {
    kind: "lamp",
    name: "Lamp",
    span: 4,
    h: 0.9,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      const on = !!o.comp.on;
      o.pen.path(leads(0.8, 4));
      o.pen.circle(0, 0, 0.8, { fill: on ? "rgba(255, 213, 74, 0.55)" : WHITE });
      if (o.style === "iec") {
        const d = 0.566;
        o.pen.path([M(-d, -d), L(d, d), M(-d, d), L(d, -d)]);
      } else {
        o.pen.path([
          M(-0.62, 0.3),
          C(-0.62, -0.42, -0.21, -0.42, -0.21, 0.3),
          C(-0.21, -0.42, 0.21, -0.42, 0.21, 0.3),
          C(0.21, -0.42, 0.62, -0.42, 0.62, 0.3),
        ]);
      }
      if (on) {
        const rays: PathCmd[] = [];
        for (let i = 0; i < 8; i++) {
          const a = ((i * 45 + 22.5) * Math.PI) / 180;
          rays.push(
            M(Math.cos(a) * 1.0, Math.sin(a) * 1.0),
            L(Math.cos(a) * 1.35, Math.sin(a) * 1.35),
          );
        }
        o.pen.path(rays, { width: o.lw * 0.9 });
      }
    },
  },

  capacitor: {
    kind: "capacitor",
    name: "Capacitor",
    span: 4,
    h: 0.75,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    defaultLabel: "C",
    draw: (o) => {
      o.pen.path([M(-2, 0), L(-0.25, 0), M(0.25, 0), L(2, 0)]);
      o.pen.path([M(-0.25, -0.7), L(-0.25, 0.7), M(0.25, -0.7), L(0.25, 0.7)], {
        width: o.lw * 1.4,
        cap: "butt",
      });
    },
  },

  inductor: {
    kind: "inductor",
    name: "Inductor",
    span: 4,
    h: 0.85,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    defaultLabel: "L",
    draw: (o) => {
      if (o.style === "iec") o.pen.path([M(-2, 0), L(-1, 0), ...humps(-1, 1, 4), L(2, 0)]);
      else o.pen.path([M(-2, 0), L(-1.2, 0), ...loops(-1.2, 1.2, 4), L(2, 0)]);
      if (o.comp.core) o.pen.path(coreLines(1.1, -0.62), { width: o.lw * 0.9, cap: "butt" });
    },
  },

  straightWire: {
    kind: "straightWire",
    name: "Straight wire",
    span: 4,
    h: 0.35,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      o.pen.path([M(-2, 0), L(2, 0)], { width: o.lw * 1.25 });
      o.pen.circle(-2, 0, 0.14, { fill: WHITE });
      o.pen.circle(2, 0, 0.14, { fill: WHITE });
    },
  },

  loop: {
    kind: "loop",
    name: "Loop",
    span: 4,
    h: 1.15,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      o.pen.path([M(-2, 0), L(-1.1, 0), M(1.1, 0), L(2, 0)]);
      o.pen.circle(0, 0, 1.1);
    },
  },

  solenoid: {
    kind: "solenoid",
    name: "Solenoid",
    span: 6,
    h: 1.05,
    pins: [
      [-3, 0],
      [3, 0],
    ],
    draw: (o) => {
      if (o.style === "iec") o.pen.path([M(-3, 0), L(-1.8, 0), ...humps(-1.8, 1.8, 6), L(3, 0)]);
      else o.pen.path([M(-3, 0), L(-1.8, 0), ...loops(-1.8, 1.8, 6), L(3, 0)]);
      if (o.comp.core) o.pen.path(coreLines(1.9, -0.72), { width: o.lw * 0.9, cap: "butt" });
    },
  },

  ammeter: {
    kind: "ammeter",
    name: "Ammeter",
    span: 4,
    h: 0.95,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: meterDraw,
  },

  voltmeter: {
    kind: "voltmeter",
    name: "Voltmeter",
    span: 4,
    h: 0.95,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: meterDraw,
  },

  galvanometer: {
    kind: "galvanometer",
    name: "Galvanometer",
    span: 4,
    h: 0.95,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: meterDraw,
  },

  switch: {
    kind: "switch",
    name: "Switch",
    span: 4,
    h: 1.1,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    defaultLabel: "S",
    draw: (o) => {
      o.pen.path(leads(1, 4));
      o.pen.circle(-1, 0, 0.12, { fill: "#000" });
      o.pen.circle(1, 0, 0.12, { fill: "#000" });
      o.pen.path(o.comp.closed ? [M(-1, 0), L(1.02, -0.13)] : [M(-1, 0), L(0.9, -1.05)]);
    },
  },

  transformer: {
    kind: "transformer",
    name: "Transformer",
    span: 3,
    h: 1.8,
    pins: [
      [-1.5, -1.5],
      [-1.5, 1.5],
      [1.5, -1.5],
      [1.5, 1.5],
    ],
    draw: (o) => {
      // primary winding (left, humps bulge outward), secondary mirrored on the right
      o.pen.path([M(-1.5, -1.5), L(-0.6, -1.5), ...humpsV(-0.6, -1.5, 1.5, 3, 1), L(-1.5, 1.5)]);
      o.pen.path([M(1.5, -1.5), L(0.6, -1.5), ...humpsV(0.6, -1.5, 1.5, 3, 0), L(1.5, 1.5)]);
      if (o.comp.core)
        o.pen.path([M(-0.09, -1.7), L(-0.09, 1.7), M(0.09, -1.7), L(0.09, 1.7)], {
          width: o.lw * 0.9,
          cap: "butt",
        });
    },
  },

  ground: {
    kind: "ground",
    name: "Ground",
    span: 2,
    h: 1,
    pins: [[0, -1]],
    draw: (o) => {
      o.pen.path([
        M(0, -1),
        L(0, 0.15),
        M(-0.6, 0.15),
        L(0.6, 0.15),
        M(-0.38, 0.45),
        L(0.38, 0.45),
        M(-0.16, 0.75),
        L(0.16, 0.75),
      ]);
    },
  },

  fuse: {
    kind: "fuse",
    name: "Fuse",
    span: 4,
    h: 0.55,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      if (o.style === "iec")
        o.pen.path([M(-2, 0), L(2, 0), M(-1, -0.35), L(1, -0.35), L(1, 0.35), L(-1, 0.35), Z]);
      else o.pen.path([M(-2, 0), L(-1, 0), A(0.5, 1, 0, 0), A(0.5, 0, 1, 0), L(2, 0)]);
    },
  },

  diode: {
    kind: "diode",
    name: "Diode",
    span: 4,
    h: 0.7,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      o.pen.path(leads(0.55, 4));
      o.pen.path([M(-0.55, -0.55), L(0.55, 0), L(-0.55, 0.55), Z], { fill: "#000" });
      o.pen.path([M(0.55, -0.55), L(0.55, 0.55)], { width: o.lw * 1.2, cap: "butt" });
    },
  },

  led: {
    kind: "led",
    name: "LED",
    span: 4,
    h: 1.35,
    pins: [
      [-2, 0],
      [2, 0],
    ],
    draw: (o) => {
      SYMBOLS.diode.draw(o);
      o.pen.path(arrow(0.02, -0.62, 0.5, -1.1, 0.28), { width: o.lw * 0.9 });
      o.pen.path(arrow(0.42, -0.32, 0.9, -0.8, 0.28), { width: o.lw * 0.9 });
    },
  },
};

/* vertical hump run for the transformer windings: along +y at fixed x.
   outward=1 bulges toward -x (left), outward=0 toward +x. */
function humpsV(x: number, y0: number, y1: number, n: number, outward: 0 | 1): PathCmd[] {
  const step = (y1 - y0) / n;
  const out: PathCmd[] = [];
  for (let i = 1; i <= n; i++) out.push(A(step / 2, outward, x, y0 + i * step));
  return out;
}

export const PALETTE_ORDER: ComponentKind[] = [
  "battery",
  "dcSource",
  "acSource",
  "switch",
  "resistor",
  "rheostat",
  "lamp",
  "fuse",
  "capacitor",
  "inductor",
  "ammeter",
  "voltmeter",
  "galvanometer",
  "diode",
  "led",
  "ground",
  "transformer",
  "solenoid",
  "loop",
  "straightWire",
];

/* Self-contained SVG preview of a symbol for palette buttons — same draw code as the
   canvas, so previews can never drift from what lands on the sheet. */
export function symbolPreviewSVG(kind: ComponentKind, style: SymbolStyle): string {
  const spec = SYMBOLS[kind];
  const W = 64;
  const H = 40;
  const u = Math.min((W - 10) / (spec.span + 0.6), (H - 8) / (spec.h * 2 + 0.5));
  const mat: Mat = { a: u, b: 0, c: 0, d: u, e: W / 2, f: H / 2 };
  const comp: CircuitComponent = {
    id: "preview",
    kind,
    x: 0,
    y: 0,
    rot: 0,
    cells: 2,
    core: kind === "transformer",
  };
  const out: string[] = [];
  const pen = new SvgPen(out, mat, 1.5);
  spec.draw({ pen, textPen: pen, style, lw: 1.5, u, comp });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%">` +
    out.join("") +
    `</svg>`
  );
}
