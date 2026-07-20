import { Upload, Download, RotateCcw, FileCode, ClipboardCopy, Layers } from "lucide-react";
import { btnCls, Check, Field, inputCls } from "./fields";

export interface ExportSectionProps {
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
}

export function ExportSection({
  exportScale,
  setExportScale,
  transparent,
  setTransparent,
  onSave,
  onLoad,
  onReset,
  onExportSvg,
  onCopyPng,
  onBatch,
}: ExportSectionProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-end gap-3">
        <Field label="Scale">
          <select
            className={inputCls}
            value={exportScale}
            onChange={(e) => setExportScale(parseInt(e.target.value, 10))}
          >
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
      <div className="grid grid-cols-2 gap-1.5">
        <button className={btnCls} onClick={onExportSvg} title="Export as SVG (vector, scalable)">
          <FileCode className="h-3.5 w-3.5" />
          SVG
        </button>
        <button className={btnCls} onClick={onCopyPng} title="Copy PNG to the clipboard">
          <ClipboardCopy className="h-3.5 w-3.5" />
          Copy PNG
        </button>
      </div>
      <label
        className={`${btnCls} w-full`}
        title="Upload one JSON holding many presets and download them all as a ZIP of PNGs"
      >
        <Layers className="h-3.5 w-3.5" />
        Batch export (ZIP)
        <input
          type="file"
          hidden
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onBatch(f);
            e.target.value = "";
          }}
        />
      </label>
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
