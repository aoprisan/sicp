import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// base is set from the repo name in CI: `VITE_BASE=/sicp-pwa/ npm run build`
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  worker: { format: "es" },
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: ["book/**/*"],
      manifest: {
        name: "SICP",
        short_name: "SICP",
        description: "Structure and Interpretation of Computer Programs, with a Scheme REPL",
        display: "standalone",
        background_color: "#fbf8f1",
        theme_color: "#3a2f2a",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,svg,json}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
});
