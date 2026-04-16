#!/usr/bin/env node
/**
 * Daily blog agent for blog.polymarket.tips
 *
 * Runs once per day. Fetches trending Polymarket markets, asks Claude Opus
 * to pick the best topic and write a full post, saves the .mdoc file with
 * the exact Keystatic frontmatter format used by manual posts, generates a
 * branded hero image via Puppeteer, commits and pushes to GitHub.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const IMAGES_DIR = path.join(ROOT, 'public/images/blog');

const ANTHROPIC_MODEL = 'claude-opus-4-5';

// ---------- Keyword priorities (from Google Search Console) ----------
// Real Search Console data — terms close to page 1, ordered by priority
const KEYWORD_PRIORITIES = [
  // TIER 1 — Already ranking 8-15, push these to page 1
  { keyword: 'polymarket whale tracker', position: 11.5, hasPost: true, slug: 'polymarket-whale-tracker' },
  { keyword: 'polymarket tracker', position: 11, hasPost: false },
  { keyword: 'polymarket leaderboard', position: 7.24, hasPost: true, slug: 'polymarket-leaderboard-explained' },
  { keyword: 'polymarket top traders', position: 6.47, hasPost: true, slug: 'top-polymarket-traders-2026' },
  { keyword: 'polymarket archetype tags', position: 7.47, hasPost: true, slug: 'polymarket-archetype-tags-explained' },
  { keyword: 'best polymarket traders', position: 11.88, hasPost: true, slug: 'best-polymarket-traders-to-follow-2026' },
  { keyword: 'what is a convergence signal', position: 15.15, hasPost: true, slug: 'what-is-a-convergence-signal' },

  // TIER 2 — Getting impressions, no post yet — high opportunity
  { keyword: 'polymarket trading guide', position: 80, hasPost: false },
  { keyword: 'convergence trading strategy', position: 81, hasPost: false },
  { keyword: 'polymarket copy trading', position: null, hasPost: false },
  { keyword: 'how to trade on polymarket', position: null, hasPost: false },
  { keyword: 'polymarket beginner guide', position: null, hasPost: false },
  { keyword: 'polymarket fees explained', position: null, hasPost: false },
  { keyword: 'polymarket accuracy', position: null, hasPost: false },
  { keyword: 'polymarket vs sports betting', position: null, hasPost: false },
  { keyword: 'prediction market strategy', position: null, hasPost: false },
];

// ---------- Polymarket research ----------

async function fetchTrendingMarkets() {
  const endpoints = [
    'https://gamma-api.polymarket.com/markets?active=true&limit=20&order=volume24hr&ascending=false',
    'https://gamma-api.polymarket.com/markets?active=true&limit=20&order=liquidity&ascending=false',
  ];

  const all = [];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        console.warn(`Polymarket API ${res.status} for ${url}`);
        continue;
      }
      const data = await res.json();
      const markets = Array.isArray(data) ? data : (data.data || []);
      all.push(...markets);
    } catch (err) {
      console.warn(`Failed to fetch ${url}:`, err.message);
    }
  }

  const seen = new Set();
  const unique = [];
  for (const m of all) {
    const id = m.id || m.slug || m.question;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({
      question: m.question || m.title || '',
      slug: m.slug || '',
      volume24hr: Number(m.volume24hr || 0),
      liquidity: Number(m.liquidity || 0),
      volumeNum: Number(m.volumeNum || m.volume || 0),
      category: m.category || (m.tags && m.tags[0]?.label) || '',
      tags: (m.tags || []).map(t => t.label || t.slug).filter(Boolean).slice(0, 4),
      endDate: m.endDate || m.end_date_iso || '',
      outcomePrices: m.outcomePrices || '',
    });
  }

  return unique
    .sort((a, b) => b.volume24hr - a.volume24hr)
    .slice(0, 15);
}

function getExistingSlugs() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

// ---------- Claude content generation ----------

const SYSTEM_PROMPT = `You are the editorial AI for polymarket.tips, a site that tracks the top 50 Polymarket traders by verified PnL and surfaces "convergence signals" when multiple top traders independently take the same position on a market.

You write a daily blog post for blog.polymarket.tips. Every post must look indistinguishable from the manually written posts — same format, same tone, same structure.

## Content strategy

You are building long-term organic search traffic, not just reacting to daily news. Evergreen keyword-targeted posts that answer specific search queries outperform timely posts by 10:1 over 6 months. When in doubt between a timely topic and a keyword gap, choose the keyword gap. The goal is to rank on page 1 of Google for high-intent Polymarket search terms.

Today you will be given:
1. The current date
2. Today's trending Polymarket markets (with 24h volume and liquidity)
3. The list of existing blog post slugs (so you do not duplicate topics)
4. Keyword priority data from Google Search Console — terms already getting impressions that need supporting content

Your task: pick the SINGLE best topic (heavily weighted toward keyword gaps, see rules below) and write a complete blog post in the exact format below.

## Output format

Return ONLY a single JSON object — no markdown fences, no prose before or after. The JSON must have these fields:

{
  "slug": "url-friendly-kebab-case-slug",
  "title": "Full Post Title (include a relevant hook)",
  "category": "market-strategy" | "trader-intelligence" | "polymarket-guides" | "convergence-signals",
  "metaTitle": "Short SEO title (55-62 chars, no 'Polymarket Tips' suffix — it is added automatically by the layout)",
  "metaDescription": "150-160 char description naturally including the target keyword",
  "datePublished": "YYYY-MM-DD",
  "heroImage": {
    "titleLines": ["Line One", "Line Two"],
    "categoryLabel": "Category Name (Title Case, e.g. 'Market Strategy')",
    "accent": "#hex color — pick from: #f59e0b amber, #3b82f6 blue, #10b981 green, #ef4444 red, #8b5cf6 purple, #f97316 orange",
    "icon": "single emoji relevant to the topic"
  },
  "heroImageAlt": "Descriptive alt text (50-100 chars)",
  "content": "Full markdown content starting with ## (H2) — see content requirements below"
}

## Content requirements (content field)

- 900-1100 words
- Start immediately with the first \`## H2 heading\` — do NOT include an H1, the title frontmatter handles that
- Use ONLY \`##\` H2 subheadings, no H3/H4
- Full prose — NEVER use bullet lists or numbered lists in the body
- Analytically sharp, informed, neutral tone — never partisan, never financial advice
- Never reproduce specific market prices as fixed facts — use approximate language ("around", "approximately", "near")
- Never reproduce direct quotes from news sources — paraphrase everything
- 6 H2 sections, following this arc: (1) timely hook with data, (2) context/analysis, (3) deeper mechanism, (4) how polymarket.tips connects, (5) practical implication, (6) sharp closing
- EXACTLY TWO affiliate links to \`https://polymarket.com/?r=POLYTips\` placed naturally in context. Use anchor text like [Polymarket](https://polymarket.com/?r=POLYTips) or [browse the live markets on Polymarket](https://polymarket.com/?r=POLYTips).
- Internal link #1: somewhere in the body, link the text "convergence signal" or "convergence signals" to /what-is-a-convergence-signal/ — format: [convergence signal](/what-is-a-convergence-signal/)
- Internal link #2: somewhere in the body, link the text "top 50 Polymarket traders" to /best-polymarket-traders-to-follow-2026/ — format: [top 50 Polymarket traders](/best-polymarket-traders-to-follow-2026/)
- CTA box after Section 3 or 4 (pick the natural spot), formatted EXACTLY like this:

---

**[Track live convergence signals from the top 50 Polymarket traders → polymarket.tips](https://polymarket.tips)**

---

- CTA box at the very end, formatted EXACTLY like this:

---

**[Follow smart money on Polymarket in real-time → polymarket.tips](https://polymarket.tips)**

---

- The target keyword (derive from the topic, e.g. "Polymarket [topic]") should appear naturally in the H1/meta and 3 times in the body
- Never mention "this post" or "today's article" self-referentially

## Topic selection rules

- Prefer high-volume markets with a timely hook
- Prefer topics with broad appeal (politics, economics, geopolitics, macro, sports at scale)
- Avoid duplicating existing slugs — check the list carefully
- If today's trending markets are thin, write an evergreen strategy piece on a fresh angle
- The slug must be unique, kebab-case, and descriptive (e.g. polymarket-fed-rate-cut-june-2026)

Return ONLY the JSON object. No preamble, no explanation, no markdown fences.`;

async function generatePost({ markets, existingSlugs, today }) {
  const client = new Anthropic();

  const keywordGaps = KEYWORD_PRIORITIES.filter(k => !k.hasPost);
  const keywordExisting = KEYWORD_PRIORITIES.filter(k => k.hasPost);

  const userMessage = `Today: ${today}

Existing blog post slugs (DO NOT duplicate these topics):
${existingSlugs.map(s => `- ${s}`).join('\n')}

KEYWORD PRIORITY DATA (from Google Search Console):
The following terms are already getting Google impressions but need stronger content to rank higher.
Prioritise these when choosing today's topic — especially terms marked hasPost: false (no post exists yet).

KEYWORD GAPS — NO POST EXISTS, HIGHEST PRIORITY:
${keywordGaps.map(k => {
  const pos = k.position != null ? `currently ranking ~${k.position}` : 'getting impressions, not yet ranking';
  return `- "${k.keyword}" — NO POST EXISTS — ${pos} — high priority to create`;
}).join('\n')}

TERMS WITH EXISTING POSTS (do NOT duplicate these — consider writing a RELATED supporting post only if you have a fresh angle):
${keywordExisting.map(k => `- "${k.keyword}" — existing post at /${k.slug}/ — ranking ~${k.position}`).join('\n')}

TOPIC SELECTION RULES:
1. DEFAULT CHOICE: pick the highest-priority keyword gap (hasPost: false) from above and write a post that targets that exact keyword. Use the keyword in the H1, meta title, meta description, and 3+ times in the body.
2. If a Tier 2 keyword gap is relevant to today's Polymarket trending data — even better, combine the two angles.
3. Only write a pure trending/news post if it is genuinely significant breaking news (major price move, major geopolitical event, major Polymarket announcement that is today's story). Timely posts are the exception, not the rule.
4. Never write a second post on the same keyword as an existing post — check the slug list and the existing-keywords list above.
5. When targeting a keyword gap, derive a natural, interesting angle — don't just regurgitate the keyword. Write something a reader searching that term would actually want to read.

Today's trending Polymarket markets (sorted by 24h volume, for reference / optional trending hook):
${JSON.stringify(markets, null, 2)}

Pick the best topic following the rules above and write the full blog post. Return only the JSON object.`;

  console.log('Calling Claude...');
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Parse JSON — strip markdown fences if the model added them
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  // Find the outer JSON object
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object in Claude response');
  }
  jsonText = jsonText.slice(firstBrace, lastBrace + 1);

  const post = JSON.parse(jsonText);
  return post;
}

// ---------- Frontmatter + file writing ----------

function escapeYamlSingleQuoted(value) {
  return value.replace(/'/g, "''");
}

function buildFrontmatter(post) {
  // Uses exact format as existing posts: folded block scalars for title/metaTitle/description,
  // single-quoted strings for dates and paths.
  return `---
title: >-
  ${post.title.trim()}
metaTitle: >-
  ${post.metaTitle.trim()}
description: >-
  ${post.metaDescription.trim()}
category: ${post.category}
publishedDate: '${post.datePublished}'
ogImage: ''
heroImage: '/images/blog/${post.slug}.jpg'
heroImageAlt: '${escapeYamlSingleQuoted(post.heroImageAlt.trim())}'
---

`;
}

function writePostFile(post) {
  const dir = path.join(POSTS_DIR, post.slug);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'index.mdoc');
  const contents = buildFrontmatter(post) + post.content.trim() + '\n';
  fs.writeFileSync(filePath, contents, 'utf8');
  console.log(`Wrote ${filePath}`);
  return filePath;
}

// ---------- Hero image generation (Puppeteer) ----------

function heroImageHTML({ titleLines, categoryLabel, accent, icon }) {
  const titleHTML = titleLines.map(l => l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))).join('<br>');
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(245,158,11,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(245,158,11,0.05) 1px,transparent 1px);background-size:60px 60px}
.glow{position:absolute;width:600px;height:400px;background:radial-gradient(ellipse,${accent}15 0%,transparent 70%);top:-100px;left:-100px}
.glow-bottom{position:absolute;width:400px;height:300px;background:radial-gradient(ellipse,${accent}10 0%,transparent 70%);bottom:-100px;right:100px}
.top-line{position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,${accent},transparent)}
.content{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:60px 80px}
.logo{position:absolute;top:36px;left:80px;display:flex;align-items:center;gap:8px}
.logo-dot{width:10px;height:10px;background:${accent};border-radius:50%}
.logo-text{font-size:18px;color:rgba(255,255,255,0.7);font-weight:500}
.logo-text span{color:${accent}}
.category{display:inline-flex;background:${accent}20;border:1px solid ${accent}40;color:${accent};font-size:14px;font-weight:600;padding:6px 14px;border-radius:100px;letter-spacing:0.05em;text-transform:uppercase;width:fit-content;margin-bottom:28px}
.title{font-size:64px;font-weight:800;color:#fff;line-height:1.1;letter-spacing:-0.02em;max-width:900px}
.bottom-bar{position:absolute;bottom:40px;left:80px}
.site-label{font-size:16px;color:rgba(255,255,255,0.4);font-weight:500}
.site-label strong{color:rgba(255,255,255,0.7)}
.icon{position:absolute;right:80px;top:50%;transform:translateY(-50%);font-size:120px;opacity:0.15}
</style></head><body>
<div class="grid"></div><div class="glow"></div><div class="glow-bottom"></div><div class="top-line"></div>
<div class="logo"><div class="logo-dot"></div><div class="logo-text">polymarket<span>.tips</span></div></div>
<div class="content"><div class="category">${categoryLabel}</div><div class="title">${titleHTML}</div></div>
<div class="icon">${icon}</div>
<div class="bottom-bar"><div class="site-label">Track smart money at <strong>polymarket.tips</strong></div></div>
</body></html>`;
}

async function generateHeroImage(post) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const outputPath = path.join(IMAGES_DIR, `${post.slug}.jpg`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630 });
    await page.setContent(heroImageHTML(post.heroImage), { waitUntil: 'networkidle0' });
    await page.screenshot({ path: outputPath, type: 'jpeg', quality: 92 });
  } finally {
    await browser.close();
  }
  console.log(`Generated ${outputPath}`);
  return outputPath;
}

// ---------- Git commit + push ----------

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function gitCommitAndPush(post) {
  try {
    run('git config user.email "agent@polymarket.tips"');
    run('git config user.name "Polymarket Tips Agent"');
    run('git add -A');
    // If nothing staged, bail gracefully (e.g. rerun same day)
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
    if (!status.trim()) {
      console.log('Nothing to commit.');
      return false;
    }
    const msg = `Daily post: ${post.slug} (${post.datePublished})`;
    run(`git commit -m ${JSON.stringify(msg)}`);
    run('git push origin main');
    return true;
  } catch (err) {
    console.error('Git step failed:', err.message);
    throw err;
  }
}

// ---------- Main ----------

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Daily blog agent starting for ${today}`);

  const [markets, existingSlugs] = await Promise.all([
    fetchTrendingMarkets(),
    Promise.resolve(getExistingSlugs()),
  ]);
  console.log(`Fetched ${markets.length} trending markets. ${existingSlugs.length} existing posts.`);

  const post = await generatePost({ markets, existingSlugs, today });

  // Validation
  const required = ['slug', 'title', 'category', 'metaTitle', 'metaDescription', 'datePublished', 'heroImage', 'heroImageAlt', 'content'];
  for (const key of required) {
    if (!post[key]) throw new Error(`Claude response missing field: ${key}`);
  }
  if (existingSlugs.includes(post.slug)) {
    throw new Error(`Claude produced duplicate slug: ${post.slug}`);
  }
  if (!/^[a-z0-9-]+$/.test(post.slug)) {
    throw new Error(`Invalid slug format: ${post.slug}`);
  }
  const validCategories = ['market-strategy', 'trader-intelligence', 'polymarket-guides', 'convergence-signals'];
  if (!validCategories.includes(post.category)) {
    throw new Error(`Invalid category: ${post.category}`);
  }
  if (!post.content.includes('polymarket.com/?r=POLYTips')) {
    throw new Error('Content missing affiliate link');
  }
  if (!post.content.includes('/what-is-a-convergence-signal/')) {
    throw new Error('Content missing convergence signal internal link');
  }
  if (!post.content.includes('/best-polymarket-traders-to-follow-2026/')) {
    throw new Error('Content missing top traders internal link');
  }

  console.log(`Generated post: "${post.title}" (${post.slug})`);

  writePostFile(post);
  await generateHeroImage(post);

  if (process.env.SKIP_GIT === '1') {
    console.log('SKIP_GIT=1, skipping commit/push.');
    return;
  }

  gitCommitAndPush(post);
  console.log(`Done. Post will be live at https://blog.polymarket.tips/${post.slug}/ after Vercel deploys.`);
}

main().catch(err => {
  console.error('Agent failed:', err);
  process.exit(1);
});
