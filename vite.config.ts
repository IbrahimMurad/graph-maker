import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/graph-maker/",
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tanstackRouter({ target: "react" }), react(), tailwindcss()],
});
