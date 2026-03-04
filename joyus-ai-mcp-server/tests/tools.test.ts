/**
 * Unit tests for tool definitions
 */

import { describe, it, expect } from 'vitest';

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
    });

    it('should have required fields specified', () => {
      const searchTool = jiraTools.find(t => t.name === 'jira_search_issues');
      expect(searchTool?.inputSchema.required).toContain('jql');

      const getIssueTool = jiraTools.find(t => t.name === 'jira_get_issue');
      expect(getIssueTool?.inputSchema.required).toContain('issueKey');
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
    });

    it('should have required fields specified', () => {
      const prTool = githubTools.find(t => t.name === 'github_get_pr');
      expect(prTool?.inputSchema.required).toContain('repo');
      expect(prTool?.inputSchema.required).toContain('prNumber');
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
    const allTools = [...jiraTools, ...slackTools, ...githubTools, ...googleTools, ...opsTools];

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
