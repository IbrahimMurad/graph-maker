import { useEffect, useRef, useState } from "react";
import { Plus, X, Copy, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import {
  PALETTE,
  CURVE_TYPES,
  type Axis,
  type GraphState,
  type LineStyle,
  type MarkerShape,
  type CurveType,
} from "@/lib/graph";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  inputCls,
  btnCls,
  stepBtnCls,
  SectionHeader,
  Field,
  Check,
  NumberField,
} from "@/components/shared/fields";
import { ExportSection } from "@/components/shared/export-section";
import type { Mutate } from "./stage";

/* Min/Max row with steppers at each end that add (outer chevron) or remove (inner chevron)
   one major grid unit. Retract is blocked when it would collapse the axis to nothing. */
function AxisRangeRow({
  axis,
  mutateAxis,
  which,
}: {
  axis: Axis;
  mutateAxis: (fn: (a: Axis) => void) => void;
  which: "x" | "y";
}) {
  const isX = which === "x";
  const OutLow = isX ? ChevronLeft : ChevronDown; // grow the lower/left/bottom end (outward)
  const InLow = isX ? ChevronRight : ChevronUp; // shrink it (inward)
  const InHigh = isX ? ChevronLeft : ChevronDown; // shrink the upper/right/top end (inward)
  const OutHigh = isX ? ChevronRight : ChevronUp; // grow it (outward)
  const rr = (v: number) => Math.round(v * 1e6) / 1e6;
  const unit = isX ? "column" : "row";
  const low = isX ? "left (−x)" : "bottom (−y)";
  const high = isX ? "right (+x)" : "top (+y)";
  // Only allow removing a unit while at least one grid unit of range remains.
  const canRetractMin = axis.step > 0 && axis.max - (axis.min + axis.step) > 1e-9;
  const canRetractMax = axis.step > 0 && axis.max - axis.step - axis.min > 1e-9;
  const retractCls = `${stepBtnCls} disabled:pointer-events-none disabled:opacity-40`;
  return (
    <div className="flex items-end gap-1.5">
      <div className="flex gap-0.5 items-end">
        <button
          type="button"
          title={`Add a grid ${unit} on the ${low}`}
          className={stepBtnCls}
          onClick={() => mutateAxis((a) => void (a.min = rr(a.min - a.step)))}
        >
          <OutLow className="h-4 w-4" />
        </button>
        <NumberField
          label="Min"
          value={axis.min}
          onValue={(v) => mutateAxis((a) => void (a.min = v))}
        />
        <button
          type="button"
          title={`Remove a grid ${unit} from the ${low}`}
          className={retractCls}
          disabled={!canRetractMin}
          onClick={() =>
            mutateAxis((a) => {
              if (a.step > 0 && a.max - (a.min + a.step) > 1e-9) a.min = rr(a.min + a.step);
            })
          }
        >
          <InLow className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-0.5 items-end">
        <button
          type="button"
          title={`Remove a grid ${unit} from the ${high}`}
          className={retractCls}
          disabled={!canRetractMax}
          onClick={() =>
            mutateAxis((a) => {
              if (a.step > 0 && a.max - a.step - a.min > 1e-9) a.max = rr(a.max - a.step);
            })
          }
        >
          <InHigh className="h-4 w-4" />
        </button>
        <NumberField
          label="Max"
          value={axis.max}
          onValue={(v) => mutateAxis((a) => void (a.max = v))}
        />
        <button
          type="button"
          title={`Add a grid ${unit} on the ${high}`}
          className={stepBtnCls}
          onClick={() => mutateAxis((a) => void (a.max = rr(a.max + a.step)))}
        >
          <OutHigh className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function AxisFields({
  axis,
  mutateAxis,
  which,
}: {
  axis: Axis;
  mutateAxis: (fn: (a: Axis) => void) => void;
  which: "x" | "y";
}) {
  return (
    <div className="space-y-2.5">
      <Field label="Title">
        <input
          className={inputCls}
          defaultValue={axis.label}
          onChange={(e) => mutateAxis((a) => void (a.label = e.target.value))}
        />
      </Field>
      <AxisRangeRow axis={axis} mutateAxis={mutateAxis} which={which} />
      <NumberField
        label="Major step"
        value={axis.step}
        onValue={(v) => mutateAxis((a) => void (a.step = v))}
      />
      <Field label="Tick labels (blank = auto)">
        <input
          className={inputCls}
          defaultValue={axis.tickLabels}
          placeholder="e.g. 5, 10, 15"
          onChange={(e) => mutateAxis((a) => void (a.tickLabels = e.target.value))}
        />
      </Field>
    </div>
  );
}

function LinesSection({ state, mutate }: { state: GraphState; mutate: Mutate }) {
  const active = state.series[state.active];
  const serialized = active.points.map((p) => p[0] + ", " + p[1]).join("\n");
  const [pointsText, setPointsText] = useState(serialized);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setPointsText(serialized);
  }, [serialized]);

  const onPointsChange = (text: string) => {
    setPointsText(text);
    const pts: [number, number][] = [];
    for (const raw of text.split("\n")) {
      const t = raw.trim();
      if (!t) continue;
      const n = t.split(/[,;\s]+/).map(Number);
      if (n.length < 2 || !isFinite(n[0]) || !isFinite(n[1])) return;
      pts.push([n[0], n[1]]);
    }
    if (pts.length >= 2) {
      pts.sort((a, b) => a[0] - b[0]);
      mutate((s) => void (s.series[s.active].points = pts));
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {state.series.map((s, i) => {
          const isActive = i === state.active;
          const canDelete = state.series.length > 1;
          return (
            <div
              key={i}
              className={`group flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-1 text-xs font-semibold transition-colors ${
                isActive
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-input bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              <button
                onClick={() => mutate((st) => void (st.active = i))}
                className="flex items-center gap-1.5"
                title={`Select line ${i + 1}`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {i + 1}
              </button>
              {canDelete && (
                <button
                  title={`Delete line ${i + 1}`}
                  onClick={() =>
                    mutate((st) => {
                      st.series.splice(i, 1);
                      if (st.active >= st.series.length) st.active = st.series.length - 1;
                      else if (st.active > i) st.active -= 1;
                    })
                  }
                  className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground/70 opacity-70 transition-all hover:bg-destructive hover:text-destructive-foreground hover:opacity-100"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              )}
            </div>
          );
        })}
        <button
          title="Add a line"
          onClick={() =>
            mutate((s) => {
              const { x: ax, y: ay } = s.axes;
              s.series.push({
                color: PALETTE[s.series.length % PALETTE.length],
                width: 2,
                points: [
                  [ax.min, ay.min],
                  [ax.max, ay.max],
                ],
              });
              s.active = s.series.length - 1;
            })
          }
          className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-input text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          title="Duplicate the selected line"
          onClick={() =>
            mutate((s) => {
              const a = s.series[s.active];
              s.series.splice(s.active + 1, 0, {
                ...a,
                color: PALETTE[s.series.length % PALETTE.length],
                points: a.points.map((p) => [p[0], p[1]] as [number, number]),
                curve: a.curve ? { ...a.curve } : undefined, // own copy, not a shared ref
              });
              s.active += 1;
            })
          }
          className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-input text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>

      <div className="flex gap-2">
        <Field label="Color">
          <input
            type="color"
            className="h-8 w-full cursor-pointer rounded-md border border-input bg-background p-0.5"
            value={active.color}
            onChange={(e) => mutate((s) => void (s.series[s.active].color = e.target.value))}
          />
        </Field>
        <NumberField
          key={`w-${state.active}`}
          label="Width"
          value={active.width}
          min={0.5}
          step="0.5"
          onValue={(v) => {
            if (v > 0) mutate((s) => void (s.series[s.active].width = v));
          }}
        />
      </div>

      <Field label="Shape">
        <select
          className={inputCls}
          value={active.curve?.type ?? "points"}
          onChange={(e) =>
            mutate((s) => {
              const v = e.target.value;
              const cur = s.series[s.active];
              if (v === "points") delete cur.curve;
              else
                cur.curve = {
                  type: v as CurveType,
                  slope: cur.curve?.slope ?? 1,
                  intercept: cur.curve?.intercept ?? 0,
                };
            })
          }
        >
          <option value="points">Freehand points</option>
          {CURVE_TYPES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-2">
        <Field label="Line style">
          <select
            className={inputCls}
            value={active.dash ?? "solid"}
            onChange={(e) =>
              mutate((s) => void (s.series[s.active].dash = e.target.value as LineStyle))
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </Field>
        {!active.curve && (
          <Field label="Markers">
            <select
              className={inputCls}
              value={active.marker ?? "none"}
              onChange={(e) =>
                mutate((s) => void (s.series[s.active].marker = e.target.value as MarkerShape))
              }
            >
              <option value="none">None</option>
              <option value="dot">Dot</option>
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
              <option value="cross">Cross</option>
            </select>
          </Field>
        )}
      </div>
      <Check
        label="Fill area under line"
        checked={!!active.fill}
        onChange={(v) => mutate((s) => void (s.series[s.active].fill = v))}
      />

      {active.curve && active.curve.type === "linear" && (
        <div className="flex gap-2">
          <NumberField
            key={`slope-${state.active}`}
            label="Slope"
            value={active.curve.slope ?? 1}
            step="0.1"
            onValue={(v) =>
              mutate((s) => {
                const c = s.series[s.active].curve;
                if (c) c.slope = v;
              })
            }
          />
          <NumberField
            key={`intercept-${state.active}`}
            label="Intercept"
            value={active.curve.intercept ?? 0}
            step="0.5"
            onValue={(v) =>
              mutate((s) => {
                const c = s.series[s.active].curve;
                if (c) c.intercept = v;
              })
            }
          />
        </div>
      )}

      {active.curve && active.curve.type !== "linear" && (
        <p className="text-xs leading-snug text-muted-foreground">
          Schematic shape spanning the axes — it shows the relation, not exact values. Set the range
          in the X/Y tabs; use a Relation diagram (Canvas tab) to hide the grid.
        </p>
      )}

      {!active.curve && (
        <Field label={`Points — one "x, y" per line`}>
          <textarea
            rows={6}
            spellCheck={false}
            className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
            value={pointsText}
            onFocus={() => (focusedRef.current = true)}
            onBlur={() => {
              focusedRef.current = false;
              setPointsText(serialized);
            }}
            onChange={(e) => onPointsChange(e.target.value)}
          />
        </Field>
      )}
    </div>
  );
}

function CanvasSection({ state, mutate }: { state: GraphState; mutate: Mutate }) {
  const relation = state.type === "relation";
  return (
    <div className="space-y-2.5">
      <Field label="Graph type">
        <select
          className={inputCls}
          value={state.type}
          onChange={(e) => mutate((s) => void (s.type = e.target.value as GraphState["type"]))}
        >
          <option value="grid">Grid graph</option>
          <option value="relation">Relation diagram</option>
        </select>
      </Field>
      <NumberField
        label="Axis width"
        value={state.axisWidth ?? 1.6}
        min={0.5}
        step="0.2"
        onValue={(v) => {
          if (v > 0) mutate((s) => void (s.axisWidth = v));
        }}
      />
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Check
          label="Fine grid"
          checked={state.showMinor}
          disabled={relation}
          onChange={(v) => mutate((s) => void (s.showMinor = v))}
        />
        <Check
          label="Snap to grid"
          checked={state.snap}
          disabled={relation}
          onChange={(v) => mutate((s) => void (s.snap = v))}
        />
      </div>
    </div>
  );
}

function AnnotationsSection({ state, mutate }: { state: GraphState; mutate: Mutate }) {
  const anns = state.annotations ?? [];
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return (
    <div className="space-y-2.5">
      {anns.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No annotations yet. Add a labelled point pinned to the graph.
        </p>
      )}
      {anns.map((an, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="flex items-center gap-1.5">
            <input
              className={inputCls}
              value={an.text}
              placeholder="Label"
              onChange={(e) => mutate((s) => void (s.annotations[i].text = e.target.value))}
            />
            <input
              type="color"
              title="Label colour"
              className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
              value={an.color ?? "#000000"}
              onChange={(e) => mutate((s) => void (s.annotations[i].color = e.target.value))}
            />
            <button
              title="Remove annotation"
              onClick={() => mutate((s) => void s.annotations.splice(i, 1))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-input text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex gap-1.5">
            <NumberField
              label="x"
              value={an.x}
              onValue={(v) => mutate((s) => void (s.annotations[i].x = v))}
            />
            <NumberField
              label="y"
              value={an.y}
              onValue={(v) => mutate((s) => void (s.annotations[i].y = v))}
            />
          </div>
        </div>
      ))}
      <button
        className={btnCls}
        onClick={() =>
          mutate((s) => {
            const { x: ax, y: ay } = s.axes;
            s.annotations.push({
              x: round((ax.min + ax.max) / 2),
              y: round((ay.min + ay.max) / 2),
              text: "Label",
            });
          })
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Add annotation
      </button>
    </div>
  );
}

export interface PanelProps {
  state: GraphState;
  mutate: Mutate;
  exportScale: number;
  setExportScale: (v: number) => void;
  transparent: boolean;
  setTransparent: (v: boolean) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onReset: () => void;
  onExportSvg: () => void;
  onCopyPng: () => void;
  onBatch: (file: File) => void;
  compact?: boolean;
}

export function GraphPanel(props: PanelProps) {
  const { state, mutate, compact } = props;

  if (compact) {
    return (
      <Tabs defaultValue="x" className="flex h-full min-h-0 flex-col">
        <TabsList className="mx-3 mt-2 grid h-9 shrink-0 grid-cols-6 gap-1 rounded-lg bg-muted/60 p-1">
          <TabsTrigger value="x" className="rounded-md text-xs font-semibold">
            X
          </TabsTrigger>
          <TabsTrigger value="y" className="rounded-md text-xs font-semibold">
            Y
          </TabsTrigger>
          <TabsTrigger value="lines" className="rounded-md text-xs font-semibold">
            Lines
          </TabsTrigger>
          <TabsTrigger value="canvas" className="rounded-md text-xs font-semibold">
            Canvas
          </TabsTrigger>
          <TabsTrigger value="notes" className="rounded-md text-xs font-semibold">
            Notes
          </TabsTrigger>
          <TabsTrigger value="export" className="rounded-md text-xs font-semibold">
            Export
          </TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <TabsContent value="x" className="mt-0">
            <AxisFields
              axis={state.axes.x}
              mutateAxis={(fn) => mutate((s) => fn(s.axes.x))}
              which="x"
            />
          </TabsContent>
          <TabsContent value="y" className="mt-0">
            <AxisFields
              axis={state.axes.y}
              mutateAxis={(fn) => mutate((s) => fn(s.axes.y))}
              which="y"
            />
          </TabsContent>
          <TabsContent value="lines" className="mt-0">
            <LinesSection state={state} mutate={mutate} />
          </TabsContent>
          <TabsContent value="canvas" className="mt-0">
            <CanvasSection state={state} mutate={mutate} />
          </TabsContent>
          <TabsContent value="notes" className="mt-0">
            <AnnotationsSection state={state} mutate={mutate} />
          </TabsContent>
          <TabsContent value="export" className="mt-0">
            <ExportSection
              exportScale={props.exportScale}
              setExportScale={props.setExportScale}
              transparent={props.transparent}
              setTransparent={props.setTransparent}
              onSave={props.onSave}
              onLoad={props.onLoad}
              onReset={props.onReset}
              onExportSvg={props.onExportSvg}
              onCopyPng={props.onCopyPng}
              onBatch={props.onBatch}
            />
          </TabsContent>
        </div>
      </Tabs>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="X axis" />
          <AxisFields
            axis={state.axes.x}
            mutateAxis={(fn) => mutate((s) => fn(s.axes.x))}
            which="x"
          />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Y axis" />
          <AxisFields
            axis={state.axes.y}
            mutateAxis={(fn) => mutate((s) => fn(s.axes.y))}
            which="y"
          />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Lines" />
          <LinesSection state={state} mutate={mutate} />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Canvas" />
          <CanvasSection state={state} mutate={mutate} />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Annotations" />
          <AnnotationsSection state={state} mutate={mutate} />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Export" />
          <ExportSection
            exportScale={props.exportScale}
            setExportScale={props.setExportScale}
            transparent={props.transparent}
            setTransparent={props.setTransparent}
            onSave={props.onSave}
            onLoad={props.onLoad}
            onReset={props.onReset}
            onExportSvg={props.onExportSvg}
            onCopyPng={props.onCopyPng}
            onBatch={props.onBatch}
          />
        </section>
      </div>
    </div>
  );
}
