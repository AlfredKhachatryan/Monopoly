import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, normalizePath } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev-only, offline preview harness for the phone Client (see TESTING.md,
// "Offline client preview", and client-harness.html / src/dev/*). Redirects
// src/Hooks/supabase.jsx to src/dev/mockSupabase.js so the Client screen can
// be driven through every game state without a Supabase backend.
//
// It matches by the *resolved absolute file id*, not by the text of the
// import specifier (a plain resolve.alias entry would have to match
// "./supabase" verbatim, which only works from inside src/Hooks itself --
// every other importer spells it differently, e.g. "../Hooks/supabase").
// Resolving first and then comparing ids works no matter how a file spells
// the import, so it keeps working even if src/Client's internals move
// around (only the target file's own path has to stay put).
function mockSupabasePlugin() {
  const targetId = normalizePath(path.resolve(__dirname, "src/Hooks/supabase.jsx"));
  const mockId = normalizePath(path.resolve(__dirname, "src/dev/mockSupabase.js"));
  return {
    name: "monopoly-mock-supabase",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || source === mockId) return null;
      let resolved;
      try {
        resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      } catch {
        return null;
      }
      if (resolved && !resolved.external && normalizePath(resolved.id) === targetId) {
        return mockId;
      }
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Only for `vite` (serve) with the flag set -- never `vite build`, and
  // never plain `npm run dev`, so the real supabase.jsx (and a real .env)
  // is still required for normal development and for production.
  const useMockBackend = command === "serve" && env.VITE_MOCK === "1";

  return {
    plugins: [react(), ...(useMockBackend ? [mockSupabasePlugin()] : [])],
    server: {
      port: 3000,
      host: true, // expose on the LAN so phones can open the Client page
    },
    build: {
      outDir: "dist",
    },
  };
});
