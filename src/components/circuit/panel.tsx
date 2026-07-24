import { Copy, Plus, Trash2, RotateCcw as RotateCcwIcon, RotateCw, X } from "lucide-react";
import type { CircuitState, ComponentKind, Selection } from "@/lib/circuit";
import { SYMBOLS } from "@/lib/circuit-symbols";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  inputCls,
  btnCls,
  SectionHeader,
  Field,
  Check,
  NumberField,
} from "@/components/shared/fields";
import { ExportSection, type ExportSectionProps } from "@/components/shared/export-section";
import { Palette } from "./palette";
import type { CircuitMutate, SelectionOps } from "./stage";

function SelectedSection({
  state,
  mutate,
  sel,
  ops,
}: {
  state: CircuitState;
  mutate: CircuitMutate;
  sel: Selection;
  ops: SelectionOps;
}) {
  if (!sel)
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Nothing selected. Click a component or wire on the sheet — then edit its label and value
        here, rotate it, or toggle its state.
      </p>
    );

  if (sel.kind === "wire") {
    const w = state.wires.find((x) => x.id === sel.id);
    if (!w) return null;
    const mutateWire = (fn: (wire: CircuitState["wires"][number]) => void) =>
      mutate((s) => {
        const wire = s.wires.find((x) => x.id === sel.id);
        if (wire) fn(wire);
      });
    return (
      <div className="space-y-2.5" key={w.id}>
        <p className="text-xs font-semibold text-foreground">
          Wire · {w.pts.length} point{w.pts.length === 1 ? "" : "s"}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Press anywhere on the wire to bend it; right-click a bend to remove it. Drag the endpoint
          dots onto pins or other wire ends to connect.
        </p>
        <Check
          label="Current-direction arrow"
          checked={!!w.arrow}
          onChange={(v) =>
            mutateWire((wire) => void (wire.arrow = v ? { t: 0.5, dir: 1, label: "I" } : undefined))
          }
        />
        {w.arrow && (
          <>
            <div className="flex gap-2">
              <Field label="Arrow label">
                <input
                  className={inputCls}
                  defaultValue={w.arrow.label ?? ""}
                  placeholder="e.g. I_1"
                  onChange={(e) =>
                    mutateWire((wire) => {
                      if (wire.arrow) wire.arrow.label = e.target.value;
                    })
                  }
                />
              </Field>
              <NumberField
                label="Position (%)"
                value={Math.round(w.arrow.t * 100)}
                min={2}
                step="5"
                onValue={(v) =>
                  mutateWire((wire) => {
                    if (wire.arrow) wire.arrow.t = Math.min(98, Math.max(2, v)) / 100;
                  })
                }
              />
            </div>
            <button
              className={`${btnCls} w-full`}
              onClick={() =>
                mutateWire((wire) => {
                  if (wire.arrow) wire.arrow.dir = wire.arrow.dir === 1 ? -1 : 1;
                })
              }
              title="Point the arrow the other way along the wire"
            >
              Flip direction
            </button>
          </>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className={btnCls}
            onClick={() =>
              mutateWire((wire) => void (wire.pts = [wire.pts[0], wire.pts[wire.pts.length - 1]]))
            }
            title="Remove all bends, keeping the two endpoints"
          >
            Straighten
          </button>
          <button className={btnCls} onClick={ops.deleteSel} title="Delete this wire (Del)">
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    );
  }

  const c = state.components.find((x) => x.id === sel.id);
  if (!c) return null;
  const spec = SYMBOLS[c.kind];
  const mutateComp = (fn: (comp: CircuitState["components"][number]) => void) =>
    mutate((s) => {
      const cc = s.components.find((x) => x.id === sel.id);
      if (cc) fn(cc);
    });

  return (
    // key remounts the uncontrolled inputs when the selection moves to another part
    <div className="space-y-2.5" key={c.id}>
      <p className="text-xs font-semibold text-foreground">{spec.name}</p>
      <div className="flex gap-2">
        <Field label="Label — _ makes a subscript">
          <input
            className={inputCls}
            defaultValue={c.label ?? ""}
            placeholder="e.g. R_1"
            onChange={(e) => mutateComp((cc) => void (cc.label = e.target.value))}
          />
        </Field>
        <Field label="Value">
          <input
            className={inputCls}
            defaultValue={c.value ?? ""}
            placeholder="e.g. 10 Ω"
            onChange={(e) => mutateComp((cc) => void (cc.value = e.target.value))}
          />
        </Field>
      </div>

      <div className="flex items-end gap-1.5">
        <Field label={`Rotation — ${c.rot}°`}>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className={btnCls}
              onClick={() => ops.rotateSel(-1)}
              title="Rotate −90° (Shift+R)"
            >
              <RotateCcwIcon className="h-3.5 w-3.5" />
              −90°
            </button>
            <button className={btnCls} onClick={() => ops.rotateSel(1)} title="Rotate +90° (R)">
              <RotateCw className="h-3.5 w-3.5" />
              +90°
            </button>
          </div>
        </Field>
      </div>

      {c.kind === "lamp" && (
        <Check
          label="Lit (glowing)"
          checked={!!c.on}
          onChange={(v) => mutateComp((cc) => void (cc.on = v))}
        />
      )}
      {c.kind === "switch" && (
        <Check
          label="Closed"
          checked={!!c.closed}
          onChange={(v) => mutateComp((cc) => void (cc.closed = v))}
        />
      )}
      {(c.kind === "inductor" || c.kind === "solenoid" || c.kind === "transformer") && (
        <Check
          label="Iron core"
          checked={!!c.core}
          onChange={(v) => mutateComp((cc) => void (cc.core = v))}
        />
      )}
      {c.kind === "battery" && (
        <NumberField
          label="Cells (1–5)"
          value={c.cells ?? 2}
          min={1}
          step="1"
          onValue={(v) =>
            mutateComp((cc) => void (cc.cells = Math.min(5, Math.max(1, Math.round(v)))))
          }
        />
      )}

      <div className="grid grid-cols-2 gap-1.5 pt-1">
        <button className={btnCls} onClick={ops.duplicateSel} title="Duplicate (Ctrl/⌘+D)">
          <Copy className="h-3.5 w-3.5" />
          Duplicate
        </button>
        <button className={btnCls} onClick={ops.deleteSel} title="Delete (Del)">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}

function AnnotateSection({
  state,
  mutate,
  onAddNote,
  onAddField,
}: {
  state: CircuitState;
  mutate: CircuitMutate;
  onAddNote: () => void;
  onAddField: (mode: "in" | "out") => void;
}) {
  return (
    <div className="space-y-2.5">
      {state.notes.length === 0 && state.fields.length === 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Free text notes and magnetic-field regions (⊗ into the page, ⊙ out of it). Drag them on
          the sheet — notes by their text, regions by their dashed border.
        </p>
      )}
      {state.notes.map((n) => (
        <div key={n.id} className="flex items-center gap-1.5">
          <input
            className={inputCls}
            defaultValue={n.text}
            placeholder="Text — _ makes a subscript"
            onChange={(e) =>
              mutate((s) => {
                const note = s.notes.find((x) => x.id === n.id);
                if (note) note.text = e.target.value;
              })
            }
          />
          <button
            title="Remove note"
            onClick={() => mutate((s) => void (s.notes = s.notes.filter((x) => x.id !== n.id)))}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-input text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button className={`${btnCls} w-full`} onClick={onAddNote}>
        <Plus className="h-3.5 w-3.5" />
        Add note
      </button>

      {state.fields.map((f) => (
        <div key={f.id} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="flex items-center gap-1.5">
            <select
              className={inputCls}
              value={f.mode}
              onChange={(e) =>
                mutate((s) => {
                  const fr = s.fields.find((x) => x.id === f.id);
                  if (fr) fr.mode = e.target.value as "in" | "out";
                })
              }
            >
              <option value="in">⊗ Field into page</option>
              <option value="out">⊙ Field out of page</option>
            </select>
            <button
              title="Remove field region"
              onClick={() => mutate((s) => void (s.fields = s.fields.filter((x) => x.id !== f.id)))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-input text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex gap-1.5">
            <NumberField
              label="Width"
              value={f.w}
              min={1}
              step="1"
              onValue={(v) =>
                mutate((s) => {
                  const fr = s.fields.find((x) => x.id === f.id);
                  if (fr && v >= 1) fr.w = v;
                })
              }
            />
            <NumberField
              label="Height"
              value={f.h}
              min={1}
              step="1"
              onValue={(v) =>
                mutate((s) => {
                  const fr = s.fields.find((x) => x.id === f.id);
                  if (fr && v >= 1) fr.h = v;
                })
              }
            />
            <NumberField
              label="Spacing"
              value={f.spacing}
              min={0.75}
              step="0.25"
              onValue={(v) =>
                mutate((s) => {
                  const fr = s.fields.find((x) => x.id === f.id);
                  if (fr && v >= 0.75) fr.spacing = v;
                })
              }
            />
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1.5">
        <button className={btnCls} onClick={() => onAddField("in")} title="Field into the page">
          <Plus className="h-3.5 w-3.5" />⊗ region
        </button>
        <button className={btnCls} onClick={() => onAddField("out")} title="Field out of the page">
          <Plus className="h-3.5 w-3.5" />⊙ region
        </button>
      </div>
    </div>
  );
}

function CanvasSection({ state, mutate }: { state: CircuitState; mutate: CircuitMutate }) {
  return (
    <div className="space-y-2.5">
      <Field label="Name — used for file names">
        <input
          className={inputCls}
          defaultValue={state.name}
          onChange={(e) => mutate((s) => void (s.name = e.target.value))}
        />
      </Field>
      <Field label="Symbol style">
        <select
          className={inputCls}
          value={state.style}
          onChange={(e) => mutate((s) => void (s.style = e.target.value as CircuitState["style"]))}
        >
          <option value="iec">IEC / European (box resistor)</option>
          <option value="ansi">US / ANSI (zigzag resistor)</option>
        </select>
      </Field>
      <div className="flex gap-2">
        <NumberField
          label="Sheet width"
          value={state.sheet.w}
          min={8}
          step="1"
          onValue={(v) => {
            if (v >= 8) mutate((s) => void (s.sheet.w = Math.round(v)));
          }}
        />
        <NumberField
          label="Sheet height"
          value={state.sheet.h}
          min={8}
          step="1"
          onValue={(v) => {
            if (v >= 8) mutate((s) => void (s.sheet.h = Math.round(v)));
          }}
        />
      </div>
      <div className="flex gap-2">
        <NumberField
          label="Cell size (px)"
          value={state.grid}
          min={8}
          step="1"
          onValue={(v) => {
            if (v >= 8) mutate((s) => void (s.grid = v));
          }}
        />
        <NumberField
          label="Wire width"
          value={state.lineWidth}
          min={0.5}
          step="0.2"
          onValue={(v) => {
            if (v > 0) mutate((s) => void (s.lineWidth = v));
          }}
        />
      </div>
      <NumberField
        label="Label size (px)"
        value={state.fontSize}
        min={6}
        step="1"
        onValue={(v) => {
          if (v > 0) mutate((s) => void (s.fontSize = v));
        }}
      />
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Check
          label="Squared paper"
          checked={state.showGrid}
          onChange={(v) => mutate((s) => void (s.showGrid = v))}
        />
        <Check
          label="Snap to grid"
          checked={state.snap}
          onChange={(v) => mutate((s) => void (s.snap = v))}
        />
        <Check
          label="Hop where wires cross"
          checked={state.hops}
          onChange={(v) => mutate((s) => void (s.hops = v))}
        />
      </div>
    </div>
  );
}

export interface CircuitPanelProps extends ExportSectionProps {
  state: CircuitState;
  mutate: CircuitMutate;
  sel: Selection;
  ops: SelectionOps;
  onAdd: (kind: ComponentKind) => void;
  onAddNote: () => void;
  onAddField: (mode: "in" | "out") => void;
  compact?: boolean;
}

export function CircuitPanel(props: CircuitPanelProps) {
  const { state, mutate, sel, ops, onAdd, onAddNote, onAddField, compact } = props;
  const exportProps: ExportSectionProps = props;

  if (compact) {
    return (
      <Tabs defaultValue="parts" className="flex h-full min-h-0 flex-col">
        <TabsList className="mx-3 mt-2 grid h-9 shrink-0 grid-cols-5 gap-1 rounded-lg bg-muted/60 p-1">
          <TabsTrigger value="parts" className="rounded-md text-xs font-semibold">
            Parts
          </TabsTrigger>
          <TabsTrigger value="selected" className="rounded-md text-xs font-semibold">
            Selected
          </TabsTrigger>
          <TabsTrigger value="notes" className="rounded-md text-xs font-semibold">
            Notes
          </TabsTrigger>
          <TabsTrigger value="canvas" className="rounded-md text-xs font-semibold">
            Canvas
          </TabsTrigger>
          <TabsTrigger value="export" className="rounded-md text-xs font-semibold">
            Export
          </TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <TabsContent value="parts" className="mt-0">
            <Palette style={state.style} onAdd={onAdd} />
          </TabsContent>
          <TabsContent value="selected" className="mt-0">
            <SelectedSection state={state} mutate={mutate} sel={sel} ops={ops} />
          </TabsContent>
          <TabsContent value="notes" className="mt-0">
            <AnnotateSection
              state={state}
              mutate={mutate}
              onAddNote={onAddNote}
              onAddField={onAddField}
            />
          </TabsContent>
          <TabsContent value="canvas" className="mt-0">
            <CanvasSection state={state} mutate={mutate} />
          </TabsContent>
          <TabsContent value="export" className="mt-0">
            <ExportSection {...exportProps} />
          </TabsContent>
        </div>
      </Tabs>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Parts" />
          <Palette style={state.style} onAdd={onAdd} />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Selected" />
          <SelectedSection state={state} mutate={mutate} sel={sel} ops={ops} />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Notes & fields" />
          <AnnotateSection
            state={state}
            mutate={mutate}
            onAddNote={onAddNote}
            onAddField={onAddField}
          />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Canvas" />
          <CanvasSection state={state} mutate={mutate} />
        </section>
        <section className="border-b border-border px-4 py-4">
          <SectionHeader title="Export" />
          <ExportSection {...exportProps} />
        </section>
      </div>
    </div>
  );
}
