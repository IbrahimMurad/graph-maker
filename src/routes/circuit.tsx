import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ImageDown, SlidersHorizontal, Zap } from "lucide-react";
import {
  contentBounds,
  defaultCircuit,
  hydrateCircuit,
  layoutCircuit,
  r3,
  renderCircuit,
  renderCircuitSVG,
  settle,
  unbindFrom,
  type CircuitState,
  type ComponentKind,
  type Rot,
  type Selection,
} from "@/lib/circuit";
import { SYMBOLS } from "@/lib/circuit-symbols";
import { zipStore } from "@/lib/zip";
import { downloadBlob } from "@/lib/download";
import { useDocHistory } from "@/hooks/use-history";
import { CircuitPanel } from "@/components/circuit/panel";
import { CircuitStage, type SelectionOps } from "@/components/circuit/stage";
import { PageNav } from "@/components/shared/nav";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-mobile";

export const Route = createFileRoute("/circuit")({
  component: CircuitPage,
});

function CircuitPage() {
  const { state, mutate, undo, redo, canUndo, canRedo, replace, uiKey } =
    useDocHistory<CircuitState>(defaultCircuit, settle);
  const [sel, setSel] = useState<Selection>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const viewCenterRef = useRef<[number, number]>([24, 16]);
  const [exportScale, setExportScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const isCompact = useMediaQuery("(max-width: 1023.98px)");

  useEffect(() => {
    if (!isCompact) setSheetOpen(false);
  }, [isCompact]);

  useEffect(() => {
    const prev = document.title;
    document.title = "Circuit Maker — Draw & Export Circuit Diagrams";
    return () => void (document.title = prev);
  }, []);

  /* ---------- selection operations (stage keyboard/toolbar + panel buttons) ---------- */

  const rotateSel = useCallback(
    (dir: 1 | -1) => {
      const s = selRef.current;
      if (!s || s.kind !== "comp") return;
      mutate((st) => {
        const c = st.components.find((x) => x.id === s.id);
        if (c) c.rot = ((((c.rot + dir * 90) % 360) + 360) % 360) as Rot;
      });
    },
    [mutate],
  );

  const deleteSel = useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    mutate((st) => {
      unbindFrom(st, s.id);
      if (s.kind === "comp") st.components = st.components.filter((c) => c.id !== s.id);
      else st.wires = st.wires.filter((w) => w.id !== s.id);
    });
    setSel(null);
  }, [mutate]);

  const duplicateSel = useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    let next: Selection = null;
    mutate((st) => {
      if (s.kind === "comp") {
        const c = st.components.find((x) => x.id === s.id);
        if (!c) return;
        const copy = structuredClone(c);
        copy.id = `c${st.seq++}`;
        copy.x = r3(Math.min(st.sheet.w, copy.x + 1));
        copy.y = r3(Math.min(st.sheet.h, copy.y + 1));
        st.components.push(copy);
        next = { kind: "comp", id: copy.id };
      } else {
        const w = st.wires.find((x) => x.id === s.id);
        if (!w) return;
        const copy = structuredClone(w);
        copy.id = `w${st.seq++}`;
        copy.a = { t: "free" };
        copy.b = { t: "free" };
        copy.pts = copy.pts.map((p) => [r3(p[0] + 1), r3(p[1] + 1)] as [number, number]);
        st.wires.push(copy);
        next = { kind: "wire", id: copy.id };
      }
    });
    if (next) setSel(next);
  }, [mutate]);

  const ops: SelectionOps = { rotateSel, deleteSel, duplicateSel };

  /* ---------- palette insert ---------- */

  const addComponent = useCallback(
    (kind: ComponentKind) => {
      const spec = SYMBOLS[kind];
      let id = "";
      mutate((s) => {
        id = `c${s.seq++}`;
        let label: string | undefined;
        if (spec.defaultLabel) {
          const n =
            s.components.filter((c) => SYMBOLS[c.kind].defaultLabel === spec.defaultLabel).length +
            1;
          label = `${spec.defaultLabel}_${n}`;
        }
        const [cx, cy] = viewCenterRef.current;
        s.components.push({
          id,
          kind,
          x: Math.round(cx),
          y: Math.round(cy),
          rot: 0,
          label,
          ...(kind === "battery" ? { cells: 2 } : {}),
          ...(kind === "transformer" ? { core: true } : {}),
        });
      });
      setSel({ kind: "comp", id });
    },
    [mutate],
  );

  /* ---------- export / persistence (crop to drawn content + 1-cell margin) ---------- */

  const fileName = () =>
    state.name
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "circuit";

  const renderPngBlob = (st: CircuitState): Promise<Blob | null> => {
    const off = document.createElement("canvas");
    const ctx = off.getContext("2d")!;
    const bounds = contentBounds(ctx, st);
    const lay = layoutCircuit(st, st.grid, bounds);
    off.width = Math.round(lay.W * exportScale);
    off.height = Math.round(lay.H * exportScale);
    ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    renderCircuit(ctx, st, st.grid, {
      background: transparent ? null : "#fff",
      viewBox: bounds,
    });
    return new Promise((res) => off.toBlob(res));
  };

  const exportPng = async () => {
    const blob = await renderPngBlob(state);
    if (blob) downloadBlob(blob, fileName() + ".png");
  };

  const copyPng = async () => {
    const blob = await renderPngBlob(state);
    if (!blob) return;
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
        throw new Error("unsupported");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      alert("Couldn't copy the image — your browser may not support it. Use Export PNG instead.");
    }
  };

  const exportSvg = () => {
    const off = document.createElement("canvas");
    const ctx = off.getContext("2d")!;
    const bounds = contentBounds(ctx, state);
    const svg = renderCircuitSVG(state, state.grid, {
      background: transparent ? null : "#fff",
      viewBox: bounds,
    });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), fileName() + ".svg");
  };

  const savePreset = () =>
    downloadBlob(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
      fileName() + ".json",
    );

  const loadPreset = (file: File) => {
    file
      .text()
      .then((t) => {
        replace(hydrateCircuit(JSON.parse(t)));
        setSel(null);
      })
      .catch(() => alert("That doesn't look like a saved circuit."));
  };

  /* ---------- batch export: one JSON of many circuits -> a ZIP of PNGs ---------- */
  const batchExport = (file: File) => {
    file
      .text()
      .then(async (t) => {
        const raw: unknown = JSON.parse(t);
        const asRec = (v: unknown) =>
          v && typeof v === "object" ? (v as Record<string, unknown>) : {};
        // Accept an array of circuits, { circuits: [...] }, or a single circuit.
        const list: unknown[] = Array.isArray(raw)
          ? raw
          : Array.isArray(asRec(raw).circuits)
            ? (asRec(raw).circuits as unknown[])
            : [raw];
        const circuits = list
          .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
          .map((it) => hydrateCircuit(it));
        if (!circuits.length) {
          alert('No circuits found. Expected an array of circuits, or { "circuits": [ ... ] }.');
          return;
        }
        const sanitize = (s: string) =>
          s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "circuit";
        const used = new Set<string>();
        const entries: { name: string; data: Uint8Array }[] = [];
        for (let i = 0; i < circuits.length; i++) {
          const blob = await renderPngBlob(circuits[i]);
          if (!blob) continue;
          const base = sanitize(circuits[i].name || `circuit-${i + 1}`);
          let name = `${base}.png`;
          for (let n = 2; used.has(name); n++) name = `${base}-${n}.png`;
          used.add(name);
          entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
        }
        if (!entries.length) {
          alert("Couldn't render any circuits from that file.");
          return;
        }
        downloadBlob(zipStore(entries), "circuits.zip");
      })
      .catch(() => alert("That file isn't valid JSON."));
  };

  const reset = () => {
    replace(defaultCircuit());
    setSel(null);
  };

  const panelProps = {
    state,
    mutate,
    sel,
    ops,
    onAdd: addComponent,
    exportScale,
    setExportScale,
    transparent,
    setTransparent,
    onSave: savePreset,
    onLoad: loadPreset,
    onReset: reset,
    onExportSvg: exportSvg,
    onCopyPng: copyPng,
    onBatch: batchExport,
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* header */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-sm font-bold leading-tight">Circuit Maker</h1>
            <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
              Textbook-style circuit diagrams, exported as PNG
            </p>
          </div>
        </div>
        <PageNav />
        <button
          onClick={exportPng}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:px-4"
        >
          <ImageDown className="h-4 w-4" />
          <span className="hidden sm:inline">Export PNG</span>
          <span className="sm:hidden">PNG</span>
        </button>
      </header>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden shrink-0 overflow-y-auto border-r border-border bg-card lg:block lg:w-80">
          <CircuitPanel key={uiKey} {...panelProps} />
        </aside>

        <main className="relative min-h-0 flex-1">
          <CircuitStage
            state={state}
            mutate={mutate}
            sel={sel}
            setSel={setSel}
            ops={ops}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            viewCenterRef={viewCenterRef}
          />

          {isCompact && (
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button
                  className="absolute bottom-20 right-4 z-20 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform active:scale-95 lg:hidden"
                  aria-label="Open settings"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Parts &amp; settings
                </button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="flex h-max flex-col rounded-t-2xl border-t bg-card p-0"
              >
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <CircuitPanel key={uiKey} {...panelProps} compact />
                </div>
              </SheetContent>
            </Sheet>
          )}
        </main>
      </div>
    </div>
  );
}
