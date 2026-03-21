/**
 * Profile Inheritance — Feature Vector Merging (T019)
 *
 * Merges stylometric feature vectors and markers from an ancestor chain
 * using a nearest-ancestor-wins strategy. The chain must be ordered
 * [root, ..., self] so later entries override earlier ones.
 */

import type { ProfileTier, ResolvedFeature, ProfileMarker } from '../types.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Minimal representation of a profile version needed for merging.
 * The full DB row is not required; callers project only these fields.
 */
export interface ProfileVersion {
  id: string;
  profileIdentity: string;
  version: number;
  tier: ProfileTier;
  stylometricFeatures: Record<string, number>;
  markers: unknown;
}

/** A resolved marker: the ProfileMarker value plus its provenance. */
export interface ResolvedMarker extends ProfileMarker {
  sourceTier: ProfileTier;
  sourceProfileId: string;
  sourceVersion: number;
}

/** Output of mergeFeatureVectors. */
export interface MergedFeatures {
  features: Map<string, ResolvedFeature>;
  /** Map of feature name → profile identity that last set this feature. */
  overrideSources: Record<string, string>;
}

/** Output of mergeMarkers. */
export interface MergedMarkers {
  markers: ResolvedMarker[];
}

// ============================================================
// MERGE FUNCTIONS
// ============================================================

/**
 * Merge feature vectors from a profile ancestry chain.
 *
 * @param chain - Ordered [root, ..., self]. Each entry's features override
 *                features set by any previous entry (nearest-ancestor-wins).
 *                Missing keys in a tier do NOT override an ancestor value.
 * @returns Merged feature map with provenance, plus an overrideSources index.
 */
export function mergeFeatureVectors(chain: ProfileVersion[]): MergedFeatures {
  if (chain.length === 0) {
    return { features: new Map(), overrideSources: {} };
  }

  const features = new Map<string, ResolvedFeature>();
  const overrideSources: Record<string, string> = {};

  for (const profile of chain) {
    const profileFeatures = profile.stylometricFeatures;
    if (!profileFeatures || typeof profileFeatures !== 'object') {
      continue;
    }

    for (const [featureName, value] of Object.entries(profileFeatures)) {
      if (typeof value !== 'number') {
        continue;
      }

      const previous = features.get(featureName);

      features.set(featureName, {
        value,
        sourceTier: profile.tier,
        sourceProfileId: profile.profileIdentity,
        sourceVersion: profile.version,
      });

      // Track as override if a prior tier already set this feature
      if (previous !== undefined) {
        overrideSources[featureName] = profile.profileIdentity;
      }
    }
  }

  return { features, overrideSources };
}

/**
 * Merge markers from a profile ancestry chain.
 *
 * Strategy: union across the chain; when the same marker name appears in
 * multiple tiers, the most specific (nearest-to-self) version wins and is
 * annotated with its source tier.
 *
 * @param chain - Ordered [root, ..., self].
 */
export function mergeMarkers(chain: ProfileVersion[]): MergedMarkers {
  if (chain.length === 0) {
    return { markers: [] };
  }

  // Map from marker name → resolved marker (later entries override earlier)
  const markerMap = new Map<string, ResolvedMarker>();

  for (const profile of chain) {
    const rawMarkers = profile.markers;
    if (!Array.isArray(rawMarkers)) {
      continue;
    }

    for (const raw of rawMarkers) {
      if (!isProfileMarkerLike(raw)) {
        continue;
      }

      markerMap.set(raw.name, {
        name: raw.name,
        threshold: raw.threshold,
        frequency: raw.frequency,
        context: raw.context,
        sourceTier: profile.tier,
        sourceProfileId: profile.profileIdentity,
        sourceVersion: profile.version,
      });
    }
  }

  return { markers: Array.from(markerMap.values()) };
}

// ============================================================
// HELPERS
// ============================================================

interface ProfileMarkerLike {
  name: string;
  threshold: number;
  frequency: number;
  context: string;
}

function isProfileMarkerLike(value: unknown): value is ProfileMarkerLike {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['threshold'] === 'number' &&
    typeof v['frequency'] === 'number' &&
    typeof v['context'] === 'string'
  );
}
