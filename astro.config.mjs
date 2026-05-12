import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import markdoc from '@astrojs/markdoc';
import vercel from '@astrojs/vercel';
import keystatic from '@keystatic/astro';

export default defineConfig({
  site: 'https://blog.polymarket.tips',
  // Canonicalise every URL to the trailing-slash form. Combined with the
  // vercel.json "trailingSlash": true setting, this guarantees:
  //   - Internal links resolve with a trailing slash
  //   - Astro.url.href (used as default canonical) ends with /
  //   - The sitemap emits /foo/ URLs
  //   - Vercel 308-redirects /foo to /foo/ at the edge
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  adapter: vercel(),
  integrations: [
    react(),
    markdoc(),
    // Sitemap inherits the Astro `trailingSlash: 'always'` setting above,
    // so emitted URLs end with /.
    sitemap(),
    keystatic(),
  ],
});
