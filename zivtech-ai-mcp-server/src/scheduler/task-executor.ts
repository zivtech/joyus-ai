/**
 * Task Executor
 *
 * Implements each scheduled task type by composing existing tools.
 * Each task type gathers data, processes it, and returns a summary.
 */

import { DateTime } from 'luxon';

import { executeTool } from '../tools/executor.js';

// Type helpers for tool results
interface JiraSearchResult {
  issues?: { key: string; summary: string; status: string; assignee?: string; duedate?: string; priority?: string; storyPoints?: number; updated?: string }[];
  total?: number;
}

interface SlackMessagesResult {
  messages?: { text?: string; user?: string; channel?: string; threadReplies?: number }[];
  total?: number;
}

interface GithubPRsResult {
  pullRequests?: { number: number; title: string; url: string; author?: string; created?: string; updated?: string; draft?: boolean }[];
}

interface GithubReposResult {
  repositories?: { fullName: string; name: string }[];
}

interface GmailSearchResult {
  messages?: { subject?: string; from?: string; date?: string }[];
  total?: number;
}

interface TaskConfig {
  // Jira configs
  project?: string;
  jql?: string;
  team?: string[];
  sprintId?: string;
  daysOverdue?: number;

  // Slack configs
  channel?: string;
  lookbackHours?: number;

  // GitHub configs
  repo?: string;
  org?: string;
  staleDays?: number;

  // Gmail configs
  query?: string;

  // Custom tool sequence
  tools?: { name: string; input: any }[];
}

/**
 * Execute a scheduled task based on its type
 */
export async function executeScheduledTask(task: any, user: any): Promise<any> {
  const config = task.config as TaskConfig;

  switch (task.taskType) {
    // ========================================
    // JIRA TASKS
    // ========================================

    case 'JIRA_STANDUP_SUMMARY':
      return executeJiraStandupSummary(user.id, config);

    case 'JIRA_OVERDUE_ALERT':
      return executeJiraOverdueAlert(user.id, config);

    case 'JIRA_SPRINT_REPORT':
      return executeJiraSprintReport(user.id, config);

    // ========================================
    // SLACK TASKS
    // ========================================

    case 'SLACK_CHANNEL_DIGEST':
      return executeSlackChannelDigest(user.id, config);

    case 'SLACK_MENTIONS_SUMMARY':
      return executeSlackMentionsSummary(user.id, config);

    // ========================================
    // GITHUB TASKS
    // ========================================

    case 'GITHUB_PR_REMINDER':
      return executeGithubPRReminder(user.id, config);

    case 'GITHUB_STALE_PR_ALERT':
      return executeGithubStalePRAlert(user.id, config);

    case 'GITHUB_RELEASE_NOTES':
      return executeGithubReleaseNotes(user.id, config);

    // ========================================
    // GOOGLE TASKS
    // ========================================

    case 'GMAIL_DIGEST':
      return executeGmailDigest(user.id, config);

    // ========================================
    // CROSS-SERVICE TASKS
    // ========================================

    case 'WEEKLY_STATUS_REPORT':
      return executeWeeklyStatusReport(user.id, config);

    case 'CUSTOM_TOOL_SEQUENCE':
      return executeCustomToolSequence(user.id, config);

    default:
      throw new Error(`Unknown task type: ${task.taskType}`);
  }
}

// ============================================================
// JIRA TASK IMPLEMENTATIONS
// ============================================================

async function executeJiraStandupSummary(userId: string, config: TaskConfig): Promise<any> {
  const yesterday = DateTime.now().minus({ days: 1 }).toISODate();
  const today = DateTime.now().toISODate();

  // Get issues updated in the last 24 hours
  const jql = config.jql ||
    `project = ${config.project || 'PROJ'} AND updated >= "${yesterday}" ORDER BY updated DESC`;

  const result = await executeTool(userId, 'jira_search_issues', {
    jql,
    maxResults: 50,
    fields: ['summary', 'status', 'assignee', 'updated', 'priority']
  }) as JiraSearchResult;

  // Group by status
  const byStatus: Record<string, any[]> = {};
  for (const issue of result.issues || []) {
    const status = issue.status || 'Unknown';
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(issue);
  }

  // Generate summary
  const summary = {
    date: today,
    project: config.project,
    totalUpdated: result.issues?.length || 0,
    byStatus,
    highlights: result.issues?.slice(0, 5).map((i: any) => ({
      key: i.key,
      summary: i.summary,
      status: i.status,
      assignee: i.assignee
    }))
  };

  return {
    type: 'standup_summary',
    title: `Standup Summary - ${today}`,
    summary,
    markdown: formatStandupMarkdown(summary)
  };
}

async function executeJiraOverdueAlert(userId: string, config: TaskConfig): Promise<any> {
  const daysOverdue = config.daysOverdue || 3;
  const overdueDate = DateTime.now().minus({ days: daysOverdue }).toISODate();

  const jql = config.jql ||
    `project = ${config.project || 'PROJ'} AND duedate < "${overdueDate}" AND status not in (Done, Closed) ORDER BY duedate ASC`;

  const result = await executeTool(userId, 'jira_search_issues', {
    jql,
    maxResults: 30,
    fields: ['summary', 'status', 'assignee', 'duedate', 'priority']
  }) as JiraSearchResult;

  return {
    type: 'overdue_alert',
    title: `Overdue Issues Alert`,
    count: result.issues?.length || 0,
    issues: result.issues,
    markdown: formatOverdueMarkdown(result.issues || [])
  };
}

async function executeJiraSprintReport(userId: string, config: TaskConfig): Promise<any> {
  // Get current sprint issues
  const jql = config.jql ||
    `project = ${config.project || 'PROJ'} AND sprint in openSprints() ORDER BY status, priority DESC`;

  const result = await executeTool(userId, 'jira_search_issues', {
    jql,
    maxResults: 100,
    fields: ['summary', 'status', 'assignee', 'storyPoints', 'priority']
  }) as JiraSearchResult;

  // Calculate stats
  const issues = result.issues || [];
  const byStatus: Record<string, number> = {};
  for (const issue of issues) {
    const status = issue.status || 'Unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  const done = byStatus['Done'] || 0;
  const total = issues.length;
  const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    type: 'sprint_report',
    title: `Sprint Progress Report`,
    stats: {
      total,
      byStatus,
      progressPercent
    },
    issues: issues.slice(0, 20),
    markdown: formatSprintMarkdown({ total, byStatus, progressPercent })
  };
}

// ============================================================
// SLACK TASK IMPLEMENTATIONS
// ============================================================

async function executeSlackChannelDigest(userId: string, config: TaskConfig): Promise<any> {
  const channel = config.channel || 'general';
  const lookbackHours = config.lookbackHours || 24;

  const oldest = DateTime.now().minus({ hours: lookbackHours }).toSeconds().toString();

  const result = await executeTool(userId, 'slack_get_channel_history', {
    channel,
    limit: 100,
    oldest
  }) as SlackMessagesResult;

  const messages = result.messages || [];

  // Find threads with most engagement
  const threads = messages
    .filter((m: any) => m.threadReplies > 0)
    .sort((a: any, b: any) => (b.threadReplies || 0) - (a.threadReplies || 0))
    .slice(0, 5);

  return {
    type: 'channel_digest',
    title: `#${channel} Digest`,
    channel,
    period: `Last ${lookbackHours} hours`,
    messageCount: messages.length,
    topThreads: threads,
    recentMessages: messages.slice(0, 10),
    markdown: formatChannelDigestMarkdown(channel, messages, threads)
  };
}

async function executeSlackMentionsSummary(userId: string, config: TaskConfig): Promise<any> {
  // Search for @mentions of the user
  const result = await executeTool(userId, 'slack_search_messages', {
    query: 'to:me',
    count: 50
  }) as SlackMessagesResult;

  return {
    type: 'mentions_summary',
    title: `Your Mentions Summary`,
    count: result.total || 0,
    messages: result.messages?.slice(0, 20),
    markdown: formatMentionsMarkdown(result.messages || [])
  };
}

// ============================================================
// GITHUB TASK IMPLEMENTATIONS
// ============================================================

async function executeGithubPRReminder(userId: string, config: TaskConfig): Promise<any> {
  const repo = config.repo;
  const org = config.org || 'zivtech';

  let prs: any[] = [];

  if (repo) {
    // Single repo
    const result = await executeTool(userId, 'github_list_prs', { repo, state: 'open' }) as GithubPRsResult;
    prs = result.pullRequests || [];
  } else {
    // Get repos from org and check each
    const repos = await executeTool(userId, 'github_list_repos', { org, per_page: 20 }) as GithubReposResult;
    for (const r of (repos.repositories || []).slice(0, 10)) {
      try {
        const result = await executeTool(userId, 'github_list_prs', {
          repo: r.fullName,
          state: 'open',
          per_page: 10
        }) as GithubPRsResult;
        prs.push(...(result.pullRequests || []).map((pr: any) => ({ ...pr, repo: r.fullName })));
      } catch (e) {
        // Skip repos with errors
      }
    }
  }

  // Filter PRs needing review (no recent reviews)
  const needsReview = prs.filter((pr: any) => !pr.draft);

  return {
    type: 'pr_reminder',
    title: `Open PRs Needing Review`,
    count: needsReview.length,
    pullRequests: needsReview.slice(0, 20),
    markdown: formatPRReminderMarkdown(needsReview)
  };
}

async function executeGithubStalePRAlert(userId: string, config: TaskConfig): Promise<any> {
  const repo = config.repo!;
  const staleDays = config.staleDays || 7;

  const result = await executeTool(userId, 'github_list_prs', { repo, state: 'open' }) as GithubPRsResult;
  const prs = result.pullRequests || [];

  const staleDate = DateTime.now().minus({ days: staleDays });
  const stalePRs = prs.filter((pr: any) => {
    const updated = DateTime.fromISO(pr.updated);
    return updated < staleDate;
  });

  return {
    type: 'stale_pr_alert',
    title: `Stale PRs (>${staleDays} days)`,
    repo,
    count: stalePRs.length,
    pullRequests: stalePRs,
    markdown: formatStalePRMarkdown(stalePRs, staleDays)
  };
}

async function executeGithubReleaseNotes(userId: string, config: TaskConfig): Promise<any> {
  const repo = config.repo!;

  // Get recent merged PRs
  const result = await executeTool(userId, 'github_list_prs', {
    repo,
    state: 'closed',
    per_page: 30
  }) as GithubPRsResult;

  const mergedPRs = (result.pullRequests || []).filter((pr: any) => {
    // Only PRs merged in the last week
    const merged = DateTime.fromISO(pr.updated);
    return merged > DateTime.now().minus({ days: 7 });
  });

  // Group by type (based on title/labels)
  const features = mergedPRs.filter((pr: any) =>
    pr.title.toLowerCase().includes('feat') || pr.title.toLowerCase().includes('add')
  );
  const fixes = mergedPRs.filter((pr: any) =>
    pr.title.toLowerCase().includes('fix') || pr.title.toLowerCase().includes('bug')
  );
  const other = mergedPRs.filter((pr: any) =>
    !features.includes(pr) && !fixes.includes(pr)
  );

  return {
    type: 'release_notes',
    title: `Release Notes Draft`,
    repo,
    period: 'Last 7 days',
    features,
    fixes,
    other,
    markdown: formatReleaseNotesMarkdown(repo, features, fixes, other)
  };
}

// ============================================================
// GOOGLE TASK IMPLEMENTATIONS
// ============================================================

async function executeGmailDigest(userId: string, config: TaskConfig): Promise<any> {
  const query = config.query || 'is:unread';

  const result = await executeTool(userId, 'gmail_search', {
    query,
    maxResults: 20
  }) as GmailSearchResult;

  return {
    type: 'gmail_digest',
    title: `Email Digest`,
    query,
    count: result.total || 0,
    messages: result.messages,
    markdown: formatGmailDigestMarkdown(result.messages || [])
  };
}

// ============================================================
// CROSS-SERVICE TASK IMPLEMENTATIONS
// ============================================================

async function executeWeeklyStatusReport(userId: string, config: TaskConfig): Promise<any> {
  const results: any = {
    jira: null,
    github: null,
    slack: null,
    generated: DateTime.now().toISO()
  };

  // Gather Jira data
  try {
    results.jira = await executeJiraSprintReport(userId, config);
  } catch (e: any) {
    results.jira = { error: e.message };
  }

  // Gather GitHub data
  try {
    results.github = await executeGithubPRReminder(userId, config);
  } catch (e: any) {
    results.github = { error: e.message };
  }

  // Gather Slack data
  try {
    results.slack = await executeSlackMentionsSummary(userId, config);
  } catch (e: any) {
    results.slack = { error: e.message };
  }

  return {
    type: 'weekly_status_report',
    title: `Weekly Status Report`,
    results,
    markdown: formatWeeklyReportMarkdown(results)
  };
}

async function executeCustomToolSequence(userId: string, config: TaskConfig): Promise<any> {
  const tools = config.tools || [];
  const results: any[] = [];

  for (const tool of tools) {
    try {
      const result = await executeTool(userId, tool.name, tool.input);
      results.push({ tool: tool.name, success: true, result });
    } catch (error: any) {
      results.push({ tool: tool.name, success: false, error: error.message });
    }
  }

  return {
    type: 'custom_sequence',
    title: `Custom Tool Sequence`,
    toolCount: tools.length,
    results
  };
}

// ============================================================
// MARKDOWN FORMATTERS
// ============================================================

function formatStandupMarkdown(summary: any): string {
  let md = `# 📊 Standup Summary - ${summary.date}\n\n`;
  md += `**Project:** ${summary.project || 'All'}\n`;
  md += `**Issues Updated:** ${summary.totalUpdated}\n\n`;

  md += `## Status Breakdown\n`;
  for (const [status, issues] of Object.entries(summary.byStatus)) {
    md += `- **${status}:** ${(issues as any[]).length}\n`;
  }

  if (summary.highlights?.length > 0) {
    md += `\n## Recent Updates\n`;
    for (const issue of summary.highlights) {
      md += `- [${issue.key}] ${issue.summary} (${issue.status}) - ${issue.assignee}\n`;
    }
  }

  return md;
}

function formatOverdueMarkdown(issues: any[]): string {
  let md = `# ⚠️ Overdue Issues Alert\n\n`;
  md += `**${issues.length} issues are overdue**\n\n`;

  for (const issue of issues.slice(0, 15)) {
    md += `- [${issue.key}] ${issue.summary}\n`;
    md += `  - Assignee: ${issue.assignee || 'Unassigned'}\n`;
    md += `  - Due: ${issue.duedate || 'Unknown'}\n\n`;
  }

  return md;
}

function formatSprintMarkdown(stats: any): string {
  let md = `# 🏃 Sprint Progress Report\n\n`;
  md += `**Progress:** ${stats.progressPercent}% complete\n`;
  md += `**Total Issues:** ${stats.total}\n\n`;

  md += `## By Status\n`;
  for (const [status, count] of Object.entries(stats.byStatus)) {
    md += `- ${status}: ${count}\n`;
  }

  return md;
}

function formatChannelDigestMarkdown(channel: string, messages: any[], threads: any[]): string {
  let md = `# 💬 #${channel} Digest\n\n`;
  md += `**Messages:** ${messages.length}\n\n`;

  if (threads.length > 0) {
    md += `## Active Threads\n`;
    for (const t of threads) {
      md += `- ${t.text?.substring(0, 100)}... (${t.threadReplies} replies)\n`;
    }
  }

  return md;
}

function formatMentionsMarkdown(messages: any[]): string {
  let md = `# 📣 Your Mentions\n\n`;
  md += `**${messages.length} mentions**\n\n`;

  for (const m of messages.slice(0, 10)) {
    md += `- **${m.channel}** from ${m.user}: ${m.text?.substring(0, 100)}...\n`;
  }

  return md;
}

function formatPRReminderMarkdown(prs: any[]): string {
  let md = `# 🔍 PRs Needing Review\n\n`;
  md += `**${prs.length} open PRs**\n\n`;

  for (const pr of prs.slice(0, 15)) {
    md += `- [#${pr.number}](${pr.url}) ${pr.title}\n`;
    md += `  - Author: ${pr.author} | Created: ${pr.created}\n\n`;
  }

  return md;
}

function formatStalePRMarkdown(prs: any[], days: number): string {
  let md = `# 🕸️ Stale PRs (>${days} days)\n\n`;
  md += `**${prs.length} stale PRs**\n\n`;

  for (const pr of prs) {
    md += `- [#${pr.number}](${pr.url}) ${pr.title}\n`;
    md += `  - Last updated: ${pr.updated}\n\n`;
  }

  return md;
}

function formatReleaseNotesMarkdown(repo: string, features: any[], fixes: any[], other: any[]): string {
  let md = `# 📝 Release Notes - ${repo}\n\n`;

  if (features.length > 0) {
    md += `## ✨ Features\n`;
    for (const pr of features) {
      md += `- ${pr.title} (#${pr.number})\n`;
    }
    md += '\n';
  }

  if (fixes.length > 0) {
    md += `## 🐛 Bug Fixes\n`;
    for (const pr of fixes) {
      md += `- ${pr.title} (#${pr.number})\n`;
    }
    md += '\n';
  }

  if (other.length > 0) {
    md += `## 📦 Other Changes\n`;
    for (const pr of other) {
      md += `- ${pr.title} (#${pr.number})\n`;
    }
  }

  return md;
}

function formatGmailDigestMarkdown(messages: any[]): string {
  let md = `# 📧 Email Digest\n\n`;
  md += `**${messages.length} messages**\n\n`;

  for (const m of messages.slice(0, 15)) {
    md += `- **${m.subject}**\n`;
    md += `  - From: ${m.from} | ${m.date}\n\n`;
  }

  return md;
}

function formatWeeklyReportMarkdown(results: any): string {
  let md = `# 📊 Weekly Status Report\n\n`;
  md += `*Generated: ${results.generated}*\n\n`;

  if (results.jira && !results.jira.error) {
    md += `## Jira\n`;
    md += `- Sprint Progress: ${results.jira.stats?.progressPercent || 0}%\n`;
    md += `- Total Issues: ${results.jira.stats?.total || 0}\n\n`;
  }

  if (results.github && !results.github.error) {
    md += `## GitHub\n`;
    md += `- Open PRs: ${results.github.count || 0}\n\n`;
  }

  if (results.slack && !results.slack.error) {
    md += `## Slack\n`;
    md += `- Unread Mentions: ${results.slack.count || 0}\n`;
  }

  return md;
}
