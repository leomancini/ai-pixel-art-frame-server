import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Inline the (tiny) built CSS into the HTML and drop the external stylesheet
// link. A render-blocking <link rel="stylesheet"> delays first paint until it's
// fetched; on a cold standalone launch that gap is when the iOS splash fade can
// reveal the grey web-view backdrop. Inlining makes the first paint (black)
// immediate, with no network round-trip.
function inlineCss() {
  return {
    name: "inline-css",
    enforce: "post",
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;
      let out = html;
      for (const [file, chunk] of Object.entries(ctx.bundle)) {
        if (file.endsWith(".css") && chunk.type === "asset") {
          const css = String(chunk.source);
          const link = new RegExp(
            `<link[^>]*href="[^"]*${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`
          );
          out = out.replace(link, `<style>${css}</style>`);
          delete ctx.bundle[file];
        }
      }
      return out;
    },
  };
}

// In dev (`npm run dev`, port 5173) proxy the API + device endpoints to the
// Express server on 3136 so same-origin cookies and the GIS button work.
export default defineConfig({
  plugins: [react(), inlineCss()],
  server: {
    proxy: {
      "/api": "http://localhost:3136",
      "/animation": "http://localhost:3136",
      "/poll": "http://localhost:3136",
    },
  },
});
