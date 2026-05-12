#!/usr/bin/env node
/**
 * Self-test for the topic-overlap duplicate detector. Asserts the detector:
 *   - Correctly flags the real-world May 1-8 "tracker / smart money" cluster
 *   - Does NOT flag legitimately distinct posts as duplicates
 *
 * Run: node scripts/test-duplicate-detection.mjs
 */

import {
  extractTopicWords,
  postTopicWords,
  overlapCount,
  findOverlappingRecentPost,
  getAllPosts,
} from './daily-blog-agent.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK:  ', msg);
}

// --- Unit-level sanity ---

// The actual May 1-8 cluster the user reported
const trackerA = postTopicWords({
  title: 'Polymarket Tracker: How to Follow Smart Money Moves in Real Time',
  slug: 'polymarket-tracker-how-to-follow-smart-money-in-real-time',
});
const trackerB = postTopicWords({
  title: 'Polymarket Smart Money Tracker: How to Follow Top Traders',
  slug: 'polymarket-smart-money-tracker-how-to-follow-top-traders',
});
const overlapAB = overlapCount(trackerA, trackerB);
assert(overlapAB >= 2, `tracker A vs tracker B should overlap (got ${overlapAB})`);

// Legitimately distinct: convergence signal explainer vs whale tracker.
// These both contain "smart money" as brand-frame but the topic is different.
// After brand-phrase stripping the shared topic count should be 0.
const conv = postTopicWords({
  title: 'What is a Convergence Signal? How Smart Money Alignment Predicts Polymarket Moves',
  slug: 'what-is-a-convergence-signal',
});
const whale = postTopicWords({
  title: 'Polymarket Whale Tracker — How to Follow Smart Money in Real Time',
  slug: 'polymarket-whale-tracker',
});
const overlapCW = overlapCount(conv, whale);
assert(overlapCW < 2, `convergence vs whale-tracker should NOT overlap at 2+ (got ${overlapCW})`);

// Distinct topics that should NOT overlap
const iran = postTopicWords({
  title: 'The Iran Ceasefire Market — What $22M in Polymarket Volume Is Telling Traders Right Now',
  slug: 'polymarket-iran-ceasefire-prediction-market-2026',
});
const bitcoin = postTopicWords({
  title: 'Polymarket Bitcoin $150K June 2026 Prediction Market',
  slug: 'polymarket-bitcoin-150k-june-2026-prediction-market',
});
const overlapIB = overlapCount(iran, bitcoin);
assert(overlapIB < 2, `iran vs bitcoin should NOT overlap at 2+ (got ${overlapIB})`);

// --- Real-world test: the May 2026 "tracker" cluster ---

const allPosts = getAllPosts(365);
console.log(`Loaded ${allPosts.length} posts.`);
assert(allPosts.length > 0, 'should load posts from filesystem');

// Use posts published since 2026-04-15 as our "recent" pool for this test.
const recent = allPosts.filter(p =>
  p.publishedDate && new Date(p.publishedDate) >= new Date('2026-04-15')
);
console.log(`Considering ${recent.length} posts from 2026-04-15 onwards as "recent" for this test.`);
assert(recent.length >= 5, 'should have multiple recent posts to test against');

// Simulate proposing a 7th "tracker" post — should be rejected.
const proposed = postTopicWords({
  title: 'Polymarket Tracker Tools: Smart Money Monitoring for Active Traders',
  slug: 'polymarket-tracker-tools-active-trader-monitoring',
});
const conflict = findOverlappingRecentPost(proposed, recent, 2);
assert(conflict !== null, `proposed tracker post should be flagged as duplicate`);
if (conflict) {
  console.log(`     -> flagged against /${conflict.slug}/, shared topic words: ${[...proposed].filter(w => conflict.topicWords.has(w)).join(', ')}`);
}

// Simulate proposing a genuinely new topic — should pass.
const newTopic = postTopicWords({
  title: 'How to Read Order Book Depth on Polymarket for an Entry Edge',
  slug: 'polymarket-order-book-depth-entry-edge',
});
const newConflict = findOverlappingRecentPost(newTopic, recent, 2);
if (newConflict) {
  console.log(`     order-book topic conflicted with /${newConflict.slug}/, shared: ${[...newTopic].filter(w => newConflict.topicWords.has(w)).join(', ')}`);
}
assert(newConflict === null, `order book depth post should be SAFE`);

// Simulate proposing the igetlitty spotlight — should pass with a sufficiently
// distinct title. Note: titles using common content words like "top trader"
// will (correctly) collide with existing posts on those words; in production
// the agent retries and Claude picks fresher framing.
const igetlitty = postTopicWords({
  title: 'igetlitty: The Polymarket Wallet That Called Iran Before the News',
  slug: 'igetlitty-polymarket-wallet-iran-call',
});
const igetlittyConflict = findOverlappingRecentPost(igetlitty, recent, 2);
if (igetlittyConflict) {
  console.log(`     igetlitty topic conflicted with /${igetlittyConflict.slug}/, shared: ${[...igetlitty].filter(w => igetlittyConflict.topicWords.has(w)).join(', ')}`);
}
assert(igetlittyConflict === null, `igetlitty wallet spotlight (distinct framing) should be SAFE`);

console.log('\nAll duplicate-detection tests passed.');
