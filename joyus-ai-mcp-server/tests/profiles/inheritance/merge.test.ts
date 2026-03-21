/**
 * Unit tests for profiles/inheritance/merge.ts (T019)
 *
 * Pure logic tests — no database or external dependencies.
 */

import { describe, it, expect } from 'vitest';
import { mergeFeatureVectors, mergeMarkers, type ProfileVersion } from '../../../src/profiles/inheritance/merge.js';
import { FEATURE_COUNT } from '../../../src/profiles/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a feature record with `count` features at a fixed base value. */
function makeFeatures(count: number, baseValue = 0.5): Record<string, number> {
  const features: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    features[`feature_${i.toString().padStart(3, '0')}`] = baseValue;
  }
  return features;
}

function makeVersion(
  identity: string,
  features: Record<string, number>,
  overrides: Partial<ProfileVersion> = {},
): ProfileVersion {
  return {
    id: `id-${identity}`,
    profileIdentity: identity,
    version: 1,
    tier: 'base',
    stylometricFeatures: features,
    markers: [],
    ...overrides,
  };
}

// ── mergeFeatureVectors ────────────────────────────────────────────────────

describe('mergeFeatureVectors', () => {
  it('returns empty map for empty chain', () => {
    const { features, overrideSources } = mergeFeatureVectors([]);
    expect(features.size).toBe(0);
    expect(overrideSources).toEqual({});
  });

  it('single-tier profile resolves to its own features unchanged', () => {
    const feats = makeFeatures(FEATURE_COUNT, 0.42);
    const version = makeVersion('org::single', feats, { tier: 'base' });

    const { features, overrideSources } = mergeFeatureVectors([version]);

    expect(features.size).toBe(FEATURE_COUNT);
    expect(overrideSources).toEqual({});

    const first = features.get('feature_000')!;
    expect(first.value).toBe(0.42);
    expect(first.sourceTier).toBe('base');
    expect(first.sourceProfileId).toBe('org::single');
    expect(first.sourceVersion).toBe(1);
  });

  it('3-tier merge: org sets 129 features, dept overrides 3, individual overrides 2', () => {
    const orgFeats = makeFeatures(FEATURE_COUNT, 0.10);

    // dept overrides features 0, 1, 2
    const deptFeats: Record<string, number> = {
      feature_000: 0.20,
      feature_001: 0.21,
      feature_002: 0.22,
    };

    // individual overrides features 0, 3
    const indivFeats: Record<string, number> = {
      feature_000: 0.30,
      feature_003: 0.31,
    };

    const org = makeVersion('org::root', orgFeats, { tier: 'base' });
    const dept = makeVersion('dept::mid', deptFeats, { tier: 'domain' });
    const individual = makeVersion('individual::self', indivFeats, { tier: 'specialized' });

    // chain: [root→self] = [org, dept, individual]
    const { features, overrideSources } = mergeFeatureVectors([org, dept, individual]);

    // All 129 features present
    expect(features.size).toBe(FEATURE_COUNT);

    // feature_000: org→dept→individual, final value from individual
    const f0 = features.get('feature_000')!;
    expect(f0.value).toBe(0.30);
    expect(f0.sourceTier).toBe('specialized');
    expect(f0.sourceProfileId).toBe('individual::self');

    // feature_001: org→dept, final value from dept
    const f1 = features.get('feature_001')!;
    expect(f1.value).toBe(0.21);
    expect(f1.sourceTier).toBe('domain');

    // feature_002: org→dept, final value from dept
    const f2 = features.get('feature_002')!;
    expect(f2.value).toBe(0.22);
    expect(f2.sourceTier).toBe('domain');

    // feature_003: org→individual (skips dept), final value from individual
    const f3 = features.get('feature_003')!;
    expect(f3.value).toBe(0.31);
    expect(f3.sourceTier).toBe('specialized');

    // feature_004 onwards: only set by org
    const f4 = features.get('feature_004')!;
    expect(f4.value).toBe(0.10);
    expect(f4.sourceTier).toBe('base');

    // Override tracking: feature_000 was overridden twice (dept, then individual)
    expect(overrideSources['feature_000']).toBe('individual::self');
    expect(overrideSources['feature_001']).toBe('dept::mid');
    expect(overrideSources['feature_002']).toBe('dept::mid');
    expect(overrideSources['feature_003']).toBe('individual::self');
    // Unoverridden features should not appear in overrideSources
    expect(overrideSources['feature_004']).toBeUndefined();
  });

  it('missing features in a tier do NOT override ancestors', () => {
    // org sets feature_000=0.10; dept does not set feature_000
    const org = makeVersion('org::root', { feature_000: 0.10 }, { tier: 'base' });
    const dept = makeVersion('dept::mid', { feature_001: 0.20 }, { tier: 'domain' });

    const { features } = mergeFeatureVectors([org, dept]);

    // feature_000 keeps the org value
    expect(features.get('feature_000')!.value).toBe(0.10);
    expect(features.get('feature_000')!.sourceTier).toBe('base');

    // feature_001 comes from dept
    expect(features.get('feature_001')!.value).toBe(0.20);
    expect(features.get('feature_001')!.sourceTier).toBe('domain');
  });

  it('nearest-ancestor-wins is deterministic for same feature in multiple tiers', () => {
    const org = makeVersion('org::root', { feature_000: 0.10 }, { tier: 'base' });
    const dept = makeVersion('dept::mid', { feature_000: 0.20 }, { tier: 'domain' });
    const individual = makeVersion('individual::self', { feature_000: 0.30 }, { tier: 'specialized' });

    const { features } = mergeFeatureVectors([org, dept, individual]);

    // The self (most specific) value always wins
    expect(features.get('feature_000')!.value).toBe(0.30);
    expect(features.get('feature_000')!.sourceProfileId).toBe('individual::self');
  });

  it('all 129 features are accounted for when org sets all of them', () => {
    const feats = makeFeatures(FEATURE_COUNT, 0.5);
    const org = makeVersion('org::root', feats, { tier: 'base' });

    const { features } = mergeFeatureVectors([org]);
    expect(features.size).toBe(FEATURE_COUNT);
  });

  it('handles non-numeric feature values gracefully (skips them)', () => {
    const feats: Record<string, number> = { feature_000: 0.5 };
    const org = makeVersion('org::root', feats, { tier: 'base' });
    // Inject a non-numeric value to simulate bad data
    (org.stylometricFeatures as Record<string, unknown>)['bad_feature'] = 'not-a-number';

    const { features } = mergeFeatureVectors([org]);
    expect(features.has('bad_feature')).toBe(false);
    expect(features.has('feature_000')).toBe(true);
  });
});

// ── mergeMarkers ───────────────────────────────────────────────────────────

describe('mergeMarkers', () => {
  const baseMarker = {
    name: 'formal-register',
    threshold: 0.7,
    frequency: 0.8,
    context: 'Uses formal language',
  };

  it('returns empty markers for empty chain', () => {
    const { markers } = mergeMarkers([]);
    expect(markers).toEqual([]);
  });

  it('single-tier: returns own markers with provenance', () => {
    const version = makeVersion('org::root', {}, {
      tier: 'base',
      markers: [baseMarker],
    });

    const { markers } = mergeMarkers([version]);
    expect(markers).toHaveLength(1);
    expect(markers[0].name).toBe('formal-register');
    expect(markers[0].sourceTier).toBe('base');
    expect(markers[0].sourceProfileId).toBe('org::root');
  });

  it('same marker name at multiple tiers: most specific wins', () => {
    const deptMarker = { ...baseMarker, threshold: 0.9, context: 'Overridden by dept' };

    const org = makeVersion('org::root', {}, { tier: 'base', markers: [baseMarker] });
    const dept = makeVersion('dept::mid', {}, { tier: 'domain', markers: [deptMarker] });

    const { markers } = mergeMarkers([org, dept]);
    expect(markers).toHaveLength(1);
    expect(markers[0].threshold).toBe(0.9);
    expect(markers[0].sourceTier).toBe('domain');
    expect(markers[0].sourceProfileId).toBe('dept::mid');
  });

  it('unique markers from different tiers are all included (union)', () => {
    const markerA = { name: 'formal-register', threshold: 0.7, frequency: 0.8, context: 'A' };
    const markerB = { name: 'passive-voice', threshold: 0.5, frequency: 0.6, context: 'B' };

    const org = makeVersion('org::root', {}, { tier: 'base', markers: [markerA] });
    const dept = makeVersion('dept::mid', {}, { tier: 'domain', markers: [markerB] });

    const { markers } = mergeMarkers([org, dept]);
    expect(markers).toHaveLength(2);
    const names = markers.map((m) => m.name);
    expect(names).toContain('formal-register');
    expect(names).toContain('passive-voice');
  });

  it('handles non-array markers value gracefully (skips tier)', () => {
    const version = makeVersion('org::root', {}, { tier: 'base', markers: 'not-an-array' as unknown as unknown[] });

    const { markers } = mergeMarkers([version]);
    expect(markers).toEqual([]);
  });
});
