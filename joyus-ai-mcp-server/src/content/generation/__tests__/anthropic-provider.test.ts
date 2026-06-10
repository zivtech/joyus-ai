import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicGenerationProvider } from '../anthropic-provider.js';

type MockAnthropicStatic = typeof Anthropic & {
  RateLimitError: new (message: string) => Error;
  AuthenticationError: new (message: string) => Error;
};

const mockMessagesCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  class RateLimitError extends Error {
    status = 429;
    constructor(message: string) {
      super(message);
      this.name = 'RateLimitError';
    }
  }
  class AuthenticationError extends Error {
    status = 401;
    constructor(message: string) {
      super(message);
      this.name = 'AuthenticationError';
    }
  }

  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  }));
  Object.assign(MockAnthropic, { RateLimitError, AuthenticationError });

  return { default: MockAnthropic };
});

const makeTextResponse = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text }],
  model: 'claude-sonnet-4-6',
  stop_reason,
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe('AnthropicGenerationProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(Anthropic).mockImplementation(
      () =>
        ({
          messages: { create: mockMessagesCreate },
        }) as unknown as Anthropic
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns text from the first text block', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('The answer is 42.'));
    const provider = new AnthropicGenerationProvider();
    await expect(provider.generate('What is the answer?', 'Be helpful.')).resolves.toMatchObject({
      text: 'The answer is 42.',
      model: 'claude-sonnet-4-6',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      },
    });
  });

  it('normalizes Anthropic cache usage metadata', async () => {
    mockMessagesCreate.mockResolvedValue({
      ...makeTextResponse('Cached answer.'),
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        cache_creation_input_tokens: 12,
        cache_read_input_tokens: 8,
      },
    });
    const provider = new AnthropicGenerationProvider();
    await expect(provider.generate('query', 'system')).resolves.toMatchObject({
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        cacheWriteTokens: 12,
        cacheReadTokens: 8,
      },
    });
  });

  it('throws when response contains no text block', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'search', input: {} }],
      stop_reason: 'tool_use',
    });
    const provider = new AnthropicGenerationProvider();
    await expect(provider.generate('query', 'system')).rejects.toThrow(
      'Anthropic response contained no text block'
    );
  });

  it('wraps RateLimitError with retryable: true', async () => {
    mockMessagesCreate.mockRejectedValue(
      new (Anthropic as MockAnthropicStatic).RateLimitError('Rate limited')
    );
    const provider = new AnthropicGenerationProvider();
    await expect(provider.generate('query', 'system')).rejects.toMatchObject({
      message: expect.stringContaining('rate limit'),
      retryable: true,
    });
  });

  it('wraps AuthenticationError with retryable: false', async () => {
    mockMessagesCreate.mockRejectedValue(
      new (Anthropic as MockAnthropicStatic).AuthenticationError('Unauthorized')
    );
    const provider = new AnthropicGenerationProvider();
    await expect(provider.generate('query', 'system')).rejects.toMatchObject({
      message: expect.stringContaining('authentication failed'),
      retryable: false,
    });
  });

  it('rethrows unknown errors unchanged', async () => {
    const cause = new Error('Network failure');
    mockMessagesCreate.mockRejectedValue(cause);
    const provider = new AnthropicGenerationProvider();
    await expect(provider.generate('query', 'system')).rejects.toBe(cause);
  });

  it('logs a warning when stop_reason is max_tokens', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('Partial response...', 'max_tokens'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new AnthropicGenerationProvider();
    await provider.generate('query', 'system');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
  });

  it('uses JOYUS_ANTHROPIC_MODEL env var as model', async () => {
    vi.stubEnv('JOYUS_ANTHROPIC_MODEL', 'claude-opus-4-7');
    mockMessagesCreate.mockResolvedValue(makeTextResponse('ok'));
    const provider = new AnthropicGenerationProvider();
    await provider.generate('q', 's');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-7' })
    );
  });

  it('options.model takes precedence over JOYUS_ANTHROPIC_MODEL', async () => {
    vi.stubEnv('JOYUS_ANTHROPIC_MODEL', 'claude-opus-4-7');
    mockMessagesCreate.mockResolvedValue(makeTextResponse('ok'));
    const provider = new AnthropicGenerationProvider({ model: 'claude-haiku-4-5-20251001' });
    await provider.generate('q', 's');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
    );
  });

  it('passes options.maxTokens to the API call', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('ok'));
    const provider = new AnthropicGenerationProvider({ maxTokens: 512 });
    await provider.generate('q', 's');
    expect(mockMessagesCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 512 }));
  });

  it('sends system prompt with ephemeral cache_control', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('ok'));
    const provider = new AnthropicGenerationProvider();
    await provider.generate('q', 'You are helpful.');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [{ type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } }],
      })
    );
  });
});
