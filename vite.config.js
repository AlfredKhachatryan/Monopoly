import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // expose on the LAN so phones can open the Client page
  },
  build: {
    outDir: "dist",
  },
});
