/**
 * Per-game token grammars.
 *
 * Each grammar receives one record's x-ordered token run (from pdf-layout) and
 * returns zero or more raw draws. Grammars are deliberately tolerant of the
 * historical variation in these files — early Pick draws predate both the Midday
 * drawing and Fireball, and early Fantasy 5 draws predate the Midday draw — but
 * they never *guess* a number. If a run does not fit the grammar it is rejected
 * with a reason, so a format change surfaces as a loud failure rather than silent
 * data corruption.
 */

import type { GameId } from '@numberiq/shared';
import type { RawDraw } from '@numberiq/shared';
import { parseLotteryDate } from './pdf-layout.js';

export interface ParseFailure {
  tokens: string[];
  reason: string;
}

export interface GrammarResult {
  draws: RawDraw[];
  failures: ParseFailure[];
}

type Grammar = (tokens: string[], source: string) => RawDraw[] | string;

const isInt = (t: string) => /^\d+$/.test(t);
const isMultiplier = (t: string) => /^[Xx]\d+$/.test(t);

/** Extract a labelled extra ball, tolerating both `PB 3` and separate `PB`,`3` tokens. */
function takeLabelledExtra(
  tokens: string[],
  labelRe: RegExp,
): { value: number | null; rest: string[] } {
  const rest: string[] = [];
  let value: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const inline = labelRe.exec(t);
    if (inline) {
      if (inline[1]) {
        value = Number(inline[1]);          // "PB 3"
      } else {
        const next = tokens[i + 1];         // "PB", "3"
        if (next && isInt(next)) {
          value = Number(next);
          i++;
        }
      }
      continue;
    }
    rest.push(t);
  }
  return { value, rest };
}

/** Pick 2-5: `date [E|M] d d d [FB] f` */
function pickGrammar(gameId: GameId, digits: number): Grammar {
  return (tokens, source) => {
    const drawDate = parseLotteryDate(tokens[0]!);
    if (!drawDate) return 'unparseable date';

    let slot = 'evening';
    let fireball: number | null = null;
    const body: string[] = [];
    let fbIndex = -1;

    for (const t of tokens.slice(1)) {
      if (t === 'E') { slot = 'evening'; continue; }
      if (t === 'M') { slot = 'midday'; continue; }
      if (t === 'FB') { fbIndex = body.length; continue; }
      if (isInt(t)) body.push(t);
    }

    let numberTokens = body;
    if (fbIndex >= 0 && fbIndex < body.length) {
      // Fireball is the digit rendered after the FB label.
      fireball = Number(body[fbIndex]);
      numberTokens = [...body.slice(0, fbIndex), ...body.slice(fbIndex + 1)];
    } else if (body.length === digits + 1) {
      // Older rows omit the FB label but still carry the value last.
      fireball = Number(body[body.length - 1]);
      numberTokens = body.slice(0, digits);
    }

    if (numberTokens.length !== digits) {
      return `expected ${digits} digits, found ${numberTokens.length}`;
    }
    // Each Pick position is a single digit; a multi-digit token means a misparse.
    const numbers: number[] = [];
    for (const t of numberTokens) {
      if (t.length !== 1) return `non-digit token "${t}"`;
      numbers.push(Number(t));
    }

    const extras: Record<string, number> = {};
    if (fireball !== null && fireball >= 0 && fireball <= 9) extras.fireball = fireball;

    return [{ gameId, drawDate, drawSlot: slot, numbers, extras, source }];
  };
}

/** Fantasy 5: `date [EVENING|MIDDAY] n n n n n` */
const fantasy5Grammar: Grammar = (tokens, source) => {
  const drawDate = parseLotteryDate(tokens[0]!);
  if (!drawDate) return 'unparseable date';

  let slot = 'evening';
  const numbers: number[] = [];
  for (const t of tokens.slice(1)) {
    const u = t.toUpperCase();
    if (u === 'MIDDAY') { slot = 'midday'; continue; }
    if (u === 'EVENING') { slot = 'evening'; continue; }
    if (isInt(t)) numbers.push(Number(t));
  }
  if (numbers.length !== 5) return `expected 5 numbers, found ${numbers.length}`;
  return [{ gameId: 'fantasy5', drawDate, drawSlot: slot, numbers, extras: {}, source }];
};

/**
 * Cash Pop: one line carries all five daily draws.
 * `date morning matinee afternoon evening lateNight`
 */
const CASHPOP_SLOTS = ['morning', 'matinee', 'afternoon', 'evening', 'late_night'];
const cashPopGrammar: Grammar = (tokens, source) => {
  const drawDate = parseLotteryDate(tokens[0]!);
  if (!drawDate) return 'unparseable date';

  const values = tokens.slice(1).filter(isInt).map(Number);
  if (values.length === 0) return 'no draw values';
  // Trailing slots may be absent on the most recent day (draws not yet held).
  if (values.length > CASHPOP_SLOTS.length) {
    return `expected at most ${CASHPOP_SLOTS.length} values, found ${values.length}`;
  }
  return values.map((n, i) => ({
    gameId: 'cashpop' as GameId,
    drawDate,
    drawSlot: CASHPOP_SLOTS[i]!,
    numbers: [n],
    extras: {},
    source,
  }));
};

/** Combination games with a labelled extra ball (Cash4Life, Mega Millions, Powerball). */
function extraBallGrammar(
  gameId: GameId,
  pick: number,
  extraKey: string,
  labelRe: RegExp,
): Grammar {
  return (tokens, source) => {
    const drawDate = parseLotteryDate(tokens[0]!);
    if (!drawDate) return 'unparseable date';

    const body = tokens.slice(1).filter((t) => !isMultiplier(t));
    // Draw-type label decides the slot for games with a Double Play variant.
    const slot = body.some((t) => /\bDP\b|DOUBLE/i.test(t)) ? 'double_play' : 'main';

    const { value: extra, rest } = takeLabelledExtra(body, labelRe);
    const numbers = rest.filter(isInt).map(Number);

    if (numbers.length !== pick) return `expected ${pick} numbers, found ${numbers.length}`;
    if (extra === null) return 'missing extra ball';

    return [{
      gameId,
      drawDate,
      drawSlot: slot,
      numbers,
      extras: { [extraKey]: extra },
      source,
    }];
  };
}

/** Plain combination games with no extra ball (Lotto, Jackpot Triple Play). */
function plainCombinationGrammar(gameId: GameId, pick: number, hasDoublePlay: boolean): Grammar {
  return (tokens, source) => {
    const drawDate = parseLotteryDate(tokens[0]!);
    if (!drawDate) return 'unparseable date';

    const body = tokens.slice(1).filter((t) => !isMultiplier(t));
    const slot = hasDoublePlay && body.some((t) => /\bDP\b|DOUBLE/i.test(t)) ? 'double_play' : 'main';
    const numbers = body.filter(isInt).map(Number);

    if (numbers.length !== pick) return `expected ${pick} numbers, found ${numbers.length}`;
    return [{ gameId, drawDate, drawSlot: slot, numbers, extras: {}, source }];
  };
}

export const GRAMMARS: Record<GameId, Grammar> = {
  pick2: pickGrammar('pick2', 2),
  pick3: pickGrammar('pick3', 3),
  pick4: pickGrammar('pick4', 4),
  pick5: pickGrammar('pick5', 5),
  fantasy5: fantasy5Grammar,
  cashpop: cashPopGrammar,
  cash4life: extraBallGrammar('cash4life', 5, 'cashBall', /^CB\s*(\d+)?$/i),
  megamillions: extraBallGrammar('megamillions', 5, 'megaBall', /^MB\s*(\d+)?$/i),
  powerball: extraBallGrammar('powerball', 5, 'powerball', /^PB\s*(\d+)?$/i),
  lotto: plainCombinationGrammar('lotto', 6, true),
  jackpot_triple_play: plainCombinationGrammar('jackpot_triple_play', 6, false),
};

/** Run a game's grammar across every extracted record run. */
export function applyGrammar(gameId: GameId, records: string[][], source: string): GrammarResult {
  const grammar = GRAMMARS[gameId];
  const draws: RawDraw[] = [];
  const failures: ParseFailure[] = [];

  for (const tokens of records) {
    const result = grammar(tokens, source);
    if (typeof result === 'string') {
      failures.push({ tokens, reason: result });
    } else {
      draws.push(...result);
    }
  }
  return { draws, failures };
}
