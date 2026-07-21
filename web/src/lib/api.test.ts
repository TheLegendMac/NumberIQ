import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDraws, invalidateDraws } from './api.js';

describe('drawing history cache', () => {
  beforeEach(() => {
    invalidateDraws();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));
  });

  afterEach(() => {
    invalidateDraws();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reuses a request briefly, then refreshes history after five minutes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ slot: 'main', draws: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }));

    await fetchDraws('powerball', 'main');
    await fetchDraws('powerball', 'main');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    await fetchDraws('powerball', 'main');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
