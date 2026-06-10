/**
 * Tool definition shape tests — validates MCP tool metadata (name, description,
 * inputSchema) is well-formed. Does NOT test executor logic; see
 * tests/content/integration/ and future executor-specific test files.
 */

import { describe, it, expect } from 'vitest';

import { approvalTools } from '../src/tools/approval-tools.js';
import { jiraTools } from '../src/tools/jira-tools.js';
import { slackTools } from '../src/tools/slack-tools.js';
import { githubTools } from '../src/tools/github-tools.js';
import { googleTools } from '../src/tools/google-tools.js';
import { opsTools } from '../src/tools/ops-tools.js';

describe('Tool Definitions', () => {
  const validateToolDefinition = (tool: any) => {
    // Every tool must have a name
    expect(tool.name).toBeDefined();
    expect(typeof tool.name).toBe('string');
    expect(tool.name.length).toBeGreaterThan(0);

    // Every tool must have a description
    expect(tool.description).toBeDefined();
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);

    // Every tool must have an input schema
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.properties).toBeDefined();
  };

  describe('Approval Tools', () => {
    it('should have valid tool definitions', () => {
      expect(approvalTools).toHaveLength(4);

      for (const tool of approvalTools) {
        validateToolDefinition(tool);
        expect(tool.name).toMatch(/^approval_/);
      }
    });

    it('should include workflow approval lifecycle tools', () => {
      const toolNames = approvalTools.map(t => t.name);

      expect(toolNames).toContain('approval_create');
      expect(toolNames).toContain('approval_status');
      expect(toolNames).toContain('approval_decide');
      expect(toolNames).toContain('approval_expire_due');
    });

    it('should have required fields specified', () => {
      const createTool = approvalTools.find(t => t.name === 'approval_create');
      expect(createTool?.inputSchema.required).toEqual([
        'workflowRunId',
        'proposalId',
        'proposalSummary',
      ]);

      const decideTool = approvalTools.find(t => t.name === 'approval_decide');
      expect(decideTool?.inputSchema.required).toContain('approvalId');
      expect(decideTool?.inputSchema.required).toContain('decision');
    });
  });

  describe('Jira Tools', () => {
    it('should have valid tool definitions', () => {
      expect(jiraTools.length).toBeGreaterThan(0);

      for (const tool of jiraTools) {
        validateToolDefinition(tool);
        expect(tool.name).toMatch(/^jira_/);
      }
    });

    it('should include essential Jira tools', () => {
      const toolNames = jiraTools.map(t => t.name);

      expect(toolNames).toContain('jira_search_issues');
      expect(toolNames).toContain('jira_get_issue');
      expect(toolNames).toContain('jira_add_comment');
      expect(toolNames).toContain('jira_resolve_reviewers');
      expect(toolNames).toContain('jira_post_proposal_comment');
    });

    it('should have required fields specified', () => {
      const searchTool = jiraTools.find(t => t.name === 'jira_search_issues');
      expect(searchTool?.inputSchema.required).toContain('jql');

      const getIssueTool = jiraTools.find(t => t.name === 'jira_get_issue');
      expect(getIssueTool?.inputSchema.required).toContain('issueKey');

      const resolveReviewersTool = jiraTools.find(t => t.name === 'jira_resolve_reviewers');
      expect(resolveReviewersTool?.inputSchema.required).toContain('issueKey');

      const proposalTool = jiraTools.find(t => t.name === 'jira_post_proposal_comment');
      expect(proposalTool?.inputSchema.required).toContain('issueKey');
      expect(proposalTool?.inputSchema.required).toContain('summary');
      expect(proposalTool?.inputSchema.required).toContain('affectedComponents');
      expect(proposalTool?.inputSchema.required).toContain('proposedChanges');
      expect(proposalTool?.inputSchema.required).toContain('riskLevel');
      expect(proposalTool?.inputSchema.required).toContain('approvalPrompt');
    });
  });

  describe('Slack Tools', () => {
    it('should have valid tool definitions', () => {
      expect(slackTools.length).toBeGreaterThan(0);

      for (const tool of slackTools) {
        validateToolDefinition(tool);
        expect(tool.name).toMatch(/^slack_/);
      }
    });

    it('should include essential Slack tools', () => {
      const toolNames = slackTools.map(t => t.name);

      expect(toolNames).toContain('slack_search_messages');
      expect(toolNames).toContain('slack_post_message');
      expect(toolNames).toContain('slack_list_channels');
    });

    it('should have required fields specified', () => {
      const postTool = slackTools.find(t => t.name === 'slack_post_message');
      expect(postTool?.inputSchema.required).toContain('channel');
      expect(postTool?.inputSchema.required).toContain('text');
    });
  });

  describe('GitHub Tools', () => {
    it('should have valid tool definitions', () => {
      expect(githubTools.length).toBeGreaterThan(0);

      for (const tool of githubTools) {
        validateToolDefinition(tool);
        expect(tool.name).toMatch(/^github_/);
      }
    });

    it('should include essential GitHub tools', () => {
      const toolNames = githubTools.map(t => t.name);

      expect(toolNames).toContain('github_search_code');
      expect(toolNames).toContain('github_list_prs');
      expect(toolNames).toContain('github_get_pr');
      expect(toolNames).toContain('github_create_pr');
      expect(toolNames).toContain('github_request_reviewers');
      expect(toolNames).toContain('github_get_pr_checks');
    });

    it('should have required fields specified', () => {
      const prTool = githubTools.find(t => t.name === 'github_get_pr');
      expect(prTool?.inputSchema.required).toContain('repo');
      expect(prTool?.inputSchema.required).toContain('prNumber');

      const createPrTool = githubTools.find(t => t.name === 'github_create_pr');
      expect(createPrTool?.inputSchema.required).toContain('repo');
      expect(createPrTool?.inputSchema.required).toContain('head');
      expect(createPrTool?.inputSchema.required).toContain('base');
      expect(createPrTool?.inputSchema.required).toContain('title');

      const reviewersTool = githubTools.find(t => t.name === 'github_request_reviewers');
      expect(reviewersTool?.inputSchema.required).toContain('repo');
      expect(reviewersTool?.inputSchema.required).toContain('prNumber');

      const checksTool = githubTools.find(t => t.name === 'github_get_pr_checks');
      expect(checksTool?.inputSchema.required).toContain('repo');
      expect(checksTool?.inputSchema.required).toContain('prNumber');
    });
  });

  describe('Google Tools', () => {
    it('should have valid tool definitions', () => {
      expect(googleTools.length).toBeGreaterThan(0);

      for (const tool of googleTools) {
        validateToolDefinition(tool);
        expect(tool.name).toMatch(/^(gmail_|drive_|docs_)/);
      }
    });

    it('should include essential Google tools', () => {
      const toolNames = googleTools.map(t => t.name);

      expect(toolNames).toContain('gmail_search');
      expect(toolNames).toContain('gmail_send');
      expect(toolNames).toContain('drive_search');
      expect(toolNames).toContain('docs_get_content');
    });

    it('should have required fields specified', () => {
      const sendTool = googleTools.find(t => t.name === 'gmail_send');
      expect(sendTool?.inputSchema.required).toContain('to');
      expect(sendTool?.inputSchema.required).toContain('subject');
      expect(sendTool?.inputSchema.required).toContain('body');
    });
  });

  describe('Ops Tools', () => {
    it('should have valid tool definitions', () => {
      expect(opsTools.length).toBeGreaterThan(0);

      for (const tool of opsTools) {
        validateToolDefinition(tool);
        expect(tool.name).toMatch(/^ops_/);
      }
    });

    it('should include the excel export tool', () => {
      const toolNames = opsTools.map(t => t.name);
      expect(toolNames).toContain('ops_export_excel');
    });

    it('should require tenant_id for ops_export_excel', () => {
      const exportTool = opsTools.find(t => t.name === 'ops_export_excel');
      expect(exportTool?.inputSchema.required).toContain('tenant_id');
    });
  });

  describe('All Tools Combined', () => {
    const allTools = [...approvalTools, ...jiraTools, ...slackTools, ...githubTools, ...googleTools, ...opsTools];

    it('should have unique tool names', () => {
      const names = allTools.map(t => t.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have no empty descriptions', () => {
      for (const tool of allTools) {
        expect(tool.description.trim()).not.toBe('');
      }
    });

    it('should have proper property types in schemas', () => {
      for (const tool of allTools) {
        const props = tool.inputSchema.properties;
        for (const [key, value] of Object.entries(props)) {
          const prop = value as any;
          expect(['string', 'number', 'boolean', 'array', 'object']).toContain(prop.type);
        }
      }
    });
  });
});
