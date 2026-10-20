import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/dashboard/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5174, proxy: { "/admin": "http://localhost:8787", "/api": "http://localhost:8787" } },
});
