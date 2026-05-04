/**
 * Tests for google-executor.ts — axios-based Google API executor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import { executeGoogleTool } from '../../src/tools/executors/google-executor.js';
import axios from 'axios';

const context = {
  accessToken: 'google_test_token',
  userId: 'user-1',
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeGoogleTool', () => {
  it('throws on unknown tool name', async () => {
    await expect(
      executeGoogleTool('google_unknown', {}, context),
    ).rejects.toThrow();
  });

  describe('Gmail tools', () => {
    it('gmail_search — lists messages then fetches details', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({
          data: { messages: [{ id: 'msg-1' }] },
        })
        .mockResolvedValueOnce({
          data: {
            id: 'msg-1',
            payload: {
              headers: [
                { name: 'Subject', value: 'Test' },
                { name: 'From', value: 'alice@test.com' },
                { name: 'Date', value: '2024-01-15' },
              ],
            },
            snippet: 'Hello',
          },
        });

      const result = await executeGoogleTool(
        'gmail_search',
        { query: 'from:boss' },
        context,
      );

      expect(axios.get).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('gmail_get_message — fetches single message', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          id: 'msg-1',
          payload: {
            headers: [
              { name: 'Subject', value: 'Test' },
              { name: 'From', value: 'alice@test.com' },
              { name: 'Date', value: '2024-01-15' },
            ],
            body: { data: '' },
            parts: [],
          },
          snippet: 'Hello',
        },
      });

      const result = await executeGoogleTool(
        'gmail_get_message',
        { messageId: 'msg-1' },
        context,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Drive tools', () => {
    it('drive_search — calls files.list', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          files: [{
            id: 'f1',
            name: 'doc.txt',
            mimeType: 'text/plain',
            webViewLink: 'https://drive.google.com/f1',
          }],
        },
      });

      const result = await executeGoogleTool(
        'drive_search',
        { query: 'test' },
        context,
      );

      expect(result).toBeDefined();
    });
  });
});
