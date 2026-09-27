import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run dev` talks to the FastAPI backend through the /api proxy.
// `npm run build:demo` bundles the TypeScript engine into one self-contained page for sharing.
export default defineConfig(({ mode }) => ({
  plugins: mode === "demo" ? [react(), viteSingleFile()] : [react()],
  define: { __DEMO__: JSON.stringify(mode === "demo") },
  build: { outDir: mode === "demo" ? "dist-demo" : "dist" },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
}));
