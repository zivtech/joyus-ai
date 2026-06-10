import type { GatewayEventService } from '../../gateway-events/event.service.js';

import type { HealthReport } from './health.js';

export class MonitoringGatewayEmitter {
  constructor(private readonly gatewayEvents: Pick<GatewayEventService, 'emitPlatformEvent'>) {}

  async emitHealthAlert(report: HealthReport): Promise<void> {
    if (report.status === 'healthy') {
      return;
    }

    await this.gatewayEvents.emitPlatformEvent({
      tenantId: 'platform',
      type: 'monitoring.alert',
      severity: report.status === 'unhealthy' ? 'critical' : 'warning',
      sourceSpec: 'gateway-event-bus',
      sourceComponent: 'content-monitoring',
      subjectType: 'content_health',
      subjectId: report.timestamp,
      correlationId: `content-health:${report.timestamp}`,
      idempotencyKey: `content-health:${report.timestamp}:${report.status}`,
      payloadSchemaVersion: 'monitoring.alert.v1',
      requiresDecision: true,
      handlerKey: 'monitoring-alert',
      payload: {
        status: report.status,
        components: report.components,
        timestamp: report.timestamp,
      },
      occurredAt: new Date(report.timestamp),
    });
  }
}
