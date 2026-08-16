import { copyFileSync } from "node:fs";
import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/graph-maker/",
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackRouter({ target: "react" }),
    react(),
    tailwindcss(),
    {
      // GitHub Pages serves 404.html for unknown paths; a copy of the SPA shell
      // lets deep links like /graph-maker/circuit boot the app and route client-side.
      name: "spa-404-fallback",
      closeBundle() {
        try {
          copyFileSync("dist/index.html", "dist/404.html");
        } catch {
          /* dev server has no dist */
        }
      },
    },
  ],
});
