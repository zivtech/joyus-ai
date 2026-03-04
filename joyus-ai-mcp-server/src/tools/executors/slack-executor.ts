/**
 * Slack Tool Executor
 * Executes Slack API calls using OAuth tokens
 */

import axios from 'axios';

import { ExecutorContext } from '../executor.js';

const SLACK_API_BASE = 'https://slack.com/api';

/**
 * Execute a Slack tool
 */
export async function executeSlackTool(
  toolName: string,
  input: any,
  context: ExecutorContext
): Promise<any> {
  const headers = {
    Authorization: `Bearer ${context.accessToken}`,
    'Content-Type': 'application/json'
  };

  switch (toolName) {
    case 'slack_search_messages':
      return searchMessages(headers, input);

    case 'slack_get_channel_history':
      return getChannelHistory(headers, input, context);

    case 'slack_post_message':
      return postMessage(headers, input, context);

    case 'slack_list_channels':
      return listChannels(headers, input);

    case 'slack_get_user_info':
      return getUserInfo(headers, input);

    case 'slack_get_thread':
      return getThread(headers, input, context);

    default:
      throw new Error(`Unknown Slack tool: ${toolName}`);
  }
}

async function searchMessages(headers: any, input: any): Promise<any> {
  const { query, count = 20, sort = 'score' } = input;

  const response = await axios.post(`${SLACK_API_BASE}/search.messages`, null, {
    headers,
    params: {
      query,
      count: Math.min(count, 100),
      sort,
      sort_dir: 'desc'
    }
  });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  return {
    total: response.data.messages.total,
    messages: response.data.messages.matches.map(formatSearchResult)
  };
}

async function getChannelHistory(headers: any, input: any, context: ExecutorContext): Promise<any> {
  const { channel, limit = 50, oldest } = input;

  // Resolve channel name to ID if needed
  const channelId = await resolveChannel(headers, channel);

  const params: any = {
    channel: channelId,
    limit: Math.min(limit, 100)
  };
  if (oldest) params.oldest = oldest;

  const response = await axios.get(`${SLACK_API_BASE}/conversations.history`, {
    headers,
    params
  });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  return {
    channel: channel,
    messages: response.data.messages.map(formatMessage)
  };
}

async function postMessage(headers: any, input: any, context: ExecutorContext): Promise<any> {
  const { channel, text, thread_ts } = input;

  // Resolve channel name to ID if needed
  const channelId = await resolveChannel(headers, channel);

  const body: any = {
    channel: channelId,
    text
  };
  if (thread_ts) body.thread_ts = thread_ts;

  const response = await axios.post(`${SLACK_API_BASE}/chat.postMessage`, body, { headers });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  return {
    success: true,
    channel: channel,
    timestamp: response.data.ts,
    message: `Message posted to ${channel}`
  };
}

async function listChannels(headers: any, input: any): Promise<any> {
  const { limit = 100, types = 'public_channel' } = input;

  const response = await axios.get(`${SLACK_API_BASE}/conversations.list`, {
    headers,
    params: {
      limit: Math.min(limit, 1000),
      types
    }
  });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  return {
    channels: response.data.channels.map((c: any) => ({
      id: c.id,
      name: c.name,
      topic: c.topic?.value,
      purpose: c.purpose?.value,
      memberCount: c.num_members,
      isPrivate: c.is_private
    }))
  };
}

async function getUserInfo(headers: any, input: any): Promise<any> {
  let { user } = input;

  // If user starts with @, look up by name
  if (user.startsWith('@')) {
    const username = user.substring(1);
    const listResponse = await axios.get(`${SLACK_API_BASE}/users.list`, {
      headers,
      params: { limit: 500 }
    });

    if (!listResponse.data.ok) {
      throw new Error(`Slack API error: ${listResponse.data.error}`);
    }

    const foundUser = listResponse.data.members.find(
      (m: any) => m.name === username || m.profile?.display_name === username
    );

    if (!foundUser) {
      throw new Error(`User "${user}" not found`);
    }

    user = foundUser.id;
  }

  const response = await axios.get(`${SLACK_API_BASE}/users.info`, {
    headers,
    params: { user }
  });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  const u = response.data.user;
  return {
    id: u.id,
    name: u.name,
    realName: u.real_name,
    displayName: u.profile?.display_name,
    email: u.profile?.email,
    title: u.profile?.title,
    timezone: u.tz,
    isAdmin: u.is_admin,
    isBot: u.is_bot
  };
}

async function getThread(headers: any, input: any, context: ExecutorContext): Promise<any> {
  const { channel, thread_ts } = input;

  const channelId = await resolveChannel(headers, channel);

  const response = await axios.get(`${SLACK_API_BASE}/conversations.replies`, {
    headers,
    params: {
      channel: channelId,
      ts: thread_ts
    }
  });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  return {
    channel: channel,
    threadTs: thread_ts,
    messages: response.data.messages.map(formatMessage)
  };
}

// Helper: Resolve channel name to ID
async function resolveChannel(headers: any, channel: string): Promise<string> {
  // If it looks like an ID already, return it
  if (channel.startsWith('C') || channel.startsWith('D') || channel.startsWith('G')) {
    return channel;
  }

  // Strip # if present
  const channelName = channel.replace(/^#/, '');

  // Look up channel by name
  const response = await axios.get(`${SLACK_API_BASE}/conversations.list`, {
    headers,
    params: { limit: 500, types: 'public_channel,private_channel' }
  });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  const found = response.data.channels.find((c: any) => c.name === channelName);
  if (!found) {
    throw new Error(`Channel "${channel}" not found`);
  }

  return found.id;
}

// Formatters
function formatMessage(msg: any): any {
  return {
    timestamp: msg.ts,
    user: msg.user,
    text: msg.text,
    reactions: msg.reactions?.map((r: any) => `${r.name}: ${r.count}`),
    threadReplies: msg.reply_count,
    edited: !!msg.edited,
    time: new Date(parseFloat(msg.ts) * 1000).toISOString()
  };
}

function formatSearchResult(match: any): any {
  return {
    timestamp: match.ts,
    channel: match.channel?.name,
    user: match.username,
    text: match.text,
    permalink: match.permalink,
    time: new Date(parseFloat(match.ts) * 1000).toISOString()
  };
}
