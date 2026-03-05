import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { initializeContentModule } from '../../../src/content/index.js';

const ORIGINAL_ENV = { ...process.env };

describe('Content module provider wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('fails closed in strict mode when generation provider is placeholder', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CONTENT_GENERATION_PROVIDER = 'placeholder';
    process.env.CONTENT_DRIFT_ENABLED = 'false';

    const app = { use: vi.fn() } as never;
    const db = {} as never;

    await expect(initializeContentModule(app, { db })).rejects.toThrow(
      /requires a real generation provider/i,
    );
    expect(app.use).not.toHaveBeenCalled();
  });

  it('fails closed when drift monitoring is enabled with stub analyzer', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CONTENT_STRICT_INIT = 'true';
    process.env.CONTENT_GENERATION_PROVIDER = 'http';
    process.env.CONTENT_GENERATION_PROVIDER_URL = 'http://localhost:9999/generate';
    process.env.CONTENT_DRIFT_ENABLED = 'true';
    process.env.CONTENT_VOICE_ANALYZER_PROVIDER = 'stub';

    const app = { use: vi.fn() } as never;
    const db = {} as never;

    await expect(initializeContentModule(app, { db })).rejects.toThrow(
      /requires a real voice analyzer/i,
    );
    expect(app.use).not.toHaveBeenCalled();
  });

  it('initializes and mounts routers when real providers are configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CONTENT_STRICT_INIT = 'true';
    process.env.CONTENT_GENERATION_PROVIDER = 'http';
    process.env.CONTENT_GENERATION_PROVIDER_URL = 'http://localhost:9999/generate';
    process.env.CONTENT_DRIFT_ENABLED = 'false';
    process.env.CONTENT_VOICE_ANALYZER_PROVIDER = 'http';
    process.env.CONTENT_VOICE_ANALYZER_URL = 'http://localhost:9999/analyze';

    const app = { use: vi.fn() } as never;
    const db = {} as never;

    await expect(initializeContentModule(app, { db })).resolves.toBeUndefined();
    expect(app.use).toHaveBeenCalledTimes(2);
  });
});
