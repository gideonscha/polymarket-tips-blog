import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import markdoc from '@astrojs/markdoc';
import vercel from '@astrojs/vercel';
import keystatic from '@keystatic/astro';

export default defineConfig({
  site: 'https://blog.polymarket.tips',
  adapter: vercel(),
  integrations: [
    react(),
    markdoc(),
    sitemap(),
    keystatic(),
  ],
});
