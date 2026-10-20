import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Bundle the shared package from its TypeScript source so Vite/Rollup can
// resolve its named exports directly (the CommonJS dist build trips up
// Rollup's static `export *` analysis). Types still resolve from dist.
const sharedSrc = fileURLToPath(
  new URL("../shared/src/index.ts", import.meta.url)
);

interface BundleChunk {
  type: "chunk";
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: string[];
}
interface BundleAsset {
  type: "asset";
  fileName: string;
}

/**
 * Emits dist/sw.js from sw.template.js with a precache list built from the
 * real chunk graph, so the first-aid page (/help) works offline: the entry
 * chunk, the lazy FirstAidPage chunk and everything they import, all CSS,
 * the Latin font files, and the app shell/manifest/icons. Everything else
 * is cached at runtime as it's used.
 */
function offlinePrecache(): Plugin {
  const OFFLINE_PAGES = [/[\\/]pages[\\/]FirstAidPage\.tsx$/];
  return {
    name: "safesips-offline-precache",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.values(bundle) as Array<BundleChunk | BundleAsset>;
      const chunks = new Map(
        files
          .filter((f): f is BundleChunk => f.type === "chunk")
          .map((c) => [c.fileName, c])
      );
      const wanted = new Set<string>();
      const visit = (chunk: BundleChunk | undefined) => {
        if (!chunk || wanted.has(chunk.fileName)) return;
        wanted.add(chunk.fileName);
        for (const dep of chunk.imports) visit(chunks.get(dep));
      };
      for (const chunk of chunks.values()) {
        const id = chunk.facadeModuleId ?? "";
        if (chunk.isEntry || OFFLINE_PAGES.some((re) => re.test(id))) visit(chunk);
      }
      for (const file of files) {
        if (
          file.fileName.endsWith(".css") ||
          /nunito-latin(-ext)?-wght-normal-.*\.woff2$/.test(file.fileName)
        ) {
          wanted.add(file.fileName);
        }
      }

      const urls = [
        "/",
        "/manifest.webmanifest",
        "/icon.svg",
        "/icon-192.png",
        ...[...wanted].sort().map((f) => `/${f}`),
      ];
      const buildId = createHash("sha256")
        .update(urls.join("\n"))
        .digest("hex")
        .slice(0, 12);
      const template = readFileSync(
        fileURLToPath(new URL("./sw.template.js", import.meta.url)),
        "utf8"
      );
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace("__BUILD_ID__", buildId)
          .replace("__PRECACHE_URLS__", JSON.stringify(urls, null, 2)),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlinePrecache()],
  resolve: {
    alias: {
      "@safesips/shared": sharedSrc,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
  },
});
