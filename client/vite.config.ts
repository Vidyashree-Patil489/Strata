import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: "C:/Users/shail/AppData/Local/vite-cache/repo-health-client",
  server: {
    port: 5173,
  },
});
