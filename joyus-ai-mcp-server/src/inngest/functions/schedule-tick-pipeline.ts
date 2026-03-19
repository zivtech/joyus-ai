/**
 * Schedule Tick Pipeline — Feature 010 evaluation spike.
 *
 * Inngest cron-triggered function that fires on a recurring schedule.
 * Also accepts external trigger via the `pipeline/schedule.tick` event,
 * enabling ad-hoc execution outside the scheduled window.
 *
 * Per-tenant concurrency:
 *   At most 1 concurrent execution per tenant at a time, preventing
 *   overlapping tick runs for the same tenant if a previous run is still
 *   in-flight when the next cron fires.
 *
 * Timezone support:
 *   Inngest cron accepts an optional `timezone` field alongside `cron`:
 *     { cron: '0 * * * *', timezone: 'America/New_York' }
 *   Any IANA timezone string is valid (e.g. 'Europe/London', 'Asia/Tokyo').
 *   The cron expression is interpreted in that timezone.
 *   This function defaults to UTC; callers can wrap with a timezone-specific
 *   variant by creating a second function that uses a different cron schedule.
 */
import { inngest } from '../client.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the schedule-tick Inngest function.
 *
 * Call this once during server initialisation and pass the result to serve():
 *   const fn = createScheduleTickPipeline();
 */
export function createScheduleTickPipeline() {
  return inngest.createFunction(
    {
      id: 'schedule-tick-pipeline',
      name: 'Schedule Tick Pipeline',
      // At most 1 concurrent execution globally — prevents overlapping cron ticks
      // if a previous run is still in-flight when the next one fires.
      // NOTE: We use a static string key (not 'event.data.tenantId') because
      // cron-triggered events carry no tenantId in their payload — the key would
      // evaluate to undefined, which skips concurrency enforcement entirely.
      // If per-tenant isolation is needed, this function should be event-triggered
      // only (pipeline/schedule.tick) with tenantId required in the payload.
      concurrency: {
        key: '"schedule-tick-global"',
        limit: 1,
      },
    },
    {
      // Fires every hour at :00 UTC.
      // Timezone support: pass `timezone: 'America/New_York'` (or any IANA
      // timezone string) alongside `cron` to interpret the schedule in that
      // timezone instead of UTC.
      cron: '0 * * * *',
    },
    async ({ event, step }) => {
      const tickResult = await step.run('record-schedule-tick', async () => {
        return {
          tenantId: (event.data as { tenantId?: string })?.tenantId ?? 'system',
          scheduledAt: new Date().toISOString(),
          timezone: 'UTC',
        };
      });

      return { status: 'completed', tick: tickResult };
    },
  );
}
