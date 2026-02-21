/**
 * ConnectorRegistry
 *
 * Maps source type strings to ContentConnector instances, enabling
 * dynamic connector selection at runtime.
 */

import type { ContentConnector } from './interface.js';

export class ConnectorRegistry {
  private connectors = new Map<string, ContentConnector>();

  register(connector: ContentConnector): void {
    this.connectors.set(connector.type, connector);
  }

  get(type: string): ContentConnector | undefined {
    return this.connectors.get(type);
  }

  getOrThrow(type: string): ContentConnector {
    const connector = this.connectors.get(type);
    if (!connector) {
      const available = Array.from(this.connectors.keys()).join(', ');
      throw new Error(
        `No connector registered for type "${type}". Available types: [${available}]`
      );
    }
    return connector;
  }

  list(): string[] {
    return Array.from(this.connectors.keys());
  }
}

export const connectorRegistry = new ConnectorRegistry();
