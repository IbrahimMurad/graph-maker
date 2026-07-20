import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ImageDown, SlidersHorizontal } from "lucide-react";
import { defaultState, layout, render, renderSVG, type GraphState } from "@/lib/graph";
import { zipStore } from "@/lib/zip";
import { downloadBlob } from "@/lib/download";
import { useDocHistory } from "@/hooks/use-history";
import { GraphPanel } from "@/components/graph/panel";
import { GraphStage } from "@/components/graph/stage";
import { PageNav } from "@/components/shared/nav";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-mobile";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { state, mutate, undo, redo, canUndo, canRedo, replace, uiKey } =
    useDocHistory<GraphState>(defaultState);
  const [exportScale, setExportScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Panel is inline as a sidebar at lg (1024px); below that it lives in a sheet
  // opened by the FAB — this must match the sidebar's `lg:block` so tablets aren't stranded.
  const isCompact = useMediaQuery("(max-width: 1023.98px)");

  useEffect(() => {
    if (!isCompact) setSheetOpen(false); // don't leave the sheet open after growing to desktop
  }, [isCompact]);

  const fileNameFor = (st: GraphState) =>
    (st.axes.y.label + "-vs-" + st.axes.x.label).replace(/[^\w-]+/g, "").toLowerCase() || "graph";
  const fileName = () => fileNameFor(state);

  /* Merge a parsed object onto the defaults into a valid GraphState (shared by load + batch). */
  const hydrate = (raw: unknown): GraphState => {
    const o = (raw || {}) as Partial<GraphState> & {
      axes?: { x?: Partial<GraphState["axes"]["x"]>; y?: Partial<GraphState["axes"]["y"]> };
    };
    const d = defaultState();
    const next: GraphState = {
      ...d,
      ...o,
      axes: {
        x: { ...d.axes.x, ...(o.axes?.x || {}) },
        y: { ...d.axes.y, ...(o.axes?.y || {}) },
      },
    };
    if (!(next.scale > 0)) next.scale = d.scale;
    if (!(next.axisWidth > 0)) next.axisWidth = d.axisWidth;
    next.type = next.type === "relation" ? "relation" : "grid";
    if (!Array.isArray(next.series) || !next.series.length) next.series = d.series;
    if (!Array.isArray(next.annotations)) next.annotations = [];
    next.active = Math.min(next.active | 0, next.series.length - 1);
    return next;
  };

  const exportPng = () => {
    const off = document.createElement("canvas");
    const ctx = off.getContext("2d")!;
    const lay = layout(ctx, state, state.scale);
    off.width = Math.round(lay.W * exportScale);
    off.height = Math.round(lay.H * exportScale);
    ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    render(ctx, state, state.scale, {
      showHandles: false,
      background: transparent ? null : "#fff",
    });
    off.toBlob((b) => b && downloadBlob(b, fileName() + ".png"));
  };

  const exportSvg = () => {
    const svg = renderSVG(state, state.scale, { background: transparent ? null : "#fff" });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), fileName() + ".svg");
  };

  const copyPng = () => {
    const off = document.createElement("canvas");
    const ctx = off.getContext("2d")!;
    const lay = layout(ctx, state, state.scale);
    off.width = Math.round(lay.W * exportScale);
    off.height = Math.round(lay.H * exportScale);
    ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    render(ctx, state, state.scale, {
      showHandles: false,
      background: transparent ? null : "#fff",
    });
    off.toBlob(async (blob) => {
      if (!blob) return;
      try {
        if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
          throw new Error("unsupported");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } catch {
        alert("Couldn't copy the image — your browser may not support it. Use Export PNG instead.");
      }
    });
  };

  const savePreset = () =>
    downloadBlob(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
      fileName() + ".json",
    );

  const loadPreset = (file: File) => {
    file
      .text()
      .then((t) => replace(hydrate(JSON.parse(t))))
      .catch(() => alert("That doesn't look like a saved graph preset."));
  };

  /* ---------- batch export: one JSON of many graphs -> a ZIP of PNGs ---------- */
  const renderPngBlob = (st: GraphState): Promise<Blob | null> => {
    const off = document.createElement("canvas");
    const ctx = off.getContext("2d")!;
    const lay = layout(ctx, st, st.scale);
    off.width = Math.round(lay.W * exportScale);
    off.height = Math.round(lay.H * exportScale);
    ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    render(ctx, st, st.scale, { showHandles: false, background: transparent ? null : "#fff" });
    return new Promise((res) => off.toBlob(res));
  };

  const batchExport = (file: File) => {
    file
      .text()
      .then(async (t) => {
        const raw: unknown = JSON.parse(t);
        const asRec = (v: unknown) =>
          v && typeof v === "object" ? (v as Record<string, unknown>) : {};
        // Accept an array of presets, { graphs: [...] }, or a single preset.
        const list: unknown[] = Array.isArray(raw)
          ? raw
          : Array.isArray(asRec(raw).graphs)
            ? (asRec(raw).graphs as unknown[])
            : [raw];
        const graphs = list
          .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
          .map((it) => ({
            state: hydrate(it),
            name: typeof it.name === "string" ? it.name : undefined,
          }));
        if (!graphs.length) {
          alert('No graphs found. Expected an array of presets, or { "graphs": [ ... ] }.');
          return;
        }
        const sanitize = (s: string) =>
          s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "graph";
        const used = new Set<string>();
        const entries: { name: string; data: Uint8Array }[] = [];
        for (let i = 0; i < graphs.length; i++) {
          const blob = await renderPngBlob(graphs[i].state);
          if (!blob) continue;
          const base = sanitize(graphs[i].name || fileNameFor(graphs[i].state) || `graph-${i + 1}`);
          let name = `${base}.png`;
          for (let n = 2; used.has(name); n++) name = `${base}-${n}.png`;
          used.add(name);
          entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
        }
        if (!entries.length) {
          alert("Couldn't render any graphs from that file.");
          return;
        }
        downloadBlob(zipStore(entries), "graphs.zip");
      })
      .catch(() => alert("That file isn't valid JSON."));
  };

  const reset = () => replace(defaultState());

  const panelProps = {
    state,
    mutate,
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
            <svg
              viewBox="0 0 24 24"
              className="h-4.5 w-4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 4v16h16" />
              <path d="M7 15l4-6 4 3 5-8" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-sm font-bold leading-tight">Graph Maker</h1>
            <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
              Textbook-style graphs, exported as PNG
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
        {/* desktop sidebar */}
        <aside className="hidden shrink-0 overflow-y-auto border-r border-border bg-card lg:block lg:w-80">
          <GraphPanel key={uiKey} {...panelProps} />
        </aside>

        {/* stage */}
        <main className="relative min-h-0 flex-1">
          <GraphStage
            state={state}
            mutate={mutate}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />

          {/* compact (mobile + tablet) FAB → bottom sheet with tabbed panel */}
          {isCompact && (
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button
                  className="absolute bottom-20 right-4 z-20 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform active:scale-95 lg:hidden"
                  aria-label="Open settings"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Settings
                </button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="flex h-max flex-col rounded-t-2xl border-t bg-card p-0"
              >
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <GraphPanel key={uiKey} {...panelProps} compact />
                </div>
              </SheetContent>
            </Sheet>
          )}
        </main>
      </div>
    </div>
  );
}
