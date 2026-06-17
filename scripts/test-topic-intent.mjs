#!/usr/bin/env node
/**
 * Tests for classifyTopicIntent — the gate that rejects the junk query
 * classes (transient market listings, dated price-target speculation,
 * numeric post-IDs / navigational) and accepts proprietary/live-data and
 * durable evergreen topics.
 *
 * Run: node scripts/test-topic-intent.mjs
 */

import { classifyTopicIntent } from './daily-blog-agent.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
  else console.log('OK:  ', msg);
}

const blocked = (title, slug) => {
  const r = classifyTopicIntent({ title, slug });
  return !r.allowed;
};
const allowed = (title, slug) => classifyTopicIntent({ title, slug }).allowed;
const tierOf = (title, slug) => classifyTopicIntent({ title, slug }).tier;

// ---- BLOCKLIST: must reject ----
assert(blocked('Polymarket Trending Markets June 2026', 'polymarket-trending-markets-june-2026'),
  'rejects time-bound trending-markets listing');
assert(blocked('Top Polymarket Markets to Watch July 2026', 'polymarket-top-markets-july-2026'),
  'rejects "top markets [month]" listing');
assert(blocked('Most Active Polymarket Markets Right Now 2026', 'polymarket-active-markets-2026'),
  'rejects "active markets" + year');
assert(blocked('Bitcoin $150k Price Prediction June 2026', 'polymarket-bitcoin-150k-june-2026'),
  'rejects dated price-target speculation');
assert(blocked('Will Ethereum Hit $10,000 in 2026?', 'ethereum-10000-price-target-2026'),
  'rejects $-number + year price target');
assert(blocked('Polymarket Post 2065933098 Market Analysis', 'polymarket-post-2065933098'),
  'rejects numeric post-ID topic');
assert(blocked('Polymarket 2065933098', '2065933098-polymarket-market'),
  'rejects mostly-numeric slug');
assert(blocked('Polymarket Live Odds Right Now', 'polymarket-live-odds-right-now'),
  'rejects navigational live-odds intent');

// ---- INTENT GATE: must accept (and tier correctly) ----
assert(allowed('What Is a Convergence Signal on Polymarket?', 'what-is-a-convergence-signal'),
  'accepts convergence signal topic');
assert(tierOf('What Is a Convergence Signal on Polymarket?', 'what-is-a-convergence-signal') === 2,
  'convergence signal is Tier 2');
assert(allowed('Polymarket Whale Tracker: How to Follow Smart Money', 'polymarket-whale-tracker-guide'),
  'accepts whale tracker topic');
assert(tierOf('Polymarket Whale Tracker: How to Follow Smart Money', 'polymarket-whale-tracker-guide') === 2,
  'whale tracker is Tier 2');
assert(allowed('mooseborzoi on Polymarket: Inside a Top-Ranked Trader Strategy', 'mooseborzoi-polymarket-trader-profile-strategy'),
  'accepts trader-name spotlight');
assert(tierOf('mooseborzoi on Polymarket: Inside a Top-Ranked Trader Strategy', 'mooseborzoi-polymarket-trader-profile-strategy') === 2,
  'trader spotlight is Tier 2 (live-data)');

// "top polymarket traders 2026" must NOT be blocked — the noun is "traders",
// not "markets", even though it has "top" + a year.
assert(allowed('Top Polymarket Traders 2026', 'top-polymarket-traders-2026'),
  'accepts "top traders [year]" (noun is traders, not markets)');

// Evergreen how-to → allowed, Tier 3.
assert(allowed('Polymarket Fees Explained', 'polymarket-fees-explained'),
  'accepts evergreen fees topic');
assert(tierOf('Polymarket Fees Explained', 'polymarket-fees-explained') === 3,
  'fees is Tier 3');

// Durable analysis of a specific market used as a live example → allowed.
assert(allowed('How Smart Money Is Positioned on the Fed Rate Decision', 'polymarket-fed-rate-smart-money-positioning'),
  'accepts durable smart-money angle that uses a live market as example');

console.log(failures === 0 ? '\nAll topic-intent tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
