/**
 * Connector Registry — pre-configured with all built-in connectors.
 *
 * Import `connectorRegistry` from this module to get a ready-to-use
 * registry with `relational-database` and `rest-api` connectors registered.
 */

import { DatabaseConnector } from './database-connector.js';
import { ApiConnector } from './api-connector.js';
import { connectorRegistry } from './registry.js';

// Register built-in connectors
connectorRegistry.register(new DatabaseConnector());
connectorRegistry.register(new ApiConnector());

export { connectorRegistry };
export { ConnectorRegistry } from './registry.js';
export {
  type ContentConnector,
  type ContentPayload,
  type DiscoveryResult,
  type DiscoveredCollection,
  type IndexBatchResult,
  type HealthStatus,
  ConnectorError,
  measureHealth,
} from './interface.js';
export { DatabaseConnector } from './database-connector.js';
export { ApiConnector } from './api-connector.js';
