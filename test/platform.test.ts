import { describe, expect, it } from 'vitest';

import { calculatePollDelaySeconds } from '../src/platform';

describe('calculatePollDelaySeconds', () => {
  it('polls running cycles quickly and idle appliances conservatively', () => {
    expect(calculatePollDelaySeconds(30, 300, true, 0)).toBe(30);
    expect(calculatePollDelaySeconds(30, 300, false, 0)).toBe(300);
  });

  it('backs off failures exponentially and caps retries at 30 minutes', () => {
    expect(calculatePollDelaySeconds(30, 300, true, 1)).toBe(60);
    expect(calculatePollDelaySeconds(30, 300, false, 1)).toBe(600);
    expect(calculatePollDelaySeconds(30, 300, false, 10)).toBe(1_800);
  });
});
