/**
 * Jira Tool Executor
 * Executes Jira API calls using OAuth tokens
 */

import axios from 'axios';

import { ExecutorContext } from '../executor.js';

const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira';
const DEFAULT_REVIEWER_FALLBACK_ORDER = ['customFields', 'assignee', 'reporter'] as const;

type JiraApiVariant = 'cloud' | 'server';
type ReviewerFallbackSource = typeof DEFAULT_REVIEWER_FALLBACK_ORDER[number];

interface JiraMetadata {
  apiVariant?: string;
  baseUrl?: string;
  resources?: { id?: string; name?: string; url?: string }[];
}

interface JiraApiContext {
  variant: JiraApiVariant;
  baseUrl: string;
  browseBaseUrl?: string;
}

interface ResolvedReviewer {
  source: string;
  displayName: string;
  accountId?: string;
  username?: string;
  key?: string;
  active?: boolean;
  fieldId?: string;
}

interface ProposalCommentInput {
  issueKey: string;
  summary: string;
  affectedComponents: string[];
  proposedChanges: string[];
  riskLevel: string;
  approvalPrompt: string;
  details?: string;
}

interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}

/**
 * Execute a Jira tool
 */
export async function executeJiraTool(
  toolName: string,
  input: any,
  context: ExecutorContext
): Promise<any> {
  const api = resolveJiraApi(context.metadata);
  const headers = {
    Authorization: `Bearer ${context.accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };

  try {
    switch (toolName) {
      case 'jira_search_issues':
        return await searchIssues(api.baseUrl, headers, input);

      case 'jira_get_issue':
        return await getIssue(api, headers, input);

      case 'jira_get_my_issues':
        return await getMyIssues(api.baseUrl, headers, input);

      case 'jira_add_comment':
        return await addComment(api, headers, input);

      case 'jira_resolve_reviewers':
        return await resolveReviewers(api, headers, input);

      case 'jira_post_proposal_comment':
        return await postProposalComment(api, headers, input);

      case 'jira_transition_issue':
        return await transitionIssue(api.baseUrl, headers, input);

      case 'jira_get_fields':
        return await getFields(api.baseUrl, headers);

      case 'jira_list_projects':
        return await listProjects(api.baseUrl, headers, input);

      default:
        throw new Error(`Unknown Jira tool: ${toolName}`);
    }
  } catch (error: unknown) {
    throw normalizeJiraError(error);
  }
}

function resolveJiraApi(rawMetadata: unknown): JiraApiContext {
  const metadata = rawMetadata as JiraMetadata | undefined;
  const variant = normalizeApiVariant(metadata?.apiVariant, metadata);

  if (variant === 'server') {
    const browseBaseUrl = trimTrailingSlash(metadata?.baseUrl);
    if (!browseBaseUrl) {
      throw new Error('No Jira Server baseUrl found. Configure Jira metadata with apiVariant "server" and baseUrl, or reconnect Jira Cloud.');
    }

    return {
      variant,
      baseUrl: `${browseBaseUrl}/rest/api/2`,
      browseBaseUrl
    };
  }

  const resource = metadata?.resources?.[0];
  const cloudId = resource?.id;
  if (!cloudId) {
    throw new Error('No Jira cloud ID found. Please reconnect Jira or configure Server metadata.');
  }

  return {
    variant,
    baseUrl: `${JIRA_API_BASE}/${cloudId}/rest/api/3`,
    browseBaseUrl: trimTrailingSlash(resource?.url)
  };
}

function normalizeApiVariant(apiVariant: string | undefined, metadata: JiraMetadata | undefined): JiraApiVariant {
  if (!apiVariant && metadata?.baseUrl && !metadata.resources?.[0]?.id) {
    return 'server';
  }
  if (!apiVariant || apiVariant === 'cloud') return 'cloud';
  if (apiVariant === 'server' || apiVariant === 'data-center' || apiVariant === 'datacenter' || apiVariant === 'data_center') {
    return 'server';
  }
  throw new Error(`Unsupported Jira API variant "${apiVariant}". Use "cloud" or "server".`);
}

function trimTrailingSlash(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, '');
}

async function searchIssues(baseUrl: string, headers: any, input: any): Promise<any> {
  const { jql, maxResults = 20, startAt = 0, fields, includeRawFields = false } = input;

  const response = await axios.post(`${baseUrl}/search`, {
    jql,
    maxResults: Math.min(maxResults, 100),
    startAt,
    fields: fields || ['summary', 'status', 'assignee', 'priority', 'created', 'updated']
  }, { headers });

  return {
    total: response.data.total,
    startAt: response.data.startAt,
    maxResults: response.data.maxResults,
    issues: includeRawFields ? response.data.issues : response.data.issues.map(formatIssue)
  };
}

async function getIssue(api: JiraApiContext, headers: any, input: any): Promise<any> {
  const { issueKey, expand } = input;

  const params = expand ? { expand: expand.join(',') } : {};

  const response = await axios.get(`${api.baseUrl}/issue/${issueKey}`, {
    headers,
    params
  });

  return formatIssueDetailed(response.data, api.browseBaseUrl);
}

async function getMyIssues(baseUrl: string, headers: any, input: any): Promise<any> {
  const { status, project, maxResults = 20 } = input;

  let jql = 'assignee = currentUser()';
  if (status) jql += ` AND status = "${status}"`;
  if (project) jql += ` AND project = ${project}`;
  jql += ' ORDER BY updated DESC';

  return searchIssues(baseUrl, headers, { jql, maxResults });
}

async function addComment(api: JiraApiContext, headers: any, input: any): Promise<any> {
  const { issueKey, comment } = input;

  const response = await axios.post(`${api.baseUrl}/issue/${issueKey}/comment`, {
    body: api.variant === 'cloud'
      ? createAdfDocument([paragraph(String(comment))])
      : String(comment)
  }, { headers });

  return {
    success: true,
    commentId: response.data.id,
    message: `Comment added to ${issueKey}`
  };
}

async function resolveReviewers(api: JiraApiContext, headers: any, input: any): Promise<any> {
  const { issueKey } = input;
  const reviewerFieldIds = toStringArray(input.reviewerFieldIds);
  const fallbackOrder = normalizeFallbackOrder(input.fallbackOrder);
  const fields = ['assignee', 'reporter', 'components', 'project', ...reviewerFieldIds];

  const response = await axios.get(`${api.baseUrl}/issue/${issueKey}`, {
    headers,
    params: { fields: fields.join(',') }
  });

  const issue = response.data;
  const issueFields = issue.fields ?? {};
  const warnings: string[] = [];
  let reviewers: ResolvedReviewer[] = [];

  for (const source of fallbackOrder) {
    const candidates = resolveReviewerSource(issueFields, source, reviewerFieldIds, warnings, issue.key ?? issueKey);
    if (candidates.length > 0) {
      reviewers = addUniqueReviewers(reviewers, candidates);
      break;
    }
  }

  const resolved = reviewers.length > 0;

  return {
    success: true,
    issueKey: issue.key ?? issueKey,
    resolved,
    reviewers,
    fallbackOrder,
    warnings,
    metadata: {
      project: issueFields.project ? {
        id: issueFields.project.id,
        key: issueFields.project.key,
        name: issueFields.project.name
      } : undefined,
      components: Array.isArray(issueFields.components)
        ? issueFields.components.map((component: any) => component.name).filter(Boolean)
        : []
    },
    message: resolved
      ? `Resolved ${reviewers.length} reviewer(s) for ${issue.key ?? issueKey}.`
      : `No reviewer could be resolved for ${issue.key ?? issueKey}. Ask a human to choose a reviewer or configure reviewerFieldIds.`
  };
}

function resolveReviewerSource(
  issueFields: any,
  source: ReviewerFallbackSource,
  reviewerFieldIds: string[],
  warnings: string[],
  issueKey: string
): ResolvedReviewer[] {
  if (source === 'customFields') {
    return reviewerFieldIds.flatMap((fieldId) => {
      if (!Object.prototype.hasOwnProperty.call(issueFields, fieldId)) {
        warnings.push(`Reviewer field "${fieldId}" was not present on ${issueKey}. Check the field ID or Jira screen configuration.`);
        return [];
      }

      const reviewers = normalizeReviewerValues(issueFields[fieldId], fieldId, fieldId);
      if (reviewers.length === 0) {
        warnings.push(`Reviewer field "${fieldId}" was present but empty on ${issueKey}.`);
      }
      return reviewers;
    });
  }

  const reviewers = normalizeReviewerValues(issueFields[source], source);
  if (reviewers.length === 0) {
    warnings.push(`Reviewer source "${source}" was empty on ${issueKey}.`);
  }
  return reviewers;
}

async function postProposalComment(api: JiraApiContext, headers: any, input: any): Promise<any> {
  const proposal = normalizeProposalCommentInput(input);
  const body = api.variant === 'cloud'
    ? buildProposalAdf(proposal)
    : buildProposalText(proposal);

  const response = await axios.post(`${api.baseUrl}/issue/${proposal.issueKey}/comment`, { body }, { headers });
  const commentId = response.data.id;
  const url = buildCommentUrl(api, proposal.issueKey, commentId);

  return {
    success: true,
    commentId,
    issueKey: proposal.issueKey,
    url,
    message: `Proposal comment posted to ${proposal.issueKey}.`
  };
}

function normalizeProposalCommentInput(input: any): ProposalCommentInput {
  return {
    issueKey: String(input.issueKey),
    summary: String(input.summary),
    affectedComponents: toStringArray(input.affectedComponents),
    proposedChanges: toStringArray(input.proposedChanges),
    riskLevel: String(input.riskLevel),
    approvalPrompt: String(input.approvalPrompt),
    details: input.details ? String(input.details) : undefined
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

async function getFields(baseUrl: string, headers: any): Promise<any> {
  const response = await axios.get(`${baseUrl}/field`, { headers });

  return {
    fields: response.data
  };
}

function normalizeFallbackOrder(input: unknown): ReviewerFallbackSource[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_REVIEWER_FALLBACK_ORDER];
  }

  return input.map((source) => {
    if (source === 'customFields' || source === 'assignee' || source === 'reporter') {
      return source;
    }
    throw new Error(`Unsupported reviewer fallback source "${String(source)}". Use customFields, assignee, or reporter.`);
  });
}

function normalizeReviewerValues(value: unknown, source: string, fieldId?: string): ResolvedReviewer[] {
  if (value === undefined || value === null || value === '') return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeReviewerValues(item, source, fieldId));
  }

  if (typeof value === 'string') {
    return [{
      source,
      displayName: value,
      username: value,
      fieldId
    }];
  }

  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const displayName = firstString(candidate.displayName, candidate.name, candidate.emailAddress, candidate.accountId, candidate.key);
    if (!displayName) return [];

    return [{
      source,
      displayName,
      accountId: stringOrUndefined(candidate.accountId),
      username: stringOrUndefined(candidate.name),
      key: stringOrUndefined(candidate.key),
      active: typeof candidate.active === 'boolean' ? candidate.active : undefined,
      fieldId
    }];
  }

  return [];
}

function addUniqueReviewers(existing: ResolvedReviewer[], candidates: ResolvedReviewer[]): ResolvedReviewer[] {
  const seen = new Set(existing.map(reviewerIdentityKey));
  const merged = [...existing];

  for (const candidate of candidates) {
    const key = reviewerIdentityKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(candidate);
    }
  }

  return merged;
}

function reviewerIdentityKey(reviewer: ResolvedReviewer): string {
  return reviewer.accountId ?? reviewer.username ?? reviewer.key ?? reviewer.displayName;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
}

function buildProposalAdf(input: ProposalCommentInput): AdfNode {
  return createAdfDocument([
    heading('Remediation Proposal', 2),
    heading('Summary', 3),
    paragraph(input.summary),
    heading('Affected components', 3),
    ...listOrParagraph(input.affectedComponents),
    heading('Proposed changes', 3),
    ...listOrParagraph(input.proposedChanges),
    heading('Risk level', 3),
    paragraph(input.riskLevel),
    heading('Approval prompt', 3),
    paragraph(input.approvalPrompt),
    ...(input.details ? [heading('Details', 3), paragraph(input.details)] : [])
  ]);
}

function buildProposalText(input: ProposalCommentInput): string {
  return [
    'h2. Remediation Proposal',
    '',
    'h3. Summary',
    input.summary,
    '',
    'h3. Affected components',
    formatWikiList(input.affectedComponents),
    '',
    'h3. Proposed changes',
    formatWikiList(input.proposedChanges),
    '',
    'h3. Risk level',
    input.riskLevel,
    '',
    'h3. Approval prompt',
    input.approvalPrompt,
    ...(input.details ? ['', 'h3. Details', input.details] : [])
  ].join('\n');
}

function createAdfDocument(content: AdfNode[]): AdfNode {
  return {
    type: 'doc',
    version: 1,
    content
  } as AdfNode;
}

function heading(text: string, level: number): AdfNode {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  };
}

function paragraph(text: string): AdfNode {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }]
  };
}

function listOrParagraph(items: string[]): AdfNode[] {
  if (items.length === 0) {
    return [paragraph('None specified')];
  }

  return [{
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraph(item)]
    }))
  }];
}

function formatWikiList(items: string[]): string {
  if (items.length === 0) return 'None specified';
  return items.map((item) => `* ${item}`).join('\n');
}

function buildCommentUrl(api: JiraApiContext, issueKey: string, commentId: unknown): string | undefined {
  if (!api.browseBaseUrl || !commentId) return undefined;
  return `${api.browseBaseUrl}/browse/${issueKey}?focusedCommentId=${commentId}`;
}

function normalizeJiraError(error: unknown): Error {
  const response = getErrorResponse(error);
  if (!response) {
    return error instanceof Error ? error : new Error('Jira tool failed with an unknown error.');
  }

  const detail = extractJiraErrorDetail(response.data);
  switch (response.status) {
    case 400:
      return new Error(`Jira rejected the request payload. Check the tool inputs and Jira field configuration.${detail}`);
    case 401:
    case 403:
      return new Error(`Jira authentication or permission error. Reconnect Jira or ask an administrator to grant access.${detail}`);
    case 404:
      return new Error(`Jira issue not found or not accessible. Check the issue key and permissions.${detail}`);
    default:
      return new Error(`Jira API request failed${response.status ? ` (${response.status})` : ''}. Check Jira connectivity and connection metadata.${detail}`);
  }
}

function getErrorResponse(error: unknown): { status?: number; data?: unknown } | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return undefined;
  }

  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  return response as { status?: number; data?: unknown };
}

function extractJiraErrorDetail(data: unknown): string {
  if (!data || typeof data !== 'object') return '';

  const record = data as Record<string, unknown>;
  const messages: string[] = [];

  if (typeof record.message === 'string') {
    messages.push(record.message);
  }

  if (Array.isArray(record.errorMessages)) {
    messages.push(...record.errorMessages.filter((message): message is string => typeof message === 'string'));
  }

  if (record.errors && typeof record.errors === 'object') {
    messages.push(...Object.entries(record.errors as Record<string, unknown>)
      .map(([field, message]) => `${field}: ${String(message)}`));
  }

  return messages.length > 0 ? ` Jira said: ${messages.join('; ')}` : '';
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

function formatIssueDetailed(issue: any, browseBaseUrl?: string): any {
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
    url: browseBaseUrl ? `${browseBaseUrl}/browse/${issue.key}` : undefined
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
      '- ' + extractBlockText(item)
    ).join('\n') || '';
  }

  if (block.type === 'listItem') {
    return block.content?.map(extractBlockText).join('') || '';
  }

  return '';
}
