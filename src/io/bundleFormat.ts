import {
  DEFAULT_OD_METRIC_DEFINITIONS,
  type BundleBounds,
  type BundleExtractionTrajectory,
  type BundleManifest,
  type BundleManifestCounts,
  type BundleOdMetricCatalog,
  type BundleOdMetricDefinition,
  type BundleOdMetricFamily,
  type BundleOdMetricVariant,
  type BundleManifestSimplification,
  type BundleOverlayFeature,
  type BundleOverlayGeometryType,
  type BundleOverlayLayer,
  type BundleOverlayLayerDescriptor,
  type BundleOverlayPointFeature,
  type BundleOverlayPolygonFeature,
  type BundleRenderTrajectory,
  type BundleScalar,
  type BundleTrajectoryKind,
  type BundleTrajectoryRef,
  type TrajectoryBundle
} from "../model/bundles";
import type { TrackPoint } from "../model/types";
import { decodeZipEntryText, parseZipCentralDirectory, readFileAsArrayBuffer } from "./zip";

const BUNDLE_EXTENSION = ".psbundle.zip";
const OVERLAY_PROGRESS_INTERVAL = 5_000;

export interface BundleParseOptions {
  onProgress?: (message: string) => void | Promise<void>;
}

async function yieldToUi(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function reportBundleProgress(
  options: BundleParseOptions | undefined,
  message: string
): Promise<void> {
  await options?.onProgress?.(message);
  await yieldToUi();
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
}

function normalizeBundleScalar(value: unknown): BundleScalar | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return undefined;
}

function normalizeProperties(input: unknown): Record<string, BundleScalar> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const output: Record<string, BundleScalar> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeBundleScalar(value);
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeMetricValues(input: unknown): Record<string, number> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = asFiniteNumber(value);
    if (normalized !== null && normalized >= 0) {
      output[key] = normalized;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeBounds(input: unknown): BundleBounds | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const candidate = input as Partial<BundleBounds>;
  const minLat = asFiniteNumber(candidate.minLat);
  const minLng = asFiniteNumber(candidate.minLng);
  const maxLat = asFiniteNumber(candidate.maxLat);
  const maxLng = asFiniteNumber(candidate.maxLng);

  if (
    minLat === null ||
    minLng === null ||
    maxLat === null ||
    maxLng === null ||
    minLat > maxLat ||
    minLng > maxLng
  ) {
    return undefined;
  }

  return {
    minLat,
    minLng,
    maxLat,
    maxLng
  };
}

function normalizeTrajectoryRef(input: unknown, index: number): BundleTrajectoryRef {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid bundle trajectory reference at index ${index}.`);
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
  if (!id) {
    throw new Error(`Bundle trajectory reference ${index} is missing an id.`);
  }

  return {
    id,
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : id,
    pointCount: asNonNegativeInteger(candidate.pointCount) ?? 0,
    simplifiedPointCount: asNonNegativeInteger(candidate.simplifiedPointCount) ?? 0,
    bounds: normalizeBounds(candidate.bounds),
    properties: normalizeProperties(candidate.properties),
    metricValues: normalizeMetricValues(candidate.metricValues)
  };
}

function normalizeManifestCounts(input: unknown): BundleManifestCounts {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      trajectoryCount: 0,
      overlayLayerCount: 0,
      overlayFeatureCount: 0
    };
  }

  const candidate = input as Record<string, unknown>;
  return {
    trajectoryCount: asNonNegativeInteger(candidate.trajectoryCount) ?? 0,
    overlayLayerCount: asNonNegativeInteger(candidate.overlayLayerCount) ?? 0,
    overlayFeatureCount: asNonNegativeInteger(candidate.overlayFeatureCount) ?? 0
  };
}

function normalizeSimplification(input: unknown): BundleManifestSimplification | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const toleranceMeters = asFiniteNumber(candidate.toleranceMeters);
  if (toleranceMeters === null) {
    return undefined;
  }

  return {
    algorithm: "rdp",
    toleranceMeters
  };
}

function normalizeOdMetricDefinition(
  input: unknown,
  index: number
): BundleOdMetricDefinition {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid OD metric definition at index ${index}.`);
  }

  const candidate = input as Record<string, unknown>;
  const key = typeof candidate.key === "string" && candidate.key ? candidate.key : "";
  const label = typeof candidate.label === "string" && candidate.label ? candidate.label : "";
  const sourceKey =
    typeof candidate.sourceKey === "string" && candidate.sourceKey ? candidate.sourceKey : "";
  const sourceLabel =
    typeof candidate.sourceLabel === "string" && candidate.sourceLabel ? candidate.sourceLabel : "";
  const family =
    candidate.family === "numeric" || candidate.family === "category" || candidate.family === "time"
      ? (candidate.family as BundleOdMetricFamily)
      : undefined;

  if (!key || !label || !sourceKey || !sourceLabel || !family) {
    throw new Error(`OD metric definition ${index} is missing required fields.`);
  }

  const variant =
    candidate.variant === "share" || candidate.variant === "subtotal"
      ? (candidate.variant as BundleOdMetricVariant)
      : undefined;

  return {
    key,
    label,
    family,
    sourceKey,
    sourceLabel,
    variant,
    valueKey:
      typeof candidate.valueKey === "string" && candidate.valueKey ? candidate.valueKey : undefined,
    valueLabel:
      typeof candidate.valueLabel === "string" && candidate.valueLabel ? candidate.valueLabel : undefined,
    unitLabel:
      typeof candidate.unitLabel === "string" && candidate.unitLabel ? candidate.unitLabel : undefined,
    order: asNonNegativeInteger(candidate.order) ?? undefined
  };
}

function normalizeOdMetricCatalog(input: unknown): BundleOdMetricCatalog | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.metrics)) {
    return undefined;
  }

  return {
    metrics: candidate.metrics.map(normalizeOdMetricDefinition)
  };
}

function normalizeOverlayDescriptor(input: unknown, index: number): BundleOverlayLayerDescriptor {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid bundle overlay descriptor at index ${index}.`);
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
  if (!id) {
    throw new Error(`Bundle overlay descriptor ${index} is missing an id.`);
  }

  const geometryType =
    candidate.geometryType === "point" || candidate.geometryType === "polygon"
      ? (candidate.geometryType as BundleOverlayGeometryType)
      : undefined;
  if (!geometryType) {
    throw new Error(`Bundle overlay descriptor ${id} has an unsupported geometry type.`);
  }

  return {
    id,
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : id,
    geometryType,
    featureCount: asNonNegativeInteger(candidate.featureCount) ?? 0,
    bounds: normalizeBounds(candidate.bounds)
  };
}

function normalizeLatLngPair(input: unknown, context: string): [number, number] {
  if (!Array.isArray(input) || input.length < 2) {
    throw new Error(`Invalid coordinate pair in ${context}.`);
  }

  const lat = asFiniteNumber(input[0]);
  const lng = asFiniteNumber(input[1]);
  if (lat === null || lng === null) {
    throw new Error(`Invalid coordinate pair in ${context}.`);
  }

  return [lat, lng];
}

function normalizeTrackPoint(input: unknown, context: string): TrackPoint {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid trajectory point in ${context}.`);
  }

  const candidate = input as Record<string, unknown>;
  const lat = asFiniteNumber(candidate.lat);
  const lng = asFiniteNumber(candidate.lng);
  if (lat === null || lng === null) {
    throw new Error(`Invalid trajectory point in ${context}.`);
  }

  const ele = asFiniteNumber(candidate.ele);
  const time = typeof candidate.time === "string" ? candidate.time : undefined;

  return {
    id: "",
    lat,
    lng,
    ...(ele === null ? {} : { ele }),
    ...(time ? { time } : {})
  };
}

function normalizeRenderTrajectory(input: unknown, index: number): BundleRenderTrajectory {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid render trajectory at index ${index}.`);
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
  if (!id) {
    throw new Error(`Render trajectory ${index} is missing an id.`);
  }

  if (!Array.isArray(candidate.path)) {
    throw new Error(`Render trajectory ${id} is missing a path.`);
  }

  return {
    id,
    path: candidate.path.map((value, pointIndex) =>
      normalizeLatLngPair(value, `render trajectory ${id} point ${pointIndex}`)
    )
  };
}

function normalizeExtractionTrajectory(input: unknown, index: number): BundleExtractionTrajectory {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid extraction trajectory at index ${index}.`);
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
  if (!id) {
    throw new Error(`Extraction trajectory ${index} is missing an id.`);
  }

  if (!Array.isArray(candidate.points)) {
    throw new Error(`Extraction trajectory ${id} is missing points.`);
  }

  return {
    id,
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : undefined,
    points: candidate.points.map((value, pointIndex) =>
      normalizeTrackPoint(value, `extraction trajectory ${id} point ${pointIndex}`)
    ),
    properties: normalizeProperties(candidate.properties)
  };
}

function normalizePointFeature(input: unknown, context: string): BundleOverlayPointFeature {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid point feature in ${context}.`);
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : context;

  return {
    id,
    kind: "point",
    coordinates: normalizeLatLngPair(candidate.coordinates, context),
    properties: normalizeProperties(candidate.properties)
  };
}

function normalizePolygonFeature(input: unknown, context: string): BundleOverlayPolygonFeature {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid polygon feature in ${context}.`);
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : context;

  if (!Array.isArray(candidate.rings)) {
    throw new Error(`Polygon feature ${context} is missing rings.`);
  }

  return {
    id,
    kind: "polygon",
    rings: candidate.rings.map((ring, ringIndex) => {
      if (!Array.isArray(ring)) {
        throw new Error(`Polygon feature ${context} has an invalid ring.`);
      }

      return ring.map((coordinate, pointIndex) =>
        normalizeLatLngPair(coordinate, `${context} ring ${ringIndex} point ${pointIndex}`)
      );
    }),
    properties: normalizeProperties(candidate.properties)
  };
}

async function normalizeOverlayLayer(
  input: unknown,
  index: number,
  options?: BundleParseOptions
): Promise<BundleOverlayLayer> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid overlay layer at index ${index}.`);
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
  if (!id) {
    throw new Error(`Overlay layer ${index} is missing an id.`);
  }

  const geometryType =
    candidate.geometryType === "point" || candidate.geometryType === "polygon"
      ? (candidate.geometryType as BundleOverlayGeometryType)
      : undefined;
  if (!geometryType) {
    throw new Error(`Overlay layer ${id} has an unsupported geometry type.`);
  }

  const featuresInput = Array.isArray(candidate.features) ? candidate.features : [];
  const features: BundleOverlayFeature[] = [];
  for (const [featureIndex, feature] of featuresInput.entries()) {
    features.push(
      geometryType === "point"
        ? normalizePointFeature(feature, `overlay ${id} feature ${featureIndex}`)
        : normalizePolygonFeature(feature, `overlay ${id} feature ${featureIndex}`)
    );

    if ((featureIndex + 1) % OVERLAY_PROGRESS_INTERVAL === 0 || featureIndex + 1 === featuresInput.length) {
      await reportBundleProgress(
        options,
        `Normalizing overlay ${candidate.name ?? id} (${featureIndex + 1}/${featuresInput.length})...`
      );
    }
  }

  return {
    id,
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : id,
    geometryType,
    featureCount: asNonNegativeInteger(candidate.featureCount) ?? features.length,
    bounds: normalizeBounds(candidate.bounds),
    features
  };
}

function indexZipEntries(buffer: ArrayBuffer): Map<string, ReturnType<typeof parseZipCentralDirectory>[number]> {
  return new Map(
    parseZipCentralDirectory(buffer)
      .filter((entry) => entry.fileName && !entry.fileName.endsWith("/"))
      .map((entry) => [entry.fileName, entry])
  );
}

async function parseRequiredJson<T>(
  buffer: ArrayBuffer,
  entriesByName: Map<string, ReturnType<typeof parseZipCentralDirectory>[number]>,
  fileName: string,
  context: string,
  options?: BundleParseOptions
): Promise<T> {
  const entry = entriesByName.get(fileName);
  if (!entry) {
    throw new Error(`Bundle is missing ${context} (${fileName}).`);
  }

  await reportBundleProgress(options, `Decompressing ${context}...`);
  const text = await decodeZipEntryText(buffer, entry);

  try {
    await reportBundleProgress(options, `Parsing ${context} JSON...`);
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Bundle contains invalid JSON in ${context} (${fileName}).`);
  }
}

function normalizeManifest(input: unknown): BundleManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Bundle manifest is not an object.");
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
  const name = typeof candidate.name === "string" && candidate.name ? candidate.name : "";
  const renderFile =
    typeof candidate.renderFile === "string" && candidate.renderFile ? candidate.renderFile : "";
  const extractionFile =
    typeof candidate.extractionFile === "string" && candidate.extractionFile
      ? candidate.extractionFile
      : "";
  const trajectoryKind =
    candidate.trajectoryKind === "path" || candidate.trajectoryKind === "od-edge"
      ? (candidate.trajectoryKind as BundleTrajectoryKind)
      : "path";

  if (!id || !name || !renderFile || !extractionFile) {
    throw new Error("Bundle manifest is missing required fields.");
  }

  return {
    version: asNonNegativeInteger(candidate.version) ?? 1,
    id,
    name,
    sourceFiles: Array.isArray(candidate.sourceFiles)
      ? candidate.sourceFiles.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [],
    trajectoryKind,
    bounds: normalizeBounds(candidate.bounds),
    counts: normalizeManifestCounts(candidate.counts),
    simplification: normalizeSimplification(candidate.simplification),
    odMetrics: normalizeOdMetricCatalog(candidate.odMetrics),
    trajectories: Array.isArray(candidate.trajectories)
      ? candidate.trajectories.map(normalizeTrajectoryRef)
      : [],
    overlays: Array.isArray(candidate.overlays)
      ? candidate.overlays.map(normalizeOverlayDescriptor)
      : [],
    renderFile,
    extractionFile,
    overlayFile:
      typeof candidate.overlayFile === "string" && candidate.overlayFile ? candidate.overlayFile : undefined
  };
}

function inferTrajectoryKind(
  manifest: BundleManifest,
  renderTrajectories: BundleRenderTrajectory[],
  extractionTrajectories: BundleExtractionTrajectory[]
): BundleTrajectoryKind {
  if (manifest.trajectories.length === 0) {
    return manifest.trajectoryKind;
  }

  const renderTrajectoryById = new Map(renderTrajectories.map((trajectory) => [trajectory.id, trajectory]));
  const extractionTrajectoryById = new Map(
    extractionTrajectories.map((trajectory) => [trajectory.id, trajectory])
  );

  const looksLikeOdEdge = manifest.trajectories.every((reference) => {
    const renderTrajectory = renderTrajectoryById.get(reference.id);
    const extractionTrajectory = extractionTrajectoryById.get(reference.id);
    const weight = reference.properties?.weight;
    const tripCount = reference.properties?.tripCount;

    return (
      renderTrajectory?.path.length === 2 &&
      extractionTrajectory?.points.length === 2 &&
      typeof weight === "number" &&
      Number.isFinite(weight) &&
      weight > 0 &&
      typeof tripCount === "number" &&
      Number.isFinite(tripCount) &&
      tripCount > 0
    );
  });

  return looksLikeOdEdge ? "od-edge" : "path";
}

function normalizeRenderPayload(input: unknown): BundleRenderTrajectory[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Bundle render payload is not an object.");
  }

  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.trajectories)) {
    throw new Error("Bundle render payload is missing trajectories.");
  }

  return candidate.trajectories.map(normalizeRenderTrajectory);
}

function normalizeExtractionPayload(input: unknown): BundleExtractionTrajectory[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Bundle extraction payload is not an object.");
  }

  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.trajectories)) {
    throw new Error("Bundle extraction payload is missing trajectories.");
  }

  return candidate.trajectories.map(normalizeExtractionTrajectory);
}

async function normalizeOverlayPayload(
  input: unknown,
  options?: BundleParseOptions
): Promise<BundleOverlayLayer[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Bundle overlay payload is not an object.");
  }

  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.layers)) {
    throw new Error("Bundle overlay payload is missing layers.");
  }

  const layers: BundleOverlayLayer[] = [];
  for (const [index, layer] of candidate.layers.entries()) {
    await reportBundleProgress(
      options,
      `Preparing overlay layer ${index + 1}/${candidate.layers.length}...`
    );
    layers.push(await normalizeOverlayLayer(layer, index, options));
  }
  return layers;
}

export function isBundleFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(BUNDLE_EXTENSION);
}

export async function parseBundleArrayBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  options?: BundleParseOptions
): Promise<TrajectoryBundle> {
  await reportBundleProgress(options, "Scanning bundle archive...");
  const entriesByName = indexZipEntries(buffer);

  const manifestInput = await parseRequiredJson<Record<string, unknown>>(
    buffer,
    entriesByName,
    "manifest.json",
    "manifest",
    options
  );
  const hasExplicitTrajectoryKind =
    manifestInput.trajectoryKind === "path" || manifestInput.trajectoryKind === "od-edge";
  let manifest = normalizeManifest(manifestInput);
  await reportBundleProgress(options, "Validating bundle manifest...");

  const renderTrajectories = normalizeRenderPayload(
    await parseRequiredJson(buffer, entriesByName, manifest.renderFile, "render payload", options)
  );
  const extractionTrajectories = normalizeExtractionPayload(
    await parseRequiredJson(
      buffer,
      entriesByName,
      manifest.extractionFile,
      "extraction payload",
      options
    )
  );
  const overlays = manifest.overlayFile
    ? await normalizeOverlayPayload(
        await parseRequiredJson(buffer, entriesByName, manifest.overlayFile, "overlay payload", options),
        options
      )
    : [];

  await reportBundleProgress(options, "Indexing bundle content...");
  const trajectoryRefById = new Map(manifest.trajectories.map((trajectory) => [trajectory.id, trajectory]));
  const renderTrajectoryById = new Map(
    renderTrajectories.map((trajectory) => [trajectory.id, trajectory])
  );
  const extractionTrajectoryById = new Map(
    extractionTrajectories.map((trajectory) => [trajectory.id, trajectory])
  );
  const resolvedTrajectoryKind = hasExplicitTrajectoryKind
    ? manifest.trajectoryKind
    : inferTrajectoryKind(manifest, renderTrajectories, extractionTrajectories);
  const resolvedOdMetrics =
    manifest.odMetrics?.metrics && manifest.odMetrics.metrics.length > 0
      ? manifest.odMetrics
      : resolvedTrajectoryKind === "od-edge"
        ? { metrics: DEFAULT_OD_METRIC_DEFINITIONS.map((definition) => ({ ...definition })) }
        : undefined;

  return {
    id: manifest.id,
    fileName,
    manifest: {
      ...manifest,
      trajectoryKind: resolvedTrajectoryKind,
      odMetrics: resolvedOdMetrics,
      counts: {
        trajectoryCount: manifest.counts.trajectoryCount || manifest.trajectories.length,
        overlayLayerCount: manifest.counts.overlayLayerCount || overlays.length,
        overlayFeatureCount:
          manifest.counts.overlayFeatureCount ||
          overlays.reduce((sum, layer) => sum + layer.features.length, 0)
      }
    },
    renderTrajectories,
    extractionTrajectories,
    overlays,
    trajectoryRefById,
    renderTrajectoryById,
    extractionTrajectoryById
  };
}

export async function parseBundleFile(
  file: File,
  options?: BundleParseOptions
): Promise<TrajectoryBundle> {
  await reportBundleProgress(options, `Reading ${file.name}...`);
  const buffer = await readFileAsArrayBuffer(file);
  return parseBundleArrayBuffer(file.name, buffer, options);
}
