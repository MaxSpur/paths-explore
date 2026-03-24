import { getTrackColor } from "./colors";
import type { OdMetricKey, Track, TrackPoint } from "./types";

export type BundleScalar = string | number | boolean | null;
export type BundleTrajectoryKind = "path" | "od-edge";
export type BundleOdMetricFamily = "numeric" | "category" | "time";
export type BundleOdMetricVariant = "share" | "subtotal";

export interface BundleBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface BundleTrajectoryRef {
  id: string;
  name: string;
  pointCount: number;
  simplifiedPointCount: number;
  bounds?: BundleBounds;
  properties?: Record<string, BundleScalar>;
  metricValues?: Record<string, number>;
}

export interface BundleRenderTrajectory {
  id: string;
  path: Array<[lat: number, lng: number]>;
}

export interface BundleExtractionTrajectory {
  id: string;
  name?: string;
  points: TrackPoint[];
  properties?: Record<string, BundleScalar>;
}

export type BundleOverlayGeometryType = "point" | "polygon";

export interface BundleOverlayPointFeature {
  id: string;
  kind: "point";
  coordinates: [lat: number, lng: number];
  properties?: Record<string, BundleScalar>;
}

export interface BundleOverlayPolygonFeature {
  id: string;
  kind: "polygon";
  rings: Array<Array<[lat: number, lng: number]>>;
  properties?: Record<string, BundleScalar>;
}

export type BundleOverlayFeature = BundleOverlayPointFeature | BundleOverlayPolygonFeature;

export interface BundleOverlayLayerDescriptor {
  id: string;
  name: string;
  geometryType: BundleOverlayGeometryType;
  featureCount: number;
  bounds?: BundleBounds;
}

export interface BundleOverlayLayer extends BundleOverlayLayerDescriptor {
  features: BundleOverlayFeature[];
}

export interface BundleManifestCounts {
  trajectoryCount: number;
  overlayLayerCount: number;
  overlayFeatureCount: number;
}

export interface BundleManifestSimplification {
  algorithm: "rdp";
  toleranceMeters: number;
}

export interface BundleOdMetricDefinition {
  key: string;
  label: string;
  family: BundleOdMetricFamily;
  sourceKey: string;
  sourceLabel: string;
  variant?: BundleOdMetricVariant;
  valueKey?: string;
  valueLabel?: string;
  unitLabel?: string;
  order?: number;
}

export interface BundleOdMetricCatalog {
  metrics: BundleOdMetricDefinition[];
}

export interface BundleManifest {
  version: number;
  id: string;
  name: string;
  sourceFiles: string[];
  trajectoryKind: BundleTrajectoryKind;
  bounds?: BundleBounds;
  counts: BundleManifestCounts;
  simplification?: BundleManifestSimplification;
  odMetrics?: BundleOdMetricCatalog;
  trajectories: BundleTrajectoryRef[];
  overlays: BundleOverlayLayerDescriptor[];
  renderFile: string;
  extractionFile: string;
  overlayFile?: string;
}

export interface TrajectoryBundle {
  id: string;
  fileName: string;
  manifest: BundleManifest;
  renderTrajectories: BundleRenderTrajectory[];
  extractionTrajectories: BundleExtractionTrajectory[];
  overlays: BundleOverlayLayer[];
  trajectoryRefById: Map<string, BundleTrajectoryRef>;
  renderTrajectoryById: Map<string, BundleRenderTrajectory>;
  extractionTrajectoryById: Map<string, BundleExtractionTrajectory>;
}

export interface LoadedTrajectoryBundle {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  overlaysVisible: boolean;
  extractionEnabled: boolean;
  bundle: TrajectoryBundle;
}

export interface BundleState {
  bundles: LoadedTrajectoryBundle[];
}

function clonePoint(point: TrackPoint): TrackPoint {
  return { ...point };
}

function cloneBundle(bundle: LoadedTrajectoryBundle): LoadedTrajectoryBundle {
  return {
    ...bundle,
    bundle: {
      ...bundle.bundle
    }
  };
}

function isFiniteBoundsValue(value: number): boolean {
  return Number.isFinite(value);
}

function asFiniteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export const DEFAULT_OD_METRIC_DEFINITIONS: BundleOdMetricDefinition[] = [
  {
    key: "weight",
    label: "Weight",
    family: "numeric",
    sourceKey: "weight",
    sourceLabel: "Weight",
    unitLabel: "weight",
    order: 0
  },
  {
    key: "tripCount",
    label: "Trip Count",
    family: "numeric",
    sourceKey: "tripCount",
    sourceLabel: "Trip Count",
    unitLabel: "trips",
    order: 1
  }
];

function compareOdMetricDefinitions(
  left: BundleOdMetricDefinition,
  right: BundleOdMetricDefinition
): number {
  const leftOrder = typeof left.order === "number" ? left.order : Number.POSITIVE_INFINITY;
  const rightOrder = typeof right.order === "number" ? right.order : Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  if (left.sourceLabel !== right.sourceLabel) {
    return left.sourceLabel.localeCompare(right.sourceLabel);
  }

  if ((left.variant ?? "") !== (right.variant ?? "")) {
    return (left.variant ?? "").localeCompare(right.variant ?? "");
  }

  if ((left.valueLabel ?? "") !== (right.valueLabel ?? "")) {
    return (left.valueLabel ?? "").localeCompare(right.valueLabel ?? "");
  }

  return left.label.localeCompare(right.label);
}

export function isBundleBoundsValid(bounds: BundleBounds | undefined): bounds is BundleBounds {
  return Boolean(
    bounds &&
      isFiniteBoundsValue(bounds.minLat) &&
      isFiniteBoundsValue(bounds.minLng) &&
      isFiniteBoundsValue(bounds.maxLat) &&
      isFiniteBoundsValue(bounds.maxLng) &&
      bounds.minLat <= bounds.maxLat &&
      bounds.minLng <= bounds.maxLng
  );
}

export function mergeBundleBounds(
  left: BundleBounds | undefined,
  right: BundleBounds | undefined
): BundleBounds | undefined {
  if (!isBundleBoundsValid(left)) {
    return isBundleBoundsValid(right) ? { ...right } : undefined;
  }

  if (!isBundleBoundsValid(right)) {
    return { ...left };
  }

  return {
    minLat: Math.min(left.minLat, right.minLat),
    minLng: Math.min(left.minLng, right.minLng),
    maxLat: Math.max(left.maxLat, right.maxLat),
    maxLng: Math.max(left.maxLng, right.maxLng)
  };
}

export class BundleStore {
  private state: BundleState = { bundles: [] };

  getState(): BundleState {
    return {
      bundles: this.state.bundles.map(cloneBundle)
    };
  }

  addBundles(bundles: TrajectoryBundle[]): void {
    if (bundles.length === 0) {
      return;
    }

    const offset = this.state.bundles.length;
    const normalized = bundles.map((bundle, index) => ({
      id: bundle.id,
      name: bundle.manifest.name || bundle.fileName,
      color: getTrackColor(offset + index),
      visible: true,
      overlaysVisible: bundle.overlays.length > 0,
      extractionEnabled: !isOdEdgeBundle(bundle),
      bundle
    }));

    this.state = {
      bundles: [...this.state.bundles, ...normalized]
    };
  }

  removeBundle(bundleId: string): void {
    this.state = {
      bundles: this.state.bundles.filter((bundle) => bundle.id !== bundleId)
    };
  }

  setBundleVisibility(bundleId: string, visible: boolean): void {
    this.state = {
      bundles: this.state.bundles.map((bundle) =>
        bundle.id === bundleId ? { ...bundle, visible } : bundle
      )
    };
  }

  setBundleOverlaysVisible(bundleId: string, overlaysVisible: boolean): void {
    this.state = {
      bundles: this.state.bundles.map((bundle) =>
        bundle.id === bundleId ? { ...bundle, overlaysVisible } : bundle
      )
    };
  }

  setBundleExtractionEnabled(bundleId: string, extractionEnabled: boolean): void {
    this.state = {
      bundles: this.state.bundles.map((bundle) =>
        bundle.id === bundleId ? { ...bundle, extractionEnabled } : bundle
      )
    };
  }
}

export function getBundleTrajectoryKind(bundle: TrajectoryBundle): BundleTrajectoryKind {
  return bundle.manifest.trajectoryKind;
}

export function isOdEdgeBundle(bundle: TrajectoryBundle | LoadedTrajectoryBundle): boolean {
  const rawBundle = "bundle" in bundle ? bundle.bundle : bundle;
  return getBundleTrajectoryKind(rawBundle) === "od-edge";
}

export function getBundleOdMetricCatalog(
  bundle: TrajectoryBundle | LoadedTrajectoryBundle
): BundleOdMetricDefinition[] {
  const rawBundle = "bundle" in bundle ? bundle.bundle : bundle;
  if (!isOdEdgeBundle(rawBundle)) {
    return [];
  }

  const configured = rawBundle.manifest.odMetrics?.metrics;
  if (!configured || configured.length === 0) {
    return DEFAULT_OD_METRIC_DEFINITIONS.map((definition) => ({ ...definition }));
  }

  return [...configured]
    .map((definition) => ({ ...definition }))
    .sort(compareOdMetricDefinitions);
}

export function getAvailableOdMetricCatalog(
  bundles: Array<TrajectoryBundle | LoadedTrajectoryBundle>
): BundleOdMetricDefinition[] {
  const definitionsByKey = new Map<string, BundleOdMetricDefinition>();

  for (const bundle of bundles) {
    for (const definition of getBundleOdMetricCatalog(bundle)) {
      if (!definitionsByKey.has(definition.key)) {
        definitionsByKey.set(definition.key, { ...definition });
      }
    }
  }

  if (definitionsByKey.size === 0) {
    return DEFAULT_OD_METRIC_DEFINITIONS.map((definition) => ({ ...definition }));
  }

  return Array.from(definitionsByKey.values()).sort(compareOdMetricDefinitions);
}

export function findOdMetricDefinition(
  bundles: Array<TrajectoryBundle | LoadedTrajectoryBundle>,
  metricKey: string
): BundleOdMetricDefinition | undefined {
  return getAvailableOdMetricCatalog(bundles).find((definition) => definition.key === metricKey);
}

export function getOdEdgeMetricValue(
  bundle: TrajectoryBundle,
  trajectoryId: string,
  metricKey: OdMetricKey
): number | undefined {
  const reference = bundle.trajectoryRefById.get(trajectoryId);
  const metricValue = asFiniteNonNegativeNumber(reference?.metricValues?.[metricKey]);
  if (metricValue !== undefined) {
    return metricValue;
  }

  if (metricKey === "weight" || metricKey === "tripCount") {
    return asFiniteNonNegativeNumber(reference?.properties?.[metricKey]);
  }

  return undefined;
}

export function extractBundleTrajectoryAsTrack(
  loadedBundle: LoadedTrajectoryBundle,
  trajectoryId: string
): Track | null {
  const extraction = loadedBundle.bundle.extractionTrajectoryById.get(trajectoryId);
  const reference = loadedBundle.bundle.trajectoryRefById.get(trajectoryId);

  if (!extraction || !reference) {
    return null;
  }

  return {
    id: "",
    name: extraction.name || reference.name || trajectoryId,
    sourceFile: `bundle:${loadedBundle.name}#${trajectoryId}`,
    format: "geojson",
    color: "",
    visible: true,
    showSegments: true,
    showPoints: false,
    points: extraction.points.map(clonePoint)
  };
}
