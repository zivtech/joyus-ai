/**
 * Jira Tool Executor
 * Executes Jira API calls using OAuth tokens
 */

import axios from 'axios';

import { ExecutorContext } from '../executor.js';

const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira';

interface JiraMetadata {
  resources?: { id: string; name?: string; url?: string }[];
}

/**
 * Execute a Jira tool
 */
export async function executeJiraTool(
  toolName: string,
  input: any,
  context: ExecutorContext
): Promise<any> {
  // Get cloud ID from metadata (set during OAuth)
  const metadata = context.metadata as JiraMetadata | undefined;
  const cloudId = metadata?.resources?.[0]?.id;
  if (!cloudId) {
    throw new Error('No Jira cloud ID found. Please reconnect Jira.');
  }

  const baseUrl = `${JIRA_API_BASE}/${cloudId}/rest/api/3`;
  const headers = {
    Authorization: `Bearer ${context.accessToken}`,
    'Content-Type': 'application/json'
  };

  switch (toolName) {
    case 'jira_search_issues':
      return searchIssues(baseUrl, headers, input);

    case 'jira_get_issue':
      return getIssue(baseUrl, headers, input);

    case 'jira_get_my_issues':
      return getMyIssues(baseUrl, headers, input);

    case 'jira_add_comment':
      return addComment(baseUrl, headers, input);

    case 'jira_transition_issue':
      return transitionIssue(baseUrl, headers, input);

    case 'jira_list_projects':
      return listProjects(baseUrl, headers, input);

    default:
      throw new Error(`Unknown Jira tool: ${toolName}`);
  }
}

async function searchIssues(baseUrl: string, headers: any, input: any): Promise<any> {
  const { jql, maxResults = 20, fields } = input;

  const response = await axios.post(`${baseUrl}/search`, {
    jql,
    maxResults: Math.min(maxResults, 50),
    fields: fields || ['summary', 'status', 'assignee', 'priority', 'created', 'updated']
  }, { headers });

  return {
    total: response.data.total,
    issues: response.data.issues.map(formatIssue)
  };
}

async function getIssue(baseUrl: string, headers: any, input: any): Promise<any> {
  const { issueKey, expand } = input;

  const params = expand ? { expand: expand.join(',') } : {};

  const response = await axios.get(`${baseUrl}/issue/${issueKey}`, {
    headers,
    params
  });

  return formatIssueDetailed(response.data);
}

async function getMyIssues(baseUrl: string, headers: any, input: any): Promise<any> {
  const { status, project, maxResults = 20 } = input;

  let jql = 'assignee = currentUser()';
  if (status) jql += ` AND status = "${status}"`;
  if (project) jql += ` AND project = ${project}`;
  jql += ' ORDER BY updated DESC';

  return searchIssues(baseUrl, headers, { jql, maxResults });
}

async function addComment(baseUrl: string, headers: any, input: any): Promise<any> {
  const { issueKey, comment } = input;

  const response = await axios.post(`${baseUrl}/issue/${issueKey}/comment`, {
    body: {
      type: 'doc',
      version: 1,
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: comment }]
      }]
    }
  }, { headers });

  return {
    success: true,
    commentId: response.data.id,
    message: `Comment added to ${issueKey}`
  };
}

async function transitionIssue(baseUrl: string, headers: any, input: any): Promise<any> {
  const { issueKey, transitionName } = input;

  // Get available transitions
  const transitionsResponse = await axios.get(
    `${baseUrl}/issue/${issueKey}/transitions`,
    { headers }
  );

  const transition = transitionsResponse.data.transitions.find(
    (t: any) => t.name.toLowerCase() === transitionName.toLowerCase()
  );

  if (!transition) {
    const available = transitionsResponse.data.transitions.map((t: any) => t.name).join(', ');
    throw new Error(`Transition "${transitionName}" not found. Available: ${available}`);
  }

  await axios.post(`${baseUrl}/issue/${issueKey}/transitions`, {
    transition: { id: transition.id }
  }, { headers });

  return {
    success: true,
    message: `${issueKey} transitioned to "${transitionName}"`
  };
}

async function listProjects(baseUrl: string, headers: any, input: any): Promise<any> {
  const { maxResults = 50 } = input;

  const response = await axios.get(`${baseUrl}/project/search`, {
    headers,
    params: { maxResults }
  });

  return {
    total: response.data.total,
    projects: response.data.values.map((p: any) => ({
      key: p.key,
      name: p.name,
      projectType: p.projectTypeKey,
      lead: p.lead?.displayName
    }))
  };
}

// Formatters
function formatIssue(issue: any): any {
  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name,
    priority: issue.fields.priority?.name,
    assignee: issue.fields.assignee?.displayName || 'Unassigned',
    created: issue.fields.created,
    updated: issue.fields.updated
  };
}

function formatIssueDetailed(issue: any): any {
  return {
    key: issue.key,
    summary: issue.fields.summary,
    description: extractText(issue.fields.description),
    status: issue.fields.status?.name,
    priority: issue.fields.priority?.name,
    assignee: issue.fields.assignee?.displayName || 'Unassigned',
    reporter: issue.fields.reporter?.displayName,
    created: issue.fields.created,
    updated: issue.fields.updated,
    labels: issue.fields.labels,
    components: issue.fields.components?.map((c: any) => c.name),
    project: {
      key: issue.fields.project?.key,
      name: issue.fields.project?.name
    },
    url: `https://zivtech.atlassian.net/browse/${issue.key}`
  };
}

function extractText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  // Handle Atlassian Document Format
  if (content.type === 'doc' && content.content) {
    return content.content
      .map((block: any) => extractBlockText(block))
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

function extractBlockText(block: any): string {
  if (!block) return '';

  if (block.type === 'paragraph' || block.type === 'heading') {
    return block.content?.map((c: any) => c.text || '').join('') || '';
  }

  if (block.type === 'bulletList' || block.type === 'orderedList') {
    return block.content?.map((item: any) =>
      '• ' + extractBlockText(item)
    ).join('\n') || '';
  }

  if (block.type === 'listItem') {
    return block.content?.map(extractBlockText).join('') || '';
  }

  return '';
}
