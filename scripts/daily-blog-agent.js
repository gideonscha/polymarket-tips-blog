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

// ---------- Keyword priorities ----------
// Refreshed Jun 8, 2026 from 28-day Search Console analysis. The strategy
// shift: STOP manufacturing vanity impressions (transient "trending markets
// june 2026" listings, price-target speculation, numeric post-IDs — all high
// impressions / zero clicks / lost to AI Overviews). PRIORITISE query types
// AI Overviews CANNOT satisfy:
//   Tier 1 — trader-name spotlights (live/proprietary data; handled by the
//            weekly spotlight path, biased into the daily picker).
//   Tier 2 — proprietary / live-data evergreen (convergence, whale tracker,
//            smart money, copy trading, leaderboard, signals, best traders).
//            These route the high-intent reader into the live product.
//   Tier 3 — evergreen how-it-works / comparison (some AI-Overview exposure,
//            so lower priority — only when Tier 1/2 exhausted).
// `tier` drives selection priority; `hasPost` marks what's already covered so
// the agent never proposes a near-duplicate.
const KEYWORD_PRIORITIES = [
  // TIER 2 — proprietary / live-data evergreen (AI-Overview-resistant).
  { keyword: 'polymarket whale tracker', tier: 2, position: 6.89, hasPost: true, slug: 'polymarket-whale-tracker' },
  { keyword: 'polymarket leaderboard', tier: 2, position: 7.32, hasPost: true, slug: 'polymarket-leaderboard-explained' },
  { keyword: 'polymarket top traders 2026', tier: 2, position: 6.47, hasPost: true, slug: 'top-polymarket-traders-2026' },
  { keyword: 'best polymarket traders', tier: 2, position: 16.21, hasPost: true, slug: 'best-polymarket-traders-to-follow-2026' },
  { keyword: 'polymarket archetype tags', tier: 2, position: 7.47, hasPost: true, slug: 'polymarket-archetype-tags-explained' },
  { keyword: 'polymarket copy trading', tier: 2, position: 13.33, hasPost: true, slug: 'polymarket-copy-trading-how-to-follow-top-traders' },
  { keyword: 'polymarket smart money tracking', tier: 2, position: 12.0, hasPost: true, slug: 'polymarket-smart-money-tracking-how-to-follow-whale-positions' },
  { keyword: 'polymarket signals', tier: 2, position: 63.0, hasPost: true, slug: 'polymarket-signals-how-to-identify-smart-money-convergence' },
  { keyword: 'convergence trading strategy', tier: 2, position: 71.33, hasPost: true, slug: 'convergence-trading-strategy-polymarket-smart-money' },
  { keyword: 'polymarket trading tips', tier: 2, position: 11.0, hasPost: true, slug: 'polymarket-tips-advanced-tactics-profitable-prediction-market-trading' },
  // Tier 2 fresh gaps (proprietary/live-data angle, not yet covered):
  { keyword: 'polymarket trader win rate analysis', tier: 2, position: null, hasPost: false },
  { keyword: 'polymarket automated trading bots', tier: 2, position: null, hasPost: false },
  { keyword: 'polymarket contrarian trader edge', tier: 2, position: null, hasPost: false },

  // TIER 3 — evergreen how-it-works / comparison (AI-Overview-exposed → lower priority).
  { keyword: 'polymarket 2026 midterms', tier: 3, position: 15.27, hasPost: true, slug: 'polymarket-2026-midterm-elections-prediction-markets' },
  { keyword: 'polymarket withdrawal guide', tier: 3, position: 12.52, hasPost: true, slug: 'polymarket-withdrawal-guide-how-to-cash-out-2026' },
  { keyword: 'polymarket app ios android', tier: 3, position: 47.36, hasPost: true, slug: 'polymarket-ios-android-app-complete-mobile-trading-guide' },
  { keyword: 'polymarket ipo 2026', tier: 3, position: 18.0, hasPost: true, slug: 'polymarket-ipo-2026-prediction-market-public-offering' },
  { keyword: 'recession probability 2026', tier: 3, position: 19.0, hasPost: true, slug: 'polymarket-recession-2026-economic-outlook-markets' },
  { keyword: 'polymarket house control 2026', tier: 3, position: 39.0, hasPost: true, slug: 'polymarket-2026-house-odds-midterm-predictions' },
  { keyword: 'how to make money on polymarket', tier: 3, position: null, hasPost: true, slug: 'how-to-make-money-on-polymarket-profitable-approaches' },
  { keyword: 'polymarket fees explained', tier: 3, position: null, hasPost: true, slug: 'polymarket-fees-explained-trading-costs-2026' },
  { keyword: 'polymarket vs sports betting', tier: 3, position: null, hasPost: true, slug: 'polymarket-vs-sports-betting-differences-explained' },
  { keyword: 'polymarket accuracy track record', tier: 3, position: null, hasPost: true, slug: 'polymarket-accuracy-how-accurate-are-prediction-markets' },
  { keyword: 'prediction market strategy guide', tier: 3, position: null, hasPost: true, slug: 'prediction-market-strategy-smart-money-edge-2026' },
  { keyword: 'polymarket beginner guide', tier: 3, position: null, hasPost: true, slug: 'polymarket-beginner-guide-how-to-start-trading-prediction-markets' },
  { keyword: 'polymarket limit orders', tier: 3, position: null, hasPost: true, slug: 'polymarket-limit-orders-how-to-use-advanced-order-types' },
  // Tier 3 fresh gaps (evergreen how-to / comparison, not yet covered):
  { keyword: 'polymarket tax reporting', tier: 3, position: null, hasPost: false },
  { keyword: 'polymarket negative risk explained', tier: 3, position: null, hasPost: false },
  { keyword: 'polymarket arbitrage strategy', tier: 3, position: null, hasPost: false },
  { keyword: 'polymarket crypto price markets', tier: 3, position: null, hasPost: false },
  { keyword: 'polymarket parlay multi outcome bets', tier: 3, position: null, hasPost: false },
  { keyword: 'polymarket leverage risk explained', tier: 3, position: null, hasPost: false },
  { keyword: 'polymarket dispute resolution uma oracle', tier: 3, position: null, hasPost: false },
];

// ---------- Trader spotlight ----------
// Trader-name searches are low-competition / high-intent. The gravia_001
// spotlight reached Google position ~1.7 within weeks. We publish ONE
// spotlight per week, selecting the highest-ranked ELIGIBLE trader on the
// live leaderboard who has not already been profiled.
const SPOTLIGHT_DAY = 1; // Monday (0=Sun,1=Mon,...). Override with SPOTLIGHT_FORCE=1.

// Live leaderboard data source (public, no auth). Returns { updatedAt, traders[] }.
const LEADERBOARD_URL = 'https://kfiizygdnlgffjdyzfxj.supabase.co/functions/v1/public-leaderboard';

// Seed list of trader names already getting Google impressions. When one of
// these is eligible AND present on the live leaderboard it is preferred over
// a higher-ranked but unsearched trader (proven search demand). Otherwise
// selection falls back to pure leaderboard rank among eligible traders.
const SPOTLIGHT_CANDIDATES = [
  'drpufferfish',
  'swisstony',
  'gator',
  'bossoskil1',
  'rn1',
  'CemeterySun',
  'Countryside',
  'RevengeProsper',
  'Punisher2022',
  'tradecraft',
];

// Brand-safety denylist (lowercased substrings). Matching ANY substring
// rejects the trader. The cost of a false reject is merely skipping to the
// next eligible trader, so this is deliberately aggressive — far better to
// skip a borderline name than autonomously publish an off-brand post.
const NAME_DENYLIST = [
  // Religion / ethnicity / nationality used as identity labels
  'jewish', 'jew', 'muslim', 'islam', 'islamic', 'christian', 'catholic', 'protestant',
  'hindu', 'buddhist', 'mormon', 'zionist', 'arab', 'negro', 'negroid', 'latina', 'latino',
  'hispanic', 'asian', 'african', 'caucasian', 'aryan', 'nazi', 'hitler', 'kkk', 'isis', 'jihad',
  // Sexual / explicit
  'sex', 'porn', 'vagina', 'penis', 'boob', 'tits', 'titty', 'cock', 'dick', 'pussy', 'cum',
  'anal', 'milf', 'dildo', 'horny', 'nude', 'naked', 'xxx', 'blowjob', 'handjob', 'orgasm',
  'erotic', 'fetish', 'bdsm', 'hentai', 'onlyfans', 'cumming',
  // Mental illness / self-harm / gambling addiction
  'mentallyill', 'mentalill', 'suicide', 'suicidal', 'selfharm', 'self-harm', 'cutter',
  'anorexi', 'bulimi', 'depressed', 'depression', 'gamblingaddict', 'gambleaddict',
  'degenaddict', 'addicted', 'addiction', 'rehab',
  // Profanity / slurs
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'asshole', 'dickhead', 'motherfuck', 'fag',
  'faggot', 'dyke', 'tranny', 'retard', 'retarded', 'spastic', 'nigg', 'nigger', 'chink',
  'spic', 'wetback', 'kike', 'gook', 'paki', 'coon', 'whore', 'slut', 'rape', 'rapist',
  'molest', 'pedo', 'paedo', 'incest', 'bestiality',
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

// ---------- Duplicate detection (topic-word overlap) ----------
//
// Problem: the agent has been producing near-duplicate posts on the same
// topic with slightly different slugs (e.g. five "polymarket tracker" /
// "smart money tracker" variants in a single week). Exact slug-match is
// too weak. Instead we extract the discriminating noun tokens from each
// title/slug and treat any pair sharing >=2 tokens as the same topic.

// Function words + brand/year markers that appear in nearly every title
// and don't help discriminate topics. Content words like "tracker", "guide",
// "follow", "strategy", "trader" are intentionally KEPT so we catch
// "smart money tracker" / "tracker tools smart money" type dupes.
//
// "market"/"prediction" ARE added — they appear in almost every Polymarket
// title and would otherwise cause false positives between genuinely distinct
// topics (e.g. "Iran ceasefire MARKET" vs "Bitcoin PREDICTION market").
const STOPWORDS = new Set([
  'the','a','an','of','to','in','on','for','with','and','or','by','at','as','is','are','was','were','be',
  'it','this','that','these','those','your','our','my','its','their','his','her',
  'do','does','did','will','would','should','could','can','may','might','must','shall',
  'what','why','how','when','where','who','which','whose','whom',
  'has','have','had','having','but','not','no','yes',
  'if','so','too','very','just','some','any','all','than','then','from','into','out','up','down',
  'about','again','also','before','after','during','through','between','among','over','under','within',
  // Brand / domain markers — in nearly every post title, no discriminating power
  'polymarket','tips','blog',
  // Niche-generic — in almost every Polymarket post (after singularisation)
  'market','prediction',
  // Year markers
  '2024','2025','2026','2027','2028',
]);

// Brand-frame bigrams: when BOTH halves co-occur in a title we treat them
// as a single non-discriminating phrase (drop both from the topic set).
// "Smart money" is the blog's recurring framing — two posts on completely
// different topics both legitimately mention it, so {smart, money} alone
// must not trigger a duplicate.
const BRAND_PHRASES = [
  ['smart', 'money'],
];

// Tokenise a title or slug into the set of discriminating topic words.
// Lowercases, splits on non-alphanumeric, strips trailing 's' for crude
// singularisation (traders -> trader, tools -> tool, positions -> position),
// drops stopwords and tokens shorter than 3 chars.
function extractTopicWords(text) {
  if (!text) return new Set();
  const words = new Set(
    text.toLowerCase()
      .replace(/[‘’']/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(t => (t.length > 3 && t.endsWith('s')) ? t.slice(0, -1) : t)
      .filter(t => t.length >= 3 && !STOPWORDS.has(t)),
  );
  // Strip brand-frame bigrams: if both halves are present, remove both.
  for (const [a, b] of BRAND_PHRASES) {
    if (words.has(a) && words.has(b)) {
      words.delete(a);
      words.delete(b);
    }
  }
  return words;
}

function postTopicWords({ title, slug }) {
  const s = new Set();
  for (const w of extractTopicWords(title)) s.add(w);
  for (const w of extractTopicWords(slug)) s.add(w);
  return s;
}

// Slug-level cross-check (SECONDARY duplicate detector).
//
// The topic-word check above misses cases where the discriminating word
// IS a brand marker. Example:
//   - existing slug "polymarket-accuracy-how-accurate-are-prediction-markets"
//   - proposed  slug "polymarket-accuracy-how-reliable"
// Under the topic-word check (with "polymarket" stopworded) these only
// share {accuracy} = 1 token, not enough to trigger. But the slugs are
// clearly the same topic.
//
// SLUG_STOPWORDS is intentionally much smaller than STOPWORDS — it keeps
// "polymarket" so that a shared brand-prefix + one shared discriminator
// triggers a duplicate. It still drops "prediction"/"market" because those
// decorate the "polymarket-X-prediction-market" boilerplate across many
// genuinely distinct topics (iran-prediction-market vs bitcoin-prediction-
// market would otherwise false-positive).
const SLUG_STOPWORDS = new Set([
  // Function words
  'the','a','an','of','to','in','on','for','with','and','or','by','at','as','is','are','was','were','be',
  'how','what','why','when','where','who','which','your','our','my',
  // Year markers
  '2024','2025','2026','2027','2028',
  // Boilerplate decorators that appear in many slugs without discriminating
  'prediction','market','guide','explained','complete','full',
  // The "tips" brand suffix (in case a slug ever uses it)
  'tips','blog',
]);

// Ordered list of slug tokens after stopword filter + crude singularisation.
function slugTokenList(slug) {
  if (!slug) return [];
  return slug.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(t => (t.length > 3 && t.endsWith('s')) ? t.slice(0, -1) : t)
    .filter(t => t.length >= 3 && !SLUG_STOPWORDS.has(t));
}

// Set form for back-compat with tests + topic-style overlap.
function slugTokens(slug) {
  return new Set(slugTokenList(slug));
}

// The first N discriminating tokens of a slug, joined with '-'. This is
// the strongest duplicate signal: if two slugs share their leading
// discriminator pair, they're almost always the same topic regardless
// of whatever boilerplate trails (e.g. "polymarket-accuracy-how-accurate"
// and "polymarket-accuracy-how-reliable" both have prefix-2
// "polymarket-accuracy").
function slugPrefix(slug, n = 2) {
  return slugTokenList(slug).slice(0, n).join('-');
}

// Cross-compare the proposed slug against each existing post's slug
// using the prefix-2 rule. This deliberately ignores the title — the
// title is human prose that often shares decorator words with unrelated
// posts (e.g. "Polymarket Trader Spotlight" vs "Top Polymarket Traders"
// share {polymarket, trader} but are distinct topics).
//
// The prefix-2 rule catches genuine slug-level duplicates without that
// false-positive surface:
//   - polymarket-accuracy-how-accurate vs polymarket-accuracy-how-reliable
//     -> both prefix-2 "polymarket-accuracy"  -> COLLIDE
//   - gravia-001-polymarket-trader vs best-polymarket-traders-to-follow
//     -> prefixes "gravia-001" vs "best-polymarket" -> DISTINCT
//   - polymarket-iran-ceasefire vs polymarket-bitcoin-prediction
//     -> prefixes "polymarket-iran" vs "polymarket-bitcoin" -> DISTINCT
function findSlugLevelCollision(candidate, existingPosts, _threshold = 2) {
  const candidatePrefix = slugPrefix(candidate.slug || '', 2);
  if (!candidatePrefix) return null;
  for (const rp of existingPosts) {
    if (slugPrefix(rp.slug, 2) === candidatePrefix) return rp;
  }
  return null;
}

function slugLevelOverlap(candidate, rp) {
  // For diagnostic output in the rejection message — return the
  // (prefix-2) tokens that matched.
  return slugTokenList(candidate.slug || '').slice(0, 2);
}

function overlapCount(setA, setB) {
  let n = 0;
  for (const t of setA) if (setB.has(t)) n++;
  return n;
}

function overlapWords(setA, setB) {
  const out = [];
  for (const t of setA) if (setB.has(t)) out.push(t);
  return out;
}

// Parse the YAML-ish frontmatter formats the agent emits. We only need
// title + publishedDate so this is intentionally small rather than a full
// YAML parser. Handles folded block scalars (>-) and single/double-quoted
// scalars.
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]+?)\n---/);
  if (!m) return {};
  const lines = m[1].split('\n');
  const result = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === '>-' || val === '>' || val === '|' || val === '|-') {
      const parts = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i++;
        parts.push(lines[i].trim());
      }
      result[key] = parts.join(' ');
    } else if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      result[key] = val.slice(1, -1).replace(/''/g, "'");
    } else {
      result[key] = val;
    }
  }
  return result;
}

// Read all posts, returning [{ slug, title, publishedDate, isRecent, topicWords }].
// "Recent" = published within `recentDays` of today.
function getAllPosts(recentDays = 30) {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
  const dirs = fs.readdirSync(POSTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  const posts = [];
  for (const d of dirs) {
    const file = path.join(POSTS_DIR, d.name, 'index.mdoc');
    if (!fs.existsSync(file)) continue;
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const slug = d.name;
    const title = fm.title || '';
    const publishedDate = fm.publishedDate || '';
    const published = publishedDate ? new Date(publishedDate) : null;
    const isRecent = published instanceof Date && !isNaN(published) && published >= cutoff;
    posts.push({
      slug,
      title,
      publishedDate,
      isRecent,
      topicWords: postTopicWords({ title, slug }),
    });
  }
  return posts;
}

class DuplicateTopicError extends Error {}
class TopicRejectedError extends Error {}

// Returns the first recent post whose topic words overlap with `candidateWords`
// at >= `threshold` tokens, or null if none.
function findOverlappingRecentPost(candidateWords, recentPosts, threshold = 2) {
  for (const rp of recentPosts) {
    if (overlapCount(candidateWords, rp.topicWords) >= threshold) return rp;
  }
  return null;
}

// ---------- Topic intent gate ----------
//
// Search Console analysis (Jun 2026) showed ~12x impression growth but ~0
// clicks, almost entirely from three junk query classes the agent had been
// manufacturing: time-bound market LISTINGS ("trending markets june 2026"),
// price-target SPECULATION ("bitcoin $150k june 2026"), and numeric post-ID /
// navigational queries. All three are either lost to AI Overviews or want to
// land on Polymarket itself, not a blog post.
//
// classifyTopicIntent is a pure, unit-testable gate run on every proposed
// topic. It returns { allowed, reason, tier }. Blocked topics trigger a retry.

const MONTH_RE = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/;
const YEAR_RE = /\b20\d{2}\b/;

function classifyTopicIntent({ title = '', slug = '' } = {}) {
  const text = `${title} ${slug.replace(/-/g, ' ')}`.toLowerCase();
  const hasMonthOrYear = MONTH_RE.test(text) || YEAR_RE.test(text);

  // BLOCK 1 — time-bound market listings. An adjective like trending/active/
  // recent/latest/current/popular/upcoming/top within ~3 words of "market(s)"
  // AND a month or year. Note: the noun must be "market(s)", NOT "traders" —
  // "top polymarket traders 2026" is a GOOD Tier-2 target and must pass.
  const listingRe = /\b(trending|active|recent|latest|current|popular|upcoming|top)\b(\s+\w+){0,3}\s+markets?\b/;
  if (listingRe.test(text) && hasMonthOrYear) {
    return { allowed: false, reason: 'time-bound market listing (transient; wants live Polymarket, not a blog post)', tier: null };
  }

  // BLOCK 2 — price-target speculation tied to a date. "$<number>", "price
  // target", or "price prediction" combined with a month/year.
  const hasPriceTarget = /\$\s?\d/.test(text) || /\bprice (target|prediction)\b/.test(text);
  if (hasPriceTarget && hasMonthOrYear) {
    return { allowed: false, reason: 'dated price-target speculation (e.g. "$150k june 2026"; AI-Overview territory)', tier: null };
  }

  // BLOCK 3 — numeric post-ID / navigational intent.
  const slugTokensOnly = slug.split('-').filter(Boolean);
  const digitTokens = slugTokensOnly.filter(t => /^\d+$/.test(t)).length;
  const mostlyNumericSlug = slugTokensOnly.length > 0 && digitTokens / slugTokensOnly.length >= 0.5;
  if (mostlyNumericSlug || /\bpost\s+\d{5,}\b/.test(text) || /\b\d{8,}\b/.test(text)) {
    return { allowed: false, reason: 'numeric post-ID / navigational topic (structurally unclickable)', tier: null };
  }
  if (/\b(live (odds|markets)|markets? (right now|today)|odds right now)\b/.test(text)) {
    return { allowed: false, reason: 'navigational "see live markets/odds now" intent (belongs on Polymarket, not the blog)', tier: null };
  }

  // INTENT TEST — prefer proprietary/live-data (Tier 2) and durable evergreen.
  const tier2Re = /\b(convergence|whale|smart money|copy trad|copytrad|leaderboard|signal|top trader|traders to follow|trader (win rate|pnl|profile|positions?|strategy)|position sizing|position size)\b/;
  if (tier2Re.test(text)) {
    return { allowed: true, reason: 'proprietary / live-data angle (AI-Overview-resistant)', tier: 2 };
  }
  // Specific named-entity / event analysis (a real market subject, framed as
  // durable analysis) — allowed. This is the legitimate trending-as-example
  // fallback: e.g. "what smart money is pricing on the <event> market".
  // Generic evergreen how-to / comparison — allowed but Tier 3 (last resort).
  const tier3Re = /\b(vs |versus|fees|accuracy|withdrawal|deposit|mobile|app|how to|guide|explained|beginner|tax|wallet|limit order|resolution|liquidity|order book|arbitrage|negative risk)\b/;
  if (tier3Re.test(text)) {
    return { allowed: true, reason: 'evergreen how-it-works / comparison', tier: 3 };
  }
  // Default: allowed (durable analysis of a specific subject), Tier 3 priority.
  return { allowed: true, reason: 'specific-subject analysis', tier: 3 };
}

// ---------- Trader spotlight: eligibility, selection, fetch ----------

// Criterion 1: a usable display name — not null, not a wallet address, not a
// wallet+timestamp handle (e.g. "0x1a5c...-1774116788380").
function isWalletLikeName(name) {
  if (!name || typeof name !== 'string') return true;
  const n = name.trim();
  if (!n) return true;
  if (n.toLowerCase().startsWith('0x')) return true;
  // 40-hex address with optional -timestamp suffix, with or without 0x prefix
  if (/^(0x)?[0-9a-f]{40}(-\d+)?$/i.test(n)) return true;
  // A long run of hex characters anywhere (defensive)
  if (/[0-9a-f]{30,}/i.test(n)) return true;
  // No alphanumeric content at all
  if (!/[a-z0-9]/i.test(n)) return true;
  // Purely numeric or numeric-ID-like handles (e.g. "123987456", "248188374").
  // These read as post-IDs, are structurally unclickable, and are exactly the
  // numeric junk we refuse to publish. A real display name has letters; require
  // at least 3 letters, and reject any long digit run.
  const letters = (n.match(/[a-z]/gi) || []).length;
  if (letters < 3) return true;
  if (/\d{6,}/.test(n)) return true;
  return false;
}

// Criterion 2: brand safety. Returns true only if the name is safe to feature
// in a public blog title. Aggressive by design — when uncertain, reject.
function isBrandSafeName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.toLowerCase();
  for (const bad of NAME_DENYLIST) {
    if (n.includes(bad)) return false;
  }
  return true;
}

// Criterion 3: enough real data to write a credible, data-driven profile.
function hasMeaningfulStats(t) {
  return (
    Number(t.pnl) > 0 &&
    Number(t.winRate) > 0 &&
    Number(t.marketsTraded) > 0 &&
    Number(t.volume) > 0
  );
}

// A trader is eligible only if ALL three criteria pass.
function isEligibleTrader(t) {
  if (!t) return false;
  if (isWalletLikeName(t.displayName)) return false;
  if (!isBrandSafeName(t.displayName)) return false;
  if (!hasMeaningfulStats(t)) return false;
  return true;
}

// Slugify a trader display name: lowercase, strip punctuation, hyphenate.
function slugifyName(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Canonical spotlight slug for a trader.
function spotlightSlug(name) {
  return `${slugifyName(name)}-polymarket-trader-profile-strategy`;
}

// Has this trader already been spotlighted? Matches any existing slug that
// begins with "<name>-polymarket-trader" so it also catches older patterns
// (e.g. the existing "gravia-001-polymarket-trader-strategy-analysis").
function traderAlreadySpotlighted(name, existingSlugs) {
  const prefix = `${slugifyName(name)}-polymarket-trader`;
  return existingSlugs.some(s => s.startsWith(prefix));
}

async function fetchLeaderboard() {
  const res = await fetch(LEADERBOARD_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Leaderboard API ${res.status}`);
  const data = await res.json();
  const traders = Array.isArray(data.traders) ? data.traders : [];
  return traders;
}

// Choose the spotlight trader: eligible + not-already-spotlighted. Among
// eligible traders, prefer ones in SPOTLIGHT_CANDIDATES (proven search
// demand) in list order, then fall back to leaderboard rank ascending.
function selectSpotlightTrader(traders, existingSlugs) {
  const eligible = traders.filter(isEligibleTrader);
  const cand = SPOTLIGHT_CANDIDATES.map(c => c.toLowerCase());
  const priority = (t) => {
    const i = cand.indexOf(String(t.displayName).toLowerCase());
    return i === -1 ? Infinity : i;
  };
  const ranked = [...eligible].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return (Number(a.rank) || 9999) - (Number(b.rank) || 9999);
  });
  for (const t of ranked) {
    if (!traderAlreadySpotlighted(t.displayName, existingSlugs)) return t;
  }
  return null;
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

## Click-earning metadata (CRITICAL — most posts rank but earn zero clicks)

The blog's job is to RANK and hand the high-intent reader to the live product. Generic informational answers lose the click to Google's AI Overviews, so titles and snippets must open an INFORMATION GAP — name the subject and promise an insight, but never reveal the conclusion or the headline number in the title or meta description.

- TITLE: name the subject + promise an insight. Do NOT put the answer or the key number in the title.
    Bad:  "gravia_001 Is Up $2.1M Betting Against the Fed"
    Good: "gravia_001's Polymarket Strategy: How a Top-10 Trader Is Positioned Now"
- META DESCRIPTION (HARD MAX 155 chars): tease the signal/direction without giving it away; end with a reason to click through to live data. NEVER put the full answer or the headline stat in the snippet.
- LIVE-APP CTA: every post must include, in the body, a prominent link to the relevant LIVE view on the main app — for live-data/trader topics link to the matching live page (a trader profile at https://polymarket.tips/trader/<address> when an address is available, otherwise the relevant feed at https://polymarket.tips), framed as "see the live data / positions / signals". This is in addition to the two CTA boxes and the affiliate links.
- Only ever use real, verifiable stats. Never fabricate a number to fill the gap.

## Topic selection rules

- Prefer high-volume markets with a timely hook
- Prefer topics with broad appeal (politics, economics, geopolitics, macro, sports at scale)
- Avoid duplicating existing slugs — check the list carefully
- If today's trending markets are thin, write an evergreen strategy piece on a fresh angle
- The slug must be unique, kebab-case, and descriptive (e.g. polymarket-fed-rate-cut-june-2026)

Return ONLY the JSON object. No preamble, no explanation, no markdown fences.`;

async function generatePost({ markets, existingSlugs, today, recentPosts, rejectionReason, forceTrending }) {
  const client = new Anthropic();

  // Annotate every keyword with whether a recent post already covers it
  // (topic-word overlap >= 2 with any post in the last 30 days).
  const annotated = KEYWORD_PRIORITIES.map(k => {
    const kwWords = extractTopicWords(k.keyword);
    const overlapping = findOverlappingRecentPost(kwWords, recentPosts, 2);
    return { ...k, recentlyCovered: !!overlapping, coveredBy: overlapping?.slug || null };
  });

  const availableGaps = annotated.filter(k => !k.hasPost && !k.recentlyCovered);
  const coveredGaps = annotated.filter(k => !k.hasPost && k.recentlyCovered);
  const keywordExisting = annotated.filter(k => k.hasPost);

  // Words appearing in 3+ recent posts — overused, treat as if they were
  // additional stopwords so Claude doesn't reach for them again.
  const wordFreq = new Map();
  for (const rp of recentPosts) {
    for (const w of rp.topicWords) wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
  }
  const overusedWords = [...wordFreq.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([w, c]) => `${w} (×${c})`);

  const userMessage = `Today: ${today}

Existing blog post slugs (DO NOT duplicate these topics):
${existingSlugs.map(s => `- ${s}`).join('\n')}

RECENTLY PUBLISHED POSTS (last 30 days) — your topic must NOT overlap with any of these on 2+ topic words:
${recentPosts.map(p => {
  const words = [...p.topicWords].sort().join(', ');
  return `- [${p.publishedDate}] "${p.title}"\n    topic words: { ${words} }`;
}).join('\n')}

KEYWORD PRIORITY DATA (from Google Search Console):

AVAILABLE KEYWORD GAPS — no post exists AND no recent post overlaps:
${availableGaps.length
  ? availableGaps.map(k => {
      const pos = k.position != null ? `ranking ~${k.position}` : 'no rank yet';
      return `- "${k.keyword}" — ${pos} — SAFE TO TARGET`;
    }).join('\n')
  : '(none available — fall back to a genuinely fresh angle on an uncovered Tier 3 idea)'}

KEYWORD GAPS RECENTLY COVERED — do NOT pick these, a recent post already addresses them:
${coveredGaps.length
  ? coveredGaps.map(k => `- "${k.keyword}" — covered by recent post /${k.coveredBy}/`).join('\n')
  : '(none)'}

TERMS WITH EXISTING POSTS (older — these may eventually get supporting content, but only with a genuinely fresh angle that does NOT overlap with any recent post on 2+ topic words):
${keywordExisting.map(k => `- "${k.keyword}" — existing post at /${k.slug}/ — ranking ~${k.position}`).join('\n')}

TOPIC SELECTION PRIORITY ORDER (weight keyword gaps FAR above the trending feed):
1. FIRST PRIORITY: An AVAILABLE Tier 2 keyword gap (proprietary / live-data angle — convergence, whale tracking, smart money, copy trading, leaderboard, signals, trader win-rate/positioning). These are AI-Overview-resistant and route the reader into the live product.
2. SECOND PRIORITY: An AVAILABLE Tier 3 keyword gap (evergreen how-it-works / comparison).
3. LAST RESORT: a fresh evergreen/trader ANGLE that uses a specific current market as a live EXAMPLE (see RESILIENT FALLBACK). The trending feed is INSPIRATION for framing, never the topic itself.

DO NOT WRITE (these get impressions but zero clicks and will be auto-rejected):
- Time-bound market listings: "Polymarket trending/active/recent/top markets [month] [year]". Searchers for these want Polymarket itself, not a blog post.
- Dated price-target speculation: "Bitcoin $150k [month] [year]", "[asset] price prediction [year]". Lost to AI Overviews.
- Anything built around a numeric market ID or "see live markets/odds right now" intent.
A hard gate enforces this after you respond; a blocked topic wastes an attempt. Do not propose them.

DUPLICATE-AVOIDANCE RULES (HARD CONSTRAINTS — both enforced post-generation):

Rule 1 — Topic-word overlap. Your proposed slug + title combined must not share 2 or more topic words with ANY post in the "Recently published" list above. Topic words exclude stopwords like "the/and/of" and the brand words "polymarket/tips/blog/2026/2025/2024" and the brand-frame phrase "smart money" (which is collapsed and ignored). Almost everything else counts.

Rule 2 — Slug-prefix collision check. The first TWO discriminating tokens of your slug ("slug prefix") must not match the first two discriminating tokens of any existing post's slug (ALL posts, not just recent). Boilerplate decorators (prediction, market, guide, explained, complete, full, year markers, function words) are skipped when computing the prefix.

Examples:
- "polymarket-accuracy-how-accurate-..." and "polymarket-accuracy-how-reliable" both have prefix "polymarket-accuracy" -> COLLIDE
- "polymarket-iran-..." and "polymarket-bitcoin-..." have prefixes "polymarket-iran" vs "polymarket-bitcoin" -> DISTINCT, fine
- "gravia-001-polymarket-..." and "best-polymarket-traders-..." have prefixes "gravia-001" vs "best-polymarket" -> DISTINCT, fine
- "polymarket-withdrawal-..." and "polymarket-deposit-..." have prefixes "polymarket-withdrawal" vs "polymarket-deposit" -> DISTINCT, fine

This rule still requires you to pick a unique leading discriminator. If you're writing about a topic in the "polymarket-X-..." namespace, make sure no existing slug already uses your X.

OVERUSED WORDS — appear in 3+ recent posts, very high collision risk:
${overusedWords.length ? overusedWords.join(', ') : '(none yet)'}
Reusing two of these in your title/slug is the #1 source of duplicate rejections. Use AT MOST ONE of them. Reach for fresher framing instead.

RESILIENT FALLBACK (important — read carefully):
If no AVAILABLE keyword gap can be covered without colliding with a recent post, DO NOT force a near-duplicate, and DO NOT write a transient "trending markets" listing. Instead, take ONE specific high-volume market from "Today's trending Polymarket markets" below and use it as a LIVE EXAMPLE inside a durable, evergreen angle — preferably a smart-money / convergence / trader-positioning angle. The post is about the durable concept, illustrated by the current market; it is NOT a time-stamped listing of what's trending.
    Bad (transient, blocked):  "Polymarket Trending Markets June 2026"
    Good (durable + live example): "How Smart Money Positions Around a Fed Decision — and What the Live <market> Market Shows"
Give it a unique slug built around the durable angle + the specific subject (e.g. polymarket-[entity]-[smart-money|convergence|positioning]-angle), NOT around a month/year. This must pass the intent gate (no listing/price-target/navigational patterns).
(Trader spotlight posts are handled separately on the weekly spotlight day — do NOT write a trader-name profile here.)

When targeting a keyword gap, use the keyword in the H1, meta title, meta description, and 3+ times in the body. Derive a natural, interesting angle — don't just regurgitate the keyword. Write something a reader searching that term would actually want to read.${rejectionReason ? `\n\nIMPORTANT: Your previous attempt was REJECTED for duplicate overlap. Reason: ${rejectionReason}\nPick a different topic that does not overlap.` : ''}${forceTrending ? `\n\nFINAL ATTEMPT — MANDATORY: Write a DURABLE evergreen/smart-money angle that uses a current market as a LIVE EXAMPLE (per RESILIENT FALLBACK). CRITICAL: do NOT pick a market whose subject already appears in the "Recently published" list above — e.g. if a World Cup post already exists, do NOT write any World Cup angle (it will collide on {world, cup}). Scan the trending list and the keyword gaps for a subject on a DIFFERENT topic entirely (a different sport, a political/econ/crypto market, or an uncovered evergreen gap). Build a unique slug around that distinct subject — NOT a "trending markets [month/year]" listing, NOT a price target, NOT a numeric ID. It must pass the intent gate and share fewer than 2 topic words with every recent post.` : ''}

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

  return parseClaudeJSON(text);
}

// Extract and parse the single JSON object from a Claude response, tolerating
// markdown fences and surrounding prose.
function parseClaudeJSON(text) {
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object in Claude response');
  }
  return JSON.parse(jsonText.slice(firstBrace, lastBrace + 1));
}

// Generate a trader spotlight post from REAL leaderboard stats. The subject
// and all quantitative facts are fixed; Claude only writes the prose. We
// force slug / title / category / hero-image config deterministically after
// parsing so the model can't drift from the spec or invent a different topic.
async function generateSpotlightPost({ trader, today }) {
  const client = new Anthropic();
  const name = trader.displayName;
  const slug = spotlightSlug(name);
  const title = `${name} on Polymarket: Trading Strategy, Win Rate & Track Record Analysis`;
  const tags = Array.isArray(trader.archetypeTags) ? trader.archetypeTags : [];

  // Pre-format the only numbers the model is allowed to state.
  const fmtUSD = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
  const stats = {
    rank: Number(trader.rank),
    pnl: fmtUSD(trader.pnl),
    winRate: `${Number(trader.winRate)}%`,
    marketsTraded: Number(trader.marketsTraded).toLocaleString('en-US'),
    volume: fmtUSD(trader.volume),
    tags: tags.length ? tags.join(', ') : 'none',
  };
  // Live app page for this trader — routes the high-intent reader to real-time
  // positions. Use the verified on-chain wallet address from the leaderboard.
  const liveProfileUrl = trader.walletAddress
    ? `https://polymarket.tips/trader/${trader.walletAddress}`
    : 'https://polymarket.tips';

  const userMessage = `Write a TRADER SPOTLIGHT post about the Polymarket trader "${name}". The subject is FIXED — do not pick a different topic.

VERIFIED ON-CHAIN STATS (from the polymarket.tips leaderboard). These are the ONLY quantitative facts you may state anywhere in the post. Do NOT invent or estimate any other number, dollar figure, percentage, date, market name, or specific trade:
- Leaderboard rank: #${stats.rank} by total profit
- Total profit (PnL): ${stats.pnl}
- Win rate: ${stats.winRate}
- Markets traded: ${stats.marketsTraded}
- Total volume traded: ${stats.volume}
- Archetype tags: ${stats.tags}

Write ~900-1100 words, 6 H2 sections, full prose (no lists), following this arc:
1. Who ${name} is — introduce them via their leaderboard standing (#${stats.rank}) and archetype tags
2. Their verified track record — discuss the real PnL, win rate, markets traded, and volume above. Frame honestly: if the win rate is below 50%, do NOT call it "high" — instead explain how a sub-50% win rate can coexist with large PnL (outsized wins on high-conviction or early-mover positions outweighing frequent small losses)
3. Their trading style — interpret the archetype tags (${stats.tags}) qualitatively. Do NOT fabricate specific trades, market names, or positions
4. What other traders can learn from ${name}'s approach
5. How to track ${name} and traders like them on polymarket.tips — this is where the required internal links go
6. Sharp closing

HONESTY RULES (critical — this publishes autonomously):
- Use ONLY the six stats above. Never state any other figure.
- Frame every stat as "verified on-chain data from the polymarket.tips leaderboard".
- Never claim ${name} is profitable in any market or category you don't have data for.
- Never invent specific positions, counterparties, dates, or per-trade amounts.

CLICK-EARNING METADATA (the post must rank AND route the reader to live data):
- TITLE must open an information gap — name ${name} and promise an insight, but do NOT put any PnL/win-rate number in the title.
- META DESCRIPTION (HARD MAX 155 chars) must tease ${name}'s approach and end with a reason to see the live positions — do NOT put the headline number in it.
- In Section 5, include a prominent live-data CTA linking to ${name}'s live profile: [See ${name}'s live positions on polymarket.tips](${liveProfileUrl}) — this routes the high-intent reader to real-time data.

Return the JSON object per the system prompt format with these EXACT values:
- "slug": "${slug}"
- "title": "${title}"
- "category": "trader-intelligence"
- "metaTitle": a 55-62 char SEO title containing "${name}" and "Polymarket" that opens an information gap — do NOT include any PnL/win-rate number
- "metaDescription": MAX 155 chars, contains "${name} Polymarket", teases the approach and ends with a reason to see live positions — do NOT include the headline number
- "datePublished": "${today}"
- "heroImage": { "titleLines": ["${name}", "Trader Profile"], "categoryLabel": "Trader Intelligence", "accent": "#f59e0b", "icon": "single relevant emoji" }
- "heroImageAlt": describes the ${name} Polymarket trader profile
- "content": the full markdown body. MUST include exactly two affiliate links to https://polymarket.com/?r=POLYTips, the internal link [convergence signal](/what-is-a-convergence-signal/), the internal link [top 50 Polymarket traders](/best-polymarket-traders-to-follow-2026/), the live-profile CTA [See ${name}'s live positions on polymarket.tips](${liveProfileUrl}), and the two CTA boxes exactly as the system prompt specifies.

Return ONLY the JSON object.`;

  console.log(`Calling Claude for spotlight: ${name} (rank #${stats.rank})...`);
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const post = parseClaudeJSON(text);

  // Force the deterministic fields regardless of what the model returned.
  post.slug = slug;
  post.title = title;
  post.category = 'trader-intelligence';
  post.datePublished = today;
  post.heroImage = {
    titleLines: [name, 'Trader Profile'],
    categoryLabel: 'Trader Intelligence',
    accent: '#f59e0b',
    icon: (post.heroImage && post.heroImage.icon) || '📊',
  };
  if (!post.heroImageAlt) {
    post.heroImageAlt = `${name} Polymarket trader profile — verified track record and trading strategy`;
  }
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
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Daily blog agent starting for ${today}`);

  // Idempotency guard runs FIRST — before any API calls. If a post has
  // already been published with today's publishedDate, exit cleanly.
  // The workflow has two scheduled ticks per day (primary at 09:17 UTC,
  // fallback at 14:42 UTC). The fallback is a no-op (no API spend) when
  // the primary already succeeded. workflow_dispatch can override via
  // FORCE_RUN=1.
  const allPostsForGuard = getAllPosts(30);
  if (process.env.FORCE_RUN !== '1') {
    const sameDay = allPostsForGuard.filter(p => p.publishedDate === today).map(p => p.slug);
    if (sameDay.length > 0) {
      console.log(`Already published today (${today}): ${sameDay.join(', ')}. Set FORCE_RUN=1 to override.`);
      return;
    }
  } else {
    console.log('FORCE_RUN=1 — bypassing same-day idempotency guard.');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const [markets, allPosts] = await Promise.all([
    fetchTrendingMarkets(),
    Promise.resolve(allPostsForGuard),
  ]);
  const existingSlugs = allPosts.map(p => p.slug);
  const recentPosts = allPosts.filter(p => p.isRecent);
  console.log(`Fetched ${markets.length} trending markets. ${existingSlugs.length} existing posts (${recentPosts.length} within 30 days).`);

  function validateStructural(post) {
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
  }

  // Topic-word overlap check: title+slug topic-word overlap with brand
  // markers stripped, against recent posts.
  function checkTopicWordDup(post) {
    const candidate = postTopicWords({ title: post.title, slug: post.slug });
    const conflict = findOverlappingRecentPost(candidate, recentPosts, 2);
    if (conflict) {
      const shared = overlapWords(candidate, conflict.topicWords);
      throw new DuplicateTopicError(
        `Proposed "${post.slug}" overlaps with recent post "${conflict.slug}" (${conflict.publishedDate}) on ${shared.length} topic words: ${shared.join(', ')}`
      );
    }
  }

  // Slug-prefix collision check: the first two discriminating slug tokens
  // must be unique across ALL existing posts (not just recent).
  function checkSlugPrefixDup(post) {
    const slugConflict = findSlugLevelCollision(
      { title: post.title, slug: post.slug },
      allPosts,
      2,
    );
    if (slugConflict) {
      const prefix = slugPrefix(post.slug, 2);
      throw new DuplicateTopicError(
        `Proposed "${post.slug}" shares slug prefix "${prefix}" with existing post "${slugConflict.slug}" (${slugConflict.publishedDate}). Pick a different leading discriminator after the brand prefix.`
      );
    }
  }

  // Normal posts must pass both checks.
  function validateNotDuplicate(post) {
    checkTopicWordDup(post);
    checkSlugPrefixDup(post);
  }

  // Spotlight posts are intentionally templated ("[Name] on Polymarket:
  // Trading Strategy, Win Rate & Track Record Analysis"), so they share
  // generic topic words with every other spotlight by design. Their
  // uniqueness is the trader name, captured by the slug prefix
  // ("[name]-polymarket"). So spotlights are deduped by the slug-prefix
  // check only — plus the already-spotlighted guard applied at selection.
  function validateSpotlightNotDuplicate(post) {
    checkSlugPrefixDup(post);
  }

  let post = null;

  // ---- Weekly trader spotlight (takes priority on the spotlight day) ----
  const isSpotlightDay =
    process.env.SPOTLIGHT_FORCE === '1' || new Date().getUTCDay() === SPOTLIGHT_DAY;
  if (isSpotlightDay) {
    console.log(`Spotlight day (or SPOTLIGHT_FORCE). Selecting an eligible trader...`);
    try {
      const traders = await fetchLeaderboard();
      console.log(`Leaderboard returned ${traders.length} traders.`);
      const eligibleCount = traders.filter(isEligibleTrader).length;
      console.log(`${eligibleCount} pass eligibility filtering.`);
      const trader = selectSpotlightTrader(traders, existingSlugs);
      if (!trader) {
        console.log('No eligible un-spotlighted trader found — falling back to keyword-gap selection.');
      } else {
        console.log(`Selected #${trader.rank} ${trader.displayName} for spotlight.`);
        const candidate = await generateSpotlightPost({ trader, today });
        validateStructural(candidate);
        try {
          // Backstop: even a "brand-safe" trader can have a junk handle that
          // slips the eligibility filter (e.g. a numeric-ID name). Run the
          // same intent gate used for normal posts — it blocks numeric-ID /
          // navigational titles — so junk names never publish.
          const intent = classifyTopicIntent({ title: candidate.title, slug: candidate.slug });
          if (!intent.allowed) {
            throw new TopicRejectedError(`spotlight intent gate: ${intent.reason}`);
          }
          validateSpotlightNotDuplicate(candidate);
          post = candidate;
        } catch (err) {
          if (!(err instanceof DuplicateTopicError) && !(err instanceof TopicRejectedError)) throw err;
          console.warn(`Spotlight rejected: ${err.message}`);
          console.warn('Falling back to keyword-gap selection.');
        }
      }
    } catch (err) {
      console.warn(`Spotlight step failed (${err.message}) — falling back to keyword-gap selection.`);
    }
  }

  // ---- Normal keyword-gap selection (runs unless a spotlight was produced) ----
  if (!post) {
    // Try up to 3 times. Each retry passes the accumulated rejection log so
    // Claude can see exactly which titles and which shared words have already
    // failed and pick fresher framing.
    const MAX_ATTEMPTS = 4;
    const rejections = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // On the final attempt, force a fresh trending-market analysis — an
      // always-novel escape hatch so the agent can never exhaust its topics
      // and fail to publish (as happened Jun 3 when the keyword list saturated).
      const forceTrending = attempt === MAX_ATTEMPTS;
      const candidate = await generatePost({
        markets,
        existingSlugs,
        today,
        recentPosts,
        rejectionReason: rejections.length ? rejections.join('\n') : null,
        forceTrending,
      });
      validateStructural(candidate);
      try {
        // Intent gate FIRST — reject transient/price/navigational topics
        // before the duplicate checks (cheaper signal, clearer rejection).
        const intent = classifyTopicIntent({ title: candidate.title, slug: candidate.slug });
        if (!intent.allowed) {
          throw new TopicRejectedError(`intent gate: ${intent.reason}`);
        }
        validateNotDuplicate(candidate);
        post = candidate;
        break;
      } catch (err) {
        if (!(err instanceof DuplicateTopicError) && !(err instanceof TopicRejectedError)) throw err;
        console.warn(`Attempt ${attempt}/${MAX_ATTEMPTS} rejected: ${err.message}`);
        rejections.push(`Attempt ${attempt}: ${err.message}`);
        // Final attempt exhausted with no acceptable, non-duplicate topic.
        // This is NOT an error — it means everything fresh is already covered
        // today (e.g. keyword gaps used up AND the trending feed is dominated
        // by an already-covered event). Skip cleanly rather than failing the
        // run; the weekly spotlight and tomorrow's fresh data will resume.
        if (attempt === MAX_ATTEMPTS) {
          console.log('No fresh, non-duplicate topic available today — skipping cleanly (not an error). Recent days are well covered; next spotlight day or new trending data will resume publishing.');
          return;
        }
      }
    }
  }

  if (!post) {
    console.log('No post produced — skipping cleanly.');
    return;
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

// Only auto-run when invoked directly, not when imported (e.g. by tests).
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedAsScript) {
  main().catch(err => {
    console.error('Agent failed:', err);
    process.exit(1);
  });
}

export {
  extractTopicWords,
  postTopicWords,
  overlapCount,
  findOverlappingRecentPost,
  slugTokens,
  slugTokenList,
  slugPrefix,
  findSlugLevelCollision,
  classifyTopicIntent,
  getAllPosts,
  parseFrontmatter,
  // Trader spotlight
  isWalletLikeName,
  isBrandSafeName,
  hasMeaningfulStats,
  isEligibleTrader,
  slugifyName,
  spotlightSlug,
  traderAlreadySpotlighted,
  selectSpotlightTrader,
  fetchLeaderboard,
  LEADERBOARD_URL,
};
