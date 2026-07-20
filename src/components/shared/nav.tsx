import { Link } from "@tanstack/react-router";

const linkCls =
  "rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground [&.active]:bg-primary [&.active]:text-primary-foreground";

/* Segmented switcher between the two editors, shown in both page headers. */
export function PageNav() {
  return (
    <nav
      aria-label="Editor"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-background p-0.5 text-xs font-semibold"
    >
      <Link to="/" className={linkCls}>
        Graphs
      </Link>
      <Link to="/circuit" className={linkCls}>
        Circuits
      </Link>
    </nav>
  );
}
