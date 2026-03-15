# Polymarket Tips Blog

SEO-optimised blog for [polymarket.tips](https://polymarket.tips), built with Astro, Keystatic CMS, and Tailwind CSS. Deployed on Vercel at `blog.polymarket.tips`.

## Tech Stack

- **Astro 5** — Static site generation with hybrid rendering
- **Keystatic** — Git-based CMS with visual editing UI
- **Tailwind CSS** — Utility-first styling
- **Vercel** — Hosting and deployment

## Local Development

### Prerequisites

- Node.js 22+
- npm

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The site runs at `http://localhost:4321`.

### Keystatic CMS

With the dev server running, access the Keystatic admin UI at:

```
http://localhost:4321/keystatic
```

From here you can create, edit, and manage blog posts with a visual editor.

## Adding New Posts

### Via Keystatic UI (Recommended)

1. Start the dev server (`npm run dev`)
2. Open `http://localhost:4321/keystatic`
3. Click "Blog Posts" → "Create"
4. Fill in the title, description, category, and published date
5. Write your post content in the editor
6. Save — the post is written to `src/content/posts/[slug]/index.mdoc`
7. Commit and push the changes

### Manually

Create a new directory in `src/content/posts/[your-slug]/` with an `index.mdoc` file:

```yaml
---
title: Your Post Title
description: Meta description for SEO
category: trader-intelligence
publishedDate: '2026-03-15'
ogImage: ''
---

Your markdoc content here...
```

Categories: `trader-intelligence`, `convergence-signals`, `market-strategy`, `polymarket-guides`

## Building for Production

```bash
npm run build
```

Output goes to `./dist/`. Preview locally with:

```bash
npm run preview
```

## Deploying to Vercel

### Initial Setup

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Vercel auto-detects Astro — no special config needed
4. Click **Deploy**

### Connecting blog.polymarket.tips

1. In your Vercel project, go to **Settings → Domains**
2. Add `blog.polymarket.tips`
3. In your DNS provider, add a CNAME record:
   - **Name:** `blog`
   - **Value:** `cname.vercel-dns.com`
4. Wait for DNS propagation (usually < 5 minutes)
5. Vercel auto-provisions an SSL certificate

### Continuous Deployment

Every push to `main` triggers a new build and deployment on Vercel.

## Project Structure

```
blog/
├── keystatic.config.tsx     # Keystatic CMS configuration
├── astro.config.mjs         # Astro configuration
├── tailwind.config.mjs      # Tailwind CSS configuration
├── vercel.json              # Vercel deployment config
├── public/
│   ├── robots.txt           # Search engine directives
│   └── favicon.svg          # Site favicon
├── src/
│   ├── components/          # Reusable Astro components
│   ├── content/posts/       # Blog post content (managed by Keystatic)
│   ├── layouts/             # Page layouts
│   ├── lib/                 # Utilities and helpers
│   ├── pages/               # Route pages
│   └── styles/              # Global CSS
```

## SEO Features

- Automatic XML sitemap at `/sitemap.xml`
- `robots.txt` with sitemap reference
- Open Graph and Twitter Card meta tags on every page
- Canonical URLs
- Article structured data (JSON-LD) on all posts
- Static HTML output for fast loading
- Semantic heading hierarchy

## Commands

| Command           | Action                                    |
| :---------------- | :---------------------------------------- |
| `npm install`     | Install dependencies                      |
| `npm run dev`     | Start dev server at `localhost:4321`       |
| `npm run build`   | Build production site to `./dist/`        |
| `npm run preview` | Preview production build locally          |
