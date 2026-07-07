/* Pure rendering engine: (ctx, state, scale) -> pixels.
   The canvas size is DERIVED from the axes so grid cells stay square:
   one "scale" = pixels per major step, shared by both axes (no distortion).
   Shared by the live editor and the PNG exporter. */

export interface Axis {
  label: string;
  min: number;
  max: number;
  step: number;
  minorPerMajor: number;
  tickLabels: string;
}

export type LineStyle = "solid" | "dashed" | "dotted";
export type MarkerShape = "none" | "dot" | "circle" | "square" | "triangle" | "cross";

export interface Series {
  color: string;
  width: number;
  points: [number, number][];
  dash?: LineStyle; // default "solid"
  marker?: MarkerShape; // default "none"
  fill?: boolean; // shade the area between the line and the x-axis (y = 0)
}

export interface Annotation {
  x: number;
  y: number;
  text: string;
  color?: string; // default black
  dx?: number; // label offset from the anchor, in px
  dy?: number;
}

export interface GraphState {
  scale: number;
  type: "grid" | "relation";
  axes: { x: Axis; y: Axis };
  showMinor: boolean;
  snap: boolean;
  fontSize: number;
  axisWidth: number;
  series: Series[];
  active: number;
  annotations: Annotation[];
}

export interface GraphLayout {
  W: number;
  H: number;
  plot: { x: number; y: number; w: number; h: number };
  toPx: (wx: number, wy: number) => [number, number];
  toWorld: (px: number, py: number) => [number, number];
  fs: number;
  xAxisY: number;
  yAxisX: number;
  axisXWorld: number;
  axisYWorld: number;
}

export interface RenderOptions {
  showHandles?: boolean;
  background?: string | null;
  selected?: { si: number; pi: number } | null; // point to highlight (editor only)
}

const FONT = '"Cambria Math", Cambria, Georgia, "Times New Roman", serif';
const C = {
  wash: "rgba(41, 171, 226, 0.25)", // plot background (#29abe2 @ 25%)
  minor: "rgba(0, 113, 188, 0.50)",
  mid: "rgba(0, 113, 188, 0.75)", // half-major emphasis line
  major: "#0071bc",
  border: "#0071bc",
  axis: "#29abe2",
  text: "#000000",
};

export const PALETTE = ["#ed1c24", "#0071bc", "#1a9850", "#7b3fa0", "#e67e22"];
const MAX_LINES = 2000; // safety cap for grid loops
const MAX_PLOT = 6000; // px cap per side, so a huge range can't blow up the canvas
export const DEFAULT_SCALE = 64; // px per major step

export function defaultState(): GraphState {
  return {
    scale: DEFAULT_SCALE,
    type: "grid",
    axes: {
      x: { label: "t (s)", min: 0, max: 30, step: 5, minorPerMajor: 10, tickLabels: "" },
      y: {
        label: "d (m)",
        min: -12,
        max: 20,
        step: 10,
        minorPerMajor: 10,
        tickLabels: "0, 10, 20, -12",
      },
    },
    showMinor: true,
    snap: true,
    fontSize: 14,
    axisWidth: 1.6,
    series: [
      {
        color: PALETTE[0],
        width: 2,
        dash: "solid",
        marker: "none",
        fill: false,
        points: [
          [0, 0],
          [5, 20],
          [22, 20],
          [30, -12],
        ],
      },
    ],
    active: 0,
    annotations: [],
  };
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const isMultiple = (v: number, m: number) => m > 0 && Math.abs(v / m - Math.round(v / m)) < 1e-6;

function autoTicks(a: Axis): number[] {
  const out: number[] = [];
  if (!(a.step > 0)) return out;
  let v = Math.ceil(a.min / a.step - 1e-9) * a.step;
  for (let n = 0; v <= a.max + 1e-9 && n < MAX_LINES; n++, v += a.step) out.push(r6(v));
  return out;
}

function labelTicks(a: Axis): number[] {
  const s = (a.tickLabels || "").trim();
  if (!s) return autoTicks(a);
  return s
    .split(/[,;\s]+/)
    .map(Number)
    .filter((v) => isFinite(v) && v >= a.min - 1e-9 && v <= a.max + 1e-9);
}

/* Margins + plot size + world<->pixel transforms. */
export function layout(
  ctx: CanvasRenderingContext2D,
  state: GraphState,
  scale: number,
): GraphLayout {
  const { x: ax, y: ay } = state.axes;
  const fs = state.fontSize || 14;
  scale = scale > 0 ? scale : DEFAULT_SCALE;
  ctx.font = fs + "px " + FONT;

  const showTicks = state.type !== "relation";

  let yTickW = 0;
  if (showTicks)
    for (const v of labelTicks(ay)) yTickW = Math.max(yTickW, ctx.measureText(String(v)).width);

  /* Extra room so each axis extends past its grid before the arrow tip. */
  const axisPad = scale * 0.5;

  const left =
    Math.max(yTickW + 14, ctx.measureText(ay.label).width / 2 + 8, 34) + (ax.min < 0 ? axisPad : 0);
  const top = fs + 24 + axisPad;
  const right = Math.max(ctx.measureText(ax.label).width + 32, 36) + axisPad;
  const bottom = fs + 18 + (ay.min < 0 ? axisPad : 0);

  const spanX = Math.max(1e-9, ax.max - ax.min);
  const spanY = Math.max(1e-9, ay.max - ay.min);
  const cellsX = ax.step > 0 ? spanX / ax.step : 10;
  const cellsY = ay.step > 0 ? spanY / ay.step : 10;
  const pw = Math.max(20, Math.min(cellsX * scale, MAX_PLOT));
  const ph = Math.max(20, Math.min(cellsY * scale, MAX_PLOT));

  const plot = { x: left, y: top, w: pw, h: ph };
  const W = left + pw + right;
  const H = top + ph + bottom;

  const toPx = (wx: number, wy: number): [number, number] => [
    plot.x + ((wx - ax.min) / spanX) * plot.w,
    plot.y + ((ay.max - wy) / spanY) * plot.h,
  ];
  const toWorld = (px: number, py: number): [number, number] => [
    ax.min + ((px - plot.x) / plot.w) * spanX,
    ay.max - ((py - plot.y) / plot.h) * spanY,
  ];

  const axisYWorld = ay.min < 0 && ay.max > 0 ? 0 : ay.min >= 0 ? ay.min : ay.max;
  const axisXWorld = ax.min < 0 && ax.max > 0 ? 0 : ax.min >= 0 ? ax.min : ax.max;

  return {
    W,
    H,
    plot,
    toPx,
    toWorld,
    fs,
    xAxisY: toPx(0, axisYWorld)[1],
    yAxisX: toPx(axisXWorld, 0)[0],
    axisXWorld,
    axisYWorld,
  };
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, k = 1) {
  const s = 9 * k,
    w = 3.6 * k;
  ctx.beginPath();
  ctx.moveTo(x + dx * 2, y + dy * 2);
  ctx.lineTo(x - dx * s - dy * w, y - dy * s + dx * w);
  ctx.lineTo(x - dx * s + dy * w, y - dy * s - dx * w);
  ctx.closePath();
  ctx.fill();
}

/* Dash pattern in px, scaled to the line width so it reads well at any thickness. */
function dashArray(style: LineStyle | undefined, w: number): number[] {
  if (style === "dashed") return [w * 3.5, w * 2.75];
  if (style === "dotted") return [w * 0.1, w * 1.9];
  return [];
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  color: string,
  r: number,
) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.beginPath();
  if (shape === "dot") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === "circle") {
    ctx.lineWidth = Math.max(1, r * 0.5);
    ctx.fillStyle = "#fff";
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (shape === "square") {
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
    ctx.closePath();
    ctx.fill();
  } else if (shape === "cross") {
    ctx.lineWidth = Math.max(1.4, r * 0.5);
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }
  ctx.restore();
}
const markerRadius = (w: number) => Math.max(3, w * 1.6);

export function render(
  ctx: CanvasRenderingContext2D,
  state: GraphState,
  scale: number,
  opts: RenderOptions = {},
) {
  const { x: ax, y: ay } = state.axes;
  const L = layout(ctx, state, scale);
  const { plot, toPx, W, H } = L;
  const grid = state.type !== "relation";

  ctx.clearRect(0, 0, W, H);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.font = L.fs + "px " + FONT;

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  /* ----- grid (skipped in relation mode) ----- */
  if (grid) {
    ctx.fillStyle = C.wash;
    ctx.fillRect(plot.x, plot.y, plot.w, plot.h);

    if (state.showMinor) {
      const drawMinors = (a: Axis, vertical: boolean) => {
        const m = a.step / Math.max(1, a.minorPerMajor || 1);
        if (!(m > 0)) return;
        let v = Math.ceil(a.min / m - 1e-9) * m;
        for (let n = 0; v <= a.max + 1e-9 && n < MAX_LINES; n++, v += m) {
          if (isMultiple(v, a.step)) continue;
          const mid = isMultiple(v, a.step / 2);
          ctx.strokeStyle = mid ? C.mid : C.minor;
          ctx.lineWidth = mid ? 0.7 : 0.5;
          if (vertical) {
            const p = toPx(v, 0)[0];
            line(p, plot.y, p, plot.y + plot.h);
          } else {
            const p = toPx(0, v)[1];
            line(plot.x, p, plot.x + plot.w, p);
          }
        }
      };
      drawMinors(ax, true);
      drawMinors(ay, false);
    }
    ctx.strokeStyle = C.major;
    ctx.lineWidth = 1;
    for (const v of autoTicks(ax)) {
      const p = toPx(v, 0)[0];
      line(p, plot.y, p, plot.y + plot.h);
    }
    for (const v of autoTicks(ay)) {
      const p = toPx(0, v)[1];
      line(plot.x, p, plot.x + plot.w, p);
    }
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
  }

  /* ----- axes + arrows (both modes) ----- */
  const axisPad = scale * 0.5;
  const aw = state.axisWidth ?? 1.6;
  const ak = aw / 1.6; // arrowhead scales with the axis line width (1.6 = default -> 1x)
  ctx.strokeStyle = C.axis;
  ctx.fillStyle = C.axis;
  ctx.lineWidth = aw;
  const xr = plot.x + plot.w + axisPad;
  const xl = ax.min < 0 ? plot.x - axisPad : plot.x;
  line(xl, L.xAxisY, xr, L.xAxisY);
  arrow(ctx, xr, L.xAxisY, 1, 0, ak);
  if (ax.min < 0) arrow(ctx, xl, L.xAxisY, -1, 0, ak);

  const yt = plot.y - axisPad;
  const yb = ay.min < 0 ? plot.y + plot.h + axisPad : plot.y + plot.h;
  line(L.yAxisX, yb, L.yAxisX, yt);
  arrow(ctx, L.yAxisX, yt, 0, -1, ak);
  if (ay.min < 0) arrow(ctx, L.yAxisX, yb, 0, 1, ak);

  /* All text: white halo (stroke) first, then black fill on top, so it stays
     legible over the grid and data lines. Uses the current align/baseline. */
  ctx.fillStyle = C.text;
  const haloText = (t: string, x: number, y: number) => {
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeText(t, x, y);
    ctx.restore();
    ctx.fillText(t, x, y);
  };

  /* ----- titles (both modes) ----- */
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  haloText(ay.label, L.yAxisX, yt - 8);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  haloText(ax.label, xr + 7, L.xAxisY);

  /* ----- tick labels (grid mode only) ----- */
  if (grid) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const autoX = !(ax.tickLabels || "").trim();
    for (const v of labelTicks(ax)) {
      if (autoX && Math.abs(v - L.axisXWorld) < 1e-9) continue;
      haloText(String(v), toPx(v, 0)[0], L.xAxisY + 5);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const seen = new Set<number>();
    for (const v of labelTicks(ay)) {
      if (seen.has(v)) continue;
      seen.add(v);
      haloText(String(v), L.yAxisX - 6, toPx(0, v)[1]);
    }
  }

  /* ----- area fills + data lines (clipped to the plot, with slack for line width) ----- */
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x - 4, plot.y - 4, plot.w + 8, plot.h + 8);
  ctx.clip();
  for (const s of state.series) {
    if (s.points.length < 2) continue;
    if (s.fill) {
      const baseY = Math.min(plot.y + plot.h, Math.max(plot.y, toPx(0, 0)[1])); // the x-axis (y=0)
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const [px, py] = toPx(p[0], p[1]);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.lineTo(toPx(s.points[s.points.length - 1][0], 0)[0], baseY);
      ctx.lineTo(toPx(s.points[0][0], 0)[0], baseY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dashArray(s.dash, s.width));
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const [px, py] = toPx(p[0], p[1]);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  /* ----- point markers (unclipped so edge markers stay whole) ----- */
  for (const s of state.series) {
    if (!s.marker || s.marker === "none") continue;
    const r = markerRadius(s.width);
    for (const p of s.points) {
      const [px, py] = toPx(p[0], p[1]);
      drawMarker(ctx, s.marker, px, py, s.color, r);
    }
  }

  /* ----- annotations (anchor dot + haloed label) ----- */
  for (const an of state.annotations ?? []) {
    const [px, py] = toPx(an.x, an.y);
    const col = an.color || C.text;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.fillStyle = col;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    haloText(an.text, px + (an.dx ?? 8), py + (an.dy ?? -10));
  }

  /* ----- drag handles + selected point (editor only, never exported) ----- */
  if (opts.showHandles) {
    state.series.forEach((s, si) => {
      for (const p of s.points) {
        const [px, py] = toPx(p[0], p[1]);
        ctx.beginPath();
        ctx.arc(px, py, si === state.active ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = si === state.active ? s.color : "#fff";
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
    });
    const sel = opts.selected;
    const selPt = sel && state.series[sel.si]?.points[sel.pi];
    if (sel && selPt) {
      const [px, py] = toPx(selPt[0], selPt[1]);
      ctx.beginPath();
      ctx.arc(px, py, 7.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 7.5, 0, Math.PI * 2);
      ctx.strokeStyle = state.series[sel.si].color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

/* ---------- SVG export (vector, mirrors render()) ---------- */

function svgMarker(
  shape: MarkerShape,
  x: number,
  y: number,
  color: string,
  r: number,
  f: (v: number) => number,
): string {
  if (shape === "dot") return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}"/>`;
  if (shape === "circle")
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#fff" stroke="${color}" stroke-width="${f(Math.max(1, r * 0.5))}"/>`;
  if (shape === "square")
    return `<rect x="${f(x - r)}" y="${f(y - r)}" width="${f(2 * r)}" height="${f(2 * r)}" fill="${color}"/>`;
  if (shape === "triangle")
    return `<polygon points="${f(x)},${f(y - r)} ${f(x + r)},${f(y + r)} ${f(x - r)},${f(y + r)}" fill="${color}"/>`;
  if (shape === "cross")
    return `<path d="M ${f(x - r)} ${f(y - r)} L ${f(x + r)} ${f(y + r)} M ${f(x + r)} ${f(y - r)} L ${f(x - r)} ${f(y + r)}" stroke="${color}" stroke-width="${f(Math.max(1.4, r * 0.5))}" stroke-linecap="round"/>`;
  return "";
}

export function renderSVG(
  state: GraphState,
  scale: number,
  opts: { background?: string | null } = {},
): string {
  const mctx = document.createElement("canvas").getContext("2d")!; // for text measurement in layout()
  const L = layout(mctx, state, scale);
  const { plot, toPx, W, H } = L;
  const { x: ax, y: ay } = state.axes;
  const grid = state.type !== "relation";
  const f = (v: number) => Math.round(v * 100) / 100;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [];

  const halo = (t: string, x: number, y: number, anchor: string, baseline: string, fill: string) =>
    `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" dominant-baseline="${baseline}" fill="${fill}" stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(t)}</text>`;
  const lineEl = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number) =>
    `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${w}"/>`;

  if (opts.background)
    parts.push(`<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="${opts.background}"/>`);

  /* grid */
  if (grid) {
    parts.push(
      `<rect x="${f(plot.x)}" y="${f(plot.y)}" width="${f(plot.w)}" height="${f(plot.h)}" fill="${C.wash}"/>`,
    );
    if (state.showMinor) {
      const minors = (a: Axis, vertical: boolean) => {
        const m = a.step / Math.max(1, a.minorPerMajor || 1);
        if (!(m > 0)) return;
        let v = Math.ceil(a.min / m - 1e-9) * m;
        for (let n = 0; v <= a.max + 1e-9 && n < MAX_LINES; n++, v += m) {
          if (isMultiple(v, a.step)) continue;
          const mid = isMultiple(v, a.step / 2);
          const col = mid ? C.mid : C.minor;
          const wid = mid ? 0.7 : 0.5;
          if (vertical) {
            const p = toPx(v, 0)[0];
            parts.push(lineEl(p, plot.y, p, plot.y + plot.h, col, wid));
          } else {
            const p = toPx(0, v)[1];
            parts.push(lineEl(plot.x, p, plot.x + plot.w, p, col, wid));
          }
        }
      };
      minors(ax, true);
      minors(ay, false);
    }
    for (const v of autoTicks(ax)) {
      const p = toPx(v, 0)[0];
      parts.push(lineEl(p, plot.y, p, plot.y + plot.h, C.major, 1));
    }
    for (const v of autoTicks(ay)) {
      const p = toPx(0, v)[1];
      parts.push(lineEl(plot.x, p, plot.x + plot.w, p, C.major, 1));
    }
    parts.push(
      `<rect x="${f(plot.x)}" y="${f(plot.y)}" width="${f(plot.w)}" height="${f(plot.h)}" fill="none" stroke="${C.border}" stroke-width="1.2"/>`,
    );
  }

  /* axes + arrows */
  const axisPad = scale * 0.5;
  const aw = state.axisWidth ?? 1.6;
  const ak = aw / 1.6;
  const xr = plot.x + plot.w + axisPad;
  const xl = ax.min < 0 ? plot.x - axisPad : plot.x;
  const arrowEl = (x: number, y: number, dx: number, dy: number) => {
    const s = 9 * ak,
      w = 3.6 * ak;
    const p1 = `${f(x + dx * 2)},${f(y + dy * 2)}`;
    const p2 = `${f(x - dx * s - dy * w)},${f(y - dy * s + dx * w)}`;
    const p3 = `${f(x - dx * s + dy * w)},${f(y - dy * s - dx * w)}`;
    return `<polygon points="${p1} ${p2} ${p3}" fill="${C.axis}"/>`;
  };
  parts.push(lineEl(xl, L.xAxisY, xr, L.xAxisY, C.axis, aw));
  parts.push(arrowEl(xr, L.xAxisY, 1, 0));
  if (ax.min < 0) parts.push(arrowEl(xl, L.xAxisY, -1, 0));
  const yt = plot.y - axisPad;
  const yb = ay.min < 0 ? plot.y + plot.h + axisPad : plot.y + plot.h;
  parts.push(lineEl(L.yAxisX, yb, L.yAxisX, yt, C.axis, aw));
  parts.push(arrowEl(L.yAxisX, yt, 0, -1));
  if (ay.min < 0) parts.push(arrowEl(L.yAxisX, yb, 0, 1));

  /* titles */
  parts.push(halo(ay.label, L.yAxisX, yt - 8, "middle", "alphabetic", C.text));
  parts.push(halo(ax.label, xr + 7, L.xAxisY, "start", "central", C.text));

  /* tick labels */
  if (grid) {
    const autoX = !(ax.tickLabels || "").trim();
    for (const v of labelTicks(ax)) {
      if (autoX && Math.abs(v - L.axisXWorld) < 1e-9) continue;
      parts.push(
        halo(String(v), toPx(v, 0)[0], L.xAxisY + 5, "middle", "text-before-edge", C.text),
      );
    }
    const seen = new Set<number>();
    for (const v of labelTicks(ay)) {
      if (seen.has(v)) continue;
      seen.add(v);
      parts.push(halo(String(v), L.yAxisX - 6, toPx(0, v)[1], "end", "central", C.text));
    }
  }

  /* area fills + data lines (clipped) */
  const clipId = "plotclip";
  parts.push(
    `<clipPath id="${clipId}"><rect x="${f(plot.x - 4)}" y="${f(plot.y - 4)}" width="${f(plot.w + 8)}" height="${f(plot.h + 8)}"/></clipPath>`,
  );
  const dataParts: string[] = [];
  for (const s of state.series) {
    if (s.points.length < 2) continue;
    if (s.fill) {
      const baseY = Math.min(plot.y + plot.h, Math.max(plot.y, toPx(0, 0)[1]));
      const lastX = toPx(s.points[s.points.length - 1][0], 0)[0];
      const firstX = toPx(s.points[0][0], 0)[0];
      const d =
        "M " +
        s.points
          .map((p) => {
            const [px, py] = toPx(p[0], p[1]);
            return `${f(px)} ${f(py)}`;
          })
          .join(" L ") +
        ` L ${f(lastX)} ${f(baseY)} L ${f(firstX)} ${f(baseY)} Z`;
      dataParts.push(`<path d="${d}" fill="${s.color}" fill-opacity="0.18" stroke="none"/>`);
    }
    const pts = s.points
      .map((p) => {
        const [px, py] = toPx(p[0], p[1]);
        return `${f(px)},${f(py)}`;
      })
      .join(" ");
    const dash = dashArray(s.dash, s.width);
    const da = dash.length ? ` stroke-dasharray="${dash.map(f).join(",")}"` : "";
    dataParts.push(
      `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round"${da}/>`,
    );
  }
  parts.push(`<g clip-path="url(#${clipId})">${dataParts.join("")}</g>`);

  /* markers (unclipped) */
  for (const s of state.series) {
    if (!s.marker || s.marker === "none") continue;
    const r = markerRadius(s.width);
    for (const p of s.points) {
      const [px, py] = toPx(p[0], p[1]);
      parts.push(svgMarker(s.marker, px, py, s.color, r, f));
    }
  }

  /* annotations */
  for (const an of state.annotations ?? []) {
    const [px, py] = toPx(an.x, an.y);
    const col = an.color || C.text;
    parts.push(`<circle cx="${f(px)}" cy="${f(py)}" r="3" fill="${col}"/>`);
    parts.push(halo(an.text, px + (an.dx ?? 8), py + (an.dy ?? -10), "start", "central", col));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}" font-family='${FONT}' font-size="${L.fs}">${parts.join("")}</svg>`;
}
