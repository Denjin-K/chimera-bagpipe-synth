import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
    // two pages: the voice synth (index.html) and the pipe band (pipes.html)
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), pipes: resolve(import.meta.dirname, "pipes.html") } },
  },
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true, allowedHosts: true },
});
