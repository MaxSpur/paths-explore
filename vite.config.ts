import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Relative base keeps asset URLs valid for custom domains and renamed repo paths.
  base: command === "build" ? "./" : "/",

  server: {
    port: 5174,
    strictPort: true
  }
}));
