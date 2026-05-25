/**
 * Tests for tools/executor.ts — the top-level tool dispatcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Module mocks — must be hoisted before any imports
// ============================================================

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  connections: {
    userId: 'userId',
    service: 'service',
    id: 'id',
  },
}));

vi.mock('../../src/db/encryption.js', () => ({
  decryptToken: vi.fn((t: string) => `decrypted:${t}`),
  encryptToken: vi.fn((t: string) => `encrypted:${t}`),
}));

vi.mock('../../src/tools/executors/content-executor.js', () => ({
  executeContentTool: vi.fn().mockResolvedValue({ content: 'result' }),
}));

vi.mock('../../src/tools/executors/github-executor.js', () => ({
  executeGithubTool: vi.fn().mockResolvedValue({ github: 'result' }),
}));

vi.mock('../../src/tools/executors/google-executor.js', () => ({
  executeGoogleTool: vi.fn().mockResolvedValue({ google: 'result' }),
}));

vi.mock('../../src/tools/executors/jira-executor.js', () => ({
  executeJiraTool: vi.fn().mockResolvedValue({ jira: 'result' }),
}));

vi.mock('../../src/tools/executors/ops-executor.js', () => ({
  executeOpsTool: vi.fn().mockResolvedValue({ ops: 'result' }),
}));

vi.mock('../../src/tools/executors/pipeline-executor.js', () => ({
  executePipelineTool: vi.fn().mockResolvedValue({ pipeline: 'result' }),
}));

vi.mock('../../src/tools/executors/slack-executor.js', () => ({
  executeSlackTool: vi.fn().mockResolvedValue({ slack: 'result' }),
}));

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

// ============================================================
// Imports after mocks
// ============================================================

import { db, connections } from '../../src/db/client.js';
import { decryptToken, encryptToken } from '../../src/db/encryption.js';
import { executeContentTool } from '../../src/tools/executors/content-executor.js';
import { executeGithubTool } from '../../src/tools/executors/github-executor.js';
import { executeGoogleTool } from '../../src/tools/executors/google-executor.js';
import { executeJiraTool } from '../../src/tools/executors/jira-executor.js';
import { executeOpsTool } from '../../src/tools/executors/ops-executor.js';
import { executePipelineTool } from '../../src/tools/executors/pipeline-executor.js';
import { executeSlackTool } from '../../src/tools/executors/slack-executor.js';
import axios from 'axios';

import { executeTool, setPipelineContext } from '../../src/tools/executor.js';

// ============================================================
// Helpers
// ============================================================

function chainable(resolveValue: any = []): any {
  const self: any = {};
  const methods = ['from', 'where', 'orderBy', 'groupBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'set', 'values', 'returning'];
  for (const m of methods) { self[m] = vi.fn().mockReturnValue(self); }
  self.then = (resolve: any) => Promise.resolve(resolveValue).then(resolve);
  return self;
}

const validConnection = {
  id: 'conn-1',
  userId: 'user-1',
  service: 'JIRA',
  accessToken: 'encrypted-access',
  refreshToken: null,
  expiresAt: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ============================================================
// ops_ prefix — no DB lookup required
// ============================================================

describe('executeTool — ops_ prefix', () => {
  it('routes ops_* tools directly to executeOpsTool', async () => {
    const result = await executeTool('user-1', 'ops_export_excel', { tenant_id: 'user-1' });
    expect(vi.mocked(executeOpsTool)).toHaveBeenCalledWith('ops_export_excel', { tenant_id: 'user-1' }, { userId: 'user-1', tenantAccessPreResolved: true });
    expect(result).toEqual({ ops: 'result' });
  });
});

// ============================================================
// content_ prefix — no DB lookup required
// ============================================================

describe('executeTool — content_ prefix', () => {
  it('routes content_* tools directly to executeContentTool', async () => {
    const result = await executeTool('user-1', 'content_create', { title: 'Test' });
    expect(vi.mocked(executeContentTool)).toHaveBeenCalledWith(
      'content_create',
      { title: 'Test' },
      expect.objectContaining({ userId: 'user-1', tenantId: 'user-1' }),
    );
    expect(result).toEqual({ content: 'result' });
  });

  it('uses the shared resolver for explicitly requested tenants', async () => {
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', 'user-1:tenant-allowed');

    await executeTool('user-1', 'content_list_sources', {
      tenant_id: 'tenant-allowed',
    });

    expect(vi.mocked(executeContentTool)).toHaveBeenCalledWith(
      'content_list_sources',
      { tenant_id: 'tenant-allowed' },
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-allowed' }),
    );
  });

  it('rejects explicitly requested tenants without membership or allowlist access', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    await expect(
      executeTool('user-1', 'content_list_sources', {
        tenant_id: 'tenant-denied',
      }),
    ).rejects.toThrow('not authorized for tenant tenant-denied');

    expect(vi.mocked(executeContentTool)).not.toHaveBeenCalled();
  });
});

// ============================================================
// pipeline_ prefix
// ============================================================

describe('executeTool — pipeline prefix', () => {
  it('throws when pipeline context is not initialized', async () => {
    // Reset pipeline context by re-importing (context starts null in fresh module)
    // We can call setPipelineContext with null via a workaround, or just test the error path
    // by importing after clearing. Instead, directly test by verifying it throws without setup.
    // The pipeline context starts as null — but tests run sequentially and setPipelineContext
    // may have been called. Reset it:
    // Cast to any to allow null for reset
    (setPipelineContext as any)(null as any);

    await expect(
      executeTool('user-1', 'pipeline_run', { pipeline_id: 'p1' }),
    ).rejects.toThrow('Pipeline module not initialized');
  });

  it('routes pipeline_* to executePipelineTool when context is set', async () => {
    const pipelineContext = {
      stepRegistry: {} as any,
      decisionRecorder: {} as any,
      eventBus: {} as any,
    };
    setPipelineContext(pipelineContext);

    const result = await executeTool('user-1', 'pipeline_run', { pipeline_id: 'p1' });
    expect(vi.mocked(executePipelineTool)).toHaveBeenCalledWith(
      'pipeline_run',
      { pipeline_id: 'p1' },
      expect.objectContaining({ tenantId: 'user-1' }),
    );
    expect(result).toEqual({ pipeline: 'result' });
  });

  it('routes pipeline template tools to executePipelineTool when context is set', async () => {
    const pipelineContext = {
      stepRegistry: {} as any,
      decisionRecorder: {} as any,
      eventBus: {} as any,
    };
    setPipelineContext(pipelineContext);

    await executeTool('user-1', 'pipeline_template_list', {});
    expect(vi.mocked(executePipelineTool)).toHaveBeenCalledWith('pipeline_template_list', {}, expect.anything());
  });

  it('routes pipeline review tools to executePipelineTool when context is set', async () => {
    const pipelineContext = {
      stepRegistry: {} as any,
      decisionRecorder: {} as any,
      eventBus: {} as any,
    };
    setPipelineContext(pipelineContext);

    await executeTool('user-1', 'pipeline_review_decide', {});
    expect(vi.mocked(executePipelineTool)).toHaveBeenCalledWith('pipeline_review_decide', {}, expect.anything());
  });

  it('does not route old unprefixed template or review tools', async () => {
    const pipelineContext = {
      stepRegistry: {} as any,
      decisionRecorder: {} as any,
      eventBus: {} as any,
    };
    setPipelineContext(pipelineContext);

    await expect(executeTool('user-1', 'template_list', {})).rejects.toThrow(
      'Unknown tool: template_list',
    );
    await expect(executeTool('user-1', 'review_decide', {})).rejects.toThrow(
      'Unknown tool: review_decide',
    );
  });
});

// ============================================================
// Unknown tool
// ============================================================

describe('executeTool — unknown tool', () => {
  it('throws for completely unknown tool prefix', async () => {
    await expect(
      executeTool('user-1', 'widget_foo', {}),
    ).rejects.toThrow('Unknown tool: widget_foo');
  });
});

// ============================================================
// Service-backed tools — connection lookup and execution
// ============================================================

describe('executeTool — jira_ prefix', () => {
  it('throws when no JIRA connection exists', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    await expect(
      executeTool('user-1', 'jira_get_issue', { issue_key: 'TEST-1' }),
    ).rejects.toThrow('No JIRA connection found');
  });

  it('executes jira tool with valid connection (no expiry)', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([validConnection]));

    const result = await executeTool('user-1', 'jira_get_issue', { issue_key: 'TEST-1' });

    expect(vi.mocked(executeJiraTool)).toHaveBeenCalledWith(
      'jira_get_issue',
      { issue_key: 'TEST-1' },
      expect.objectContaining({
        userId: 'user-1',
        accessToken: 'decrypted:encrypted-access',
        refreshToken: undefined,
      }),
    );
    expect(result).toEqual({ jira: 'result' });
  });

  it('passes decrypted refreshToken in context when present', async () => {
    const connWithRefresh = { ...validConnection, refreshToken: 'encrypted-refresh' };
    vi.mocked(db.select).mockReturnValue(chainable([connWithRefresh]));

    await executeTool('user-1', 'jira_get_issue', { issue_key: 'TEST-1' });

    expect(vi.mocked(executeJiraTool)).toHaveBeenCalledWith(
      'jira_get_issue',
      { issue_key: 'TEST-1' },
      expect.objectContaining({
        refreshToken: 'decrypted:encrypted-refresh',
      }),
    );
  });
});

describe('executeTool — slack_ prefix', () => {
  it('throws when no SLACK connection exists', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    await expect(
      executeTool('user-1', 'slack_post_message', { channel: '#general', text: 'hi' }),
    ).rejects.toThrow('No SLACK connection found');
  });

  it('routes to executeSlackTool with valid connection', async () => {
    const slackConn = { ...validConnection, service: 'SLACK' };
    vi.mocked(db.select).mockReturnValue(chainable([slackConn]));

    const result = await executeTool('user-1', 'slack_post_message', { channel: '#general' });
    expect(vi.mocked(executeSlackTool)).toHaveBeenCalledWith(
      'slack_post_message',
      { channel: '#general' },
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(result).toEqual({ slack: 'result' });
  });
});

describe('executeTool — github_ prefix', () => {
  it('routes to executeGithubTool with valid connection', async () => {
    const githubConn = { ...validConnection, service: 'GITHUB' };
    vi.mocked(db.select).mockReturnValue(chainable([githubConn]));

    const result = await executeTool('user-1', 'github_list_prs', { repo: 'org/repo' });
    expect(vi.mocked(executeGithubTool)).toHaveBeenCalledWith(
      'github_list_prs',
      { repo: 'org/repo' },
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(result).toEqual({ github: 'result' });
  });
});

describe('executeTool — google prefixes', () => {
  it('routes gmail_ to executeGoogleTool', async () => {
    const googleConn = { ...validConnection, service: 'GOOGLE' };
    vi.mocked(db.select).mockReturnValue(chainable([googleConn]));

    const result = await executeTool('user-1', 'gmail_list_messages', {});
    expect(vi.mocked(executeGoogleTool)).toHaveBeenCalledWith(
      'gmail_list_messages',
      {},
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(result).toEqual({ google: 'result' });
  });

  it('routes drive_ to executeGoogleTool', async () => {
    const googleConn = { ...validConnection, service: 'GOOGLE' };
    vi.mocked(db.select).mockReturnValue(chainable([googleConn]));

    await executeTool('user-1', 'drive_list_files', {});
    expect(vi.mocked(executeGoogleTool)).toHaveBeenCalledWith('drive_list_files', {}, expect.anything());
  });

  it('routes docs_ to executeGoogleTool', async () => {
    const googleConn = { ...validConnection, service: 'GOOGLE' };
    vi.mocked(db.select).mockReturnValue(chainable([googleConn]));

    await executeTool('user-1', 'docs_get_document', {});
    expect(vi.mocked(executeGoogleTool)).toHaveBeenCalledWith('docs_get_document', {}, expect.anything());
  });
});

// ============================================================
// Token expiry and refresh
// ============================================================

describe('executeTool — token expiry handling', () => {
  it('throws when token is expired and no refreshToken exists', async () => {
    const expiredConn = {
      ...validConnection,
      service: 'JIRA',
      refreshToken: null,
      expiresAt: new Date(Date.now() - 1000), // already expired
    };
    vi.mocked(db.select).mockReturnValue(chainable([expiredConn]));

    await expect(
      executeTool('user-1', 'jira_get_issue', { issue_key: 'TEST-1' }),
    ).rejects.toThrow('JIRA token expired');
  });

  it('refreshes JIRA token when expired with refreshToken', async () => {
    const expiredConn = {
      ...validConnection,
      service: 'JIRA',
      refreshToken: 'encrypted-refresh',
      expiresAt: new Date(Date.now() - 1000), // already expired
    };
    vi.mocked(db.select).mockReturnValue(chainable([expiredConn]));
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'new-access-token',
        expires_in: 3600,
      },
    });

    const result = await executeTool('user-1', 'jira_get_issue', { issue_key: 'TEST-1' });
    expect(axios.post).toHaveBeenCalledWith(
      'https://auth.atlassian.com/oauth/token',
      expect.objectContaining({ grant_type: 'refresh_token' }),
    );
    expect(result).toEqual({ jira: 'result' });
  });

  it('refreshes GOOGLE token when expired with refreshToken', async () => {
    const expiredConn = {
      ...validConnection,
      service: 'GOOGLE',
      refreshToken: 'encrypted-google-refresh',
      expiresAt: new Date(Date.now() - 1000),
    };
    vi.mocked(db.select).mockReturnValue(chainable([expiredConn]));
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'new-google-access',
        expires_in: 3600,
      },
    });

    const result = await executeTool('user-1', 'gmail_list_messages', {});
    expect(axios.post).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ grant_type: 'refresh_token' }),
    );
    expect(result).toEqual({ google: 'result' });
  });

  it('SLACK token with expiry returns null (no refresh needed) — uses existing token', async () => {
    const expiredSlackConn = {
      ...validConnection,
      service: 'SLACK',
      refreshToken: 'encrypted-slack-refresh',
      expiresAt: new Date(Date.now() - 1000),
    };
    vi.mocked(db.select).mockReturnValue(chainable([expiredSlackConn]));

    // SLACK refresh returns null, so the original (expired) token is used as-is
    const result = await executeTool('user-1', 'slack_post_message', {});
    expect(vi.mocked(executeSlackTool)).toHaveBeenCalled();
    expect(result).toEqual({ slack: 'result' });
  });

  it('GITHUB token with expiry returns null — uses existing token', async () => {
    const expiredGithubConn = {
      ...validConnection,
      service: 'GITHUB',
      refreshToken: 'encrypted-github-refresh',
      expiresAt: new Date(Date.now() - 1000),
    };
    vi.mocked(db.select).mockReturnValue(chainable([expiredGithubConn]));

    const result = await executeTool('user-1', 'github_list_prs', {});
    expect(vi.mocked(executeGithubTool)).toHaveBeenCalled();
    expect(result).toEqual({ github: 'result' });
  });

  it('throws when token refresh fails', async () => {
    const expiredConn = {
      ...validConnection,
      service: 'JIRA',
      refreshToken: 'encrypted-refresh',
      expiresAt: new Date(Date.now() - 1000),
    };
    vi.mocked(db.select).mockReturnValue(chainable([expiredConn]));
    vi.mocked(axios.post).mockRejectedValue(new Error('Network error'));

    await expect(
      executeTool('user-1', 'jira_get_issue', { issue_key: 'TEST-1' }),
    ).rejects.toThrow('JIRA token refresh failed');
  });
});

// ============================================================
// setPipelineContext
// ============================================================

describe('setPipelineContext', () => {
  it('sets the pipeline context so pipeline tools can execute', async () => {
    const pipelineContext = {
      stepRegistry: { getStep: vi.fn() } as any,
      decisionRecorder: { record: vi.fn() } as any,
      eventBus: { emit: vi.fn() } as any,
    };
    setPipelineContext(pipelineContext);

    const result = await executeTool('user-1', 'pipeline_list', {});
    expect(vi.mocked(executePipelineTool)).toHaveBeenCalled();
    expect(result).toEqual({ pipeline: 'result' });
  });
});
