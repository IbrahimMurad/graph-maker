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

export interface Series {
  color: string;
  width: number;
  points: [number, number][];
}

export interface GraphState {
  scale: number;
  type: "grid" | "relation";
  axes: { x: Axis; y: Axis };
  showMinor: boolean;
  snap: boolean;
  fontSize: number;
  series: Series[];
  active: number;
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
      y: { label: "d (m)", min: -12, max: 20, step: 10, minorPerMajor: 10, tickLabels: "0, 10, 20, -12" },
    },
    showMinor: true,
    snap: true,
    fontSize: 14,
    series: [{ color: PALETTE[0], width: 2, points: [[0, 0], [5, 20], [22, 20], [30, -12]] }],
    active: 0,
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
export function layout(ctx: CanvasRenderingContext2D, state: GraphState, scale: number): GraphLayout {
  const { x: ax, y: ay } = state.axes;
  const fs = state.fontSize || 14;
  scale = scale > 0 ? scale : DEFAULT_SCALE;
  ctx.font = fs + "px " + FONT;

  const showTicks = state.type !== "relation";

  let yTickW = 0;
  if (showTicks) for (const v of labelTicks(ay)) yTickW = Math.max(yTickW, ctx.measureText(String(v)).width);

  const left = Math.max(yTickW + 14, ctx.measureText(ay.label).width / 2 + 8, 34);
  const top = fs + 24;
  const right = Math.max(ctx.measureText(ax.label).width + 32, 36);
  const bottom = fs + 18;

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

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number) {
  const s = 9,
    w = 3.6;
  ctx.beginPath();
  ctx.moveTo(x + dx * 2, y + dy * 2);
  ctx.lineTo(x - dx * s - dy * w, y - dy * s + dx * w);
  ctx.lineTo(x - dx * s + dy * w, y - dy * s - dx * w);
  ctx.closePath();
  ctx.fill();
}

export function render(ctx: CanvasRenderingContext2D, state: GraphState, scale: number, opts: RenderOptions = {}) {
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
  ctx.strokeStyle = C.axis;
  ctx.fillStyle = C.axis;
  ctx.lineWidth = 1.6;
  const xr = plot.x + plot.w + 14;
  const xl = ax.min < 0 ? plot.x - 14 : plot.x;
  line(xl, L.xAxisY, xr, L.xAxisY);
  arrow(ctx, xr, L.xAxisY, 1, 0);
  if (ax.min < 0) arrow(ctx, xl, L.xAxisY, -1, 0);

  const yt = plot.y - 14;
  const yb = ay.min < 0 ? plot.y + plot.h + 14 : plot.y + plot.h;
  line(L.yAxisX, yb, L.yAxisX, yt);
  arrow(ctx, L.yAxisX, yt, 0, -1);
  if (ay.min < 0) arrow(ctx, L.yAxisX, yb, 0, 1);

  /* ----- titles (both modes) ----- */
  ctx.fillStyle = C.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(ay.label, L.yAxisX, yt - 8);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(ax.label, xr + 7, L.xAxisY);

  /* ----- tick labels (grid mode only) ----- */
  if (grid) {
    const label = (t: string, x: number, y: number) => {
      if (x > plot.x && x < plot.x + plot.w && y > plot.y - 2 && y < plot.y + plot.h + 2) {
        ctx.save();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeText(t, x, y);
        ctx.restore();
      }
      ctx.fillText(t, x, y);
    };
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const autoX = !(ax.tickLabels || "").trim();
    for (const v of labelTicks(ax)) {
      if (autoX && Math.abs(v - L.axisXWorld) < 1e-9) continue;
      label(String(v), toPx(v, 0)[0], L.xAxisY + 5);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const seen = new Set<number>();
    for (const v of labelTicks(ay)) {
      if (seen.has(v)) continue;
      seen.add(v);
      label(String(v), L.yAxisX - 6, toPx(0, v)[1]);
    }
  }

  /* ----- data lines (clipped to the plot, with slack for line width) ----- */
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x - 4, plot.y - 4, plot.w + 8, plot.h + 8);
  ctx.clip();
  for (const s of state.series) {
    if (s.points.length < 2) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const [px, py] = toPx(p[0], p[1]);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
  ctx.restore();

  /* ----- drag handles (editor only, never exported) ----- */
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
  }
}
