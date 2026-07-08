import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("monaco-editor/esm/vs/basic-languages")) return "monaco-languages";
          if (id.includes("monaco-editor")) return "monaco-core";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
