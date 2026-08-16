/* Dual-backend drawing pen.
   Circuit symbols describe their geometry ONCE as abstract path commands in local
   coordinates; a Pen carries an affine matrix (local -> device) and renders those
   commands either onto a canvas (via Path2D) or into an SVG string. This keeps the
   editor canvas, the PNG export, the SVG export, and the palette previews pixel-honest
   with each other — there is exactly one source of truth per symbol.

   Conventions:
   - Matrices are similarity transforms only (uniform scale + quarter-turn rotation +
     optional mirror + translation), which is all a schematic needs. Arc radii scale
     uniformly and mirrors flip the sweep flag.
   - Stroke widths, dash patterns and font sizes are given in DEVICE px (already zoomed);
     the matrix only positions geometry.
   - text() places its anchor through the matrix but always renders upright — schematic
     lettering (A, V, +, R₁) must never end up sideways or upside-down. "_" toggles
     subscript runs: "R_1" renders as R₁. */

export const FONT = '"Cambria Math", Cambria, Georgia, "Times New Roman", serif';

export type PathCmd =
  | ["M", number, number]
  | ["L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["A", number, number, number, 0 | 1, 0 | 1, number, number] // rx ry xrot largeArc sweep x y
  | ["Z"];

export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const matIdentity: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/* m1 ∘ m2 — apply m2 first, then m1. */
export function matMul(m1: Mat, m2: Mat): Mat {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function matApply(m: Mat, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

export function matInverse(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/* Quarter-turn rotation matrices, exact (screen coords: +y is down, 90° turns clockwise). */
export function matRot(rot: 0 | 90 | 180 | 270): Mat {
  switch (rot) {
    case 0:
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    case 90:
      return { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    case 180:
      return { a: -1, b: 0, c: 0, d: -1, e: 0, f: 0 };
    case 270:
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: 0 };
  }
}

export interface StrokeOpts {
  stroke?: string | null; // null = no stroke; default ink handled by caller-supplied pen defaults
  fill?: string | null;
  width?: number; // device px
  dash?: number[]; // device px
  cap?: CanvasLineCap;
}

export interface TextOpts {
  size: number; // device px
  color?: string;
  align?: "center" | "left" | "right";
  baseline?: "middle" | "top" | "bottom";
  italic?: boolean;
  halo?: boolean; // white outline under the glyphs for legibility over grid lines
}

export interface Pen {
  path(cmds: PathCmd[], o?: StrokeOpts): void;
  circle(cx: number, cy: number, r: number, o?: StrokeOpts): void;
  text(t: string, x: number, y: number, o: TextOpts): void;
}

export interface TextRun {
  t: string;
  sub: boolean;
}

/* "_" toggles subscript: "R_1" -> R, sub(1); "V_AB" -> V, sub(AB). */
export function parseSub(t: string): TextRun[] {
  const runs: TextRun[] = [];
  let sub = false;
  for (const part of t.split("_")) {
    if (part) runs.push({ t: part, sub });
    sub = !sub;
  }
  return runs.length ? runs : [{ t: "", sub: false }];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/* Transform path commands through a similarity matrix and serialize to SVG path data.
   The same string feeds Path2D (canvas) and <path d> (SVG). */
export function transformedPath(cmds: PathCmd[], m: Mat): string {
  const k = Math.hypot(m.a, m.b); // uniform scale factor
  const theta = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  const mirrored = m.a * m.d - m.b * m.c < 0;
  const out: string[] = [];
  for (const c of cmds) {
    switch (c[0]) {
      case "M":
      case "L": {
        const [x, y] = matApply(m, c[1], c[2]);
        out.push(`${c[0]}${r2(x)} ${r2(y)}`);
        break;
      }
      case "C": {
        const [x1, y1] = matApply(m, c[1], c[2]);
        const [x2, y2] = matApply(m, c[3], c[4]);
        const [x, y] = matApply(m, c[5], c[6]);
        out.push(`C${r2(x1)} ${r2(y1)} ${r2(x2)} ${r2(y2)} ${r2(x)} ${r2(y)}`);
        break;
      }
      case "A": {
        const [, rx, ry, xrot, large, sweep, ex, ey] = c;
        const [x, y] = matApply(m, ex, ey);
        const sw = mirrored ? ((1 - sweep) as 0 | 1) : sweep;
        out.push(
          `A${r2(rx * k)} ${r2(ry * k)} ${r2(xrot + (mirrored ? -theta : theta))} ${large} ${sw} ${r2(x)} ${r2(y)}`,
        );
        break;
      }
      case "Z":
        out.push("Z");
        break;
    }
  }
  return out.join(" ");
}

export const INK = "#000000";

export class CanvasPen implements Pen {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private mat: Mat,
    private lw: number, // default stroke width, device px
  ) {}

  path(cmds: PathCmd[], o: StrokeOpts = {}): void {
    const { ctx } = this;
    const p = new Path2D(transformedPath(cmds, this.mat));
    ctx.save();
    if (o.fill) {
      ctx.fillStyle = o.fill;
      ctx.fill(p);
    }
    if (o.stroke !== null) {
      ctx.strokeStyle = o.stroke ?? INK;
      ctx.lineWidth = o.width ?? this.lw;
      ctx.lineJoin = "round";
      ctx.lineCap = o.cap ?? "round";
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.stroke(p);
    }
    ctx.restore();
  }

  circle(cx: number, cy: number, r: number, o: StrokeOpts = {}): void {
    const { ctx } = this;
    const [x, y] = matApply(this.mat, cx, cy);
    const k = Math.hypot(this.mat.a, this.mat.b);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * k, 0, Math.PI * 2);
    if (o.fill) {
      ctx.fillStyle = o.fill;
      ctx.fill();
    }
    if (o.stroke !== null) {
      ctx.strokeStyle = o.stroke ?? INK;
      ctx.lineWidth = o.width ?? this.lw;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.stroke();
    }
    ctx.restore();
  }

  text(t: string, x: number, y: number, o: TextOpts): void {
    const { ctx } = this;
    const [px, py] = matApply(this.mat, x, y);
    const runs = parseSub(t);
    const font = (sub: boolean) =>
      `${o.italic ? "italic " : ""}${r2(sub ? o.size * 0.7 : o.size)}px ${FONT}`;
    ctx.save();
    ctx.textBaseline = o.baseline === "top" ? "top" : o.baseline === "bottom" ? "bottom" : "middle";
    ctx.textAlign = "left";
    let total = 0;
    for (const r of runs) {
      ctx.font = font(r.sub);
      total += ctx.measureText(r.t).width;
    }
    const x0 = o.align === "left" ? px : o.align === "right" ? px - total : px - total / 2;
    // halo first for ALL runs, then fills, so outlines never overpaint neighbouring glyphs
    if (o.halo !== false) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2.5, o.size / 5);
      ctx.lineJoin = "round";
      let cx = x0;
      for (const r of runs) {
        ctx.font = font(r.sub);
        ctx.strokeText(r.t, cx, py + (r.sub ? o.size * 0.24 : 0));
        cx += ctx.measureText(r.t).width;
      }
    }
    ctx.fillStyle = o.color ?? INK;
    let cx = x0;
    for (const r of runs) {
      ctx.font = font(r.sub);
      ctx.fillText(r.t, cx, py + (r.sub ? o.size * 0.24 : 0));
      cx += ctx.measureText(r.t).width;
    }
    ctx.restore();
  }
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class SvgPen implements Pen {
  constructor(
    private out: string[],
    private mat: Mat,
    private lw: number,
  ) {}

  private strokeAttrs(o: StrokeOpts): string {
    const parts: string[] = [];
    parts.push(`fill="${o.fill ?? "none"}"`);
    if (o.stroke === null) parts.push(`stroke="none"`);
    else {
      parts.push(`stroke="${o.stroke ?? INK}"`);
      parts.push(`stroke-width="${r2(o.width ?? this.lw)}"`);
      parts.push(`stroke-linejoin="round" stroke-linecap="${o.cap ?? "round"}"`);
      if (o.dash) parts.push(`stroke-dasharray="${o.dash.map(r2).join(" ")}"`);
    }
    return parts.join(" ");
  }

  path(cmds: PathCmd[], o: StrokeOpts = {}): void {
    this.out.push(`<path d="${transformedPath(cmds, this.mat)}" ${this.strokeAttrs(o)}/>`);
  }

  circle(cx: number, cy: number, r: number, o: StrokeOpts = {}): void {
    const [x, y] = matApply(this.mat, cx, cy);
    const k = Math.hypot(this.mat.a, this.mat.b);
    this.out.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r * k)}" ${this.strokeAttrs(o)}/>`);
  }

  text(t: string, x: number, y: number, o: TextOpts): void {
    const [px, py] = matApply(this.mat, x, y);
    const runs = parseSub(t);
    const anchor = o.align === "left" ? "start" : o.align === "right" ? "end" : "middle";
    const baseline =
      o.baseline === "top" ? "text-top" : o.baseline === "bottom" ? "text-bottom" : "central";
    // dy shifts accumulate across tspans, so each subscript run is followed by a
    // compensating shift back on the next normal run.
    let shifted = false;
    const spans = runs
      .map((r) => {
        const dy = r.sub && !shifted ? 0.28 : !r.sub && shifted ? -0.28 : 0;
        shifted = r.sub;
        const attrs =
          (r.sub ? ` font-size="70%"` : "") +
          (dy !== 0 ? ` dy="${dy > 0 ? "0.28em" : "-0.28em"}"` : "");
        return `<tspan${attrs}>${escapeXml(r.t)}</tspan>`;
      })
      .join("");
    const halo =
      o.halo !== false
        ? ` stroke="#ffffff" stroke-width="${r2(Math.max(2.5, o.size / 5))}" stroke-linejoin="round" paint-order="stroke"`
        : "";
    this.out.push(
      `<text x="${r2(px)}" y="${r2(py)}" font-family='${FONT}' font-size="${r2(o.size)}"` +
        `${o.italic ? ` font-style="italic"` : ""} fill="${o.color ?? INK}"` +
        ` text-anchor="${anchor}" dominant-baseline="${baseline}"${halo}>${spans}</text>`,
    );
  }
}
