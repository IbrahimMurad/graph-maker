import { useEffect, useRef, useState } from "react";
import { Plus, Upload, Download, RotateCcw, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import { PALETTE, type Axis, type GraphState } from "@/lib/graph";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Mutate } from "./stage";

const inputCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";
const btnCls =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted";
const stepBtnCls =
  "grid h-7 w-7 shrink-0 place-items-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary active:scale-95";

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mb-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {title}
    </h2>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-xs font-medium ${disabled ? "text-muted-foreground/50" : "text-foreground"}`}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  step,
  onValue,
}: {
  label: string;
  value: number;
  min?: number;
  step?: string;
  onValue: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        className={inputCls}
        defaultValue={value}
        min={min}
        step={step ?? "any"}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (isFinite(v)) onValue(v);
        }}
      />
    </Field>
  );
}

/* Min/Max row with steppers that extend the axis by one major step at either end. */
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
  const MinusIcon = isX ? ChevronLeft : ChevronDown;
  const PlusIcon = isX ? ChevronRight : ChevronUp;
  return (
    <div className="flex items-end gap-1.5">
      <button
        type="button"
        title={isX ? "Extend −x by one grid column" : "Extend −y by one grid row"}
        className={stepBtnCls}
        onClick={() => mutateAxis((a) => void (a.min = Math.round((a.min - a.step) * 1e6) / 1e6))}
      >
        <MinusIcon className="h-4 w-4" />
      </button>
      <NumberField label="Min" value={axis.min} onValue={(v) => mutateAxis((a) => void (a.min = v))} />
      <NumberField label="Max" value={axis.max} onValue={(v) => mutateAxis((a) => void (a.max = v))} />
      <button
        type="button"
        title={isX ? "Extend +x by one grid column" : "Extend +y by one grid row"}
        className={stepBtnCls}
        onClick={() => mutateAxis((a) => void (a.max = Math.round((a.max + a.step) * 1e6) / 1e6))}
      >
        <PlusIcon className="h-4 w-4" />
      </button>
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
      <NumberField label="Major step" value={axis.step} onValue={(v) => mutateAxis((a) => void (a.step = v))} />
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

function ExportSection({
  exportScale,
  setExportScale,
  transparent,
  setTransparent,
  onSave,
  onLoad,
  onReset,
}: {
  exportScale: number;
  setExportScale: (v: number) => void;
  transparent: boolean;
  setTransparent: (v: boolean) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-end gap-3">
        <Field label="Scale">
          <select className={inputCls} value={exportScale} onChange={(e) => setExportScale(parseInt(e.target.value, 10))}>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={3}>3×</option>
            <option value={4}>4×</option>
          </select>
        </Field>
        <div className="pb-2">
          <Check label="Transparent" checked={transparent} onChange={setTransparent} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 pt-1">
        <button className={btnCls} onClick={onSave} title="Save preset as JSON">
          <Download className="h-3.5 w-3.5" />
          Save
        </button>
        <label className={btnCls} title="Load a saved preset">
          <Upload className="h-3.5 w-3.5" />
          Load
          <input
            type="file"
            hidden
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLoad(f);
              e.target.value = "";
            }}
          />
        </label>
        <button className={btnCls} onClick={onReset} title="Reset to defaults">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>
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
  compact?: boolean;
}

export function GraphPanel(props: PanelProps) {
  const { state, mutate, compact } = props;

  if (compact) {
    return (
      <Tabs defaultValue="x" className="flex h-full min-h-0 flex-col">
        <TabsList className="mx-3 mt-2 grid h-9 shrink-0 grid-cols-5 gap-1 rounded-lg bg-muted/60 p-1">
          <TabsTrigger value="x" className="rounded-md text-xs font-semibold">X</TabsTrigger>
          <TabsTrigger value="y" className="rounded-md text-xs font-semibold">Y</TabsTrigger>
          <TabsTrigger value="lines" className="rounded-md text-xs font-semibold">Lines</TabsTrigger>
          <TabsTrigger value="canvas" className="rounded-md text-xs font-semibold">Canvas</TabsTrigger>
          <TabsTrigger value="export" className="rounded-md text-xs font-semibold">Export</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <TabsContent value="x" className="mt-0">
            <AxisFields axis={state.axes.x} mutateAxis={(fn) => mutate((s) => fn(s.axes.x))} which="x" />
          </TabsContent>
          <TabsContent value="y" className="mt-0">
            <AxisFields axis={state.axes.y} mutateAxis={(fn) => mutate((s) => fn(s.axes.y))} which="y" />
          </TabsContent>
          <TabsContent value="lines" className="mt-0">
            <LinesSection state={state} mutate={mutate} />
          </TabsContent>
          <TabsContent value="canvas" className="mt-0">
            <CanvasSection state={state} mutate={mutate} />
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
          <AxisFields axis={state.axes.x} mutateAxis={(fn) => mutate((s) => fn(s.axes.x))} which="x" />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Y axis" />
          <AxisFields axis={state.axes.y} mutateAxis={(fn) => mutate((s) => fn(s.axes.y))} which="y" />
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
          <SectionHeader title="Export" />
          <ExportSection
            exportScale={props.exportScale}
            setExportScale={props.setExportScale}
            transparent={props.transparent}
            setTransparent={props.setTransparent}
            onSave={props.onSave}
            onLoad={props.onLoad}
            onReset={props.onReset}
          />
        </section>
      </div>
    </div>
  );
}
