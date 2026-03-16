/**
 * Event Adapter — Admin Panel Routes (WP12)
 *
 * Minimal, embedded web-based admin panel served at /event-adapter/admin.
 * Server-rendered HTML using template literals — no npm templating dependency.
 * Queries DB directly (same-process, same Drizzle patterns as other route files).
 * XSS prevention: all user-provided strings escaped via escapeHtml().
 *
 * Routes:
 *   GET /event-adapter/admin            → redirect to /event-adapter/admin/sources
 *   GET /event-adapter/admin/sources    → sources list page (T062)
 *   GET /event-adapter/admin/schedules  → schedules list page (T063)
 *   GET /event-adapter/admin/activity   → activity log page (T064)
 *   GET /event-adapter/admin/automation → automation destination page (T065)
 *
 * Note: direct DB queries are used here (pragmatic v1 shortcut — the panel is
 * server-side code in the same process, no security boundary is crossed).
 * Could be refactored to call internal REST handlers in a future iteration.
 */

import { Router, type Request, type Response } from 'express';
import { eq, and, or, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  eventSources,
  eventScheduledTasks,
  webhookEvents,
  automationDestinations,
} from '../schema.js';

// ============================================================
// TYPES
// ============================================================

export interface AdminRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
}

// ============================================================
// XSS PREVENTION
// ============================================================

/**
 * Escape user-provided strings before embedding in HTML output.
 * Must be applied to ALL data that originates from external input.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve tenant id from x-tenant-id header.
 * Returns null if missing (platform admin context).
 */
function resolveTenantId(req: Request): string | null {
  const header = req.headers['x-tenant-id'];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

/**
 * Format a Date (or null) for display in tables.
 */
function formatDate(date: Date | null | undefined): string {
  if (!date) return '<span style="color:#aaa">—</span>';
  return escapeHtml(new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
}

/**
 * Status badge HTML for event source / schedule lifecycle states.
 */
function lifecycleBadge(state: string): string {
  const classes: Record<string, string> = {
    active: 'badge-green',
    paused: 'badge-yellow',
    disabled: 'badge-red',
    archived: 'badge-gray',
  };
  const cls = classes[state] ?? 'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(state)}</span>`;
}

/**
 * Status badge HTML for webhook event statuses.
 */
function eventStatusBadge(status: string): string {
  const classes: Record<string, string> = {
    delivered: 'badge-green',
    pending: 'badge-blue',
    processing: 'badge-blue',
    failed: 'badge-red',
    dead_letter: 'badge-red',
  };
  const cls = classes[status] ?? 'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

/**
 * Tenant selector banner shown when no tenant header is present (platform admin).
 */
function platformAdminBanner(): string {
  return `
<div class="alert alert-warning">
  <strong>Platform admin view.</strong>
  Add the <code>x-tenant-id</code> header to scope data to a specific tenant.
  Showing all tenants.
</div>`;
}

// ============================================================
// HTML LAYOUT
// ============================================================

function renderLayout(title: string, content: string, activeNav: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Event Adapter Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
    .nav { background: #1a1a2e; padding: 1rem; display: flex; gap: 1.5rem; align-items: center; }
    .nav a { color: #a0a0c0; text-decoration: none; padding: 0.5rem 1rem; border-radius: 4px; }
    .nav a.active { background: #16213e; color: #fff; }
    .nav .brand { color: #fff; font-weight: 600; margin-right: auto; }
    .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #f8f9fa; text-align: left; padding: 0.75rem 1rem; font-size: 0.85rem; color: #666; text-transform: uppercase; }
    td { padding: 0.75rem 1rem; border-top: 1px solid #eee; font-size: 0.9rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge-green { background: #d4edda; color: #155724; }
    .badge-yellow { background: #fff3cd; color: #856404; }
    .badge-red { background: #f8d7da; color: #721c24; }
    .badge-gray { background: #e2e3e5; color: #383d41; }
    .badge-blue { background: #cce5ff; color: #004085; }
    .btn { display: inline-block; padding: 0.4rem 0.8rem; border-radius: 4px; border: 1px solid #ddd; background: #fff; cursor: pointer; font-size: 0.85rem; text-decoration: none; color: #333; }
    .btn-primary { background: #0d6efd; color: #fff; border-color: #0d6efd; }
    .btn-danger { background: #dc3545; color: #fff; border-color: #dc3545; }
    .btn-sm { padding: 0.2rem 0.5rem; font-size: 0.75rem; }
    .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1rem; }
    .filters { display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap; }
    .filters select, .filters input { padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; }
    .empty { text-align: center; padding: 3rem; color: #999; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .pagination { display: flex; justify-content: center; gap: 0.5rem; margin-top: 1rem; }
    .alert { padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .alert-warning { background: #fff3cd; color: #856404; }
    .alert-success { background: #d4edda; color: #155724; }
    code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.85em; }
    .mono { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.8rem; }
    .text-muted { color: #888; font-size: 0.85rem; }
    .stat-row { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .stat-card { background: #fff; border-radius: 8px; padding: 1rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); flex: 1; min-width: 150px; }
    .stat-card .label { font-size: 0.75rem; color: #888; text-transform: uppercase; margin-bottom: 0.25rem; }
    .stat-card .value { font-size: 1.5rem; font-weight: 700; }
    form.inline { display: inline; }
    input[type=text], input[type=url], input[type=password] { padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; width: 100%; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem; }
    .form-hint { font-size: 0.75rem; color: #888; margin-top: 0.2rem; }
  </style>
</head>
<body>
  <nav class="nav">
    <span class="brand">Event Adapter</span>
    <a href="/event-adapter/admin/sources" class="${activeNav === 'sources' ? 'active' : ''}">Sources</a>
    <a href="/event-adapter/admin/schedules" class="${activeNav === 'schedules' ? 'active' : ''}">Schedules</a>
    <a href="/event-adapter/admin/activity" class="${activeNav === 'activity' ? 'active' : ''}">Activity</a>
    <a href="/event-adapter/admin/automation" class="${activeNav === 'automation' ? 'active' : ''}">Automation</a>
  </nav>
  <div class="container">${content}</div>
</body>
</html>`;
}

// ============================================================
// T062: SOURCES PAGE
// ============================================================

function sourcesPageHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);

    const flash = req.query['flash'] ? escapeHtml(String(req.query['flash'])) : null;

    try {
      const rows = tenantId
        ? await deps.db
            .select()
            .from(eventSources)
            .where(
              or(
                eq(eventSources.tenantId, tenantId),
                eq(eventSources.isPlatformWide, true),
              ),
            )
            .limit(100)
        : await deps.db
            .select()
            .from(eventSources)
            .limit(100);

      const tableRows = rows.map((row) => {
        const webhookUrl = `/webhook/${escapeHtml(row.endpointSlug)}`;
        const isPaused = row.lifecycleState === 'paused';
        const isArchived = row.lifecycleState === 'archived';
        const toggleState = isPaused ? 'active' : 'paused';
        const toggleLabel = isPaused ? 'Resume' : 'Pause';

        return `<tr>
          <td><strong>${escapeHtml(row.name)}</strong><br><span class="text-muted mono">${escapeHtml(row.id)}</span></td>
          <td><span class="badge badge-gray">${escapeHtml(row.sourceType)}</span></td>
          <td><code class="mono">${webhookUrl}</code></td>
          <td><span class="badge badge-gray">${escapeHtml(row.authMethod)}</span></td>
          <td>${lifecycleBadge(row.lifecycleState)}</td>
          <td>
            ${!isArchived ? `
            <form class="inline" method="POST" action="/event-adapter/admin/sources/${escapeHtml(row.id)}/lifecycle">
              <input type="hidden" name="state" value="${toggleState}">
              <button class="btn btn-sm" type="submit">${toggleLabel}</button>
            </form>
            <form class="inline" method="POST" action="/event-adapter/admin/sources/${escapeHtml(row.id)}/lifecycle"
                  onsubmit="return confirm('Archive this source?')">
              <input type="hidden" name="state" value="archived">
              <button class="btn btn-sm btn-danger" type="submit">Archive</button>
            </form>` : '<span class="text-muted">archived</span>'}
          </td>
        </tr>`;
      }).join('');

      const content = `
        ${tenantId === null ? platformAdminBanner() : ''}
        ${flash ? `<div class="alert alert-success">${flash}</div>` : ''}
        <div class="header">
          <h2>Event Sources</h2>
          <span class="text-muted">${rows.length} source(s)</span>
        </div>
        ${rows.length === 0 ? `
          <div class="card">
            <div class="empty">No event sources configured.</div>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Webhook URL</th>
                <th>Auth</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        `}`;

      res.status(200).send(renderLayout('Sources', content, 'sources'));
    } catch (err) {
      console.error('[admin] sources page error', err);
      const content = `<div class="alert alert-warning">Failed to load sources. Check server logs.</div>`;
      res.status(500).send(renderLayout('Sources', content, 'sources'));
    }
  };
}

// ============================================================
// SOURCE LIFECYCLE ACTION (POST)
// ============================================================

function sourceLifecycleHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);
    const rawState = req.body?.state as string | undefined;
    const validStates = ['active', 'paused', 'disabled', 'archived'] as const;
    type LifecycleState = typeof validStates[number];
    const state = validStates.includes(rawState as LifecycleState) ? rawState as LifecycleState : null;

    if (!state) {
      res.redirect('/event-adapter/admin/sources');
      return;
    }

    try {
      const whereClause = tenantId
        ? and(eq(eventSources.id, id), eq(eventSources.tenantId, tenantId))
        : eq(eventSources.id, id);

      await deps.db
        .update(eventSources)
        .set({ lifecycleState: state, updatedAt: new Date() })
        .where(whereClause);

      res.redirect(`/event-adapter/admin/sources?flash=Source+updated`);
    } catch (err) {
      console.error('[admin] source lifecycle error', err);
      res.redirect('/event-adapter/admin/sources');
    }
  };
}

// ============================================================
// T063: SCHEDULES PAGE
// ============================================================

function schedulesPageHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    const flash = req.query['flash'] ? escapeHtml(String(req.query['flash'])) : null;

    try {
      const rows = tenantId
        ? await deps.db
            .select()
            .from(eventScheduledTasks)
            .where(eq(eventScheduledTasks.tenantId, tenantId))
            .limit(100)
        : await deps.db
            .select()
            .from(eventScheduledTasks)
            .limit(100);

      const tableRows = rows.map((row) => {
        const isPaused = row.lifecycleState === 'paused';
        const isArchived = row.lifecycleState === 'archived';
        const toggleState = isPaused ? 'active' : 'paused';
        const toggleLabel = isPaused ? 'Resume' : 'Pause';

        return `<tr>
          <td><strong>${escapeHtml(row.name)}</strong><br><span class="text-muted mono">${escapeHtml(row.id)}</span></td>
          <td><code class="mono">${escapeHtml(row.cronExpression)}</code></td>
          <td>${escapeHtml(row.timezone)}</td>
          <td>${formatDate(row.nextFireAt)}</td>
          <td>${lifecycleBadge(row.lifecycleState)}</td>
          <td>${formatDate(row.lastFiredAt)}</td>
          <td>
            ${!isArchived ? `
            <form class="inline" method="POST" action="/event-adapter/admin/schedules/${escapeHtml(row.id)}/lifecycle">
              <input type="hidden" name="state" value="${toggleState}">
              <button class="btn btn-sm" type="submit">${toggleLabel}</button>
            </form>
            <form class="inline" method="POST" action="/event-adapter/admin/schedules/${escapeHtml(row.id)}/lifecycle"
                  onsubmit="return confirm('Archive this schedule?')">
              <input type="hidden" name="state" value="archived">
              <button class="btn btn-sm btn-danger" type="submit">Archive</button>
            </form>` : '<span class="text-muted">archived</span>'}
          </td>
        </tr>`;
      }).join('');

      const content = `
        ${tenantId === null ? platformAdminBanner() : ''}
        ${flash ? `<div class="alert alert-success">${flash}</div>` : ''}
        <div class="header">
          <h2>Schedules</h2>
          <span class="text-muted">${rows.length} schedule(s)</span>
        </div>
        ${rows.length === 0 ? `
          <div class="card">
            <div class="empty">No schedules configured.</div>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Cron</th>
                <th>Timezone</th>
                <th>Next Fire</th>
                <th>Status</th>
                <th>Last Fired</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        `}`;

      res.status(200).send(renderLayout('Schedules', content, 'schedules'));
    } catch (err) {
      console.error('[admin] schedules page error', err);
      const content = `<div class="alert alert-warning">Failed to load schedules. Check server logs.</div>`;
      res.status(500).send(renderLayout('Schedules', content, 'schedules'));
    }
  };
}

// ============================================================
// SCHEDULE LIFECYCLE ACTION (POST)
// ============================================================

function scheduleLifecycleHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);
    const rawState = req.body?.state as string | undefined;
    const validStates = ['active', 'paused', 'disabled', 'archived'] as const;
    type LifecycleState = typeof validStates[number];
    const state = validStates.includes(rawState as LifecycleState) ? rawState as LifecycleState : null;

    if (!state) {
      res.redirect('/event-adapter/admin/schedules');
      return;
    }

    try {
      const whereClause = tenantId
        ? and(eq(eventScheduledTasks.id, id), eq(eventScheduledTasks.tenantId, tenantId))
        : eq(eventScheduledTasks.id, id);

      await deps.db
        .update(eventScheduledTasks)
        .set({ lifecycleState: state, updatedAt: new Date() })
        .where(whereClause);

      res.redirect(`/event-adapter/admin/schedules?flash=Schedule+updated`);
    } catch (err) {
      console.error('[admin] schedule lifecycle error', err);
      res.redirect('/event-adapter/admin/schedules');
    }
  };
}

// ============================================================
// T064: ACTIVITY LOG PAGE
// ============================================================

function activityPageHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);

    // Filters from query params
    const statusFilter = req.query['status'] as string | undefined;
    const sourceTypeFilter = req.query['source_type'] as string | undefined;
    const rawOffset = parseInt(String(req.query['offset'] ?? '0'), 10);
    const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);
    const limit = 50;

    const validStatuses = ['pending', 'processing', 'delivered', 'failed', 'dead_letter'];
    const validSourceTypes = ['github', 'generic_webhook', 'schedule', 'automation_callback'];

    const statusOk = statusFilter && validStatuses.includes(statusFilter);
    const sourceTypeOk = sourceTypeFilter && validSourceTypes.includes(sourceTypeFilter);

    const flash = req.query['flash'] ? escapeHtml(String(req.query['flash'])) : null;

    try {
      // Build where conditions array
      const conditions = [];
      if (tenantId) conditions.push(eq(webhookEvents.tenantId, tenantId));
      if (statusOk) {
        conditions.push(eq(webhookEvents.status, statusFilter as 'pending' | 'processing' | 'delivered' | 'failed' | 'dead_letter'));
      }
      if (sourceTypeOk) {
        conditions.push(eq(webhookEvents.sourceType, sourceTypeFilter as 'github' | 'generic_webhook' | 'schedule' | 'automation_callback'));
      }

      const rows = conditions.length > 0
        ? await deps.db
            .select()
            .from(webhookEvents)
            .where(and(...conditions))
            .orderBy(desc(webhookEvents.createdAt))
            .limit(limit)
            .offset(offset)
        : await deps.db
            .select()
            .from(webhookEvents)
            .orderBy(desc(webhookEvents.createdAt))
            .limit(limit)
            .offset(offset);

      const tableRows = rows.map((row) => {
        const canReplay = row.status === 'failed' || row.status === 'dead_letter';
        const durationStr = row.processingDurationMs !== null
          ? `${row.processingDurationMs}ms`
          : '—';

        return `<tr>
          <td class="mono">${formatDate(row.createdAt)}</td>
          <td><span class="badge badge-gray">${escapeHtml(row.sourceType)}</span></td>
          <td><span class="badge badge-gray">${escapeHtml(row.triggerType ?? '—')}</span></td>
          <td class="mono text-muted">${escapeHtml(row.pipelineId ?? '—')}</td>
          <td>${eventStatusBadge(row.status)}</td>
          <td class="text-muted">${escapeHtml(durationStr)}</td>
          <td>
            ${canReplay ? `
            <form class="inline" method="POST" action="/event-adapter/admin/activity/${escapeHtml(row.id)}/replay">
              <button class="btn btn-sm" type="submit">Replay</button>
            </form>` : ''}
          </td>
        </tr>`;
      }).join('');

      const prevOffset = Math.max(offset - limit, 0);
      const nextOffset = offset + limit;
      const showPrev = offset > 0;
      const showNext = rows.length === limit;

      const currentStatusParam = statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : '';
      const currentSourceParam = sourceTypeFilter ? `&source_type=${encodeURIComponent(sourceTypeFilter)}` : '';
      const baseFilterParams = currentStatusParam + currentSourceParam;

      const filterBar = `
        <form class="filters" method="GET" action="/event-adapter/admin/activity">
          <select name="status" onchange="this.form.submit()">
            <option value="">All Statuses</option>
            ${validStatuses.map((s) => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <select name="source_type" onchange="this.form.submit()">
            <option value="">All Source Types</option>
            ${validSourceTypes.map((t) => `<option value="${t}" ${sourceTypeFilter === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <button class="btn btn-sm" type="submit">Filter</button>
          <a class="btn btn-sm" href="/event-adapter/admin/activity">Clear</a>
        </form>`;

      const pagination = `
        <div class="pagination">
          ${showPrev ? `<a class="btn btn-sm" href="/event-adapter/admin/activity?offset=${prevOffset}${baseFilterParams}">← Previous</a>` : ''}
          <span class="text-muted" style="padding: 0.4rem 0.5rem;">Showing ${offset + 1}–${offset + rows.length}</span>
          ${showNext ? `<a class="btn btn-sm" href="/event-adapter/admin/activity?offset=${nextOffset}${baseFilterParams}">Next →</a>` : ''}
        </div>`;

      const content = `
        ${tenantId === null ? platformAdminBanner() : ''}
        ${flash ? `<div class="alert alert-success">${flash}</div>` : ''}
        <div class="header">
          <h2>Activity Log</h2>
        </div>
        ${filterBar}
        ${rows.length === 0 ? `
          <div class="card">
            <div class="empty">No events match the current filters.</div>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Source Type</th>
                <th>Trigger</th>
                <th>Pipeline</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
          ${pagination}
        `}`;

      res.status(200).send(renderLayout('Activity', content, 'activity'));
    } catch (err) {
      console.error('[admin] activity page error', err);
      const content = `<div class="alert alert-warning">Failed to load activity log. Check server logs.</div>`;
      res.status(500).send(renderLayout('Activity', content, 'activity'));
    }
  };
}

// ============================================================
// REPLAY ACTION (POST)
// ============================================================

function replayEventHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);

    try {
      // Enforce tenant scoping
      const whereClause = tenantId
        ? and(eq(webhookEvents.id, id), eq(webhookEvents.tenantId, tenantId))
        : eq(webhookEvents.id, id);

      const [existing] = await deps.db
        .select()
        .from(webhookEvents)
        .where(whereClause);

      if (!existing) {
        res.redirect('/event-adapter/admin/activity');
        return;
      }

      if (existing.status !== 'failed' && existing.status !== 'dead_letter') {
        res.redirect('/event-adapter/admin/activity');
        return;
      }

      await deps.db
        .update(webhookEvents)
        .set({ status: 'pending', attemptCount: 0, updatedAt: new Date() })
        .where(eq(webhookEvents.id, id));

      res.redirect(`/event-adapter/admin/activity?flash=Event+queued+for+replay`);
    } catch (err) {
      console.error('[admin] replay error', err);
      res.redirect('/event-adapter/admin/activity');
    }
  };
}

// ============================================================
// T065: AUTOMATION PAGE
// ============================================================

function automationPageHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    const flash = req.query['flash'] ? escapeHtml(String(req.query['flash'])) : null;

    if (!tenantId) {
      const content = `
        ${platformAdminBanner()}
        <div class="card">
          <p>Select a specific tenant (via <code>x-tenant-id</code> header) to manage automation destinations.</p>
        </div>`;
      res.status(200).send(renderLayout('Automation', content, 'automation'));
      return;
    }

    try {
      const [row] = await deps.db
        .select()
        .from(automationDestinations)
        .where(eq(automationDestinations.tenantId, tenantId));

      const circuitOpen = row ? row.failureCount >= 10 : false;

      const configuredContent = row ? `
        <div class="card">
          <h3 style="margin-bottom:1rem">Current Destination</h3>
          <table style="margin-bottom:1rem">
            <tr><th>URL</th><td><code>${escapeHtml(row.url)}</code></td></tr>
            <tr><th>Status</th><td>${row.isActive ? '<span class="badge badge-green">active</span>' : '<span class="badge badge-red">inactive</span>'}</td></tr>
            <tr><th>Auth Header</th><td>${row.authHeader ? `<code>${escapeHtml(row.authHeader)}</code>` : '<span class="text-muted">none</span>'}</td></tr>
            <tr><th>Secret</th><td>${row.authSecretRef ? '<span class="badge badge-green">set</span>' : '<span class="badge badge-gray">not set</span>'}</td></tr>
            <tr><th>Failure Count</th><td>${row.failureCount}${circuitOpen ? ' <span class="badge badge-red">circuit open</span>' : ''}</td></tr>
            <tr><th>Last Forwarded</th><td>${formatDate(row.lastForwardedAt)}</td></tr>
          </table>
          <form method="POST" action="/event-adapter/admin/automation/disconnect"
                onsubmit="return confirm('Remove the automation destination for this tenant?')">
            <button class="btn btn-danger" type="submit">Disconnect</button>
          </form>
        </div>
        <div class="card">
          <h3 style="margin-bottom:1rem">Update Destination</h3>
          ${renderAutomationForm(row.url, row.authHeader ?? '')}
        </div>
      ` : `
        <div class="card">
          <div class="empty" style="padding: 1.5rem 0">
            <p style="margin-bottom:1rem">No automation destination configured.</p>
            <p class="text-muted">Connect an external automation tool (Activepieces, n8n, Zapier, etc.) to forward events.</p>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:1rem">Register Destination</h3>
          ${renderAutomationForm('', '')}
        </div>
      `;

      const content = `
        ${flash ? `<div class="alert alert-success">${flash}</div>` : ''}
        <div class="header">
          <h2>Automation Destination</h2>
        </div>
        ${configuredContent}`;

      res.status(200).send(renderLayout('Automation', content, 'automation'));
    } catch (err) {
      console.error('[admin] automation page error', err);
      const content = `<div class="alert alert-warning">Failed to load automation config. Check server logs.</div>`;
      res.status(500).send(renderLayout('Automation', content, 'automation'));
    }
  };
}

function renderAutomationForm(currentUrl: string, currentAuthHeader: string): string {
  return `
    <form method="POST" action="/event-adapter/admin/automation/register">
      <div class="form-group">
        <label for="url">Destination URL (HTTPS required)</label>
        <input type="url" id="url" name="url" required placeholder="https://hooks.example.com/webhook/..."
               value="${escapeHtml(currentUrl)}">
        <div class="form-hint">Must be an HTTPS endpoint that accepts POST requests.</div>
      </div>
      <div class="form-group">
        <label for="authHeader">Auth Header Name</label>
        <input type="text" id="authHeader" name="authHeader" placeholder="x-api-key"
               value="${escapeHtml(currentAuthHeader)}">
        <div class="form-hint">Optional. Header name sent with each forwarded event.</div>
      </div>
      <div class="form-group">
        <label for="authSecret">Auth Header Value</label>
        <input type="password" id="authSecret" name="authSecret" placeholder="Leave blank to keep existing secret">
        <div class="form-hint">Optional. Encrypted at rest. Leave blank to keep the current secret.</div>
      </div>
      <button class="btn btn-primary" type="submit">Save</button>
    </form>`;
}

// ============================================================
// AUTOMATION REGISTER ACTION (POST)
// ============================================================

function automationRegisterHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      res.redirect('/event-adapter/admin/automation');
      return;
    }

    const rawUrl = String(req.body?.url ?? '').trim();
    const rawAuthHeader = String(req.body?.authHeader ?? '').trim();
    const rawAuthSecret = String(req.body?.authSecret ?? '').trim();

    if (!rawUrl.startsWith('https://')) {
      const content = `<div class="alert alert-warning">URL must start with https://</div>` +
        `<div class="card">${renderAutomationForm(rawUrl, rawAuthHeader)}</div>`;
      res.status(400).send(renderLayout('Automation', content, 'automation'));
      return;
    }

    try {
      const { encryptSecret } = await import('../services/secret-store.js');
      const authSecretRef = rawAuthSecret ? encryptSecret(rawAuthSecret) : null;

      const [existing] = await deps.db
        .select()
        .from(automationDestinations)
        .where(eq(automationDestinations.tenantId, tenantId));

      if (existing) {
        await deps.db
          .update(automationDestinations)
          .set({
            url: rawUrl,
            authHeader: rawAuthHeader || null,
            authSecretRef: authSecretRef ?? (rawAuthSecret === '' ? existing.authSecretRef : null),
            isActive: true,
            failureCount: 0,
            updatedAt: new Date(),
          })
          .where(eq(automationDestinations.tenantId, tenantId));
      } else {
        await deps.db
          .insert(automationDestinations)
          .values({
            tenantId,
            url: rawUrl,
            authHeader: rawAuthHeader || null,
            authSecretRef,
            isActive: true,
            failureCount: 0,
          });
      }

      res.redirect('/event-adapter/admin/automation?flash=Automation+destination+saved');
    } catch (err) {
      console.error('[admin] automation register error', err);
      res.redirect('/event-adapter/admin/automation');
    }
  };
}

// ============================================================
// AUTOMATION DISCONNECT ACTION (POST)
// ============================================================

function automationDisconnectHandler(deps: AdminRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      res.redirect('/event-adapter/admin/automation');
      return;
    }

    try {
      await deps.db
        .delete(automationDestinations)
        .where(eq(automationDestinations.tenantId, tenantId));

      res.redirect('/event-adapter/admin/automation?flash=Automation+destination+removed');
    } catch (err) {
      console.error('[admin] automation disconnect error', err);
      res.redirect('/event-adapter/admin/automation');
    }
  };
}

// ============================================================
// T066: ROUTE FACTORY
// ============================================================

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();

  // Root redirect
  router.get('/', (_req, res) => {
    res.redirect('/event-adapter/admin/sources');
  });

  // Sources
  router.get('/sources', sourcesPageHandler(deps));
  router.post('/sources/:id/lifecycle', sourceLifecycleHandler(deps));

  // Schedules
  router.get('/schedules', schedulesPageHandler(deps));
  router.post('/schedules/:id/lifecycle', scheduleLifecycleHandler(deps));

  // Activity log
  router.get('/activity', activityPageHandler(deps));
  router.post('/activity/:id/replay', replayEventHandler(deps));

  // Automation destination
  router.get('/automation', automationPageHandler(deps));
  router.post('/automation/register', automationRegisterHandler(deps));
  router.post('/automation/disconnect', automationDisconnectHandler(deps));

  return router;
}
