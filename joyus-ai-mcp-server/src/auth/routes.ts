/**
 * Auth Routes
 * OAuth flows for connecting external services
 */

import axios from 'axios';
import { eq, and } from 'drizzle-orm';
import { Router, Request, Response } from 'express';

import { db, users, connections, oauthStates, type Service } from '../db/client.js';
import { encryptToken, generateMcpToken, generateOAuthState } from '../db/encryption.js';
import { requireSessionOrRedirect } from './middleware.js';

export const authRouter = Router();

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toJsStringLiteral(str: string): string {
  return JSON.stringify(str);
}

// OAuth configuration
const OAUTH_CONFIG = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/documents.readonly'
    ]
  },
  jira: {
    authUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access']
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['channels:history', 'channels:read', 'chat:write', 'users:read', 'search:read']
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user', 'read:org']
  }
};

// ============================================================
// Portal Home - Shows connection status and MCP URL
// ============================================================

authRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.session?.userId;

  if (!userId) {
    // Show login page
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Joyus AI - Connect</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          h1 { color: #1a1a2e; }
          .btn { display: inline-block; padding: 12px 24px; background: #0066cc; color: white; text-decoration: none; border-radius: 6px; margin: 8px 4px; }
          .btn:hover { background: #0052a3; }
          .info { background: #f0f4ff; padding: 16px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h1>🔌 Joyus AI</h1>
        <p>Connect your work tools to use them with Claude Desktop.</p>

        <div class="info">
          <strong>Step 1:</strong> Sign in with Google (organization account)
        </div>

        <a href="/auth/google/start" class="btn">Sign in with Google</a>
      </body>
      </html>
    `);
  }

  // Show dashboard
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    req.session.userId = undefined;
    return res.redirect('/auth');
  }

  const userConnections = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, userId));

  const connectedServices = new Set(userConnections.map((c) => c.service));
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const safeDisplayName = escapeHtml(user.name || user.email);
  const safeToken = escapeHtml(user.mcpToken);
  const baseUrlJsLiteral = toJsStringLiteral(baseUrl);
  const tokenJsLiteral = toJsStringLiteral(user.mcpToken);

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Joyus AI - Dashboard</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; }
        h1 { color: #1a1a2e; }
        .btn { display: inline-block; padding: 10px 20px; background: #0066cc; color: white; text-decoration: none; border-radius: 6px; margin: 4px; }
        .btn:hover { background: #0052a3; }
        .btn.connected { background: #28a745; }
        .btn.disconnect { background: #dc3545; font-size: 12px; padding: 6px 12px; }
        .mcp-url { background: #1a1a2e; color: #00ff88; padding: 16px; border-radius: 8px; font-family: monospace; word-break: break-all; margin: 20px 0; }
        .service { display: flex; align-items: center; justify-content: space-between; padding: 12px; border: 1px solid #ddd; border-radius: 6px; margin: 8px 0; }
        .status { font-size: 14px; color: #666; }
        .connected-status { color: #28a745; }
        .info { background: #fff3cd; padding: 16px; border-radius: 8px; margin: 20px 0; }
        .copy-btn { background: #6c757d; padding: 6px 12px; border: none; color: white; border-radius: 4px; cursor: pointer; margin-left: 10px; }
      </style>
    </head>
    <body>
      <h1>🔌 Joyus AI</h1>
      <p>Welcome, <strong>${safeDisplayName}</strong></p>

      <h2>Your MCP Connection URL</h2>
      <div class="mcp-url">
        ${escapeHtml(baseUrl)}/mcp
        <button class="copy-btn" onclick='navigator.clipboard.writeText(${baseUrlJsLiteral} + "/mcp")'>Copy</button>
      </div>

      <div class="mcp-url">
        Token: ${safeToken}
        <button class="copy-btn" onclick='navigator.clipboard.writeText(${tokenJsLiteral})'>Copy</button>
      </div>

      <div class="info">
        <strong>Claude Desktop Setup:</strong><br>
        1. Open Claude Desktop Settings → Connectors<br>
        2. Add a new MCP server with the URL above<br>
        3. Use the token as Bearer authentication
      </div>

      <h2>Connected Services</h2>

      <div class="service">
        <div>
          <strong>Google</strong> (Gmail, Drive, Docs)
          <div class="status ${connectedServices.has('GOOGLE') ? 'connected-status' : ''}">
            ${connectedServices.has('GOOGLE') ? '✅ Connected' : '❌ Not connected'}
          </div>
        </div>
        ${connectedServices.has('GOOGLE')
          ? '<a href="/auth/google/disconnect" class="btn disconnect">Disconnect</a>'
          : '<a href="/auth/google/start" class="btn">Connect</a>'}
      </div>

      <div class="service">
        <div>
          <strong>Jira</strong> (Issues, Projects)
          <div class="status ${connectedServices.has('JIRA') ? 'connected-status' : ''}">
            ${connectedServices.has('JIRA') ? '✅ Connected' : '❌ Not connected'}
          </div>
        </div>
        ${connectedServices.has('JIRA')
          ? '<a href="/auth/jira/disconnect" class="btn disconnect">Disconnect</a>'
          : '<a href="/auth/jira/start" class="btn">Connect</a>'}
      </div>

      <div class="service">
        <div>
          <strong>Slack</strong> (Messages, Channels)
          <div class="status ${connectedServices.has('SLACK') ? 'connected-status' : ''}">
            ${connectedServices.has('SLACK') ? '✅ Connected' : '❌ Not connected'}
          </div>
        </div>
        ${connectedServices.has('SLACK')
          ? '<a href="/auth/slack/disconnect" class="btn disconnect">Disconnect</a>'
          : '<a href="/auth/slack/start" class="btn">Connect</a>'}
      </div>

      <div class="service">
        <div>
          <strong>GitHub</strong> (Repos, PRs, Issues)
          <div class="status ${connectedServices.has('GITHUB') ? 'connected-status' : ''}">
            ${connectedServices.has('GITHUB') ? '✅ Connected' : '❌ Not connected'}
          </div>
        </div>
        ${connectedServices.has('GITHUB')
          ? '<a href="/auth/github/disconnect" class="btn disconnect">Disconnect</a>'
          : '<a href="/auth/github/start" class="btn">Connect</a>'}
      </div>

      <p style="margin-top: 40px; color: #666;"><a href="/auth/logout">Sign out</a></p>
    </body>
    </html>
  `);
});

// ============================================================
// Google OAuth (also used for initial login)
// ============================================================

authRouter.get('/google/start', async (req: Request, res: Response) => {
  const state = generateOAuthState();
  const userId = req.session?.userId;

  // Store state
  await db.insert(oauthStates).values({
    state,
    userId: userId || 'pending',
    service: 'GOOGLE',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 min
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.BASE_URL}/auth/google/callback`,
    response_type: 'code',
    scope: OAUTH_CONFIG.google.scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    hd: 'example.com' // Restrict to organization domain — change to your domain
  });

  res.redirect(`${OAUTH_CONFIG.google.authUrl}?${params}`);
});

authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  // Verify state
  const [oauthState] = await db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.state, state as string))
    .limit(1);

  if (!oauthState || oauthState.expiresAt < new Date()) {
    return res.status(400).send('Invalid or expired state');
  }

  // Clean up state
  await db.delete(oauthStates).where(eq(oauthStates.id, oauthState.id));

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(OAUTH_CONFIG.google.tokenUrl, {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.BASE_URL}/auth/google/callback`
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user info
    const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const { email, name } = userInfoResponse.data;

    // Verify organization domain — change to your domain
    if (!email.endsWith('@example.com')) {
      return res.status(403).send('Only organization accounts are allowed');
    }

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          name,
          mcpToken: generateMcpToken()
        })
        .returning();
      user = newUser;
    }

    // Upsert Google connection
    const [existingConnection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, user.id),
          eq(connections.service, 'GOOGLE')
        )
      )
      .limit(1);

    if (existingConnection) {
      await db
        .update(connections)
        .set({
          accessToken: encryptToken(access_token),
          refreshToken: refresh_token ? encryptToken(refresh_token) : null,
          expiresAt: new Date(Date.now() + expires_in * 1000),
          updatedAt: new Date()
        })
        .where(eq(connections.id, existingConnection.id));
    } else {
      await db.insert(connections).values({
        userId: user.id,
        service: 'GOOGLE',
        accessToken: encryptToken(access_token),
        refreshToken: refresh_token ? encryptToken(refresh_token) : null,
        expiresAt: new Date(Date.now() + expires_in * 1000)
      });
    }

    // Set session
    req.session.userId = user.id;

    res.redirect('/auth');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Google OAuth error:', message);
    res.status(500).send('Authentication failed');
  }
});

// ============================================================
// Jira OAuth
// ============================================================

authRouter.get('/jira/start', requireSessionOrRedirect, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const state = generateOAuthState();

  await db.insert(oauthStates).values({
    state,
    userId,
    service: 'JIRA',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: process.env.ATLASSIAN_CLIENT_ID!,
    scope: OAUTH_CONFIG.jira.scopes.join(' '),
    redirect_uri: `${process.env.BASE_URL}/auth/jira/callback`,
    state,
    response_type: 'code',
    prompt: 'consent'
  });

  res.redirect(`${OAUTH_CONFIG.jira.authUrl}?${params}`);
});

authRouter.get('/jira/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  const [oauthState] = await db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.state, state as string))
    .limit(1);

  if (!oauthState || oauthState.expiresAt < new Date() || oauthState.service !== 'JIRA') {
    return res.status(400).send('Invalid or expired state');
  }

  await db.delete(oauthStates).where(eq(oauthStates.id, oauthState.id));

  try {
    const tokenResponse = await axios.post(OAUTH_CONFIG.jira.tokenUrl, {
      grant_type: 'authorization_code',
      client_id: process.env.ATLASSIAN_CLIENT_ID,
      client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.BASE_URL}/auth/jira/callback`
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get accessible resources (cloud IDs)
    const resourcesResponse = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const resources = resourcesResponse.data;

    // Upsert Jira connection
    const [existingConnection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, oauthState.userId),
          eq(connections.service, 'JIRA')
        )
      )
      .limit(1);

    if (existingConnection) {
      await db
        .update(connections)
        .set({
          accessToken: encryptToken(access_token),
          refreshToken: refresh_token ? encryptToken(refresh_token) : null,
          expiresAt: new Date(Date.now() + expires_in * 1000),
          metadata: { resources },
          updatedAt: new Date()
        })
        .where(eq(connections.id, existingConnection.id));
    } else {
      await db.insert(connections).values({
        userId: oauthState.userId,
        service: 'JIRA',
        accessToken: encryptToken(access_token),
        refreshToken: refresh_token ? encryptToken(refresh_token) : null,
        expiresAt: new Date(Date.now() + expires_in * 1000),
        metadata: { resources }
      });
    }

    res.redirect('/auth');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Jira OAuth error:', message);
    res.status(500).send('Jira authentication failed');
  }
});

// ============================================================
// Slack OAuth
// ============================================================

authRouter.get('/slack/start', requireSessionOrRedirect, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const state = generateOAuthState();

  await db.insert(oauthStates).values({
    state,
    userId,
    service: 'SLACK',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });

  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    user_scope: OAUTH_CONFIG.slack.scopes.join(','),
    redirect_uri: `${process.env.BASE_URL}/auth/slack/callback`,
    state
  });

  res.redirect(`${OAUTH_CONFIG.slack.authUrl}?${params}`);
});

authRouter.get('/slack/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  const [oauthState] = await db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.state, state as string))
    .limit(1);

  if (!oauthState || oauthState.expiresAt < new Date() || oauthState.service !== 'SLACK') {
    return res.status(400).send('Invalid or expired state');
  }

  await db.delete(oauthStates).where(eq(oauthStates.id, oauthState.id));

  try {
    const tokenResponse = await axios.post(OAUTH_CONFIG.slack.tokenUrl, null, {
      params: {
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: `${process.env.BASE_URL}/auth/slack/callback`
      }
    });

    const { authed_user, team } = tokenResponse.data;

    // Upsert Slack connection
    const [existingConnection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, oauthState.userId),
          eq(connections.service, 'SLACK')
        )
      )
      .limit(1);

    if (existingConnection) {
      await db
        .update(connections)
        .set({
          accessToken: encryptToken(authed_user.access_token),
          metadata: { team, slackUserId: authed_user.id },
          updatedAt: new Date()
        })
        .where(eq(connections.id, existingConnection.id));
    } else {
      await db.insert(connections).values({
        userId: oauthState.userId,
        service: 'SLACK',
        accessToken: encryptToken(authed_user.access_token),
        metadata: { team, slackUserId: authed_user.id }
      });
    }

    res.redirect('/auth');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slack OAuth error:', message);
    res.status(500).send('Slack authentication failed');
  }
});

// ============================================================
// GitHub OAuth
// ============================================================

authRouter.get('/github/start', requireSessionOrRedirect, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;
  const state = generateOAuthState();

  await db.insert(oauthStates).values({
    state,
    userId,
    service: 'GITHUB',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${process.env.BASE_URL}/auth/github/callback`,
    scope: OAUTH_CONFIG.github.scopes.join(' '),
    state
  });

  res.redirect(`${OAUTH_CONFIG.github.authUrl}?${params}`);
});

authRouter.get('/github/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  const [oauthState] = await db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.state, state as string))
    .limit(1);

  if (!oauthState || oauthState.expiresAt < new Date() || oauthState.service !== 'GITHUB') {
    return res.status(400).send('Invalid or expired state');
  }

  await db.delete(oauthStates).where(eq(oauthStates.id, oauthState.id));

  try {
    const tokenResponse = await axios.post(OAUTH_CONFIG.github.tokenUrl, {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.BASE_URL}/auth/github/callback`
    }, {
      headers: { Accept: 'application/json' }
    });

    const { access_token } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    // Upsert GitHub connection
    const [existingConnection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, oauthState.userId),
          eq(connections.service, 'GITHUB')
        )
      )
      .limit(1);

    if (existingConnection) {
      await db
        .update(connections)
        .set({
          accessToken: encryptToken(access_token),
          metadata: { login: userResponse.data.login },
          updatedAt: new Date()
        })
        .where(eq(connections.id, existingConnection.id));
    } else {
      await db.insert(connections).values({
        userId: oauthState.userId,
        service: 'GITHUB',
        accessToken: encryptToken(access_token),
        metadata: { login: userResponse.data.login }
      });
    }

    res.redirect('/auth');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GitHub OAuth error:', message);
    res.status(500).send('GitHub authentication failed');
  }
});

// ============================================================
// Disconnect & Logout
// ============================================================

authRouter.get('/:service/disconnect', requireSessionOrRedirect, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const service = req.params.service.toUpperCase() as Service;

  try {
    await db
      .delete(connections)
      .where(
        and(
          eq(connections.userId, userId),
          eq(connections.service, service)
        )
      );
  } catch {
    // Ignore if not found
  }

  res.redirect('/auth');
});

authRouter.get('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/auth');
  });
});
