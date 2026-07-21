import { describe, it, expect } from 'vitest';
import { GAMES, GAME_LIST, expectedValuePerTicket, strategiesForGame, hasSharedPrizes } from './games.js';
import { choose, totalCombinations, waysToMatch } from './math.js';

/**
 * These tests recompute every published odds figure from the game matrix. If the
 * Florida Lottery's published overall odds and our independently-derived odds agree,
 * the registry is internally consistent and the matrices are right.
 */
describe('game matrices reproduce published odds', () => {
  it('Powerball: 5/69 + 1/26', () => {
    expect(totalCombinations(69, 5, 26)).toBe(292_201_338);
  });

  it('Mega Millions: 5/70 + 1/24', () => {
    expect(totalCombinations(70, 5, 24)).toBe(290_472_336);
  });

  it('Fantasy 5: 5/36', () => {
    expect(choose(36, 5)).toBe(376_992);
  });

  it('Florida Lotto: 6/53', () => {
    expect(choose(53, 6)).toBe(22_957_480);
  });

  it('Jackpot Triple Play: 6/46', () => {
    expect(choose(46, 6)).toBe(9_366_819);
  });

  it('Cash4Life: 5/60 + 1/4', () => {
    expect(totalCombinations(60, 5, 4)).toBe(21_846_048);
  });

  /**
   * The strongest check available: derive overall odds for the extra-ball games
   * from scratch and compare with the figure the Lottery publishes.
   */
  it.each([
    ['powerball', 69, 5, 26, 24.87],
    ['megamillions', 70, 5, 24, 23.07],
  ] as const)('%s overall odds match published', (id, pool, pick, extraPool, published) => {
    const total = totalCombinations(pool, pick, extraPool);
    const game = GAMES[id];
    let winning = 0;
    for (const tier of game.prizeTiers) {
      const ways = waysToMatch(pool, pick, tier.match);
      winning += tier.extra ? ways : ways * (extraPool - 1);
    }
    const overall = total / winning;
    expect(overall).toBeCloseTo(published, 1);
  });

  it('every declared tier oneIn matches the matrix', () => {
    for (const id of ['powerball', 'megamillions', 'cash4life'] as const) {
      const g = GAMES[id];
      const pool = g.max - g.min + 1;
      const extraPool = g.extraBall ? g.extraBall.max - g.extraBall.min + 1 : 1;
      const total = totalCombinations(pool, g.pick, extraPool);
      for (const tier of g.prizeTiers) {
        const ways = waysToMatch(pool, g.pick, tier.match);
        const count = tier.extra ? ways : ways * (extraPool - 1);
        expect(total / count, `${id} ${tier.label}`).toBeCloseTo(tier.oneIn, 0);
      }
    }
  });

  it('combination-game tiers without an extra ball match the matrix', () => {
    for (const id of ['fantasy5', 'lotto', 'jackpot_triple_play'] as const) {
      const g = GAMES[id];
      const pool = g.max - g.min + 1;
      const total = choose(pool, g.pick);
      for (const tier of g.prizeTiers) {
        const ways = waysToMatch(pool, g.pick, tier.match);
        expect(total / ways, `${id} ${tier.label}`).toBeCloseTo(tier.oneIn, 0);
      }
    }
  });
});

describe('honesty invariants', () => {
  it('fixed-payout games never offer shared-prize strategies', () => {
    for (const g of GAME_LIST) {
      if (g.payoutModel !== 'fixed') continue;
      const offered = strategiesForGame(g);
      expect(offered.some((s) => s.requiresSharedPrizes), g.name).toBe(false);
    }
  });

  it('Pick games and Cash Pop are classified fixed-payout', () => {
    for (const id of ['pick2', 'pick3', 'pick4', 'pick5', 'cashpop'] as const) {
      expect(hasSharedPrizes(GAMES[id]), id).toBe(false);
    }
  });

  it('shared-prize games are classified as such', () => {
    for (const id of ['fantasy5', 'lotto', 'jackpot_triple_play', 'powerball', 'megamillions'] as const) {
      expect(hasSharedPrizes(GAMES[id]), id).toBe(true);
    }
  });

  it('Pick games have exactly 50% return on straight play', () => {
    for (const id of ['pick2', 'pick3', 'pick4', 'pick5'] as const) {
      const ev = expectedValuePerTicket(GAMES[id]);
      expect(ev).not.toBeNull();
      expect(ev! / GAMES[id].basePrice).toBeCloseTo(0.5, 6);
    }
  });

  it('declines to state an EV when jackpot tiers are pari-mutuel', () => {
    for (const id of ['fantasy5', 'lotto', 'powerball', 'megamillions'] as const) {
      expect(expectedValuePerTicket(GAMES[id]), id).toBeNull();
    }
  });

  it('every game has a source file and at least one prize tier', () => {
    for (const g of GAME_LIST) {
      expect(g.sourceFile, g.name).toBeTruthy();
      expect(g.prizeTiers.length, g.name).toBeGreaterThan(0);
      expect(g.slots.length, g.name).toBeGreaterThan(0);
    }
  });

  it('every cosmetic strategy carries a disclosure that it does not change odds', () => {
    const cosmetic = strategiesForGame(GAMES.fantasy5).filter((s) => s.class === 'cosmetic');
    expect(cosmetic.length).toBeGreaterThan(0);
    for (const s of cosmetic) {
      expect(s.disclosure.toLowerCase(), s.id).toMatch(/does not change|fallacy/);
    }
  });
});
