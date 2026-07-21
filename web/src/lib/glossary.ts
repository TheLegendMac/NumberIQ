/**
 * Plain-language definitions for every technical term the UI shows.
 *
 * The rule this file exists to serve: NumberIQ never removes a statistic to make
 * itself readable. Instead every piece of jargon carries its own explanation, so
 * the full depth stays on screen and stops requiring a statistics background.
 */
export interface GlossaryEntry {
  term: string;
  plain: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  pValue: {
    term: 'p-value',
    plain:
      'How easily plain luck explains what we saw. Big (above 0.05) means "nothing unusual here". Small means the result would be a surprise if everything were fair.',
  },
  zScore: {
    term: 'z-score',
    plain:
      'How far a number sits from what was expected, measured in standard steps. Roughly: under 2 is ordinary, over 3 is genuinely unusual. In any fair game some numbers land at 2 purely by chance.',
  },
  chiSquare: {
    term: 'chi-square test',
    plain:
      'Compares how often every number actually appeared against how often it should have if the machine were fair. It answers one question: is the spread bigger than luck alone would produce?',
  },
  serialCorrelation: {
    term: 'serial independence',
    plain:
      'Checks whether one draw influences the next. In a fair game it never does — this test confirms there is no link between consecutive drawings.',
  },
  runsTest: {
    term: 'runs test',
    plain:
      'Looks for streaks. If high totals clumped together, or alternated too neatly, this would catch it. Fair draws produce a predictable amount of streakiness, and this checks we have exactly that much.',
  },
  repeatRate: {
    term: 'repeat rate',
    plain:
      'How often a number from the last drawing shows up again in the next one. Chance says this happens a specific amount; the test checks reality matches.',
  },
  pariMutuel: {
    term: 'pari-mutuel',
    plain:
      'The prize pot is shared among everyone who wins that tier. Fewer co-winners means a bigger cheque for you — which is why avoiding popular number patterns actually matters here.',
  },
  fixedPayout: {
    term: 'fixed payout',
    plain:
      'The prize is a posted amount, paid in full to every winner. It is never divided. That is why no choice of numbers can improve your return in these games.',
  },
  splitJackpot: {
    term: 'split jackpot',
    plain:
      'Smaller prizes are fixed amounts, but the jackpot is divided among everyone who hits it. Avoiding common combinations only affects that top tier.',
  },
  expectedValue: {
    term: 'expected value',
    plain:
      'What an average ticket returns over the very long run. Every lottery game returns less than it costs — that gap is how the lottery funds itself.',
  },
  roi: {
    term: 'ROI',
    plain:
      'Return on what you spent. −50% means for every $1 spent you got 50¢ back. Negative is the normal and expected outcome.',
  },
  overdue: {
    term: 'overdue',
    plain:
      'A number that has not appeared for a long time. It is NOT "due" — the machine has no memory, so its chance next drawing is exactly the same as every other number.',
  },
  strategyScore: {
    term: 'Strategy Score',
    plain:
      'How well a ticket is built: spread across the range, not an obvious pattern, and (in shared-prize games) unlikely to be picked by lots of other people. It is not a chance of winning — every combination has identical odds.',
  },
  popularity: {
    term: 'popularity',
    plain:
      'An estimate of how many other players likely picked these same numbers, based on known habits — birthdays, lucky 7, straight lines on the playslip. It changes what you would collect, never whether you win.',
  },
  nullDistribution: {
    term: 'random baseline',
    plain:
      'We simulate hundreds of runs of pure random picking over the same drawings. That spread is what luck alone looks like. A strategy only means anything if it lands outside it.',
  },
  drawSlot: {
    term: 'drawing',
    plain:
      'Some games draw more than once a day (Midday and Evening). Each is analysed separately, because they are independent drawings.',
  },
  coverage: {
    term: 'coverage',
    plain:
      'How much of the number pool your batch of tickets touches. Spreading out raises the chance of catching at least one small prize.',
  },
  overlap: {
    term: 'overlap',
    plain:
      'How many numbers your tickets share with each other. Lower overlap means your tickets are not competing for the same outcome.',
  },
  matrixEra: {
    term: 'matrix change',
    plain:
      'Games sometimes change how many balls are in play. Mixing those periods would make newer numbers look falsely "cold", so older drawings are excluded from these figures.',
  },
};

/** Reads a p-value in plain English. */
export function readPValue(p: number): { plain: string; tone: 'pos' | 'warn' } {
  if (p >= 0.5) return { plain: 'Completely ordinary — exactly what fair draws look like', tone: 'pos' };
  if (p >= 0.05) return { plain: 'Nothing unusual — well within normal variation', tone: 'pos' };
  if (p >= 0.01) return { plain: 'Slightly unusual, but not enough to mean anything', tone: 'warn' };
  return { plain: 'Unusual enough to be worth a closer look', tone: 'warn' };
}

/**
 * Reads a z-score in plain English.
 *
 * The sign matters and must be preserved: a z of −2.4 means the number came up
 * LESS often than expected. Collapsing to a magnitude makes the interface state
 * the opposite of the truth.
 */
export function readZ(z: number): string {
  const a = Math.abs(z);
  const dir = z >= 0 ? 'above' : 'below';
  if (a < 1) return 'right about where expected';
  if (a < 2) return `slightly ${dir} expectation, which is normal`;
  if (a < 3) return `noticeably ${dir} expectation — still well within chance`;
  return `well ${dir} expectation`;
}
