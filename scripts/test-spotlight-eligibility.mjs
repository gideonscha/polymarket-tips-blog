#!/usr/bin/env node
/**
 * Tests for the trader-spotlight eligibility filter and selection logic.
 * Runs against BOTH synthetic fixtures (deterministic, offline) and the
 * LIVE leaderboard (to prove the real ineligible names are rejected).
 *
 * Run: node scripts/test-spotlight-eligibility.mjs
 */

import {
  isWalletLikeName,
  isBrandSafeName,
  hasMeaningfulStats,
  isEligibleTrader,
  slugifyName,
  spotlightSlug,
  traderAlreadySpotlighted,
  selectSpotlightTrader,
  fetchLeaderboard,
} from './daily-blog-agent.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
  else console.log('OK:  ', msg);
}

// ---- Criterion 1: wallet-like / null names ----
assert(isWalletLikeName(null), 'null name is wallet-like (rejected)');
assert(isWalletLikeName('0x903221b1'), '0x-prefixed name rejected');
assert(isWalletLikeName('0x3DFb153c197D4C19D3B31c1ecD2c7B6860eeabAf-1722957908185'), 'wallet+timestamp rejected');
assert(isWalletLikeName('0xa0f21e6d351baa9185716b5c00c2925ed9621848'), '40-hex address rejected');
assert(!isWalletLikeName('mooseborzoi'), 'normal name not wallet-like');
assert(!isWalletLikeName('LaBradfordSmith22'), 'alphanumeric name not wallet-like');
// Purely-numeric / numeric-ID handles must be rejected (structurally unclickable).
assert(isWalletLikeName('123987456'), 'all-numeric handle rejected');
assert(isWalletLikeName('248188374'), 'numeric-ID handle rejected');
assert(isWalletLikeName('a1234567'), 'short-letters + long digit run rejected');
assert(!isWalletLikeName('trader88'), 'normal name with a couple digits is fine');

// ---- Criterion 2: brand safety (the names the user flagged) ----
assert(!isBrandSafeName('JewishNinja'), 'JewishNinja rejected (religion/ethnicity)');
assert(!isBrandSafeName('Mentallyillgambld'), 'Mentallyillgambld rejected (mental illness)');
assert(!isBrandSafeName('IlikeVagina'), 'IlikeVagina rejected (explicit)');
assert(!isBrandSafeName('Latina'), 'Latina rejected (ethnicity identity label)');
assert(isBrandSafeName('mooseborzoi'), 'mooseborzoi is brand-safe');
assert(isBrandSafeName('ohuhusos'), 'ohuhusos is brand-safe');
assert(isBrandSafeName('JPMorgan101'), 'JPMorgan101 is brand-safe');

// ---- Criterion 3: meaningful stats ----
assert(hasMeaningfulStats({ pnl: 100, winRate: 35, marketsTraded: 95, volume: 7000 }), 'full stats pass');
assert(!hasMeaningfulStats({ pnl: 100, winRate: 0, marketsTraded: 95, volume: 7000 }), 'zero win rate fails');
assert(!hasMeaningfulStats({ pnl: 100, winRate: 35, marketsTraded: 0, volume: 7000 }), 'zero markets fails');
assert(!hasMeaningfulStats({ pnl: 100, winRate: 35, marketsTraded: 95, volume: 0 }), 'zero volume fails');
assert(!hasMeaningfulStats({ pnl: 0, winRate: 35, marketsTraded: 95, volume: 7000 }), 'zero pnl fails');

// ---- slug helpers ----
assert(spotlightSlug('mooseborzoi') === 'mooseborzoi-polymarket-trader-profile-strategy', 'spotlight slug pattern');
assert(slugifyName('DimSumConnoisseur.') === 'dimsumconnoisseur', 'slugify strips punctuation');
assert(
  traderAlreadySpotlighted('gravia_001', ['gravia-001-polymarket-trader-strategy-analysis']),
  'existing gravia spotlight detected (older pattern)',
);
assert(
  !traderAlreadySpotlighted('mooseborzoi', ['gravia-001-polymarket-trader-strategy-analysis']),
  'un-spotlighted trader not flagged',
);

// ---- Selection against a synthetic leaderboard ----
const fixture = [
  { rank: 1, displayName: 'mooseborzoi', pnl: 1090340, winRate: 35, marketsTraded: 95, volume: 708557, archetypeTags: ['High Volume'] },
  { rank: 2, displayName: 'JewishNinja', pnl: 960244, winRate: 0, marketsTraded: 0, volume: 92581, archetypeTags: [] },
  { rank: 3, displayName: null, pnl: 704313, winRate: 50, marketsTraded: 47, volume: 843266, archetypeTags: [] },
  { rank: 4, displayName: 'IlikeVagina', pnl: 315572, winRate: 0, marketsTraded: 0, volume: 50000, archetypeTags: [] },
];
const pick = selectSpotlightTrader(fixture, []);
assert(pick && pick.displayName === 'mooseborzoi', `selects mooseborzoi from fixture (got ${pick?.displayName})`);

// Once mooseborzoi is already spotlighted, fixture has no other eligible -> null
const pick2 = selectSpotlightTrader(fixture, ['mooseborzoi-polymarket-trader-profile-strategy']);
assert(pick2 === null, `no eligible trader left after mooseborzoi spotlighted (got ${pick2?.displayName})`);

// ---- LIVE leaderboard ----
console.log('\n--- Live leaderboard check ---');
try {
  const traders = await fetchLeaderboard();
  assert(traders.length > 0, `fetched live leaderboard (${traders.length} traders)`);

  // Every flagged name present in the live data must be rejected.
  const mustReject = ['JewishNinja', 'Mentallyillgambld', 'IlikeVagina', 'Latina'];
  for (const name of mustReject) {
    const t = traders.find(x => x.displayName === name);
    if (t) assert(!isEligibleTrader(t), `live: "${name}" is rejected`);
    else console.log(`note: "${name}" not in current top 50 (skipping)`);
  }

  // No wallet-like display name may be eligible.
  const walletEligible = traders.filter(t => isEligibleTrader(t) && isWalletLikeName(t.displayName));
  assert(walletEligible.length === 0, 'no wallet-like name is eligible');

  // The selected trader must itself be eligible.
  const chosen = selectSpotlightTrader(traders, []);
  assert(chosen && isEligibleTrader(chosen), `selected trader is eligible: ${chosen?.displayName} (#${chosen?.rank})`);
  console.log(`\nLive selection -> #${chosen.rank} ${chosen.displayName} | pnl ${chosen.pnl} | wr ${chosen.winRate} | mkts ${chosen.marketsTraded} | vol ${chosen.volume}`);
  console.log(`Spotlight slug -> ${spotlightSlug(chosen.displayName)}`);
} catch (e) {
  console.error('Live leaderboard test error:', e.message);
  failures++;
}

console.log(failures === 0 ? '\nAll spotlight eligibility tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
