/**
 * Tests for slack-executor.ts — axios-based Slack API executor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import { executeSlackTool } from '../../src/tools/executors/slack-executor.js';
import axios from 'axios';

const context = {
  accessToken: 'xoxb-test-token',
  userId: 'user-1',
  metadata: { teamId: 'T123' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeSlackTool', () => {
  it('throws on unknown tool name', async () => {
    await expect(
      executeSlackTool('slack_unknown', {}, context),
    ).rejects.toThrow('Unknown Slack tool');
  });

  it('slack_search_messages — uses POST to search.messages', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { ok: true, messages: { matches: [{ text: 'hello', user: 'U1', channel: { name: 'general' }, ts: '1705334400.000000', permalink: 'https://slack.com/archives/C123/p1705334400' }] } },
    });

    const result = await executeSlackTool(
      'slack_search_messages',
      { query: 'test' },
      context,
    );

    expect(axios.post).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });

  it('slack_list_channels — uses GET conversations.list', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { ok: true, channels: [{ id: 'C123', name: 'general', num_members: 10 }] },
    });

    const result = await executeSlackTool(
      'slack_list_channels',
      {},
      context,
    );

    expect(axios.get).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });

  it('slack_get_user_info — uses GET users.info', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        ok: true,
        user: { id: 'U123', name: 'alice', real_name: 'Alice', tz: 'UTC' },
      },
    });

    const result = await executeSlackTool(
      'slack_get_user_info',
      { user: 'U123' },
      context,
    );

    expect(result).toBeDefined();
  });

  it('slack_post_message — uses POST chat.postMessage', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { ok: true, ts: '123.456' },
    });

    const result = await executeSlackTool(
      'slack_post_message',
      { channel: 'C123', text: 'Hello' },
      context,
    );

    expect(axios.post).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });
});
