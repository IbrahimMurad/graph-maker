import { useEffect, useRef, useState } from "react";
import { Plus, Minus, Upload, Download, RotateCcw } from "lucide-react";
import { PALETTE, type Axis, type GraphState } from "@/lib/graph";
import type { Mutate } from "./stage";

const inputCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";
const btnCls =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4">
      <h2 className="mb-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
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

function AxisSection({ title, axis, mutateAxis }: { title: string; axis: Axis; mutateAxis: (fn: (a: Axis) => void) => void }) {
  return (
    <Section title={title}>
      <Field label="Title">
        <input
          className={inputCls}
          defaultValue={axis.label}
          onChange={(e) => mutateAxis((a) => void (a.label = e.target.value))}
        />
      </Field>
      <div className="flex gap-2">
        <NumberField label="Min" value={axis.min} onValue={(v) => mutateAxis((a) => void (a.min = v))} />
        <NumberField label="Max" value={axis.max} onValue={(v) => mutateAxis((a) => void (a.max = v))} />
      </div>
      <div className="flex gap-2">
        <NumberField label="Major step" value={axis.step} onValue={(v) => mutateAxis((a) => void (a.step = v))} />
        <NumberField
          label="Minor / major"
          value={axis.minorPerMajor}
          min={1}
          step="1"
          onValue={(v) => mutateAxis((a) => void (a.minorPerMajor = v))}
        />
      </div>
      <Field label="Tick labels (blank = auto)">
        <input
          className={inputCls}
          defaultValue={axis.tickLabels}
          placeholder="e.g. 5, 10, 15"
          onChange={(e) => mutateAxis((a) => void (a.tickLabels = e.target.value))}
        />
      </Field>
    </Section>
  );
}

export function GraphPanel({
  state,
  mutate,
  exportScale,
  setExportScale,
  transparent,
  setTransparent,
  onSave,
  onLoad,
  onReset,
}: {
  state: GraphState;
  mutate: Mutate;
  exportScale: number;
  setExportScale: (v: number) => void;
  transparent: boolean;
  setTransparent: (v: boolean) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onReset: () => void;
}) {
  const active = state.series[state.active];
  const relation = state.type === "relation";

  /* points textarea: editable draft that re-syncs when points change elsewhere (e.g. drag) */
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
      if (n.length < 2 || !isFinite(n[0]) || !isFinite(n[1])) return; // mid-edit: keep last valid state
      pts.push([n[0], n[1]]);
    }
    if (pts.length >= 2) {
      pts.sort((a, b) => a[0] - b[0]);
      mutate((s) => void (s.series[s.active].points = pts));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AxisSection title="X axis" axis={state.axes.x} mutateAxis={(fn) => mutate((s) => fn(s.axes.x))} />
        <AxisSection title="Y axis" axis={state.axes.y} mutateAxis={(fn) => mutate((s) => fn(s.axes.y))} />

        <Section title="Lines">
          <div className="flex flex-wrap items-center gap-1.5">
            {state.series.map((s, i) => (
              <button
                key={i}
                onClick={() => mutate((st) => void (st.active = i))}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  i === state.active
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-input bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {i + 1}
              </button>
            ))}
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
            {state.series.length > 1 && (
              <button
                title="Delete this line"
                onClick={() =>
                  mutate((s) => {
                    s.series.splice(s.active, 1);
                    s.active = Math.max(0, s.active - 1);
                  })
                }
                className="grid h-6 w-6 place-items-center rounded-full border border-input text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            )}
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
        </Section>

        <Section title="Canvas">
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
          <div className="flex items-center gap-4 pt-1">
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
        </Section>

        <Section title="Export">
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
        </Section>
      </div>
    </div>
  );
}
