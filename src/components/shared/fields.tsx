import { useEffect, useRef, useState } from "react";

/* Panel building blocks shared by the graph and circuit control panels. */

export const inputCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";
export const btnCls =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted";
export const stepBtnCls =
  "grid h-7 w-7 shrink-0 place-items-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary active:scale-95";

export function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mb-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {title}
    </h2>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Check({
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

export function NumberField({
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
  // Controlled, but with a local buffer so free typing (e.g. "-", "1.") isn't clobbered,
  // while programmatic changes (steppers, reset, load) still flow back into the field.
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <Field label={label}>
      <input
        type="number"
        className={inputCls}
        value={text}
        min={min}
        step={step ?? "any"}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          if (isFinite(v)) onValue(v);
        }}
      />
    </Field>
  );
}
