#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, "../src/frontend");
const BASE_URL = "https://oikonomia.ar";

const routes = JSON.parse(
  readFileSync(resolve(FRONTEND_DIR, "src/data/publicRoutes.json"), "utf-8")
);

const buildDate = new Date().toISOString().split("T")[0];

const urls = routes
  .map((r) => {
    const loc = r.path === "/" ? BASE_URL : `${BASE_URL}${r.path}`;
    return `  <url>
    <loc>${loc}</loc>
    <lastmod>${buildDate}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`;
  })
  .join("\n");

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

const distDir = resolve(FRONTEND_DIR, "dist");
try {
  mkdirSync(distDir, { recursive: true });
} catch {}
writeFileSync(resolve(distDir, "sitemap.xml"), sitemap, "utf-8");
console.log(`✓ sitemap.xml generated (${routes.length} URLs)`);
