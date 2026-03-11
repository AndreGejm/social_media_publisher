import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const APP_VERSION = process.env.npm_package_version ?? "0.0.0";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

export default defineConfig({
  plugins: [react()],
  define: {
    __SKALD_APP_VERSION__: JSON.stringify(APP_VERSION),
    __SKALD_BUILD_DATE__: JSON.stringify(BUILD_DATE)
  },
  server: {
    port: 1420,
    strictPort: true
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});