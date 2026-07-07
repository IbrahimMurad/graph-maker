import { useCallback, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ImageDown, SlidersHorizontal } from "lucide-react";
import { defaultState, layout, render, type GraphState } from "@/lib/graph";
import { GraphPanel } from "@/components/graph/panel";
import { GraphStage, type Mutate } from "@/components/graph/stage";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [state, setState] = useState<GraphState>(() => defaultState());
  const [uiKey, setUiKey] = useState(0);
  const [exportScale, setExportScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  const mutate: Mutate = useCallback((fn) => {
    setState((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const fileName = () => {
    const n = (state.axes.y.label + "-vs-" + state.axes.x.label).replace(/[^\w-]+/g, "").toLowerCase();
    return n || "graph";
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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

  const savePreset = () =>
    downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), fileName() + ".json");

  const loadPreset = (file: File) => {
    file
      .text()
      .then((t) => {
        const o = JSON.parse(t);
        const d = defaultState();
        const next: GraphState = {
          ...d,
          ...o,
          axes: {
            x: { ...d.axes.x, ...((o.axes || {}).x || {}) },
            y: { ...d.axes.y, ...((o.axes || {}).y || {}) },
          },
        };
        if (!(next.scale > 0)) next.scale = d.scale;
        if (!(next.axisWidth > 0)) next.axisWidth = d.axisWidth;
        next.type = next.type === "relation" ? "relation" : "grid";
        if (!Array.isArray(next.series) || !next.series.length) next.series = d.series;
        next.active = Math.min(next.active | 0, next.series.length - 1);
        setState(next);
        setUiKey((k) => k + 1);
      })
      .catch(() => alert("That doesn't look like a saved graph preset."));
  };

  const reset = () => {
    setState(defaultState());
    setUiKey((k) => k + 1);
  };

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
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
          <GraphStage state={state} mutate={mutate} />

          {/* mobile FAB → bottom sheet with tabbed panel */}
          {isMobile && (
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
                className="flex h-[70dvh] flex-col rounded-t-2xl border-t bg-card p-0"
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
