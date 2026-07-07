import { useCallback, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ImageDown } from "lucide-react";
import { defaultState, layout, render, type GraphState } from "@/lib/graph";
import { GraphPanel } from "@/components/graph/panel";
import { GraphStage, type Mutate } from "@/components/graph/stage";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [state, setState] = useState<GraphState>(() => defaultState());
  const [uiKey, setUiKey] = useState(0); // remounts the panel so uncontrolled inputs refresh on load/reset
  const [exportScale, setExportScale] = useState(2);
  const [transparent, setTransparent] = useState(false);

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
    const lay = layout(ctx, state, state.scale); // natural size — export ignores on-screen zoom
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

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4v16h16" />
              <path d="M7 15l4-6 4 3 5-8" />
            </svg>
          </div>
          <div>
            <h1 className="font-display text-sm font-bold leading-tight">Graph Maker</h1>
            <p className="text-[11px] leading-tight text-muted-foreground">Textbook-style graphs, exported as PNG</p>
          </div>
        </div>
        <button
          onClick={exportPng}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <ImageDown className="h-4 w-4" />
          Export PNG
        </button>
      </header>

      {/* body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 shrink-0 overflow-y-auto border-t border-border bg-card lg:order-1 lg:w-80 lg:border-r lg:border-t-0">
          <GraphPanel
            key={uiKey}
            state={state}
            mutate={mutate}
            exportScale={exportScale}
            setExportScale={setExportScale}
            transparent={transparent}
            setTransparent={setTransparent}
            onSave={savePreset}
            onLoad={loadPreset}
            onReset={reset}
          />
        </aside>
        <main className="order-1 min-h-72 flex-1 lg:order-2">
          <GraphStage state={state} mutate={mutate} />
        </main>
      </div>
    </div>
  );
}
