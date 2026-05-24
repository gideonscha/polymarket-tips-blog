import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import markdoc from '@astrojs/markdoc';
import vercel from '@astrojs/vercel';
import keystatic from '@keystatic/astro';

export default defineConfig({
  site: 'https://blog.polymarket.tips',
  // Canonicalise every URL to the NON-trailing-slash form. Google was
  // overriding our previously declared trailing-slash canonical (Search
  // Console reported "Duplicate, Google chose different canonical than
  // user"), so we now follow Google's preference.
  //   - Internal links resolve without a trailing slash
  //   - Astro.url.href (used as default canonical) has no trailing /
  //   - The sitemap emits /foo URLs (no slash)
  //   - Vercel 308-redirects /foo/ to /foo at the edge
  trailingSlash: 'never',
  build: {
    format: 'directory',
  },
  adapter: vercel(),
  integrations: [
    react(),
    markdoc(),
    // Sitemap inherits the Astro `trailingSlash: 'never'` setting above,
    // so emitted URLs do NOT end with /.
    sitemap(),
    keystatic(),
  ],
});
