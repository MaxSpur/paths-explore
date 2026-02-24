import { createFileImporter } from "./io/fileImport";
import { createTrackPersistence } from "./io/persistence";
import { serializeTrack } from "./io/serializers";
import { MapView, type UndoNavigationMode } from "./map/mapView";
import { computeVelocityScaleInfo } from "./map/velocity";
import { DEFAULT_COLORMAP_ID, getColormapById } from "./colormaps";
import { TrackStore } from "./model/store";
import type { AppState, EditInteractionMode, ImportSummary, Track, VelocityViewSettings } from "./model/types";
import { bindKeyboardEditor } from "./ui/editor";
import { SidebarView } from "./ui/sidebar";

interface RenderOptions {
  fitToVisible?: boolean;
}

const VELOCITY_SETTINGS_STORAGE_KEY = "path-segments-velocity-settings-v1";
const VELOCITY_MAX_LIMIT = 350;
const UNDO_PAN_NAVIGATION_APPLY_DELAY_MS = 150;
const UNDO_TELEPORT_NAVIGATION_APPLY_DELAY_MS = 300;

const DEFAULT_VELOCITY_SETTINGS: VelocityViewSettings = {
  enabled: false,
  metric: "velocity",
  scaleMode: "auto",
  fixedMax: 60,
  colormapId: DEFAULT_COLORMAP_ID
};

function clampVelocityFixedMax(value: number): number {
  return Math.max(0, Math.min(VELOCITY_MAX_LIMIT, value));
}

function normalizeVelocitySettings(
  settings: Partial<VelocityViewSettings> | null | undefined
): VelocityViewSettings {
  const metric = settings?.metric === "acceleration" ? "acceleration" : "velocity";
  const scaleMode = settings?.scaleMode === "fixed" ? "fixed" : "auto";
  const rawFixedMax =
    typeof settings?.fixedMax === "number"
      ? settings.fixedMax
      : Number.parseFloat(String(settings?.fixedMax ?? Number.NaN));
  const fixedMax = Number.isFinite(rawFixedMax)
    ? clampVelocityFixedMax(rawFixedMax)
    : DEFAULT_VELOCITY_SETTINGS.fixedMax;
  const colormapId = getColormapById(String(settings?.colormapId ?? DEFAULT_COLORMAP_ID)).id;

  return {
    enabled: Boolean(settings?.enabled),
    metric,
    scaleMode,
    fixedMax,
    colormapId
  };
}

function loadVelocitySettings(): VelocityViewSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_VELOCITY_SETTINGS };
  }

  try {
    const raw = localStorage.getItem(VELOCITY_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_VELOCITY_SETTINGS };
    }

    const parsed = JSON.parse(raw) as Partial<VelocityViewSettings>;
    return normalizeVelocitySettings(parsed);
  } catch {
    return { ...DEFAULT_VELOCITY_SETTINGS };
  }
}

function saveVelocitySettings(settings: VelocityViewSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(VELOCITY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures (quota/private mode).
  }
}

function areVelocitySettingsEqual(
  left: VelocityViewSettings,
  right: VelocityViewSettings
): boolean {
  return (
    left.enabled === right.enabled &&
    left.metric === right.metric &&
    left.scaleMode === right.scaleMode &&
    left.fixedMax === right.fixedMax &&
    left.colormapId === right.colormapId
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
        <div id="map" class="map-view" aria-label="Track map"></div>
      </main>
    </div>
  `;

  const sidebarElement = root.querySelector("#sidebar") as HTMLElement;
  const mapElement = root.querySelector("#map") as HTMLElement;

  let editMode: EditInteractionMode = "move";
  let velocitySettings: VelocityViewSettings = loadVelocitySettings();
  saveVelocitySettings(velocitySettings);
  const store = new TrackStore();
  const persistence = createTrackPersistence();
  let latestSummary: ImportSummary | undefined;
  let sidebar: SidebarView;
  let mapView: MapView;

  const setVelocitySettings = (next: VelocityViewSettings): boolean => {
    const normalized = normalizeVelocitySettings(next);
    if (areVelocitySettingsEqual(normalized, velocitySettings)) {
      return false;
    }

    velocitySettings = normalized;
    saveVelocitySettings(velocitySettings);
    return true;
  };

  const render = (options: RenderOptions = {}): void => {
    const state = store.getState();
    const velocityScaleTracks =
      velocitySettings.scaleMode === "auto"
        ? state.tracks.filter((track) => track.visible)
        : state.tracks;
    const velocityScaleInfo = computeVelocityScaleInfo(velocityScaleTracks, velocitySettings);

    sidebar.render(state, latestSummary, editMode, velocitySettings, velocityScaleInfo.maxDisplayValue);
    mapView.renderTracks(state.tracks, {
      editingTrackId: state.editingTrackId,
      selectedPointIds: state.selectedPointIds,
      editMode,
      velocitySettings,
      fitToVisible: options.fitToVisible
    });
  };

  mapView = new MapView(mapElement, {
    onPointSelected: (trackId, pointId, additive) => {
      store.togglePointSelection(trackId, pointId, additive);
      render();
    },
    onPointsMoved: (trackId, updates) => {
      store.movePoints(trackId, updates);
      render();
    },
    onAreaSelected: (trackId, pointIds, additive) => {
      store.selectPoints(trackId, pointIds, additive);
      render();
    },
    onMapBackgroundClick: () => {
      store.setSelectedPoints(undefined, []);
      render();
    }
  });

  const importer = createFileImporter({
    onTracks: (tracks) => {
      store.addTracks(tracks);
    },
    onSummary: (summary) => {
      latestSummary = summary;
      render({ fitToVisible: true });
    }
  });

  sidebar = new SidebarView(sidebarElement, {
    onImportFiles: async (files) => {
      await importer.importFiles(files);
    },
    onToggleVisibility: (trackId, visible) => {
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
    onVelocityModeChange: (mode) => {
      if (mode === "off") {
        setVelocitySettings({
          ...velocitySettings,
          enabled: false
        });
        render();
        return;
      }

      setVelocitySettings({
        ...velocitySettings,
        enabled: true,
        metric: mode
      });
      render();
    },
    onVelocityScaleModeChange: (mode) => {
      setVelocitySettings({
        ...velocitySettings,
        scaleMode: mode
      });
      render();
    },
    onVelocityFixedMaxChange: (maxValue) => {
      if (!Number.isFinite(maxValue)) {
        return;
      }

      setVelocitySettings({
        ...velocitySettings,
        fixedMax: clampVelocityFixedMax(maxValue)
      });
      render();
    },
    onVelocityColormapChange: (colormapId) => {
      setVelocitySettings({
        ...velocitySettings,
        colormapId
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
      store.deleteSelectedPoints();
      render();
    },
    clearSelection: () => {
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
      issues: []
    };
    render({ fitToVisible: true });
  })();

  render();
}
