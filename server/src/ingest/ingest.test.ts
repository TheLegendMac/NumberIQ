import { describe, it, expect } from 'vitest';
import { getGame, validateDraw, matrixForDate, type RawDraw } from '@numberiq/shared';
import { parseLotteryDate, clusterIntoLines, splitIntoColumns, DATE_RE } from './pdf-layout.js';
import { applyGrammar } from './grammars.js';
import { validateBatch } from './pipeline.js';

const draw = (over: Partial<RawDraw> = {}): RawDraw => ({
  gameId: 'fantasy5', drawDate: '2024-05-01', drawSlot: 'evening',
  numbers: [1, 2, 3, 4, 5], extras: {}, source: 'test', ...over,
});

describe('date parsing', () => {
  it('handles both two- and four-digit years', () => {
    expect(parseLotteryDate('07/19/26')).toBe('2026-07-19');
    expect(parseLotteryDate('7/19/2026')).toBe('2026-07-19');
    expect(parseLotteryDate('1/5/99')).toBe('1999-01-05');
  });

  it('pivots two-digit years on the Lottery\'s 1988 launch', () => {
    expect(parseLotteryDate('01/01/88')).toBe('1988-01-01');
    expect(parseLotteryDate('01/01/87')).toBe('2087-01-01'); // out of range; caught by validation
  });

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(parseLotteryDate('02/30/24')).toBeNull();
    expect(parseLotteryDate('13/01/24')).toBeNull();
    expect(parseLotteryDate('not a date')).toBeNull();
  });
});

describe('layout engine', () => {
  it('clusters tokens with sub-point y jitter into one line', () => {
    // Real PDFs render a record's tokens across ~1pt of baseline drift.
    const items = [
      { x: 14, y: 679.3, s: '07/19/26' },
      { x: 57, y: 679.2, s: 'E' },
      { x: 70, y: 679.3, s: '0' },
      { x: 117, y: 678.6, s: 'FB' },
      { x: 131, y: 679.0, s: '4' },
      { x: 14, y: 667.0, s: '07/18/26' },
    ];
    const lines = clusterIntoLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(5);
    expect(lines[0]!.map((i) => i.s)).toEqual(['07/19/26', 'E', '0', 'FB', '4']);
  });

  it('splits a multi-column line into one run per record', () => {
    const line = [
      { x: 14, y: 1, s: '07/19/26' }, { x: 70, y: 1, s: '0' }, { x: 86, y: 1, s: '9' },
      { x: 197, y: 1, s: '06/23/26' }, { x: 253, y: 1, s: '3' }, { x: 269, y: 1, s: '3' },
    ];
    const runs = splitIntoColumns(line);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(['07/19/26', '0', '9']);
    expect(runs[1]).toEqual(['06/23/26', '3', '3']);
  });

  it('drops header tokens that appear before the first date', () => {
    const line = [
      { x: 5, y: 1, s: 'Draw Date' }, { x: 14, y: 1, s: '07/19/26' }, { x: 70, y: 1, s: '4' },
    ];
    expect(splitIntoColumns(line)).toEqual([['07/19/26', '4']]);
  });

  it('DATE_RE matches only date-shaped tokens', () => {
    expect(DATE_RE.test('7/4/26')).toBe(true);
    expect(DATE_RE.test('123')).toBe(false);
    expect(DATE_RE.test('PB 3')).toBe(false);
  });
});

describe('game grammars', () => {
  it('parses a Pick 3 record with draw type and Fireball', () => {
    const { draws, failures } = applyGrammar('pick3', [['07/19/26', 'M', '9', '8', '5', 'FB', '0']], 'test');
    expect(failures).toHaveLength(0);
    expect(draws[0]).toMatchObject({
      drawDate: '2026-07-19', drawSlot: 'midday', numbers: [9, 8, 5], extras: { fireball: 0 },
    });
  });

  it('parses a Pick record with no Fireball label (older draws)', () => {
    const { draws } = applyGrammar('pick3', [['07/19/26', 'E', '1', '2', '3']], 'test');
    expect(draws[0]).toMatchObject({ numbers: [1, 2, 3], drawSlot: 'evening' });
    expect(draws[0]!.extras.fireball).toBeUndefined();
  });

  it('defaults to the evening draw when no slot marker is present', () => {
    const { draws } = applyGrammar('pick3', [['07/19/26', '1', '2', '3']], 'test');
    expect(draws[0]!.drawSlot).toBe('evening');
  });

  it('expands one Cash Pop line into five separate draws', () => {
    const { draws } = applyGrammar('cashpop', [['7/19/2026', '2', '9', '4', '12', '3']], 'test');
    expect(draws).toHaveLength(5);
    expect(draws.map((d) => d.drawSlot)).toEqual(['morning', 'matinee', 'afternoon', 'evening', 'late_night']);
    expect(draws.map((d) => d.numbers[0])).toEqual([2, 9, 4, 12, 3]);
  });

  it('handles a partial Cash Pop day (later draws not yet held)', () => {
    const { draws, failures } = applyGrammar('cashpop', [['7/19/2026', '2', '9']], 'test');
    expect(failures).toHaveLength(0);
    expect(draws).toHaveLength(2);
  });

  it('parses Powerball with an inline "PB n" token and a multiplier', () => {
    const { draws } = applyGrammar('powerball', [['7/18/26', '9', '14', '44', '50', '56', 'PB 3', 'X4', 'POWERBALL']], 'test');
    expect(draws[0]).toMatchObject({
      numbers: [9, 14, 44, 50, 56], extras: { powerball: 3 }, drawSlot: 'main',
    });
  });

  it('routes Powerball Double Play to its own slot', () => {
    const { draws } = applyGrammar('powerball', [['7/18/26', '5', '11', '25', '26', '64', 'PB 11', 'POWERBALL DP']], 'test');
    expect(draws[0]!.drawSlot).toBe('double_play');
  });

  it('parses a split "MB","n" extra-ball token pair', () => {
    const { draws } = applyGrammar('megamillions', [['07/17/26', '22', '34', '45', '48', '55', 'MB', '14']], 'test');
    expect(draws[0]).toMatchObject({ numbers: [22, 34, 45, 48, 55], extras: { megaBall: 14 } });
  });

  it('parses Fantasy 5 with a draw-type word', () => {
    const { draws } = applyGrammar('fantasy5', [['7/19/26', 'MIDDAY', '18', '21', '24', '32', '34']], 'test');
    expect(draws[0]).toMatchObject({ drawSlot: 'midday', numbers: [18, 21, 24, 32, 34] });
  });

  it('reports a failure rather than guessing when a record is malformed', () => {
    const { draws, failures } = applyGrammar('fantasy5', [['7/19/26', '18', '21']], 'test');
    expect(draws).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toMatch(/expected 5 numbers/);
  });

  it('reports missing extra balls rather than defaulting them', () => {
    const { draws, failures } = applyGrammar('powerball', [['7/18/26', '9', '14', '44', '50', '56']], 'test');
    expect(draws).toHaveLength(0);
    expect(failures[0]!.reason).toMatch(/missing extra ball/);
  });
});

describe('validation', () => {
  it('accepts a well-formed draw', () => {
    expect(validateDraw(getGame('fantasy5'), draw())).toHaveLength(0);
  });

  it('rejects out-of-range numbers', () => {
    const issues = validateDraw(getGame('fantasy5'), draw({ numbers: [1, 2, 3, 4, 99] }));
    expect(issues.some((i) => i.code === 'out_of_range')).toBe(true);
  });

  it('rejects duplicates in combination games but allows them in digit games', () => {
    expect(
      validateDraw(getGame('fantasy5'), draw({ numbers: [1, 1, 3, 4, 5] }))
        .some((i) => i.code === 'duplicate_numbers'),
    ).toBe(true);

    const pick3Draw = draw({ gameId: 'pick3', numbers: [7, 7, 7], drawSlot: 'evening' });
    expect(validateDraw(getGame('pick3'), pick3Draw)).toHaveLength(0);
  });

  it('rejects future and pre-1988 dates', () => {
    expect(
      validateDraw(getGame('fantasy5'), draw({ drawDate: '2099-01-01' }))
        .some((i) => i.code === 'future_date'),
    ).toBe(true);
    expect(
      validateDraw(getGame('fantasy5'), draw({ drawDate: '1970-01-01' }))
        .some((i) => i.code === 'implausible_date'),
    ).toBe(true);
  });

  it('rejects unknown draw slots', () => {
    expect(
      validateDraw(getGame('fantasy5'), draw({ drawSlot: 'brunch' }))
        .some((i) => i.code === 'unknown_slot'),
    ).toBe(true);
  });

  /**
   * The regression that motivated matrix eras: Mega Ball 25 is valid before the
   * April 2025 revamp and invalid after it. Validating old draws against today's
   * matrix would reject genuine official data.
   */
  it('validates each draw against the matrix in effect on its own date', () => {
    const mm = getGame('megamillions');
    const old = draw({ gameId: 'megamillions', drawDate: '2024-10-01', numbers: [27, 35, 47, 50, 66], extras: { megaBall: 25 }, drawSlot: 'main' });
    const now = draw({ gameId: 'megamillions', drawDate: '2026-01-05', numbers: [27, 35, 47, 50, 66], extras: { megaBall: 25 }, drawSlot: 'main' });

    expect(validateDraw(mm, old), 'MB 25 was valid in 2024').toHaveLength(0);
    expect(validateDraw(mm, now).some((i) => i.code === 'extra_out_of_range'), 'MB 25 invalid in 2026').toBe(true);
  });

  it('resolves historical matrices correctly', () => {
    const mm = getGame('megamillions');
    expect(matrixForDate(mm, '2015-01-01').max).toBe(75);
    expect(matrixForDate(mm, '2020-01-01').extraMax).toBe(25);
    expect(matrixForDate(mm, '2026-01-01').extraMax).toBe(24);

    const pb = getGame('powerball');
    expect(matrixForDate(pb, '2014-01-01').max).toBe(59);
    expect(matrixForDate(pb, '2020-01-01').max).toBe(69);
  });
});

describe('batch validation', () => {
  it('collapses in-batch duplicates and keeps the rest', () => {
    const { valid, rejected } = validateBatch('fantasy5', [
      draw({ drawDate: '2024-05-01' }),
      draw({ drawDate: '2024-05-01' }),
      draw({ drawDate: '2024-05-02' }),
    ]);
    expect(valid).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it('separates invalid records with a readable reason', () => {
    const { valid, rejected, issues } = validateBatch('fantasy5', [
      draw(),
      draw({ drawDate: '2024-05-02', numbers: [1, 2, 3, 4, 99] }),
    ]);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(issues[0]).toMatch(/outside 1-36/);
  });
});
