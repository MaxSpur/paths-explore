import { createFileImporter } from "./io/fileImport";
import { createTrackPersistence } from "./io/persistence";
import { serializeTrack } from "./io/serializers";
import { MapView, type UndoNavigationMode } from "./map/mapView";
import { computeVelocityScaleInfo } from "./map/velocity";
import { COLORMAPS, DEFAULT_COLORMAP_ID, getColormapById } from "./colormaps";
import {
  BundleStore,
  extractBundleTrajectoryAsTrack,
  getAvailableOdMetricCatalog,
  isOdEdgeBundle
} from "./model/bundles";
import { TrackStore } from "./model/store";
import type {
  AnalysisMode,
  AnalysisSettings,
  AppState,
  EditInteractionMode,
  ImportSummary,
  MapBaseStyle,
  MapViewSettings,
  Track,
  VelocityViewSettings
} from "./model/types";
import { bindKeyboardEditor } from "./ui/editor";
import { SidebarView } from "./ui/sidebar";

interface RenderOptions {
  fitToVisible?: boolean;
  fitToTrackIds?: string[];
  fitToBundleIds?: string[];
}

type PointSelectionContext = "none" | "point-click" | "area-select" | "peak-nav";
interface SelectedOdEdge {
  bundleId: string;
  trajectoryId: string;
}

const ANALYSIS_SETTINGS_STORAGE_KEY = "path-segments-analysis-settings-v1";
const LEGACY_VELOCITY_SETTINGS_STORAGE_KEY = "path-segments-velocity-settings-v1";
const MAP_VIEW_SETTINGS_STORAGE_KEY = "path-segments-map-view-settings-v1";
const VELOCITY_MAX_LIMIT = 350;
const MAP_FILTER_PERCENT_LIMIT = 100;
const UNDO_PAN_NAVIGATION_APPLY_DELAY_MS = 150;
const UNDO_TELEPORT_NAVIGATION_APPLY_DELAY_MS = 300;
const PEAK_DELETE_REFOCUS_DELAY_MS = 200;

const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  mode: "off",
  colormapId: DEFAULT_COLORMAP_ID,
  velocityScaleMode: "auto",
  velocityFixedMax: 60,
  odColorMetricKey: "weight",
  odDrawOrderMetricKey: "weight"
};
const DEFAULT_MAP_VIEW_SETTINGS: MapViewSettings = {
  baseStyle: "osm-standard",
  darkenPercent: 0,
  desaturatePercent: 0
};
const MAP_BASE_STYLES = new Set<MapBaseStyle>([
  "osm-standard",
  "carto-light",
  "carto-positron",
  "carto-positron-nolabels",
  "carto-dark",
  "carto-voyager"
]);

function clampVelocityFixedMax(value: number): number {
  return Math.max(0, Math.min(VELOCITY_MAX_LIMIT, value));
}

function clampMapFilterPercent(value: number): number {
  return Math.max(0, Math.min(MAP_FILTER_PERCENT_LIMIT, value));
}

function normalizeAnalysisSettings(
  settings:
    | (Partial<AnalysisSettings> & { odMetric?: string })
    | null
    | undefined
): AnalysisSettings {
  const mode: AnalysisMode =
    settings?.mode === "velocity" ||
    settings?.mode === "acceleration" ||
    settings?.mode === "od"
      ? settings.mode
      : "off";
  const velocityScaleMode = settings?.velocityScaleMode === "fixed" ? "fixed" : "auto";
  const rawVelocityFixedMax =
    typeof settings?.velocityFixedMax === "number"
      ? settings.velocityFixedMax
      : Number.parseFloat(String(settings?.velocityFixedMax ?? Number.NaN));
  const velocityFixedMax = Number.isFinite(rawVelocityFixedMax)
    ? clampVelocityFixedMax(rawVelocityFixedMax)
    : DEFAULT_ANALYSIS_SETTINGS.velocityFixedMax;
  const colormapId = getColormapById(String(settings?.colormapId ?? DEFAULT_COLORMAP_ID)).id;
  const legacyOdMetric =
    settings?.odMetric === "tripCount" || settings?.odMetric === "weight"
      ? settings.odMetric
      : undefined;
  const rawOdColorMetricKey =
    typeof settings?.odColorMetricKey === "string" && settings.odColorMetricKey.length > 0
      ? settings.odColorMetricKey
      : legacyOdMetric ?? DEFAULT_ANALYSIS_SETTINGS.odColorMetricKey;
  const rawOdDrawOrderMetricKey =
    typeof settings?.odDrawOrderMetricKey === "string" && settings.odDrawOrderMetricKey.length > 0
      ? settings.odDrawOrderMetricKey
      : legacyOdMetric ?? DEFAULT_ANALYSIS_SETTINGS.odDrawOrderMetricKey;

  return {
    mode,
    colormapId,
    velocityScaleMode,
    velocityFixedMax,
    odColorMetricKey: rawOdColorMetricKey,
    odDrawOrderMetricKey: rawOdDrawOrderMetricKey
  };
}

function migrateLegacyVelocitySettings(
  settings: Partial<VelocityViewSettings> | null | undefined
): AnalysisSettings {
  const metric = settings?.metric === "acceleration" ? "acceleration" : "velocity";
  const scaleMode = settings?.scaleMode === "fixed" ? "fixed" : "auto";
  const rawFixedMax =
    typeof settings?.fixedMax === "number"
      ? settings.fixedMax
      : Number.parseFloat(String(settings?.fixedMax ?? Number.NaN));
  const fixedMax = Number.isFinite(rawFixedMax)
    ? clampVelocityFixedMax(rawFixedMax)
    : DEFAULT_ANALYSIS_SETTINGS.velocityFixedMax;

  return normalizeAnalysisSettings({
    mode: Boolean(settings?.enabled) ? metric : "off",
    colormapId: String(settings?.colormapId ?? DEFAULT_COLORMAP_ID),
    velocityScaleMode: scaleMode,
    velocityFixedMax: fixedMax,
    odColorMetricKey: DEFAULT_ANALYSIS_SETTINGS.odColorMetricKey,
    odDrawOrderMetricKey: DEFAULT_ANALYSIS_SETTINGS.odDrawOrderMetricKey
  });
}

function deriveVelocityViewSettings(settings: AnalysisSettings): VelocityViewSettings {
  const metric = settings.mode === "acceleration" ? "acceleration" : "velocity";
  const enabled = settings.mode === "velocity" || settings.mode === "acceleration";

  return {
    enabled,
    metric,
    scaleMode: settings.velocityScaleMode,
    fixedMax: settings.velocityFixedMax,
    colormapId: settings.colormapId
  };
}

function normalizeMapViewSettings(
  settings: Partial<MapViewSettings> | null | undefined
): MapViewSettings {
  const baseStyle = MAP_BASE_STYLES.has(settings?.baseStyle as MapBaseStyle)
    ? (settings?.baseStyle as MapBaseStyle)
    : DEFAULT_MAP_VIEW_SETTINGS.baseStyle;
  const rawDarken =
    typeof settings?.darkenPercent === "number"
      ? settings.darkenPercent
      : Number.parseFloat(String(settings?.darkenPercent ?? Number.NaN));
  const rawDesaturate =
    typeof settings?.desaturatePercent === "number"
      ? settings.desaturatePercent
      : Number.parseFloat(String(settings?.desaturatePercent ?? Number.NaN));

  return {
    baseStyle,
    darkenPercent: Number.isFinite(rawDarken)
      ? clampMapFilterPercent(rawDarken)
      : DEFAULT_MAP_VIEW_SETTINGS.darkenPercent,
    desaturatePercent: Number.isFinite(rawDesaturate)
      ? clampMapFilterPercent(rawDesaturate)
      : DEFAULT_MAP_VIEW_SETTINGS.desaturatePercent
  };
}

function loadAnalysisSettings(): AnalysisSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_ANALYSIS_SETTINGS };
  }

  try {
    const raw = localStorage.getItem(ANALYSIS_SETTINGS_STORAGE_KEY);
    if (raw) {
      return normalizeAnalysisSettings(JSON.parse(raw) as Partial<AnalysisSettings>);
    }

    const legacyRaw = localStorage.getItem(LEGACY_VELOCITY_SETTINGS_STORAGE_KEY);
    if (!legacyRaw) {
      return { ...DEFAULT_ANALYSIS_SETTINGS };
    }

    const migrated = migrateLegacyVelocitySettings(
      JSON.parse(legacyRaw) as Partial<VelocityViewSettings>
    );
    try {
      localStorage.setItem(ANALYSIS_SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_VELOCITY_SETTINGS_STORAGE_KEY);
    } catch {
      // Ignore persistence failures during migration.
    }
    return migrated;
  } catch {
    return { ...DEFAULT_ANALYSIS_SETTINGS };
  }
}

function loadMapViewSettings(): MapViewSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_MAP_VIEW_SETTINGS };
  }

  try {
    const raw = localStorage.getItem(MAP_VIEW_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_MAP_VIEW_SETTINGS };
    }

    const parsed = JSON.parse(raw) as Partial<MapViewSettings>;
    return normalizeMapViewSettings(parsed);
  } catch {
    return { ...DEFAULT_MAP_VIEW_SETTINGS };
  }
}

function saveAnalysisSettings(settings: AnalysisSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(ANALYSIS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures (quota/private mode).
  }
}

function saveMapViewSettings(settings: MapViewSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(MAP_VIEW_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures (quota/private mode).
  }
}

function areAnalysisSettingsEqual(
  left: AnalysisSettings,
  right: AnalysisSettings
): boolean {
  return (
    left.mode === right.mode &&
    left.colormapId === right.colormapId &&
    left.velocityScaleMode === right.velocityScaleMode &&
    left.velocityFixedMax === right.velocityFixedMax &&
    left.odColorMetricKey === right.odColorMetricKey &&
    left.odDrawOrderMetricKey === right.odDrawOrderMetricKey
  );
}

function areMapViewSettingsEqual(left: MapViewSettings, right: MapViewSettings): boolean {
  return (
    left.baseStyle === right.baseStyle &&
    left.darkenPercent === right.darkenPercent &&
    left.desaturatePercent === right.desaturatePercent
  );
}

function areTrackPointsStructurallyEqual(left: Track["points"], right: Track["points"]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftPoint = left[index];
    const rightPoint = right[index];
    if (!rightPoint) {
      return false;
    }

    if (
      leftPoint.id !== rightPoint.id ||
      leftPoint.lat !== rightPoint.lat ||
      leftPoint.lng !== rightPoint.lng
    ) {
      return false;
    }
  }

  return true;
}

function collectTrackChangedPoints(previousTrack: Track, nextTrack: Track): Array<{ lat: number; lng: number }> {
  const previousByPointId = new Map(previousTrack.points.map((point) => [point.id, point]));
  const changedPoints: Array<{ lat: number; lng: number }> = [];

  for (const point of nextTrack.points) {
    const previousPoint = previousByPointId.get(point.id);
    if (!previousPoint || previousPoint.lat !== point.lat || previousPoint.lng !== point.lng) {
      changedPoints.push({ lat: point.lat, lng: point.lng });
    }
  }

  return changedPoints;
}

function collectUndoNavigationPoints(
  previousState: AppState,
  nextState: AppState
): Array<{ lat: number; lng: number }> {
  const previousTracksById = new Map(previousState.tracks.map((track) => [track.id, track]));
  const nextTracksById = new Map(nextState.tracks.map((track) => [track.id, track]));
  const candidatePoints: Array<{ lat: number; lng: number }> = [];

  const trackIds = new Set([...previousTracksById.keys(), ...nextTracksById.keys()]);
  for (const trackId of trackIds) {
    const previousTrack = previousTracksById.get(trackId);
    const nextTrack = nextTracksById.get(trackId);

    if (!nextTrack || !nextTrack.visible || nextTrack.points.length === 0) {
      continue;
    }

    if (!previousTrack) {
      candidatePoints.push(...nextTrack.points.map((point) => ({ lat: point.lat, lng: point.lng })));
      continue;
    }

    const becameVisible = !previousTrack.visible && nextTrack.visible;
    const displayModeChanged =
      previousTrack.visible !== nextTrack.visible ||
      previousTrack.showPoints !== nextTrack.showPoints ||
      previousTrack.showSegments !== nextTrack.showSegments;
    const geometryChanged = !areTrackPointsStructurallyEqual(previousTrack.points, nextTrack.points);

    if (!becameVisible && !displayModeChanged && !geometryChanged) {
      continue;
    }

    if (becameVisible || (displayModeChanged && !geometryChanged)) {
      candidatePoints.push(...nextTrack.points.map((point) => ({ lat: point.lat, lng: point.lng })));
      continue;
    }

    const changedPoints = collectTrackChangedPoints(previousTrack, nextTrack);
    if (changedPoints.length > 0) {
      candidatePoints.push(...changedPoints);
      continue;
    }

    candidatePoints.push(...nextTrack.points.map((point) => ({ lat: point.lat, lng: point.lng })));
  }

  const dedupedByKey = new Map<string, { lat: number; lng: number }>();
  for (const point of candidatePoints) {
    dedupedByKey.set(`${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`, point);
  }

  return Array.from(dedupedByKey.values());
}

function getFollowupPointIdAfterDeletion(
  previousTrack: Track | undefined,
  nextTrack: Track | undefined,
  deletedPointIds: string[]
): string | undefined {
  if (!previousTrack || !nextTrack || nextTrack.points.length === 0 || deletedPointIds.length === 0) {
    return undefined;
  }

  const deletedSet = new Set(deletedPointIds);
  const deletedIndices = previousTrack.points
    .map((point, index) => (deletedSet.has(point.id) ? index : -1))
    .filter((index) => index >= 0);
  if (deletedIndices.length === 0) {
    return undefined;
  }

  const anchorIndex = Math.min(...deletedIndices);
  const nextIndex = Math.min(anchorIndex, nextTrack.points.length - 1);
  return nextTrack.points[nextIndex]?.id;
}

function delayMs(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getUndoNavigationDelayMs(mode: UndoNavigationMode): number {
  if (mode === "teleport") {
    return UNDO_TELEPORT_NAVIGATION_APPLY_DELAY_MS;
  }

  if (mode === "pan") {
    return UNDO_PAN_NAVIGATION_APPLY_DELAY_MS;
  }

  return 0;
}

function downloadTrackFile(fileName: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export function createApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app-layout">
      <aside id="sidebar" class="sidebar"></aside>
      <main class="map-shell">
        <div id="map" class="map-view" aria-label="Track map" tabindex="-1"></div>
      </main>
    </div>
  `;

  const sidebarElement = root.querySelector("#sidebar") as HTMLElement;
  const mapElement = root.querySelector("#map") as HTMLElement;

  let editMode: EditInteractionMode = "move";
  let analysisSettings: AnalysisSettings = loadAnalysisSettings();
  let mapViewSettings: MapViewSettings = loadMapViewSettings();
  saveAnalysisSettings(analysisSettings);
  saveMapViewSettings(mapViewSettings);
  const store = new TrackStore();
  const bundleStore = new BundleStore();
  const persistence = createTrackPersistence();
  let latestSummary: ImportSummary | undefined;
  let activeImportStatusMessage: string | undefined;
  let sidebar: SidebarView;
  let mapView: MapView;
  let lastPointSelectionSource: PointSelectionContext = "none";
  let pendingPeakDeleteRefocusTimerId: number | undefined;
  let lastImportedTrackIds: string[] = [];
  let lastImportedBundleIds: string[] = [];
  let selectedOdEdge: SelectedOdEdge | undefined;

  const cancelPendingPeakDeleteRefocus = (): void => {
    if (pendingPeakDeleteRefocusTimerId === undefined) {
      return;
    }

    window.clearTimeout(pendingPeakDeleteRefocusTimerId);
    pendingPeakDeleteRefocusTimerId = undefined;
  };

  const setAnalysisSettings = (next: AnalysisSettings): boolean => {
    const normalized = normalizeAnalysisSettings(next);
    if (areAnalysisSettingsEqual(normalized, analysisSettings)) {
      return false;
    }

    analysisSettings = normalized;
    saveAnalysisSettings(analysisSettings);
    return true;
  };

  const setMapViewSettings = (next: MapViewSettings): boolean => {
    const normalized = normalizeMapViewSettings(next);
    if (areMapViewSettingsEqual(normalized, mapViewSettings)) {
      return false;
    }

    mapViewSettings = normalized;
    saveMapViewSettings(mapViewSettings);
    return true;
  };

  const clearSelectedOdEdgeForBundle = (bundleId: string): void => {
    if (selectedOdEdge?.bundleId === bundleId) {
      selectedOdEdge = undefined;
    }
  };

  const resolveAnalysisSettingsForBundles = (
    settings: AnalysisSettings,
    bundleState: ReturnType<BundleStore["getState"]>
  ): AnalysisSettings => {
    const catalog = getAvailableOdMetricCatalog(bundleState.bundles);
    const availableKeys = new Set(catalog.map((definition) => definition.key));
    const fallbackKey =
      catalog.find((definition) => definition.key === "weight")?.key ??
      catalog[0]?.key ??
      DEFAULT_ANALYSIS_SETTINGS.odColorMetricKey;
    const odColorMetricKey = availableKeys.has(settings.odColorMetricKey)
      ? settings.odColorMetricKey
      : fallbackKey;
    const odDrawOrderMetricKey = availableKeys.has(settings.odDrawOrderMetricKey)
      ? settings.odDrawOrderMetricKey
      : odColorMetricKey;

    if (
      odColorMetricKey === settings.odColorMetricKey &&
      odDrawOrderMetricKey === settings.odDrawOrderMetricKey
    ) {
      return settings;
    }

    return {
      ...settings,
      odColorMetricKey,
      odDrawOrderMetricKey
    };
  };

  const extractOdEdgeAsTrack = (target: SelectedOdEdge | undefined): void => {
    if (!target) {
      return;
    }

    const loadedBundle = bundleStore.getState().bundles.find((bundle) => bundle.id === target.bundleId);
    if (!loadedBundle || !isOdEdgeBundle(loadedBundle)) {
      return;
    }

    const extractedTrack = extractBundleTrajectoryAsTrack(loadedBundle, target.trajectoryId);
    if (!extractedTrack) {
      return;
    }

    const previousTrackIds = new Set(store.getState().tracks.map((track) => track.id));
    store.addTracks([extractedTrack]);
    const extractedTrackIds = store
      .getState()
      .tracks.filter((track) => !previousTrackIds.has(track.id))
      .map((track) => track.id);

    render({ fitToTrackIds: extractedTrackIds });
  };

  const cycleAnalysisColormap = (): void => {
    const currentIndex = COLORMAPS.findIndex((colormap) => colormap.id === analysisSettings.colormapId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % COLORMAPS.length : 0;
    const nextColormap = COLORMAPS[nextIndex];
    if (!nextColormap) {
      return;
    }

    if (
      setAnalysisSettings({
        ...analysisSettings,
        colormapId: nextColormap.id
      })
    ) {
      render();
    }
  };

  const render = (options: RenderOptions = {}): void => {
    const state = store.getState();
    const bundleState = bundleStore.getState();
    const effectiveAnalysisSettings = resolveAnalysisSettingsForBundles(analysisSettings, bundleState);
    const velocitySettings = deriveVelocityViewSettings(effectiveAnalysisSettings);
    const velocityScaleTracks =
      velocitySettings.scaleMode === "auto"
        ? state.tracks.filter((track) => track.visible)
        : state.tracks;
    const velocityScaleInfo = computeVelocityScaleInfo(velocityScaleTracks, velocitySettings);

    sidebar.render(
      state,
      bundleState,
      latestSummary,
      activeImportStatusMessage,
      editMode,
      effectiveAnalysisSettings,
      velocityScaleInfo.maxDisplayValue,
      mapViewSettings
    );
    mapView.setMapViewSettings(mapViewSettings);
    mapView.renderTracks(state.tracks, {
      editingTrackId: state.editingTrackId,
      selectedPointIds: state.selectedPointIds,
      editMode,
      analysisSettings: effectiveAnalysisSettings,
      selectedOdEdge,
      velocitySettings,
      bundles: bundleState.bundles,
      fitToVisible: options.fitToVisible,
      fitToTrackIds: options.fitToTrackIds,
      fitToBundleIds: options.fitToBundleIds
    });
  };

  mapView = new MapView(mapElement, {
    onPointSelected: (trackId, pointId, additive, source) => {
      cancelPendingPeakDeleteRefocus();
      lastPointSelectionSource = source;
      store.togglePointSelection(trackId, pointId, additive);
      render();
    },
    onPointsMoved: (trackId, updates) => {
      store.movePoints(trackId, updates);
      render();
    },
    onAreaSelected: (trackId, pointIds, additive) => {
      cancelPendingPeakDeleteRefocus();
      lastPointSelectionSource = "area-select";
      store.selectPoints(trackId, pointIds, additive);
      render();
    },
    onBundleTrajectorySelected: (bundleId, trajectoryId) => {
      const loadedBundle = bundleStore.getState().bundles.find((bundle) => bundle.id === bundleId);
      if (!loadedBundle) {
        return;
      }

      const extractedTrack = extractBundleTrajectoryAsTrack(loadedBundle, trajectoryId);
      if (!extractedTrack) {
        return;
      }

      const previousTrackIds = new Set(store.getState().tracks.map((track) => track.id));
      store.addTracks([extractedTrack]);
      const extractedTrackIds = store
        .getState()
        .tracks.filter((track) => !previousTrackIds.has(track.id))
        .map((track) => track.id);

      render({ fitToTrackIds: extractedTrackIds });
    },
    onOdEdgeSelected: (bundleId, trajectoryId) => {
      selectedOdEdge = { bundleId, trajectoryId };
      render();
    },
    onExtractSelectedOdEdge: () => {
      extractOdEdgeAsTrack(selectedOdEdge);
    },
    onMapBackgroundClick: () => {
      cancelPendingPeakDeleteRefocus();
      lastPointSelectionSource = "none";
      selectedOdEdge = undefined;
      store.setSelectedPoints(undefined, []);
      render();
    },
    onCycleAnalysisColormap: () => {
      cycleAnalysisColormap();
    }
  });

  const importer = createFileImporter({
    onTracks: (tracks) => {
      const previousTrackIds = new Set(store.getState().tracks.map((track) => track.id));
      store.addTracks(tracks);
      lastImportedTrackIds = store
        .getState()
        .tracks.filter((track) => !previousTrackIds.has(track.id))
        .map((track) => track.id);
    },
    onBundles: (bundles) => {
      const previousBundleIds = new Set(bundleStore.getState().bundles.map((bundle) => bundle.id));
      bundleStore.addBundles(bundles);
      lastImportedBundleIds = bundleStore
        .getState()
        .bundles.filter((bundle) => !previousBundleIds.has(bundle.id))
        .map((bundle) => bundle.id);
    },
    onSummary: (summary) => {
      latestSummary = summary;
      if (
        (summary.importedTrackCount > 0 && lastImportedTrackIds.length > 0) ||
        (summary.importedBundleCount > 0 && lastImportedBundleIds.length > 0)
      ) {
        render({
          fitToTrackIds: lastImportedTrackIds,
          fitToBundleIds: lastImportedBundleIds
        });
      } else {
        render();
      }
      lastImportedTrackIds = [];
      lastImportedBundleIds = [];
    },
    onImportStatusChange: (message) => {
      activeImportStatusMessage = message;
      render();
    }
  });

  sidebar = new SidebarView(sidebarElement, {
    onImportFiles: async (files) => {
      await importer.importFiles(files);
    },
    onToggleVisibility: (trackId, visible) => {
      const state = store.getState();
      if (!visible && state.editingTrackId === trackId) {
        store.setEditingTrack(undefined);
      }
      store.setTrackVisibility(trackId, visible);
      render();
    },
    onTogglePoints: (trackId, show) => {
      store.setTrackPointsVisible(trackId, show);
      render();
    },
    onToggleSegments: (trackId, show) => {
      store.setTrackSegmentsVisible(trackId, show);
      render();
    },
    onMoveTrackUp: (trackId) => {
      store.moveTrack(trackId, "up");
      render();
    },
    onMoveTrackDown: (trackId) => {
      store.moveTrack(trackId, "down");
      render();
    },
    onFocusTrack: (trackId) => {
      mapView.focusTrack(trackId, store.getState().tracks);
    },
    onFocusBundle: (bundleId) => {
      mapView.focusBundle(bundleId);
    },
    onExportTrack: (trackId) => {
      const track = store.getState().tracks.find((candidate) => candidate.id === trackId);
      if (!track) {
        return;
      }

      const serialized = serializeTrack(track);
      downloadTrackFile(serialized.fileName, serialized.mimeType, serialized.content);
    },
    onDeleteTrack: (trackId) => {
      store.removeTrack(trackId);
      render({ fitToVisible: true });
    },
    onToggleBundleVisibility: (bundleId, visible) => {
      bundleStore.setBundleVisibility(bundleId, visible);
      if (!visible) {
        clearSelectedOdEdgeForBundle(bundleId);
      }
      render();
    },
    onToggleBundleOverlays: (bundleId, overlaysVisible) => {
      bundleStore.setBundleOverlaysVisible(bundleId, overlaysVisible);
      render();
    },
    onToggleBundleExtraction: (bundleId, extractionEnabled) => {
      bundleStore.setBundleExtractionEnabled(bundleId, extractionEnabled);
      render();
    },
    onDeleteBundle: (bundleId) => {
      bundleStore.removeBundle(bundleId);
      clearSelectedOdEdgeForBundle(bundleId);
      render({ fitToVisible: true });
    },
    onToggleEdit: (trackId) => {
      const state = store.getState();
      const currentlyEditing = state.editingTrackId;
      const nextEditingTrackId = currentlyEditing === trackId ? undefined : trackId;

      if (nextEditingTrackId) {
        const track = state.tracks.find((candidate) => candidate.id === trackId);
        if (track && !track.visible) {
          store.setTrackVisibility(trackId, true);
        }
      }

      store.setEditingTrack(nextEditingTrackId);
      render();
    },
    onEditModeChange: (mode) => {
      editMode = mode;
      render();
    },
    onAnalysisModeChange: (mode) => {
      setAnalysisSettings({
        ...analysisSettings,
        mode
      });
      render();
    },
    onAnalysisVelocityScaleModeChange: (mode) => {
      setAnalysisSettings({
        ...analysisSettings,
        velocityScaleMode: mode
      });
      render();
    },
    onAnalysisVelocityFixedMaxChange: (maxValue) => {
      if (!Number.isFinite(maxValue)) {
        return;
      }

      setAnalysisSettings({
        ...analysisSettings,
        velocityFixedMax: clampVelocityFixedMax(maxValue)
      });
      render();
    },
    onAnalysisColormapChange: (colormapId) => {
      setAnalysisSettings({
        ...analysisSettings,
        colormapId
      });
      render();
    },
    onAnalysisOdColorMetricKeyChange: (odColorMetricKey) => {
      setAnalysisSettings({
        ...analysisSettings,
        odColorMetricKey
      });
      render();
    },
    onAnalysisOdDrawOrderMetricKeyChange: (odDrawOrderMetricKey) => {
      setAnalysisSettings({
        ...analysisSettings,
        odDrawOrderMetricKey
      });
      render();
    },
    onMapBaseStyleChange: (baseStyle) => {
      setMapViewSettings({
        ...mapViewSettings,
        baseStyle
      });
      render();
    },
    onMapDarkenChange: (darkenPercent) => {
      if (!Number.isFinite(darkenPercent)) {
        return;
      }

      setMapViewSettings({
        ...mapViewSettings,
        darkenPercent: clampMapFilterPercent(darkenPercent)
      });
      render();
    },
    onMapDesaturateChange: (desaturatePercent) => {
      if (!Number.isFinite(desaturatePercent)) {
        return;
      }

      setMapViewSettings({
        ...mapViewSettings,
        desaturatePercent: clampMapFilterPercent(desaturatePercent)
      });
      render();
    }
  });

  importer.bindDropZone(document.body);

  let historyActionQueue: Promise<void> = Promise.resolve();

  const runHistoryAction = async (direction: "undo" | "redo"): Promise<void> => {
    const previousState = store.getState();
    const nextStatePreview = direction === "undo" ? store.peekUndoState() : store.peekRedoState();

    if (!nextStatePreview) {
      return;
    }

    const navigationPoints = collectUndoNavigationPoints(previousState, nextStatePreview);
    const navigationMode = await mapView.focusPointsIfOutsideView(navigationPoints);
    await delayMs(getUndoNavigationDelayMs(navigationMode));

    if (direction === "undo") {
      store.undoEdits();
    } else {
      store.redoEdits();
    }

    render();
  };

  const enqueueHistoryAction = (direction: "undo" | "redo"): Promise<void> => {
    historyActionQueue = historyActionQueue
      .catch(() => undefined)
      .then(() => runHistoryAction(direction));

    return historyActionQueue;
  };

  bindKeyboardEditor({
    getState: () => store.getState(),
    deleteSelectedPoints: () => {
      cancelPendingPeakDeleteRefocus();
      const previousState = store.getState();
      const selectedTrackId = previousState.selectedTrackId;
      const deletedPointIds = [...previousState.selectedPointIds];
      const previousTrack = selectedTrackId
        ? previousState.tracks.find((track) => track.id === selectedTrackId)
        : undefined;

      store.deleteSelectedPoints();
      render();

      if (!selectedTrackId || deletedPointIds.length === 0) {
        lastPointSelectionSource = "none";
        return;
      }

      let followupSelection = undefined as
        | {
            trackId: string;
            pointId: string;
            source: PointSelectionContext;
          }
        | undefined;

      if (lastPointSelectionSource === "peak-nav") {
        pendingPeakDeleteRefocusTimerId = window.setTimeout(() => {
          pendingPeakDeleteRefocusTimerId = undefined;
          mapView.focusCurrentPeakSegment();
          const target = mapView.getCurrentPeakEndpointSelectionTarget();
          if (!target) {
            lastPointSelectionSource = "none";
            return;
          }

          store.setSelectedPoints(target.trackId, [target.pointId]);
          lastPointSelectionSource = "peak-nav";
          render();
        }, PEAK_DELETE_REFOCUS_DELAY_MS);
        return;
      }

      if (!followupSelection) {
        const nextState = store.getState();
        const nextTrack = nextState.tracks.find((track) => track.id === selectedTrackId);
        const pointId = getFollowupPointIdAfterDeletion(previousTrack, nextTrack, deletedPointIds);
        if (pointId) {
          followupSelection = {
            trackId: selectedTrackId,
            pointId,
            source: "point-click"
          };
        }
      }

      if (!followupSelection) {
        lastPointSelectionSource = "none";
        return;
      }

      store.setSelectedPoints(followupSelection.trackId, [followupSelection.pointId]);
      lastPointSelectionSource = followupSelection.source;
      render();
    },
    clearSelection: () => {
      cancelPendingPeakDeleteRefocus();
      lastPointSelectionSource = "none";
      store.setSelectedPoints(undefined, []);
      render();
    },
    undoEdits: () => enqueueHistoryAction("undo"),
    redoEdits: () => enqueueHistoryAction("redo")
  });

  let previousTracks = store.getState().tracks;
  store.subscribe((state) => {
    if (state.tracks === previousTracks) {
      return;
    }

    previousTracks = state.tracks;
    void persistence.saveTracks(state.tracks);
  });

  void (async () => {
    const tracks = await persistence.loadTracks();
    if (tracks.length === 0) {
      return;
    }

    store.hydrateTracks(tracks);
    latestSummary = {
      importedTrackCount: tracks.length,
      importedBundleCount: 0,
      issues: []
    };
    render({ fitToVisible: true });
  })();

  render();
}
