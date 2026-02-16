import { Cron } from 'croner';

/**
 * Calculate the next occurrence of a cron expression after a given date.
 *
 * @param cronExpression - A standard cron expression (5 fields, e.g. "0 * * * *").
 * @param timezone - IANA timezone string (default: "UTC").
 * @param after - The reference date to compute the next run from (default: now).
 * @param CronImpl - Cron class for dependency injection (default: croner's Cron).
 * @returns The next occurrence as a Date, or null if the expression will never fire again.
 */
export function getNextCronOccurrence(
  cronExpression: string,
  timezone: string = 'UTC',
  after?: Date,
  CronImpl: typeof Cron = Cron,
): Date | null {
  const cron = new CronImpl(cronExpression, { timezone });
  const next = cron.nextRun(after ?? new Date());
  return next ?? null;
}

/**
 * Validate whether a string is a syntactically correct cron expression.
 *
 * @param cronExpression - The cron expression to validate.
 * @param CronImpl - Cron class for dependency injection (default: croner's Cron).
 * @returns True if the expression is valid, false otherwise.
 */
export function validateCronExpression(
  cronExpression: string,
  CronImpl: typeof Cron = Cron,
): boolean {
  try {
    new CronImpl(cronExpression);
    return true;
  } catch {
    return false;
  }
}
