import { createFileImporter } from "./io/fileImport";
import { createTrackPersistence } from "./io/persistence";
import { serializeTrack } from "./io/serializers";
import { MapView } from "./map/mapView";
import { computeVelocityScaleInfo } from "./map/velocity";
import { DEFAULT_COLORMAP_ID } from "./colormaps";
import { TrackStore } from "./model/store";
import type { EditInteractionMode, ImportSummary, VelocityViewSettings } from "./model/types";
import { bindKeyboardEditor } from "./ui/editor";
import { SidebarView } from "./ui/sidebar";

interface RenderOptions {
  fitToVisible?: boolean;
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

  const store = new TrackStore();
  const persistence = createTrackPersistence();
  let latestSummary: ImportSummary | undefined;
  let editMode: EditInteractionMode = "move";
  let velocitySettings: VelocityViewSettings = {
    enabled: false,
    metric: "velocity",
    scaleMode: "auto",
    fixedMax: 60,
    colormapId: DEFAULT_COLORMAP_ID
  };
  let sidebar: SidebarView;
  let mapView: MapView;

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
        velocitySettings = {
          ...velocitySettings,
          enabled: false
        };
        render();
        return;
      }

      velocitySettings = {
        ...velocitySettings,
        enabled: true,
        metric: mode
      };
      render();
    },
    onVelocityScaleModeChange: (mode) => {
      velocitySettings = {
        ...velocitySettings,
        scaleMode: mode
      };
      render();
    },
    onVelocityFixedMaxChange: (maxValue) => {
      if (!Number.isFinite(maxValue)) {
        return;
      }

      velocitySettings = {
        ...velocitySettings,
        fixedMax: Math.max(0, Math.min(350, maxValue))
      };
      render();
    },
    onVelocityColormapChange: (colormapId) => {
      velocitySettings = {
        ...velocitySettings,
        colormapId
      };
      render();
    }
  });

  importer.bindDropZone(document.body);

  bindKeyboardEditor({
    getState: () => store.getState(),
    deleteSelectedPoints: () => {
      store.deleteSelectedPoints();
      render();
    },
    clearSelection: () => {
      store.setSelectedPoints(undefined, []);
      render();
    }
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
