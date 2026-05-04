/**
 * Tests for ConnectorRegistry — pure in-memory Map operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ConnectorRegistry } from '../../../src/content/connectors/registry.js';

function makeConnector(type: string) {
  return { type, indexBatch: async () => ({ items: [], nextCursor: null }) } as any;
}

describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry();
  });

  it('register and get a connector', () => {
    const connector = makeConnector('api');
    registry.register(connector);

    expect(registry.get('api')).toBe(connector);
  });

  it('returns undefined for unregistered type', () => {
    expect(registry.get('missing')).toBeUndefined();
  });

  it('getOrThrow returns connector when registered', () => {
    registry.register(makeConnector('db'));
    expect(registry.getOrThrow('db')).toBeDefined();
  });

  it('getOrThrow throws with available types listed', () => {
    registry.register(makeConnector('api'));
    registry.register(makeConnector('db'));

    expect(() => registry.getOrThrow('missing')).toThrow(
      'No connector registered for type "missing"',
    );
    expect(() => registry.getOrThrow('missing')).toThrow('api');
  });

  it('list returns all registered types', () => {
    registry.register(makeConnector('api'));
    registry.register(makeConnector('db'));

    expect(registry.list()).toEqual(['api', 'db']);
  });

  it('list returns empty array when no connectors', () => {
    expect(registry.list()).toEqual([]);
  });
});
