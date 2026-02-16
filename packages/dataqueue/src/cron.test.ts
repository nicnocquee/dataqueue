import { describe, it, expect, afterEach, vi } from 'vitest';
import { getNextCronOccurrence, validateCronExpression } from './cron.js';

describe('getNextCronOccurrence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the next occurrence for a every-5-minutes expression', () => {
    // Setup
    const after = new Date('2026-01-15T10:02:00Z');

    // Act
    const next = getNextCronOccurrence('*/5 * * * *', 'UTC', after);

    // Assert
    expect(next).toEqual(new Date('2026-01-15T10:05:00Z'));
  });

  it('returns the next occurrence for a daily-at-midnight expression', () => {
    // Setup
    const after = new Date('2026-01-15T10:00:00Z');

    // Act
    const next = getNextCronOccurrence('0 0 * * *', 'UTC', after);

    // Assert
    expect(next).toEqual(new Date('2026-01-16T00:00:00Z'));
  });

  it('uses the current time when after is not provided', () => {
    // Act
    const next = getNextCronOccurrence('*/5 * * * *');

    // Assert
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('respects a non-UTC timezone', () => {
    // Setup — 10:02 UTC is 19:02 in Asia/Tokyo (UTC+9)
    const after = new Date('2026-01-15T10:02:00Z');

    // Act — "0 20 * * *" = daily at 20:00 Tokyo time = 11:00 UTC
    const next = getNextCronOccurrence('0 20 * * *', 'Asia/Tokyo', after);

    // Assert
    expect(next).toEqual(new Date('2026-01-15T11:00:00Z'));
  });

  it('returns null when expression cannot produce a future match', () => {
    // Setup — Feb 30 never exists: "0 0 30 2 *"
    const after = new Date('2026-01-01T00:00:00Z');

    // Act
    const next = getNextCronOccurrence('0 0 30 2 *', 'UTC', after);

    // Assert
    expect(next).toBeNull();
  });

  it('defaults to UTC timezone', () => {
    // Setup
    const after = new Date('2026-06-01T23:58:00Z');

    // Act
    const next = getNextCronOccurrence('0 0 * * *', undefined, after);

    // Assert
    expect(next).toEqual(new Date('2026-06-02T00:00:00Z'));
  });
});

describe('validateCronExpression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true for a valid every-minute expression', () => {
    // Act
    const result = validateCronExpression('* * * * *');

    // Assert
    expect(result).toBe(true);
  });

  it('returns true for a valid complex expression', () => {
    // Act
    const result = validateCronExpression('0 9-17 * * 1-5');

    // Assert
    expect(result).toBe(true);
  });

  it('returns false for an invalid expression with too few fields', () => {
    // Act
    const result = validateCronExpression('* *');

    // Assert
    expect(result).toBe(false);
  });

  it('returns false for an empty string', () => {
    // Act
    const result = validateCronExpression('');

    // Assert
    expect(result).toBe(false);
  });

  it('returns false for a completely invalid string', () => {
    // Act
    const result = validateCronExpression('not a cron expression');

    // Assert
    expect(result).toBe(false);
  });

  it('returns true for an expression with step values', () => {
    // Act
    const result = validateCronExpression('*/15 * * * *');

    // Assert
    expect(result).toBe(true);
  });
});
