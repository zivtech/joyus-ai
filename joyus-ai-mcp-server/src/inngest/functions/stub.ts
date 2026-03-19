/**
 * Stub Inngest function — Feature 010 evaluation spike.
 *
 * This is a minimal registration-only function to verify that:
 *   1. The Inngest client connects to the self-hosted server
 *   2. The Express serve() adapter works at /api/inngest
 *   3. The function appears in the Inngest dev UI
 *
 * Replace with real pipeline functions in WP02.
 */
import { inngest } from '../client.js';

export const stubFunction = inngest.createFunction(
  {
    id: 'pipeline-stub',
    name: 'Pipeline Stub (Feature 010 spike verification)',
  },
  { event: 'pipeline/corpus.changed' },
  async ({ event, step }) => {
    const result = await step.run('log-event', async () => {
      return {
        received: true,
        tenantId: event.data.tenantId,
        corpusId: event.data.corpusId,
        changeType: event.data.changeType,
        timestamp: new Date().toISOString(),
      };
    });

    return { status: 'stub-ok', result };
  },
);
